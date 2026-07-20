//! Aircraft tool handlers (6): `mxg.aircraft.*`.
//!
//! Lookup and profile resolve through a licensed source adapter and a
//! tenant-scoped canonical catalog. The remaining four return typed
//! `NOT_CONFIGURED` envelopes until their sources are mounted.

use std::sync::Arc;

use async_trait::async_trait;
use mxgenius_shared::adapters::jetnet::{JetNetAdapter, JetNetAircraftDto, JetNetLookupQuery};
use mxgenius_shared::adapters::source::AdapterError;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{
    CapabilityEnvelope, EnvelopeError, EnvelopeStatus, PromotionState,
};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    AircraftHistoryWindowRequest, AircraftHistoryWindowResponse, AircraftLocationContextRequest,
    AircraftLocationContextResponse, AircraftLookupRequest, AircraftLookupResponse, AircraftMatch,
    AircraftProfileRequest, AircraftProfileResponse, AircraftRef, AircraftRelatedEntitiesRequest,
    AircraftRelatedEntitiesResponse, AircraftUtilizationSummaryRequest,
    AircraftUtilizationSummaryResponse, LocationKind,
};
use mxgenius_shared::domain::evidence::{ConfidenceBasis, Evidence, EvidenceKind, SourceType};
use mxgenius_shared::domain::ids::EvidenceId;
use sha2::Digest as _;
use uuid::Uuid;

use crate::application::aircraft_catalog::{AircraftCatalog, CanonicalAircraft};
use crate::handlers::{spec, NotConfiguredTool};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    jetnet: Arc<dyn JetNetAdapter>,
    catalog: Arc<dyn AircraftCatalog>,
) {
    reg.register_typed_tool(wrap(Arc::new(AircraftLookupTool {
        jetnet: jetnet.clone(),
        catalog: catalog.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(AircraftProfileTool { jetnet, catalog })));
    reg.register_typed_tool(wrap(Arc::new(AircraftLocationContextTool)));
    reg.register_typed_tool(wrap(Arc::new(AircraftUtilizationSummaryTool)));
    reg.register_typed_tool(wrap(Arc::new(AircraftRelatedEntitiesTool)));
    reg.register_typed_tool(wrap(Arc::new(AircraftHistoryWindowTool)));
}

// 1. lookup ---------------------------------------------------------------

pub struct AircraftLookupTool {
    jetnet: Arc<dyn JetNetAdapter>,
    catalog: Arc<dyn AircraftCatalog>,
}

#[async_trait]
impl Tool for AircraftLookupTool {
    type Request = AircraftLookupRequest;
    type Response = AircraftLookupResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.aircraft.lookup",
            "Aircraft Lookup",
            "Resolve one or more canonical aircraft identifiers by registration, serial, or source id.",
            Action::AircraftRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftLookupRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        if let Err(message) = input.validate() {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message,
                retryable: false,
            });
        }
        let source_rows = match self
            .jetnet
            .lookup(&JetNetLookupQuery {
                registration: input.registration,
                serial_number: input.serial_number,
                source_id: input.source_id,
            })
            .await
        {
            Ok(rows) => rows,
            Err(error) => return Ok(source_failure_lookup(ctx, error)),
        };
        let mut matches = Vec::with_capacity(source_rows.len());
        for source in source_rows {
            let canonical = canonical_aircraft(&source);
            self.catalog
                .upsert(ctx.organization_id, &canonical)
                .await
                .map_err(adapter_envelope_error)?;
            matches.push(AircraftMatch {
                aircraft_id: source.aircraft_id,
                registration: source.registration,
                serial_number: source.serial_number,
                make: source.make,
                model: source.model,
                source_reference: format!("jetnet://aircraft/{}", source.source_id),
                // JetNet has not supplied a record-level source timestamp.
                // Retrieval time is retained in the catalog but is not
                // mislabeled as source freshness.
                source_freshness: None,
            });
        }
        let unique = matches.len();
        let aircraft_id = if unique == 1 {
            Some(matches[0].aircraft_id)
        } else {
            None
        };
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            AircraftLookupResponse {
                aircraft_id,
                matches,
            },
        );
        if unique == 0 {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no aircraft matched the supplied identifiers".into(),
                retryable: false,
            });
        } else if unique > 1 {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::AmbiguousMatch,
                severity: "warn".into(),
                message: format!("{unique} matches found; caller must disambiguate"),
                retryable: false,
            });
        }
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        Ok(env)
    }
}

// 2. profile --------------------------------------------------------------

pub struct AircraftProfileTool {
    jetnet: Arc<dyn JetNetAdapter>,
    catalog: Arc<dyn AircraftCatalog>,
}

#[async_trait]
impl Tool for AircraftProfileTool {
    type Request = AircraftProfileRequest;
    type Response = AircraftProfileResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.aircraft.profile",
            "Aircraft Profile",
            "Return the canonical aircraft profile: identity, make, model, year, status, base, freshness.",
            Action::AircraftRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftProfileRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let mut canonical = self
            .catalog
            .get(ctx.organization_id, input.aircraft_id)
            .await
            .map_err(adapter_envelope_error)?;
        if canonical.is_none() {
            if let Ok(rows) = self.jetnet.lookup(&JetNetLookupQuery::default()).await {
                if let Some(source) = rows
                    .into_iter()
                    .find(|row| row.aircraft_id == input.aircraft_id)
                {
                    let resolved = canonical_aircraft(&source);
                    self.catalog
                        .upsert(ctx.organization_id, &resolved)
                        .await
                        .map_err(adapter_envelope_error)?;
                    canonical = Some(resolved);
                }
            }
        }
        let Some(mut profile) = canonical else {
            return Ok(missing_profile(ctx, input.aircraft_id));
        };
        let mut warning = None;
        match self.jetnet.profile(&profile.source_id).await {
            Ok(source) => {
                profile = canonical_aircraft(&source);
                self.catalog
                    .upsert(ctx.organization_id, &profile)
                    .await
                    .map_err(adapter_envelope_error)?;
            }
            Err(error) => warning = Some(source_warning(error)),
        }
        let source_name = self.jetnet.source_info().await.name;
        let evidence = aircraft_profile_evidence(&profile, &source_name);
        let resp = AircraftProfileResponse {
            aircraft_id: input.aircraft_id,
            registration: profile.registration,
            serial_number: profile.serial_number,
            make: profile.make,
            model: profile.model,
            year: profile.year,
            status: None,
            operator: None,
            owner: None,
            base: profile.base_icao,
            images: vec![],
            source_freshness: None,
        };
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        env.evidence.push(evidence);
        if let Some(warning) = warning {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(warning);
        }
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        Ok(env)
    }
}

fn aircraft_profile_evidence(profile: &CanonicalAircraft, source_name: &str) -> Evidence {
    let content = serde_json::json!({
        "aircraft_id": profile.aircraft_id,
        "registration": profile.registration,
        "serial_number": profile.serial_number,
        "make": profile.make,
        "model": profile.model,
        "year": profile.year,
        "base_icao": profile.base_icao,
    })
    .to_string();
    let content_hash = format!(
        "sha256:{}",
        hex::encode(sha2::Sha256::digest(content.as_bytes()))
    );
    let source_reference = if source_name == "jetnet_fixture" {
        "fixture://jetnet/profile".into()
    } else {
        format!("jetnet://aircraft/{}", profile.source_id)
    };
    Evidence {
        evidence_id: EvidenceId(Uuid::new_v5(
            &Uuid::from_u128(0x3a4c5b6c_2c7e_4f47_9a3e_2a2a2a2a2a2a),
            content_hash.as_bytes(),
        )),
        source_type: SourceType::Jetnet,
        source_reference,
        kind: EvidenceKind::RetrievedFact,
        title: "Canonical aircraft profile".into(),
        excerpt: None,
        retrieved_at: profile.freshness_at,
        effective_at: None,
        revision: None,
        license_scope: Some(if source_name == "jetnet_fixture" {
            "sanitized_fixture".into()
        } else {
            "configured_customer_account".into()
        }),
        content_hash,
        retrieval_score: None,
        assets: vec![],
        content,
    }
}

fn canonical_aircraft(source: &JetNetAircraftDto) -> CanonicalAircraft {
    CanonicalAircraft {
        aircraft_id: source.aircraft_id,
        source_system: "jetnet".into(),
        source_id: source.source_id.clone(),
        registration: source.registration.clone(),
        serial_number: source.serial_number.clone(),
        make: source.make.clone(),
        model: source.model.clone(),
        year: source.year,
        base_icao: source.base_icao.clone(),
        freshness_at: time::OffsetDateTime::now_utc(),
    }
}

fn source_failure_lookup(
    ctx: &ExecutionContext,
    error: AdapterError,
) -> CapabilityEnvelope<AircraftLookupResponse> {
    let mut env = CapabilityEnvelope::new(
        ctx.request_id.0,
        AircraftLookupResponse {
            aircraft_id: None,
            matches: vec![],
        },
    );
    env.status = EnvelopeStatus::Partial;
    env.promotion_state = PromotionState::Shadow;
    env.warnings.push(source_warning(error));
    env.confidence.score = 0.0;
    env
}

fn missing_profile(
    ctx: &ExecutionContext,
    aircraft_id: mxgenius_shared::domain::ids::AircraftId,
) -> CapabilityEnvelope<AircraftProfileResponse> {
    let mut env = CapabilityEnvelope::new(
        ctx.request_id.0,
        AircraftProfileResponse {
            aircraft_id,
            registration: None,
            serial_number: None,
            make: None,
            model: None,
            year: None,
            status: None,
            operator: None,
            owner: None,
            base: None,
            images: vec![],
            source_freshness: None,
        },
    );
    env.status = EnvelopeStatus::Partial;
    env.warnings.push(EnvelopeError {
        code: StableErrorCode::EntityNotFound,
        severity: "warn".into(),
        message: "aircraft is not present in this tenant's canonical catalog".into(),
        retryable: false,
    });
    env
}

fn adapter_envelope_error(error: AdapterError) -> EnvelopeError {
    EnvelopeError {
        code: StableErrorCode::InternalError,
        severity: "error".into(),
        message: error.to_string(),
        retryable: true,
    }
}

fn source_warning(error: AdapterError) -> EnvelopeError {
    let (code, retryable) = match error {
        AdapterError::NotConfigured { .. } => (StableErrorCode::NotConfigured, false),
        AdapterError::InvalidInput(_) => (StableErrorCode::InvalidInput, false),
        _ => (StableErrorCode::SourceUnavailable, true),
    };
    EnvelopeError {
        code,
        severity: "warn".into(),
        message: error.to_string(),
        retryable,
    }
}

// 3-6. typed not-configured ----------------------------------------------

pub struct AircraftLocationContextTool;
#[async_trait]
impl Tool for AircraftLocationContextTool {
    type Request = AircraftLocationContextRequest;
    type Response = AircraftLocationContextResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.aircraft.location_context",
            "Aircraft Location Context",
            "Return the known base or licensed location. Never live tracking unless source supports it.",
            Action::AircraftRead, false)
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftLocationContextRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        location_context_stub().invoke(ctx, input).await
    }
}

fn location_context_stub(
) -> NotConfiguredTool<AircraftLocationContextRequest, AircraftLocationContextResponse> {
    NotConfiguredTool::new(
        "mxg.aircraft.location_context",
        "Aircraft Location Context",
        "Return the known base or licensed location. Never live tracking unless source supports it.",
        Action::AircraftRead, false,
        |input: AircraftLocationContextRequest| -> AircraftLocationContextResponse {
            AircraftLocationContextResponse {
                aircraft_id: input.aircraft_id,
                kind: LocationKind::Unknown,
                airport_icao: None, airport_iata: None, coordinates: None,
                jurisdiction_country: None, timestamp: None,
                source_reference: None, live_tracking_supported: false,
            }
        },
    )
}

pub struct AircraftUtilizationSummaryTool;
#[async_trait]
impl Tool for AircraftUtilizationSummaryTool {
    type Request = AircraftUtilizationSummaryRequest;
    type Response = AircraftUtilizationSummaryResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.aircraft.utilization_summary",
            "Aircraft Utilization Summary",
            "Return airframe hours, cycles, age, trend, and source timestamps.",
            Action::AircraftRead,
            false,
        )
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftUtilizationSummaryRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        utilization_stub().invoke(ctx, input).await
    }
}

fn utilization_stub(
) -> NotConfiguredTool<AircraftUtilizationSummaryRequest, AircraftUtilizationSummaryResponse> {
    NotConfiguredTool::new(
        "mxg.aircraft.utilization_summary",
        "Aircraft Utilization Summary",
        "Return airframe hours, cycles, age, trend, and source timestamps.",
        Action::AircraftRead,
        false,
        |input: AircraftUtilizationSummaryRequest| -> AircraftUtilizationSummaryResponse {
            AircraftUtilizationSummaryResponse {
                aircraft_id: input.aircraft_id,
                airframe_hours: None,
                estimated_hours: None,
                cycles: None,
                age_years: None,
                trend: None,
                source_timestamps: vec![],
                missing_fields: vec!["airframe_hours".into(), "cycles".into()],
            }
        },
    )
}

pub struct AircraftRelatedEntitiesTool;
#[async_trait]
impl Tool for AircraftRelatedEntitiesTool {
    type Request = AircraftRelatedEntitiesRequest;
    type Response = AircraftRelatedEntitiesResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.aircraft.related_entities",
            "Aircraft Related Entities",
            "Return owner, operator, companies, and contacts as canonical references.",
            Action::AircraftRead,
            false,
        )
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftRelatedEntitiesRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        related_entities_stub().invoke(ctx, input).await
    }
}

fn related_entities_stub(
) -> NotConfiguredTool<AircraftRelatedEntitiesRequest, AircraftRelatedEntitiesResponse> {
    NotConfiguredTool::new(
        "mxg.aircraft.related_entities",
        "Aircraft Related Entities",
        "Return owner, operator, companies, and contacts as canonical references.",
        Action::AircraftRead,
        false,
        |input: AircraftRelatedEntitiesRequest| -> AircraftRelatedEntitiesResponse {
            AircraftRelatedEntitiesResponse {
                aircraft_id: input.aircraft_id,
                entities: vec![],
            }
        },
    )
}

pub struct AircraftHistoryWindowTool;
#[async_trait]
impl Tool for AircraftHistoryWindowTool {
    type Request = AircraftHistoryWindowRequest;
    type Response = AircraftHistoryWindowResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.aircraft.history_window",
            "Aircraft History Window",
            "Return bounded licensed history events within a date range.",
            Action::AircraftRead,
            false,
        )
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftHistoryWindowRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        history_window_stub().invoke(ctx, input).await
    }
}

fn history_window_stub(
) -> NotConfiguredTool<AircraftHistoryWindowRequest, AircraftHistoryWindowResponse> {
    NotConfiguredTool::new(
        "mxg.aircraft.history_window",
        "Aircraft History Window",
        "Return bounded licensed history events within a date range.",
        Action::AircraftRead,
        false,
        |input: AircraftHistoryWindowRequest| -> AircraftHistoryWindowResponse {
            AircraftHistoryWindowResponse {
                aircraft_id: input.aircraft_id,
                events: vec![],
                source_timestamps: vec![],
                completeness: "unknown".into(),
                drill_through: vec![],
            }
        },
    )
}

// Lint satisfaction
#[allow(dead_code)]
fn _aircraft_ref_unused(_: &AircraftRef) {}
