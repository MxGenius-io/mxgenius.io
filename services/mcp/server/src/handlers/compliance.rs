//! Compliance tool handlers (5): `mxg.compliance.*`.

use std::sync::Arc;

use async_trait::async_trait;
use sha2::Digest as _;
use uuid::Uuid;

use mxgenius_shared::adapters::faa::{AdQuery, FaaAdAdapter, SaibAdapter};
use mxgenius_shared::adapters::source::AdapterError;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{
    CapabilityEnvelope, EnvelopeError, EnvelopeStatus, PromotionState,
};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    ApplicabilityDto, ApplicableAd, ComplianceApplicableAdsRequest,
    ComplianceApplicableAdsResponse, ComplianceManualCurrencyRequest,
    ComplianceManualCurrencyResponse, ComplianceRecordAuditRequest, ComplianceRecordAuditResponse,
    ComplianceReturnToServicePackRequest, ComplianceReturnToServicePackResponse,
    ComplianceSaibSearchRequest, ComplianceSaibSearchResponse, SaibResult,
};
use mxgenius_shared::domain::compliance::ApplicabilityState;
use mxgenius_shared::domain::datetime::{IsoDate, UtcDateTime};
use mxgenius_shared::domain::evidence::{ConfidenceBasis, Evidence, EvidenceKind, SourceType};
use mxgenius_shared::domain::ids::{AircraftId, EvidenceId};

use crate::application::aircraft_catalog::AircraftCatalog;
use crate::handlers::{not_configured, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    aircraft_catalog: Arc<dyn AircraftCatalog>,
    faa_ad: Arc<dyn FaaAdAdapter>,
    saib: Arc<dyn SaibAdapter>,
) {
    reg.register_typed_tool(wrap(Arc::new(ApplicableAdsTool {
        aircraft_catalog,
        faa_ad,
    })));
    reg.register_typed_tool(wrap(Arc::new(SaibSearchTool { saib })));
    reg.register_typed_tool(wrap(not_configured::<
        ComplianceManualCurrencyRequest,
        ComplianceManualCurrencyResponse,
        _,
    >(
        "mxg.compliance.manual_currency",
        "Manual Currency",
        "Return known revision, effective date, supersession state, and warnings for a document.",
        Action::ComplianceRead,
        |input| ComplianceManualCurrencyResponse {
            document_id: input.document_id,
            known_revision: None,
            effective_date: None,
            supersession_state: "unknown".into(),
            currency_state: "unknown".into(),
            source: "not_configured".into(),
            warnings: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<ComplianceRecordAuditRequest, ComplianceRecordAuditResponse, _>(
        "mxg.compliance.record_audit",
        "Record Audit",
        "Return missing fields, missing evidence, signatures/approvals, completeness checks for a case.",
        Action::ComplianceRead,
        |input| ComplianceRecordAuditResponse {
            case_id: input.case_id,
            missing_fields: vec![], missing_evidence: vec![],
            missing_signatures: vec![], missing_approvals: vec![],
            part_documentation_gaps: vec![], unresolved_warnings: vec![],
            completeness: "unknown".into(),
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        ComplianceReturnToServicePackRequest,
        ComplianceReturnToServicePackResponse,
        _,
    >(
        "mxg.compliance.return_to_service_pack",
        "Return-to-Service Review Pack",
        "Assemble the case return-to-service review pack. Review only, never approval.",
        Action::ComplianceReturnToService,
        |input| ComplianceReturnToServicePackResponse {
            case_id: input.case_id,
            assembled_documents: vec![],
            evidence: vec![],
            approvals_present: vec![],
            approvals_needed: vec![],
            record_gaps: vec![],
            warnings: vec![],
            review_metadata: None,
            authorized: false,
        },
    )));
}

struct ApplicableAdsTool {
    aircraft_catalog: Arc<dyn AircraftCatalog>,
    faa_ad: Arc<dyn FaaAdAdapter>,
}

#[async_trait]
impl Tool for ApplicableAdsTool {
    type Request = ComplianceApplicableAdsRequest;
    type Response = ComplianceApplicableAdsResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.compliance.applicable_ads",
            "Applicable ADs",
            "Return evidence-backed candidate ADs for qualified applicability review.",
            Action::ComplianceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Self::Request,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let aircraft_id = input
            .aircraft_id
            .parse::<AircraftId>()
            .map_err(|_| EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "aircraft_id must be a canonical UUID".into(),
                retryable: false,
            })?;
        let aircraft = self
            .aircraft_catalog
            .get(ctx.organization_id, aircraft_id)
            .await
            .map_err(adapter_error)?;
        let Some(aircraft) = aircraft else {
            return Ok(partial_ads(
                ctx,
                StableErrorCode::EntityNotFound,
                "aircraft is not present in this tenant's canonical catalog".into(),
                false,
            ));
        };
        if aircraft.make.is_none() || aircraft.model.is_none() {
            return Ok(partial_ads(
                ctx,
                StableErrorCode::ApplicabilityUnknown,
                "canonical make and model are required before AD candidate discovery".into(),
                false,
            ));
        }
        let directives = match self
            .faa_ad
            .applicable_ads(&AdQuery {
                aircraft_id: Some(aircraft.aircraft_id.to_string()),
                make: aircraft.make.clone(),
                model: aircraft.model.clone(),
                serial: aircraft.serial_number.clone(),
                ata: None,
            })
            .await
        {
            Ok(directives) => directives,
            Err(error) => return Ok(partial_from_adapter(ctx, error)),
        };
        let mut evidence = Vec::with_capacity(directives.len());
        let ads = directives
            .into_iter()
            .map(|directive| {
                evidence.push(regulatory_evidence(
                    SourceType::FaaAd,
                    &directive.ad_number,
                    &directive.title,
                    &directive.source_reference,
                ));
                ApplicableAd {
                    ad_number: directive.ad_number,
                    title: directive.title,
                    effective_at: directive.effective_at.map(UtcDateTime),
                    source_reference: directive.source_reference,
                    applicability: map_applicability(directive.applicability),
                }
            })
            .collect();
        let mut envelope =
            CapabilityEnvelope::new(ctx.request_id.0, ComplianceApplicableAdsResponse { ads });
        envelope.evidence = evidence;
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        envelope.confidence.explanation =
            "FAA DRS metadata match; final effectivity and serial applicability require human review"
                .into();
        Ok(envelope)
    }
}

struct SaibSearchTool {
    saib: Arc<dyn SaibAdapter>,
}

#[async_trait]
impl Tool for SaibSearchTool {
    type Request = ComplianceSaibSearchRequest;
    type Response = ComplianceSaibSearchResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.compliance.saib_search",
            "SAIB Search",
            "Search official DRS SAIB metadata by aircraft, component, or terms.",
            Action::ComplianceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Self::Request,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let query = [
            input.aircraft_type.as_deref(),
            input.component.as_deref(),
            input.query.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
        if query.is_empty() {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "aircraft_type, component, or query is required".into(),
                retryable: false,
            });
        }
        let notices = match self.saib.search(&query).await {
            Ok(notices) => notices,
            Err(error) => return Ok(partial_saibs_from_adapter(ctx, error)),
        };
        let notices = notices
            .into_iter()
            .filter(|notice| {
                let date = notice.issued_at.map(|value| value.date());
                input
                    .start_date
                    .map(|start| date.map(|date| date >= start.0).unwrap_or(false))
                    .unwrap_or(true)
                    && input
                        .end_date
                        .map(|end| date.map(|date| date <= end.0).unwrap_or(false))
                        .unwrap_or(true)
            })
            .collect::<Vec<_>>();
        let mut evidence = Vec::with_capacity(notices.len());
        let results = notices
            .into_iter()
            .map(|notice| {
                evidence.push(regulatory_evidence(
                    SourceType::FaaDrs,
                    &notice.notice_number,
                    &notice.title,
                    &notice.source_reference,
                ));
                SaibResult {
                    identifier: notice.notice_number,
                    title: notice.title,
                    issued_at: notice.issued_at.map(|value| IsoDate(value.date())),
                    applicability_text: None,
                    source_link: notice.source_reference,
                }
            })
            .collect();
        let mut envelope =
            CapabilityEnvelope::new(ctx.request_id.0, ComplianceSaibSearchResponse { results });
        envelope.evidence = evidence;
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        Ok(envelope)
    }
}

fn map_applicability(state: ApplicabilityState) -> ApplicabilityDto {
    match state {
        ApplicabilityState::Candidate => ApplicabilityDto::Candidate,
        ApplicabilityState::LikelyApplicable => ApplicabilityDto::LikelyApplicable,
        ApplicabilityState::ConfirmedApplicable => ApplicabilityDto::ConfirmedApplicable,
        ApplicabilityState::NotApplicable => ApplicabilityDto::NotApplicable,
        ApplicabilityState::Unknown => ApplicabilityDto::Unknown,
    }
}

fn regulatory_evidence(
    source_type: SourceType,
    identifier: &str,
    title: &str,
    source_reference: &str,
) -> Evidence {
    let content = serde_json::json!({
        "identifier": identifier,
        "title": title,
        "applicability": "candidate"
    })
    .to_string();
    let content_hash = format!(
        "sha256:{}",
        hex::encode(sha2::Sha256::digest(content.as_bytes()))
    );
    Evidence {
        evidence_id: EvidenceId(Uuid::new_v5(
            &Uuid::from_u128(0x733a0931_1ec1_41b6_9ce2_59a76f6f68a2),
            content_hash.as_bytes(),
        )),
        source_type,
        source_reference: source_reference.into(),
        kind: EvidenceKind::RegulatoryRequirement,
        title: title.into(),
        excerpt: None,
        retrieved_at: time::OffsetDateTime::now_utc(),
        effective_at: None,
        revision: None,
        license_scope: Some("faa_drs_api_key".into()),
        content_hash,
        assets: vec![],
        content,
    }
}

fn partial_ads(
    ctx: &ExecutionContext,
    code: StableErrorCode,
    message: String,
    retryable: bool,
) -> CapabilityEnvelope<ComplianceApplicableAdsResponse> {
    let mut envelope = CapabilityEnvelope::new(
        ctx.request_id.0,
        ComplianceApplicableAdsResponse { ads: vec![] },
    );
    envelope.status = EnvelopeStatus::Partial;
    envelope.promotion_state = PromotionState::Shadow;
    envelope.warnings.push(EnvelopeError {
        code,
        severity: "warn".into(),
        message,
        retryable,
    });
    envelope.confidence.score = 0.0;
    envelope
}

fn partial_from_adapter(
    ctx: &ExecutionContext,
    error: AdapterError,
) -> CapabilityEnvelope<ComplianceApplicableAdsResponse> {
    let (code, retryable) = adapter_error_code(&error);
    partial_ads(ctx, code, error.to_string(), retryable)
}

fn partial_saibs_from_adapter(
    ctx: &ExecutionContext,
    error: AdapterError,
) -> CapabilityEnvelope<ComplianceSaibSearchResponse> {
    let (code, retryable) = adapter_error_code(&error);
    let mut envelope = CapabilityEnvelope::new(
        ctx.request_id.0,
        ComplianceSaibSearchResponse { results: vec![] },
    );
    envelope.status = EnvelopeStatus::Partial;
    envelope.promotion_state = PromotionState::Shadow;
    envelope.warnings.push(EnvelopeError {
        code,
        severity: "warn".into(),
        message: error.to_string(),
        retryable,
    });
    envelope.confidence.score = 0.0;
    envelope
}

fn adapter_error(error: AdapterError) -> EnvelopeError {
    let (code, retryable) = adapter_error_code(&error);
    EnvelopeError {
        code,
        severity: "error".into(),
        message: error.to_string(),
        retryable,
    }
}

fn adapter_error_code(error: &AdapterError) -> (StableErrorCode, bool) {
    match error {
        AdapterError::NotConfigured { .. } => (StableErrorCode::NotConfigured, false),
        AdapterError::InvalidInput(_) => (StableErrorCode::InvalidInput, false),
        AdapterError::Timeout(_) => (StableErrorCode::SourceTimeout, true),
        AdapterError::RateLimited(_) => (StableErrorCode::SourceRateLimited, true),
        AdapterError::NotLicensed(_) => (StableErrorCode::SourceNotLicensed, false),
        AdapterError::Stale(_) => (StableErrorCode::SourceStale, false),
        AdapterError::Unavailable(_) | AdapterError::Internal(_) => {
            (StableErrorCode::SourceUnavailable, true)
        }
    }
}
