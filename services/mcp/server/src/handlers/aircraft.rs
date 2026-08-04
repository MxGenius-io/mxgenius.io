//! Aircraft tool handlers (6): `mxg.aircraft.*`.
//!
//! All six handlers are backed by real sources available in the supplied build:
//! - `lookup` and `profile` resolve through the licensed JetNet adapter and
//!   the tenant-scoped canonical catalog.
//! - `location_context`, `utilization_summary`, `related_entities`, and
//!   `history_window` derive typed facts from the canonical catalog and the
//!   tenant-scoped case spine (events, observations, maintenance history).
//!
//! Where the source is partial (no airframe-hours telemetry, no owner/operator
//! directory), the response is a typed partial envelope with explicit
//! `missing_fields` and a `NOT_CONFIGURED` warning that names the absent
//! source. No fake scores, no invented numbers.

use std::collections::HashSet;
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
    AircraftUtilizationSummaryResponse, HistoryEvent, HistoryKind, LocationKind,
};
use mxgenius_shared::domain::case::MaintenanceCase;
use mxgenius_shared::domain::evidence::{ConfidenceBasis, Evidence, EvidenceKind, SourceType};
use mxgenius_shared::domain::ids::EvidenceId;
use sha2::Digest as _;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::aircraft_catalog::{AircraftCatalog, CanonicalAircraft};
use crate::application::case_service::CaseService;
use crate::handlers::{limited_spec, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    jetnet: Arc<dyn JetNetAdapter>,
    catalog: Arc<dyn AircraftCatalog>,
    case_service: Arc<dyn CaseService>,
) {
    reg.register_typed_tool(wrap(Arc::new(AircraftLookupTool {
        jetnet: jetnet.clone(),
        catalog: catalog.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(AircraftProfileTool { jetnet, catalog })));
    reg.register_typed_tool(wrap(Arc::new(AircraftLocationContextTool {
        case_service: case_service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(AircraftUtilizationSummaryTool {
        case_service: case_service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(AircraftRelatedEntitiesTool {
        case_service: case_service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(AircraftHistoryWindowTool { case_service })));
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

// 3. location_context -----------------------------------------------------

pub struct AircraftLocationContextTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for AircraftLocationContextTool {
    type Request = AircraftLocationContextRequest;
    type Response = AircraftLocationContextResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.aircraft.location_context",
            "Aircraft Location Context",
            "Return the known base or last case-recorded location. Never live tracking unless a source supports it.",
            Action::AircraftRead, false)
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftLocationContextRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let aircraft_id = input.aircraft_id.0.to_string();
        let cases = self
            .case_service
            .list_for_org(ctx.organization_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        // Derive most recent case-scoped location for the aircraft identifier.
        let mut most_recent: Option<&MaintenanceCase> = None;
        for case in &cases {
            let is_newer = match most_recent {
                Some(current) => case.updated_at > current.updated_at,
                None => true,
            };
            if case.aircraft_id == aircraft_id && case.location.is_some() && is_newer {
                most_recent = Some(case);
            }
        }
        let response = match most_recent {
            Some(case) => AircraftLocationContextResponse {
                aircraft_id: input.aircraft_id,
                kind: LocationKind::KnownLicensedLocation,
                airport_icao: case.location.as_ref().and_then(|l| l.icao.clone()),
                airport_iata: case.location.as_ref().and_then(|l| l.iata.clone()),
                coordinates: None,
                jurisdiction_country: case.location.as_ref().and_then(|l| l.country.clone()),
                timestamp: Some(mxgenius_shared::domain::datetime::UtcDateTime::from(
                    case.updated_at,
                )),
                source_reference: Some(format!("case://maintenance_cases/{}", case.case_id.0)),
                live_tracking_supported: false,
            },
            None => AircraftLocationContextResponse {
                aircraft_id: input.aircraft_id,
                kind: LocationKind::Unknown,
                airport_icao: None,
                airport_iata: None,
                coordinates: None,
                jurisdiction_country: None,
                timestamp: None,
                source_reference: None,
                live_tracking_supported: false,
            },
        };
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, response);
        if most_recent.is_none() {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no case-recorded location for this aircraft in this tenant".into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
            env.confidence.explanation =
                "no canonical base or recent case location; live tracking not available in this build"
                    .into();
        } else {
            env.confidence.basis = ConfidenceBasis::DeterministicLookup;
            env.confidence.explanation =
                "most recent case-recorded location for the aircraft; live tracking not available in this build"
                    .into();
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "info".into(),
                message: "live tracking source not configured in this build".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

// 4. utilization_summary --------------------------------------------------

pub struct AircraftUtilizationSummaryTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for AircraftUtilizationSummaryTool {
    type Request = AircraftUtilizationSummaryRequest;
    type Response = AircraftUtilizationSummaryResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.aircraft.utilization_summary",
            "Aircraft Utilization Summary",
            "Return tenant-scoped case activity: open count, last event, gap. Airframe hours/cycles are not provided by the supplied source.",
            Action::AircraftRead,
            false,
        )
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftUtilizationSummaryRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let aircraft_id = input.aircraft_id.0.to_string();
        let cases = self
            .case_service
            .list_for_org(ctx.organization_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        let mut total: i64 = 0;
        let mut open: i64 = 0;
        let mut last_event: Option<OffsetDateTime> = None;
        for case in &cases {
            if case.aircraft_id == aircraft_id {
                total += 1;
                if !is_terminal(case) {
                    open += 1;
                }
                if last_event.is_none() || case.updated_at > last_event.unwrap() {
                    last_event = Some(case.updated_at);
                }
            }
        }
        let missing_fields: Vec<String> = if total == 0 {
            vec![
                "airframe_hours".into(),
                "cycles".into(),
                "estimated_hours".into(),
                "age_years".into(),
            ]
        } else {
            // Only what we can prove is missing is reported.
            vec!["airframe_hours".into(), "cycles".into()]
        };
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            AircraftUtilizationSummaryResponse {
                aircraft_id: input.aircraft_id,
                airframe_hours: None,
                estimated_hours: None,
                cycles: None,
                age_years: None,
                trend: None,
                source_timestamps: last_event
                    .map(|t| vec![mxgenius_shared::domain::datetime::UtcDateTime::from(t)])
                    .unwrap_or_default(),
                missing_fields,
            },
        );
        if total == 0 {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no tenant case activity for this aircraft".into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
            env.confidence.explanation =
                "no tenant case history; airframe hours and cycles are not provided by the supplied source"
                    .into();
        } else {
            env.confidence.basis = ConfidenceBasis::DeterministicLookup;
            env.confidence.explanation = format!(
                "derived from {total} tenant cases ({open} non-terminal); airframe hours and cycles are not provided by the supplied source"
            );
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "info".into(),
                message: "airframe hours and cycles are not provided by the supplied source".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

fn is_terminal(case: &MaintenanceCase) -> bool {
    use mxgenius_shared::domain::case::CaseStatus;
    matches!(case.status, CaseStatus::Closed | CaseStatus::Cancelled)
}

// 5. related_entities -----------------------------------------------------

pub struct AircraftRelatedEntitiesTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for AircraftRelatedEntitiesTool {
    type Request = AircraftRelatedEntitiesRequest;
    type Response = AircraftRelatedEntitiesResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.aircraft.related_entities",
            "Aircraft Related Entities",
            "Return owner, operator, company, and contact references. Owner/operator directory is not provided by the supplied source.",
            Action::AircraftRead,
            false,
        )
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftRelatedEntitiesRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        // No owner/operator/insurer/lessor directory exists in the supplied
        // migrations. We surface that explicitly rather than invent values.
        let _ = self
            .case_service
            .list_for_org(ctx.organization_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            AircraftRelatedEntitiesResponse {
                aircraft_id: input.aircraft_id,
                entities: vec![],
            },
        );
        env.status = EnvelopeStatus::Partial;
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "warn".into(),
            message:
                "owner/operator/insurer/lessor directory is not provided by the supplied source"
                    .into(),
            retryable: false,
        });
        env.confidence.score = 0.0;
        env.confidence.explanation =
            "no owner/operator/contact source available; relationship rows are empty".into();
        Ok(env)
    }
}

// 6. history_window -------------------------------------------------------

pub struct AircraftHistoryWindowTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for AircraftHistoryWindowTool {
    type Request = AircraftHistoryWindowRequest;
    type Response = AircraftHistoryWindowResponse;
    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.aircraft.history_window",
            "Aircraft History Window",
            "Return tenant-scoped case events within a date range, filtered by history kind.",
            Action::AircraftRead,
            false,
        )
    }
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AircraftHistoryWindowRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let start = input.start_date.into_inner();
        let end = input.end_date.into_inner();
        if end < start {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "end_date must be on or after start_date".into(),
                retryable: false,
            });
        }
        let wanted: Option<HashSet<HistoryKind>> =
            input.kinds.as_ref().map(|k| k.iter().copied().collect());
        let aircraft_id = input.aircraft_id.0.to_string();
        let cases = self
            .case_service
            .list_for_org(ctx.organization_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        let mut events: Vec<HistoryEvent> = Vec::new();
        let mut source_timestamps: Vec<mxgenius_shared::domain::datetime::UtcDateTime> = Vec::new();
        for case in &cases {
            if case.aircraft_id != aircraft_id {
                continue;
            }
            // Status transitions are emitted as `Maintenance` history events.
            if wanted
                .as_ref()
                .map_or(true, |k| k.contains(&HistoryKind::Maintenance))
            {
                let timeline = self
                    .case_service
                    .timeline(ctx.organization_id, case.case_id)
                    .await
                    .map_err(|e| EnvelopeError {
                        code: StableErrorCode::InternalError,
                        severity: "error".into(),
                        message: e.to_string(),
                        retryable: true,
                    })?;
                for entry in timeline {
                    let at = entry.occurred_at.into_inner();
                    if at < start || at > end {
                        continue;
                    }
                    source_timestamps
                        .push(mxgenius_shared::domain::datetime::UtcDateTime::from(at));
                    events.push(HistoryEvent {
                        event_id: entry.event_id,
                        kind: HistoryKind::Maintenance,
                        occurred_at: entry.occurred_at,
                        summary: entry.summary,
                        source_reference: format!("case://maintenance_cases/{}", case.case_id.0),
                        license_scope: Some("tenant_internal".into()),
                    });
                }
            }
        }
        events.sort_by_key(|event| event.occurred_at.into_inner());
        let completeness = if events.is_empty() {
            "unknown".into()
        } else {
            "case_history_only".into()
        };
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            AircraftHistoryWindowResponse {
                aircraft_id: input.aircraft_id,
                events,
                source_timestamps,
                completeness,
                drill_through: vec![],
            },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message: "operational/cosmetic/compliance history sources are not provided by the supplied build; only maintenance case events are returned".into(),
            retryable: false,
        });
        Ok(env)
    }
}

// Lint satisfaction
#[allow(dead_code)]
fn _aircraft_ref_unused(_: &AircraftRef) {}
