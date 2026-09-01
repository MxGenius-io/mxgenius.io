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
use mxgenius_shared::adapters::weather::AviationWeatherAdapter;
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

    // Local development can use a database too. The parts module is entirely
    // Postgres-backed, so without one every parts route answers
    // "not configured" and none of it can be exercised locally. Production and
    // pilot are unchanged below and still require DATABASE_URL.
    let production_pool = if insecure_local && !pilot {
        match std::env::var("DATABASE_URL") {
            Ok(url) if !url.trim().is_empty() => {
                tracing::warn!(
                    target: "mxgenius.mcp",
                    "insecure-local mode with a database; migrations will be applied"
                );
                let pool = sqlx::postgres::PgPoolOptions::new()
                    .max_connections(5)
                    .connect(&url)
                    .await?;
                sqlx::migrate!("../migrations").run(&pool).await?;
                Some(pool)
            }
            _ => None,
        }
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
        let adapter = mxgenius_mcp::adapters::manual::AzureManualCorpusAdapter::from_env()
            .map_err(|error| anyhow::anyhow!("manual retrieval configuration rejected: {error}"))?;
        adapter
            .validate_contract()
            .await
            .map_err(|error| anyhow::anyhow!("manual retrieval readiness rejected: {error}"))?;
        Arc::new(adapter)
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
        let weather: Option<Arc<dyn AviationWeatherAdapter>> =
            match mxgenius_mcp::adapters::weather::AviationWeatherHttpAdapter::from_env() {
                Ok(adapter) => Some(Arc::new(adapter)),
                Err(error) => {
                    tracing::warn!(target: "mxgenius.mcp", %error, "AviationWeather.gov adapter is not configured");
                    None
                }
            };
        registry_with_adapters(
            case_service,
            evidence_service,
            RegistryAdapters {
                pool: production_pool.clone(),
                manual: manual.clone(),
                jetnet,
                aircraft_catalog,
                faa_ad,
                saib,
                weather,
                allow_fixture_compliance: false,
            },
        )
    };
    let info = mxgenius_mcp::registry::server_info(&registry);
    let auth: ContextProvider = if insecure_local || pilot {
        if pilot {
            tracing::warn!(target: "mxgenius.mcp", "authentication mode: pilot; persistent services enabled");
        }
        // Read only here, and only when this is genuinely a developer machine.
        // The production arm builds `OidcProvider`, whose role comes from
        // `organization_memberships`, and never consults this value.
        //
        // The override is also non-escalating by construction: this arm
        // already runs as Administrator, which every gate in the codebase
        // admits, so no value of the variable can grant authority the mode
        // does not already grant unconditionally. It can only narrow.
        let role = if insecure_local && !pilot {
            insecure_local_role(std::env::var("MXGENIUS_INSECURE_LOCAL_ROLE").ok())?
        } else {
            // `--pilot` shares this arm but runs against a real database with
            // real adapters, so it stays pinned to the role it has today.
            Role::Administrator
        };
        tracing::warn!(
            target: "mxgenius.mcp",
            role = role.as_str(),
            "authentication mode: insecure-local"
        );
        let mut provider = InsecureLocalProvider::new(role);
        // Without a verifier the provider leaves `confirmation` as `None` and
        // every grant-gated parts operation rejects with 428, so receiving
        // confirm, unit transitions, metadata correction, quantity adjust, and
        // split are all unreachable locally. Attach the production verifier
        // whenever the pool and a signing secret are both present.
        match (&production_pool, std::env::var("MXGENIUS_CONFIRMATION_SECRET")) {
            (Some(pool), Ok(secret)) => {
                let verifier = PostgresConfirmationGrantVerifier::new(
                    pool.clone(),
                    secret.as_bytes(),
                    std::env::var("MXGENIUS_CONFIRMATION_ISSUER")
                        .unwrap_or_else(|_| "mxgenius-application".into()),
                    std::env::var("MXGENIUS_CONFIRMATION_AUDIENCE")
                        .unwrap_or_else(|_| "mxgenius-mcp".into()),
                )?;
                provider = provider.with_confirmation_verifier(Arc::new(verifier));
                tracing::info!(
                    target: "mxgenius.mcp",
                    "confirmation grants: enabled (local verifier)"
                );
            }
            (Some(_), Err(_)) => {
                tracing::warn!(
                    target: "mxgenius.mcp",
                    "confirmation grants: disabled; MXGENIUS_CONFIRMATION_SECRET is unset, so \
                     stock-mutating parts operations will reject with 428"
                );
            }
            (None, _) => {}
        }
        Arc::new(provider)
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

/// The role the dev-only provider runs as.
///
/// An unknown name refuses to boot rather than defaulting. Defaulting to
/// Administrator on a typo is the worst outcome available: the developer runs
/// the test they intended, watches a gated action succeed, and concludes
/// either that the gate is broken or -- far worse when checking the positive
/// case -- that the role under test is permitted, when nothing of the sort was
/// verified. The error always points the permissive way. One restart is
/// cheaper than a wrong answer about an airworthiness control.
///
/// Empty or whitespace reads as unset, because `export VAR=` is how a shell
/// clears a variable; the same reading `DATABASE_URL` already gets above.
fn insecure_local_role(raw: Option<String>) -> anyhow::Result<Role> {
    let Some(value) = raw else {
        return Ok(Role::Administrator);
    };
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Ok(Role::Administrator);
    }
    // Normalising here rather than loosening `Role::parse`, which also reads
    // database membership rows where leniency would hide corruption.
    Role::parse(&normalized).ok_or_else(|| {
        anyhow::anyhow!(
            "MXGENIUS_INSECURE_LOCAL_ROLE={value} is not a role; expected one of {}",
            Role::ALL
                .iter()
                .map(|role| role.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unset_or_cleared_variable_keeps_the_default() {
        for raw in [None, Some(String::new()), Some("   ".into())] {
            assert_eq!(insecure_local_role(raw).unwrap(), Role::Administrator);
        }
    }

    #[test]
    fn a_named_role_is_taken_and_may_be_typed_loosely() {
        assert_eq!(insecure_local_role(Some("quality".into())).unwrap(), Role::Quality);
        assert_eq!(insecure_local_role(Some(" Quality ".into())).unwrap(), Role::Quality);
        assert_eq!(
            insecure_local_role(Some("technician".into())).unwrap(),
            Role::Technician
        );
    }

    /// A typo must not quietly become Administrator, and the message has to be
    /// self-correcting.
    #[test]
    fn a_misspelled_role_refuses_to_boot_and_names_the_valid_set() {
        let error = insecure_local_role(Some("qualtiy".into())).unwrap_err();
        let message = error.to_string();
        assert!(message.contains("qualtiy"), "{message}");
        assert!(message.contains("quality"), "{message}");
        assert!(message.contains("administrator"), "{message}");
    }
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
