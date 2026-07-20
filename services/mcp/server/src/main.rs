//! MXGenius MCP server entrypoint.
//!
//! Default mode: Streamable HTTP on `127.0.0.1:3030` at `/mcp`.
//! Pass `--stdio` to use the stdio transport.
//! Pass `--insecure-local` to enable the dev-only authentication provider.

use std::net::SocketAddr;
use std::sync::Arc;

use mxgenius_mcp::application::aircraft_catalog::{AircraftCatalog, PostgresAircraftCatalog};
use mxgenius_mcp::application::case_service::InMemoryCaseService;
use mxgenius_mcp::application::evidence_service::{
    EvidenceService, EvidenceStore, PostgresEvidenceService,
};
use mxgenius_mcp::application::postgres_case_service::PostgresCaseService;
use mxgenius_mcp::context::{
    ContextProvider, InsecureLocalProvider, JwksTokenVerifier, OidcProvider,
    PostgresConfirmationGrantVerifier, PostgresMembershipResolver,
};
use mxgenius_mcp::registry::{default_registry, registry_with_adapters, RegistryAdapters};
use mxgenius_mcp::Dispatcher;
use mxgenius_shared::adapters::faa::{
    FaaAdAdapter, NotConfiguredFaaAdAdapter, NotConfiguredSaibAdapter, SaibAdapter,
};
use mxgenius_shared::adapters::jetnet::{JetNetAdapter, NotConfiguredJetNetAdapter};
use mxgenius_shared::adapters::manual::{ManualCorpusAdapter, NotConfiguredManualAdapter};
use mxgenius_shared::application::policy::Role;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let args: Vec<String> = std::env::args().collect();
    let use_stdio = args.iter().any(|a| a == "--stdio");
    let insecure_local = args.iter().any(|a| a == "--insecure-local");
    let pilot = args.iter().any(|a| a == "--pilot");

    if use_stdio && !insecure_local {
        anyhow::bail!("production OIDC mode requires HTTP request metadata; stdio is local-only");
    }

    let production_pool = if insecure_local && !pilot {
        None
    } else {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(10)
            .connect(&required_env("DATABASE_URL")?)
            .await?;
        sqlx::migrate!("../migrations").run(&pool).await?;
        Some(pool)
    };
    let in_memory_evidence = Arc::new(EvidenceService::new());
    let evidence_service: Arc<dyn EvidenceStore> = match &production_pool {
        Some(pool) => Arc::new(PostgresEvidenceService::new(pool.clone())),
        None => in_memory_evidence.clone(),
    };
    let case_service: Arc<dyn mxgenius_mcp::application::case_service::CaseService> =
        match &production_pool {
            Some(pool) => Arc::new(PostgresCaseService::new(pool.clone())),
            None => Arc::new(InMemoryCaseService::new((*in_memory_evidence).clone())),
        };
    let manual: Arc<dyn ManualCorpusAdapter> = if insecure_local && !pilot {
        Arc::new(NotConfiguredManualAdapter)
    } else {
        match mxgenius_mcp::adapters::manual::AzureManualCorpusAdapter::from_env() {
            Ok(adapter) => Arc::new(adapter),
            Err(error) => {
                tracing::warn!(target: "mxgenius.mcp", %error, "manual corpus adapter is not configured");
                Arc::new(NotConfiguredManualAdapter)
            }
        }
    };
    let registry = if insecure_local && !pilot {
        default_registry(case_service, evidence_service)
    } else {
        let jetnet: Arc<dyn JetNetAdapter> =
            match mxgenius_mcp::adapters::aircraft::JetNetHttpAdapter::from_env() {
                Ok(adapter) => Arc::new(adapter),
                Err(error) => {
                    tracing::warn!(target: "mxgenius.mcp", %error, "JetNet adapter is not configured");
                    Arc::new(NotConfiguredJetNetAdapter)
                }
            };
        let aircraft_catalog: Arc<dyn AircraftCatalog> = Arc::new(PostgresAircraftCatalog::new(
            production_pool.clone().expect("production pool"),
        ));
        let (faa_ad, saib): (Arc<dyn FaaAdAdapter>, Arc<dyn SaibAdapter>) =
            match mxgenius_mcp::adapters::faa::FaaDrsHttpAdapter::from_env() {
                Ok(adapter) => {
                    let adapter = Arc::new(adapter);
                    (adapter.clone(), adapter)
                }
                Err(error) => {
                    tracing::warn!(target: "mxgenius.mcp", %error, "FAA DRS adapter is not configured");
                    (
                        Arc::new(NotConfiguredFaaAdAdapter),
                        Arc::new(NotConfiguredSaibAdapter),
                    )
                }
            };
        registry_with_adapters(
            case_service,
            evidence_service,
            RegistryAdapters {
                manual: manual.clone(),
                jetnet,
                aircraft_catalog,
                faa_ad,
                saib,
                allow_fixture_compliance: false,
            },
        )
    };
    let info = mxgenius_mcp::registry::server_info(&registry);
    let auth: ContextProvider = if insecure_local || pilot {
        if pilot {
            tracing::warn!(target: "mxgenius.mcp", "authentication mode: pilot; persistent services enabled");
        }
        tracing::warn!(target: "mxgenius.mcp", "authentication mode: insecure-local");
        Arc::new(InsecureLocalProvider::new(Role::Administrator))
    } else {
        production_context_provider(production_pool.clone().expect("production pool")).await?
    };
    tracing::info!(
        target: "mxgenius.mcp",
        "starting {} v{} with {} tools, {} resources, {} prompts",
        info.name, info.version, info.tool_count, info.resource_count, info.prompt_count,
    );
    let dispatcher = Dispatcher::new(registry, auth);

    if use_stdio {
        tracing::info!(target: "mxgenius.mcp", "transport: stdio");
        mxgenius_mcp::transport::stdio::run(dispatcher).await
    } else {
        let addr: SocketAddr = std::env::var("MXGENIUS_MCP_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:3030".into())
            .parse()?;
        tracing::info!(target: "mxgenius.mcp", "transport: http (addr={})", addr);
        let health = production_pool
            .map(mxgenius_mcp::transport::http::HealthState::Postgres)
            .unwrap_or(mxgenius_mcp::transport::http::HealthState::Local);
        mxgenius_mcp::transport::http::serve(addr, dispatcher, health, manual).await
    }
}

async fn production_context_provider(pool: sqlx::PgPool) -> anyhow::Result<ContextProvider> {
    let discovery_url = required_env("MXGENIUS_OIDC_DISCOVERY_URL")?;
    let oidc_audience = required_env("MXGENIUS_OIDC_AUDIENCE")?;
    let confirmation_secret = required_env("MXGENIUS_CONFIRMATION_SECRET")?;
    let verifier =
        Arc::new(JwksTokenVerifier::from_discovery(&discovery_url, oidc_audience).await?);
    let memberships = Arc::new(PostgresMembershipResolver::new(pool.clone()));
    let grants = Arc::new(PostgresConfirmationGrantVerifier::new(
        pool,
        confirmation_secret.as_bytes(),
        std::env::var("MXGENIUS_CONFIRMATION_ISSUER")
            .unwrap_or_else(|_| "mxgenius-application".into()),
        std::env::var("MXGENIUS_CONFIRMATION_AUDIENCE").unwrap_or_else(|_| "mxgenius-mcp".into()),
    )?);
    Ok(Arc::new(
        OidcProvider::new(verifier, memberships).with_confirmation_verifier(grants),
    ))
}

fn required_env(name: &str) -> anyhow::Result<String> {
    std::env::var(name)
        .map_err(|_| anyhow::anyhow!("required environment variable {name} is unset"))
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,mxgenius_mcp=info,mxgenius::mcp=info"));
    let use_stdio = std::env::args().any(|a| a == "--stdio");
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact();
    if use_stdio {
        builder.with_writer(std::io::stderr).init();
    } else {
        builder.init();
    }
}
