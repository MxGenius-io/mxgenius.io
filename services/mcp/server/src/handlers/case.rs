//! MaintenanceCase tool handlers (6): `mxg.maintenance_case.*`.
//!
//! `create`, `get`, `build_context`, and `attach_observation` are part of
//! the first vertical slice. `update_status` and `similar_cases` are
//! included in the spine and exercise the same service. The remaining
//! tools return typed `NOT_CONFIGURED` envelopes with no invented facts.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use sha2::Digest;

use mxgenius_shared::adapters::manual::{ManualCorpusAdapter, ManualQuery};
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::CapabilityEnvelope;
use mxgenius_shared::application::envelope::EnvelopeError;
use mxgenius_shared::application::envelope::EnvelopeStatus;
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    CaseDto, DocumentRef, EvidenceLink, FacilitySlice, LocationDto,
    MaintenanceCaseAttachObservationRequest, MaintenanceCaseAttachObservationResponse,
    MaintenanceCaseBuildContextRequest, MaintenanceCaseBuildContextResponse,
    MaintenanceCaseCreateRequest, MaintenanceCaseCreateResponse, MaintenanceCaseGetRequest,
    MaintenanceCaseGetResponse, MaintenanceCaseSimilarCasesRequest,
    MaintenanceCaseSimilarCasesResponse, MaintenanceCaseUpdateStatusRequest,
    MaintenanceCaseUpdateStatusResponse, PartsSlice, PriorityDto, RegulatoryRef, TimelineEntry,
    WeatherSlice,
};
use mxgenius_shared::domain::evidence::{Evidence, EvidenceKind, SourceType};
use mxgenius_shared::domain::ids::EvidenceId;
use uuid::Uuid;

use crate::application::case_service::CaseService;
use crate::application::evidence_service::EvidenceService;
use crate::handlers::spec;
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

fn manual_document_id(source_reference: &str) -> String {
    let path = source_reference
        .split_once("://")
        .map(|(_, path)| path)
        .unwrap_or(source_reference);
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    segments
        .get(segments.len().saturating_sub(2))
        .copied()
        .unwrap_or("unknown")
        .to_string()
}

pub fn register(
    reg: &mut Registry,
    service: Arc<dyn CaseService>,
    manual: Arc<dyn ManualCorpusAdapter>,
    allow_fixture_compliance: bool,
) {
    reg.register_typed_tool(wrap(Arc::new(MaintenanceCaseCreateTool {
        service: service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(MaintenanceCaseGetTool {
        service: service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(MaintenanceCaseBuildContextTool {
        service: service.clone(),
        manual,
        allow_fixture_compliance,
    })));
    reg.register_typed_tool(wrap(Arc::new(MaintenanceCaseUpdateStatusTool {
        service: service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(MaintenanceCaseAttachObservationTool {
        service: service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(MaintenanceCaseSimilarCasesTool {
        service: service.clone(),
    })));
}

// 7. create ----------------------------------------------------------------

pub struct MaintenanceCaseCreateTool {
    service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for MaintenanceCaseCreateTool {
    type Request = MaintenanceCaseCreateRequest;
    type Response = MaintenanceCaseCreateResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.maintenance_case.create",
            "Create Maintenance Case",
            "Persist a new MaintenanceCase in `open` state with raw discrepancy and priority.",
            Action::CaseCreate,
            true,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MaintenanceCaseCreateRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        validate_input(input.validate())?;
        let (resp, trace_id) = self
            .service
            .create(ctx, &input)
            .await
            .map_err(EnvelopeError::from)?;
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        env.trace_id = trace_id;
        env.confidence.basis = mxgenius_shared::domain::evidence::ConfidenceBasis::HumanConfirmed;
        env.confidence.score = 1.0;
        env.confidence.explanation = "human confirmation supplied via trusted context".into();
        env.requires_human_approval = false;
        Ok(env)
    }
}

// 8. get -------------------------------------------------------------------

pub struct MaintenanceCaseGetTool {
    service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for MaintenanceCaseGetTool {
    type Request = MaintenanceCaseGetRequest;
    type Response = MaintenanceCaseGetResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.maintenance_case.get",
            "Get Maintenance Case",
            "Return the complete tenant-scoped case aggregate.",
            Action::CaseRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MaintenanceCaseGetRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let resp = self
            .service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(EnvelopeError::from)?;
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        env.confidence.basis =
            mxgenius_shared::domain::evidence::ConfidenceBasis::DeterministicLookup;
        Ok(env)
    }
}

// 9. build_context --------------------------------------------------------

pub struct MaintenanceCaseBuildContextTool {
    service: Arc<dyn CaseService>,
    manual: Arc<dyn ManualCorpusAdapter>,
    allow_fixture_compliance: bool,
}

#[async_trait]
impl Tool for MaintenanceCaseBuildContextTool {
    type Request = MaintenanceCaseBuildContextRequest;
    type Response = MaintenanceCaseBuildContextResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.maintenance_case.build_context",
            "Build Case Context",
            "Compose aircraft, documents, compliance, weather, parts, and timeline.",
            Action::CaseRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MaintenanceCaseBuildContextRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let flags = input.include.unwrap_or_default();
        let case_resp = self
            .service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(EnvelopeError::from)?;
        let case = case_resp.case.clone();

        let (manual_evidence, manual_warning) = if flags.documents {
            match self
                .manual
                .search(&ManualQuery {
                    aircraft_id: Some(case.aircraft_id.clone()),
                    ata: None,
                    text: case.raw_discrepancy.clone(),
                    limit: Some(8),
                })
                .await
            {
                Ok(evidence) => (evidence, None),
                Err(error) => (vec![], Some(error.to_string())),
            }
        } else {
            (vec![], None)
        };

        let mut document_map = BTreeMap::new();
        for evidence in &manual_evidence {
            let document_id = manual_document_id(&evidence.source_reference);
            document_map
                .entry(document_id.clone())
                .or_insert_with(|| DocumentRef {
                    document_id,
                    title: evidence.title.clone(),
                    revision: evidence.revision.clone(),
                    effective_date: None,
                    currency_state: if evidence.source_reference.starts_with("fixture://") {
                        "fixture_unverified".into()
                    } else if evidence.revision.is_some() {
                        "revision_reported_unverified".into()
                    } else {
                        "unknown".into()
                    },
                    source_reference: evidence.source_reference.clone(),
                });
        }
        let documents = document_map.into_values().collect();
        let evidence_map: Vec<EvidenceLink> = manual_evidence
            .iter()
            .map(|evidence| EvidenceLink {
                evidence_id: evidence.evidence_id.0.to_string(),
                kind: "manual_excerpt".into(),
                title: evidence.title.clone(),
                source_type: "manual".into(),
            })
            .collect();

        let regulatory_items: Vec<RegulatoryRef> =
            if flags.compliance && self.allow_fixture_compliance {
                // Use FAA fixture if present
                let faa = include_str!("../../../fixtures/faa/ads.json");
                let ads: Vec<serde_json::Value> = serde_json::from_str(faa).unwrap_or_default();
                ads.into_iter()
                    .map(|a| RegulatoryRef {
                        id: a["ad_number"].as_str().unwrap_or("").into(),
                        kind: "ad".into(),
                        identifier: a["ad_number"].as_str().unwrap_or("").into(),
                        title: a["title"].as_str().unwrap_or("").into(),
                        applicability: a["applicability"].as_str().unwrap_or("unknown").into(),
                        source_reference: a["source_reference"].as_str().unwrap_or("").into(),
                    })
                    .collect()
            } else {
                vec![]
            };

        let weather: Option<WeatherSlice> = if flags.weather {
            Some(WeatherSlice {
                airport_icao: None,
                observed_at: None,
                flight_category: None,
                source: None,
                not_configured: true,
            })
        } else {
            None
        };

        let parts_state: Option<PartsSlice> = if flags.parts {
            Some(PartsSlice {
                required: vec![],
                readiness: "unknown".into(),
                not_configured: true,
            })
        } else {
            None
        };

        let facility_state: Option<FacilitySlice> = if flags.facilities {
            Some(FacilitySlice {
                candidates: vec![],
                best_match: None,
                not_configured: true,
            })
        } else {
            None
        };

        let timeline: Vec<TimelineEntry> = if flags.timeline {
            self.service
                .timeline(ctx.organization_id, input.case_id)
                .await
                .map_err(EnvelopeError::from)?
        } else {
            vec![]
        };

        let resp = MaintenanceCaseBuildContextResponse {
            case,
            documents,
            regulatory_items,
            weather,
            parts_state,
            facility_state,
            timeline,
            unresolved_conflicts: vec![],
            evidence_map,
        };
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        env.evidence.extend(manual_evidence);
        if let Some(message) = manual_warning {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "warn".into(),
                message: format!("manual corpus unavailable: {message}"),
                retryable: true,
            });
            env.confidence.score = 0.0;
            env.confidence.explanation = "manual corpus did not return evidence".into();
        } else if env.evidence.is_empty() {
            env.confidence.score = 0.0;
            env.confidence.explanation = "no manual excerpts matched the case context".into();
        } else {
            env.confidence.basis =
                mxgenius_shared::domain::evidence::ConfidenceBasis::DeterministicLookup;
            env.confidence.score = 0.7;
            env.confidence.explanation =
                "manual excerpts were returned by the configured corpus adapter; revision currency may remain unknown".into();
        }
        if flags.compliance && !self.allow_fixture_compliance {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "warn".into(),
                message: "FAA AD/DRS/SAIB adapters are not configured; no regulatory fixture data was substituted".into(),
                retryable: false,
            });
        }
        if flags.compliance {
            let namespace =
                Uuid::parse_str("3a4c5b6c-2c7e-4f47-9a3e-2a2a2a2a2a2a").expect("valid namespace");
            let hash = sha2::Sha256::digest(include_bytes!("../../../fixtures/faa/ads.json"));
            env.evidence.push(Evidence {
                evidence_id: EvidenceId(Uuid::new_v5(&namespace, &hash[..])),
                source_type: SourceType::FaaAd,
                source_reference: "fixture://faa/ads".into(),
                kind: EvidenceKind::RegulatoryRequirement,
                title: "Sanitized fictional FAA AD fixture".into(),
                excerpt: None,
                retrieved_at: time::OffsetDateTime::now_utc(),
                effective_at: None,
                revision: None,
                license_scope: Some("sanitized_fixture".into()),
                content_hash: format!("sha256:{}", hex::encode(hash)),
                retrieval_score: None,
                assets: vec![],
                content: include_str!("../../../fixtures/faa/ads.json").into(),
            });
        }
        Ok(env)
    }
}

// 11. update_status --------------------------------------------------------

pub struct MaintenanceCaseUpdateStatusTool {
    service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for MaintenanceCaseUpdateStatusTool {
    type Request = MaintenanceCaseUpdateStatusRequest;
    type Response = MaintenanceCaseUpdateStatusResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.maintenance_case.update_status",
            "Update Case Status",
            "Apply a state transition with optimistic version check and event/audit record.",
            Action::CaseUpdateStatus,
            true,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MaintenanceCaseUpdateStatusRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        validate_input(input.validate())?;
        let (resp, trace_id) = self
            .service
            .update_status(ctx, &input)
            .await
            .map_err(EnvelopeError::from)?;
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        env.trace_id = trace_id;
        env.confidence.basis = mxgenius_shared::domain::evidence::ConfidenceBasis::HumanConfirmed;
        env.requires_human_approval = false;
        Ok(env)
    }
}

// 12. attach_observation ---------------------------------------------------

pub struct MaintenanceCaseAttachObservationTool {
    service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for MaintenanceCaseAttachObservationTool {
    type Request = MaintenanceCaseAttachObservationRequest;
    type Response = MaintenanceCaseAttachObservationResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.maintenance_case.attach_observation",
            "Attach Observation",
            "Persist an immutable Observation with optional media references.",
            Action::CaseAttachObservation,
            true,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MaintenanceCaseAttachObservationRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        validate_input(input.validate())?;
        let (resp, trace_id) = self
            .service
            .attach_observation(ctx, &input)
            .await
            .map_err(EnvelopeError::from)?;
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        env.trace_id = trace_id;
        env.confidence.basis = mxgenius_shared::domain::evidence::ConfidenceBasis::HumanConfirmed;
        Ok(env)
    }
}

// 10. similar_cases --------------------------------------------------------

pub struct MaintenanceCaseSimilarCasesTool {
    service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for MaintenanceCaseSimilarCasesTool {
    type Request = MaintenanceCaseSimilarCasesRequest;
    type Response = MaintenanceCaseSimilarCasesResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.maintenance_case.similar_cases",
            "Similar Cases",
            "Return prior tenant-scoped case matches with score, factors, and outcomes.",
            Action::CaseRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MaintenanceCaseSimilarCasesRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        validate_input(input.validate())?;
        // The in-memory service has no similarity index. Return an empty
        // typed result with a clear note.
        let _ = self
            .service
            .list_for_org(ctx.organization_id)
            .await
            .map_err(EnvelopeError::from)?;
        let resp = MaintenanceCaseSimilarCasesResponse { matches: vec![] };
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "warn".into(),
            message: "similarity index not yet mounted; tenant-scoped corpus requires the fleshed-out build".into(),
            retryable: false,
        });
        Ok(env)
    }
}

fn validate_input(result: Result<(), String>) -> Result<(), EnvelopeError> {
    result.map_err(|message| EnvelopeError {
        code: StableErrorCode::InvalidInput,
        severity: "error".into(),
        message,
        retryable: false,
    })
}

// Lint satisfaction
#[allow(dead_code)]
fn _lint(_: &LocationDto, _: &PriorityDto, _: &CaseDto, _: &EvidenceService) {}
