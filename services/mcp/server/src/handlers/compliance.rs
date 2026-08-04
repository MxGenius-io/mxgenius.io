//! Compliance tool handlers (5): `mxg.compliance.*`.
//!
//! - `applicable_ads` and `saib_search` continue to use the FAA DRS adapter
//!   (already wired by `register`).
//! - `manual_currency`, `record_audit`, and `return_to_service_pack` are
//!   remounted on the case spine, the evidence store, and the existing
//!   `approvals` / `audit_events` tables. When the application pool is
//!   absent they remain typed `not_configured` so the `tools/list`
//!   metadata agrees with the runtime envelope.
//!
//! No compliance tool invents facts. Missing approvals, missing evidence,
//!   and missing fields are surfaced as typed partial envelopes with the
//!   appropriate warning and `missing_*` collections.

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
    ComplianceSaibSearchRequest, ComplianceSaibSearchResponse, RecordAuditFinding, SaibResult,
    Severity,
};
use mxgenius_shared::domain::compliance::ApplicabilityState;
use mxgenius_shared::domain::datetime::{IsoDate, UtcDateTime};
use mxgenius_shared::domain::evidence::{ConfidenceBasis, Evidence, EvidenceKind, SourceType};
use mxgenius_shared::domain::ids::{AircraftId, EvidenceId};

use crate::application::aircraft_catalog::AircraftCatalog;
use crate::application::case_service::CaseService;
use crate::handlers::{limited_spec, not_configured, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    aircraft_catalog: Arc<dyn AircraftCatalog>,
    faa_ad: Arc<dyn FaaAdAdapter>,
    saib: Arc<dyn SaibAdapter>,
    pool: Option<sqlx::PgPool>,
    case_service: Arc<dyn CaseService>,
) {
    reg.register_typed_tool(wrap(Arc::new(ApplicableAdsTool {
        aircraft_catalog,
        faa_ad,
    })));
    reg.register_typed_tool(wrap(Arc::new(SaibSearchTool { saib })));
    if let Some(pool) = pool {
        reg.register_typed_tool(wrap(Arc::new(ManualCurrencyTool {
            pool: pool.clone(),
            case_service: case_service.clone(),
        })));
        reg.register_typed_tool(wrap(Arc::new(RecordAuditTool {
            pool: pool.clone(),
            case_service: case_service.clone(),
        })));
        reg.register_typed_tool(wrap(Arc::new(ReturnToServicePackTool {
            pool,
            case_service,
        })));
    } else {
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
        reg.register_typed_tool(wrap(not_configured::<
            ComplianceRecordAuditRequest,
            ComplianceRecordAuditResponse,
            _,
        >(
            "mxg.compliance.record_audit",
            "Record Audit",
            "Return missing fields, missing evidence, signatures/approvals, completeness checks for a case.",
            Action::ComplianceRead,
            |input| ComplianceRecordAuditResponse {
                case_id: input.case_id,
                missing_fields: vec![],
                missing_evidence: vec![],
                missing_signatures: vec![],
                missing_approvals: vec![],
                part_documentation_gaps: vec![],
                unresolved_warnings: vec![],
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
        input: ComplianceApplicableAdsRequest,
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
        input: ComplianceSaibSearchRequest,
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

// 30. manual_currency ------------------------------------------------------

struct ManualCurrencyTool {
    pool: sqlx::PgPool,
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for ManualCurrencyTool {
    type Request = ComplianceManualCurrencyRequest;
    type Response = ComplianceManualCurrencyResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.compliance.manual_currency",
            "Manual Currency",
            "Return known revision, effective date, supersession state, and warnings for a document.",
            Action::ComplianceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: ComplianceManualCurrencyRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let document_id = input.document_id;
        let _ = self.case_service.list_for_org(ctx.organization_id).await;
        let row: Option<(Option<String>, Option<time::Date>, Option<Uuid>)> = sqlx::query_as(
            r#"SELECT r.revision, r.effective_date, r.supersedes
               FROM document_revisions r
               JOIN technical_documents d ON d.id=r.document_id
               WHERE d.organization_id=$1 AND r.document_id=$2
               ORDER BY r.created_at DESC
               LIMIT 1"#,
        )
        .bind(ctx.organization_id.0)
        .bind(document_id.0)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| envelope_internal("document_revisions lookup", error.to_string()))?;
        let mut warnings: Vec<String> = Vec::new();
        let mut supersession_state = "unknown".to_string();
        let mut currency_state = "unknown".to_string();
        let mut known_revision: Option<String> = None;
        let mut effective_date: Option<IsoDate> = None;
        let mut source = "document_revisions".to_string();
        match row {
            Some((revision, effective, supersedes)) => {
                known_revision = revision.clone();
                effective_date = effective.map(IsoDate);
                supersession_state = if supersedes.is_some() {
                    "superseded".into()
                } else if revision.is_some() {
                    "current".into()
                } else {
                    "unknown".into()
                };
                currency_state = if effective.is_some() {
                    "effective_date_known".into()
                } else {
                    "effective_date_unknown".into()
                };
            }
            None => {
                warnings.push("no document_revisions row found for this document_id".into());
                source = "fallback_evidence".into();
                // Fall back to the case-linked evidence with kind=manual_excerpt.
                let fallback: Option<(String, Option<time::Date>, Option<String>)> = sqlx::query_as(
                    r#"SELECT e.title, e.effective_at::date, e.revision
                       FROM evidence e
                       WHERE e.organization_id=$1
                         AND e.kind='manual_excerpt'
                         AND (e.source_reference LIKE '%' || $2::text || '%' OR e.title LIKE '%' || $2::text || '%')
                       ORDER BY e.retrieved_at DESC
                       LIMIT 1"#,
                )
                .bind(ctx.organization_id.0)
                .bind(document_id.to_string())
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| envelope_internal("evidence fallback", error.to_string()))?;
                if let Some((_title, effective, revision)) = fallback {
                    effective_date = effective.map(IsoDate);
                    known_revision = revision;
                    currency_state = "fallback_evidence".into();
                } else {
                    warnings.push("no manual_excerpt evidence references this document".into());
                }
            }
        }
        let mut envelope = CapabilityEnvelope::new(
            ctx.request_id.0,
            ComplianceManualCurrencyResponse {
                document_id,
                known_revision,
                effective_date,
                supersession_state,
                currency_state,
                source,
                warnings: warnings.clone(),
            },
        );
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        if !warnings.is_empty() {
            envelope.status = EnvelopeStatus::Partial;
            envelope.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "warn".into(),
                message: warnings.join("; "),
                retryable: false,
            });
            envelope.confidence.score = 0.0;
        }
        Ok(envelope)
    }
}

// 31. record_audit ---------------------------------------------------------

struct RecordAuditTool {
    pool: sqlx::PgPool,
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for RecordAuditTool {
    type Request = ComplianceRecordAuditRequest;
    type Response = ComplianceRecordAuditResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.compliance.record_audit",
            "Record Audit",
            "Return missing fields, missing evidence, signatures/approvals, completeness checks for a case.",
            Action::ComplianceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: ComplianceRecordAuditRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let case_resp = self
            .case_service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: e.to_string(),
                retryable: false,
            })?;
        let case = case_resp.case;
        let mut missing_fields: Vec<String> = Vec::new();
        if case.raw_discrepancy.trim().is_empty() {
            missing_fields.push("raw_discrepancy".into());
        }
        if case.location.is_none() {
            missing_fields.push("location".into());
        }
        if case.evidence_ids.is_empty() {
            missing_fields.push("evidence_ids".into());
        }
        let evidence_count: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM evidence_links
               WHERE organization_id=$1 AND case_id=$2"#,
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| envelope_internal("evidence_links count", error.to_string()))?;
        let missing_evidence: Vec<String> = if evidence_count == 0 {
            vec!["at least one evidence row".into()]
        } else {
            Vec::new()
        };
        // Part documentation gaps: certificate_records linked to this case
        // that are not validated.
        let part_gaps: Vec<String> = sqlx::query_scalar(
            r#"SELECT certificate_type FROM certificate_records
               WHERE case_id=$1 AND validated=false"#,
        )
        .bind(input.case_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| envelope_internal("certificate_records scan", error.to_string()))?;
        // Missing approvals: open approval rows that have not been decided.
        let missing_approvals: Vec<String> = sqlx::query_scalar(
            r#"SELECT action FROM approvals
               WHERE organization_id=$1 AND case_id=$2 AND decision IS NULL"#,
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| envelope_internal("approvals scan", error.to_string()))?;
        // Missing signatures: there is no signatures table in the supplied
        // migrations; surface the gap explicitly.
        let missing_signatures: Vec<String> =
            vec!["signatures table is not provided by the supplied build".into()];
        let unresolved_warnings: Vec<RecordAuditFinding> = case_resp
            .unresolved_conflicts
            .iter()
            .map(|c| RecordAuditFinding {
                kind: c.kind.clone(),
                severity: match c.severity.to_ascii_lowercase().as_str() {
                    "critical" => Severity::Critical,
                    "high" => Severity::High,
                    "medium" => Severity::Medium,
                    "low" => Severity::Low,
                    _ => Severity::Info,
                },
                description: c.description.clone(),
                evidence_id: c.evidence_ids.first().cloned(),
            })
            .collect();
        let completeness = match (
            missing_fields.is_empty(),
            missing_evidence.is_empty(),
            part_gaps.is_empty(),
            missing_approvals.is_empty(),
        ) {
            (true, true, true, true) => "complete".to_string(),
            (false, _, _, _) | (_, false, _, _) | (_, _, false, _) | (_, _, _, false) => {
                "incomplete".to_string()
            }
        };
        let mut envelope = CapabilityEnvelope::new(
            ctx.request_id.0,
            ComplianceRecordAuditResponse {
                case_id: input.case_id,
                missing_fields,
                missing_evidence,
                missing_signatures,
                missing_approvals,
                part_documentation_gaps: part_gaps,
                unresolved_warnings,
                completeness: completeness.clone(),
            },
        );
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        envelope.confidence.explanation = format!("case audit completeness: {completeness}");
        if completeness != "complete" {
            envelope.status = EnvelopeStatus::Partial;
        }
        Ok(envelope)
    }
}

// 32. return_to_service_pack -----------------------------------------------

struct ReturnToServicePackTool {
    pool: sqlx::PgPool,
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for ReturnToServicePackTool {
    type Request = ComplianceReturnToServicePackRequest;
    type Response = ComplianceReturnToServicePackResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.compliance.return_to_service_pack",
            "Return-to-Service Review Pack",
            "Assemble the case return-to-service review pack. Review only, never approval.",
            Action::ComplianceReturnToService,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: ComplianceReturnToServicePackRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let case_resp = self
            .case_service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: e.to_string(),
                retryable: false,
            })?;
        let case = case_resp.case;
        let timeline = self
            .case_service
            .timeline(ctx.organization_id, input.case_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        let evidence_rows: Vec<(Uuid, String, String, String)> = sqlx::query_as(
            r#"SELECT e.id, e.title, e.source_reference, e.source_type
               FROM evidence e
               JOIN evidence_links l
                 ON l.organization_id=e.organization_id AND l.evidence_id=e.id
               WHERE e.organization_id=$1 AND l.case_id=$2
               ORDER BY e.retrieved_at DESC"#,
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| envelope_internal("evidence pack query", error.to_string()))?;
        let evidence: Vec<String> = evidence_rows
            .iter()
            .map(|(id, _, _, _)| id.to_string())
            .collect();
        let assembled_documents: Vec<mxgenius_shared::contracts::DocumentRefRts> = evidence_rows
            .iter()
            .map(|(id, title, _source_reference, _source_type)| {
                mxgenius_shared::contracts::DocumentRefRts {
                    document_id: id.to_string(),
                    title: title.clone(),
                    revision: None,
                    effective_date: None,
                }
            })
            .collect();
        let approvals_present: Vec<String> = sqlx::query_scalar(
            r#"SELECT action FROM approvals
               WHERE organization_id=$1 AND case_id=$2 AND decision IS NOT NULL"#,
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| envelope_internal("approvals query", error.to_string()))?;
        let approvals_needed: Vec<String> = sqlx::query_scalar(
            r#"SELECT action FROM approvals
               WHERE organization_id=$1 AND case_id=$2 AND decision IS NULL"#,
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| envelope_internal("approvals needed query", error.to_string()))?;
        let mut record_gaps: Vec<String> = Vec::new();
        if case.raw_discrepancy.trim().is_empty() {
            record_gaps.push("raw_discrepancy is empty".into());
        }
        if case.evidence_ids.is_empty() {
            record_gaps.push("case has no evidence rows".into());
        }
        let mut warnings: Vec<String> = Vec::new();
        if !approvals_needed.is_empty() {
            warnings.push(format!(
                "{} approval(s) are still open and must be granted before return-to-service",
                approvals_needed.len()
            ));
        }
        if !record_gaps.is_empty() {
            warnings.push("case has open record gaps; review required".into());
        }
        let review_metadata = Some(mxgenius_shared::contracts::RtsReviewMetadata {
            generated_at: mxgenius_shared::domain::datetime::UtcDateTime::now(),
            generated_by_user_id: ctx.user_id.0.to_string(),
            scope: if timeline.is_empty() {
                "case_only".to_string()
            } else {
                format!("case_with_{}_timeline_events", timeline.len())
            },
        });
        let authorized = approvals_needed.is_empty() && record_gaps.is_empty();
        let mut envelope = CapabilityEnvelope::new(
            ctx.request_id.0,
            ComplianceReturnToServicePackResponse {
                case_id: input.case_id,
                assembled_documents,
                evidence,
                approvals_present,
                approvals_needed,
                record_gaps,
                warnings,
                review_metadata,
                authorized,
            },
        );
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        envelope.confidence.explanation = if authorized {
            "all approvals granted and no record gaps detected; the pack is review-only, never an approval".into()
        } else {
            "review-only pack; authorized=false because approvals or record gaps remain".into()
        };
        if !authorized {
            envelope.status = EnvelopeStatus::Partial;
            envelope.warnings.push(EnvelopeError {
                code: StableErrorCode::HumanApprovalRequired,
                severity: "warn".into(),
                message: "return-to-service requires qualified approval; this pack is review-only"
                    .into(),
                retryable: false,
            });
        }
        // Suppress unused-variable warnings on parameters we intentionally ignore.
        let _ = &case;
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
        retrieval_score: None,
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

fn envelope_internal(context: &'static str, message: String) -> EnvelopeError {
    EnvelopeError {
        code: StableErrorCode::InternalError,
        severity: "error".into(),
        message: format!("{context}: {message}"),
        retryable: true,
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
