//! Evidence tool handlers (4): `mxg.evidence.*`.
//!
//! `mxg.evidence.collect` is part of the first vertical slice and operates
//! against the in-memory or Postgres evidence store. The remaining three
//! (`trace_case`, `citation_pack`, `conflict_check`) are remounted onto
//! the existing case, evidence, and observation records. They never invent
//! facts: when a case or evidence row is missing the response is a typed
//! partial envelope with the appropriate `ENTITY_NOT_FOUND` or
//! `NOT_CONFIGURED` warning.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use sha2::Digest as _;
use time::OffsetDateTime;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError, EnvelopeStatus};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    EvidenceCitationPackRequest, EvidenceCitationPackResponse, EvidenceCollectRequest,
    EvidenceCollectResponse, EvidenceConflict, EvidenceConflictCheckRequest,
    EvidenceConflictCheckResponse, EvidenceDto, EvidenceGraphLink, EvidenceGraphNode,
    EvidenceTraceCaseRequest, EvidenceTraceCaseResponse,
};
use mxgenius_shared::domain::datetime::UtcDateTime;

use crate::application::case_service::CaseService;
use crate::application::evidence_service::{EvidenceRecord, EvidenceStore};
use crate::handlers::{limited_spec, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    evidence: Arc<dyn EvidenceStore>,
    case_service: Arc<dyn CaseService>,
) {
    reg.register_typed_tool(wrap(Arc::new(EvidenceCollectTool {
        service: evidence.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(EvidenceTraceCaseTool {
        case_service: case_service.clone(),
        evidence: evidence.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(EvidenceCitationPackTool {
        case_service: case_service.clone(),
        evidence: evidence.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(EvidenceConflictCheckTool {
        case_service,
        evidence,
    })));
}

// 43. collect --------------------------------------------------------------

pub struct EvidenceCollectTool {
    service: Arc<dyn EvidenceStore>,
}

#[async_trait]
impl Tool for EvidenceCollectTool {
    type Request = EvidenceCollectRequest;
    type Response = EvidenceCollectResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.evidence.collect",
            "Collect Evidence",
            "Normalize, hash, and de-duplicate Evidence from typed adapter results or source references.",
            Action::EvidenceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: EvidenceCollectRequest,
    ) -> Result<
        CapabilityEnvelope<Self::Response>,
        mxgenius_shared::application::envelope::EnvelopeError,
    > {
        input.validate().map_err(|message| {
            mxgenius_shared::application::envelope::EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message,
                retryable: false,
            }
        })?;
        let mut collected: Vec<EvidenceRecord> = Vec::new();
        let warnings: Vec<String> = Vec::new();
        let mut dedup = 0u32;
        if let Some(items) = input.raw_items {
            for item in items {
                let content_hash = format!(
                    "sha256:{}",
                    hex::encode(sha2::Sha256::digest(item.content.as_bytes()))
                );
                let rec = EvidenceRecord {
                    evidence_id: mxgenius_shared::domain::ids::EvidenceId(uuid::Uuid::new_v4()),
                    source_type: item.source_type,
                    source_reference: item.source_reference,
                    kind: item.kind,
                    title: item.title,
                    excerpt: item.excerpt,
                    retrieved_at: UtcDateTime::from(OffsetDateTime::now_utc()),
                    effective_at: item.effective_at,
                    revision: item.revision,
                    license_scope: item.license_scope,
                    content_hash,
                    content: item.content,
                };
                let inserted = self
                    .service
                    .append(rec.clone(), ctx.organization_id, input.case_id)
                    .await
                    .map_err(
                        |message| mxgenius_shared::application::envelope::EnvelopeError {
                            code: StableErrorCode::InternalError,
                            severity: "error".into(),
                            message,
                            retryable: true,
                        },
                    )?;
                if !inserted {
                    dedup += 1;
                    continue;
                }
                collected.push(rec);
            }
        }
        let evidence: Vec<EvidenceDto> = collected
            .into_iter()
            .map(|r| EvidenceDto {
                evidence_id: r.evidence_id.0.to_string(),
                source_type: r.source_type,
                source_reference: r.source_reference,
                kind: r.kind,
                title: r.title,
                excerpt: r.excerpt,
                retrieved_at: r.retrieved_at,
                effective_at: r.effective_at,
                revision: r.revision,
                license_scope: r.license_scope,
                content_hash: r.content_hash,
                supersedes: None,
            })
            .collect();
        let resp = EvidenceCollectResponse {
            evidence,
            collection_warnings: warnings,
            deduplicated_count: dedup,
        };
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, resp);
        if dedup > 0 {
            env.warnings
                .push(mxgenius_shared::application::envelope::EnvelopeError {
                    code: StableErrorCode::ConflictingEvidence,
                    severity: "info".into(),
                    message: format!(
                        "{dedup} duplicate(s) detected by content hash; de-duplicated"
                    ),
                    retryable: false,
                });
        }
        env.confidence.basis =
            mxgenius_shared::domain::evidence::ConfidenceBasis::DeterministicLookup;
        Ok(env)
    }
}

// 44. trace_case ----------------------------------------------------------

pub struct EvidenceTraceCaseTool {
    case_service: Arc<dyn CaseService>,
    evidence: Arc<dyn EvidenceStore>,
}

#[async_trait]
impl Tool for EvidenceTraceCaseTool {
    type Request = EvidenceTraceCaseRequest;
    type Response = EvidenceTraceCaseResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.evidence.trace_case",
            "Trace Case Evidence",
            "Return the case evidence graph: nodes, links, derivations, supersessions, conflicts, decisions.",
            Action::EvidenceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: EvidenceTraceCaseRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let _ = self
            .case_service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: e.to_string(),
                retryable: false,
            })?;
        let evidence = self
            .evidence
            .list_for_case(ctx.organization_id, input.case_id)
            .await
            .map_err(|message| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message,
                retryable: true,
            })?;
        let mut nodes: Vec<EvidenceGraphNode> = Vec::new();
        let mut links: Vec<EvidenceGraphLink> = Vec::new();
        let mut source_freshness: Vec<UtcDateTime> = Vec::new();
        for record in &evidence {
            let id = record.evidence_id.0.to_string();
            nodes.push(EvidenceGraphNode {
                id: id.clone(),
                kind: record.kind.clone(),
                label: record.title.clone(),
            });
            links.push(EvidenceGraphLink {
                from: format!("case://{}", input.case_id.0),
                to: id,
                kind: "derived_from".into(),
            });
            source_freshness.push(record.retrieved_at);
        }
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            EvidenceTraceCaseResponse {
                nodes,
                links,
                conflicts: vec![],
                decisions: vec![],
                source_freshness,
            },
        );
        if env.output.nodes.is_empty() {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no evidence rows are linked to this case".into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
        } else {
            env.confidence.basis =
                mxgenius_shared::domain::evidence::ConfidenceBasis::DeterministicLookup;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "info".into(),
                message: "semantic conflict / decision detection is not implemented in this build; only the per-evidence graph is returned".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

// 45. citation_pack -------------------------------------------------------

pub struct EvidenceCitationPackTool {
    case_service: Arc<dyn CaseService>,
    evidence: Arc<dyn EvidenceStore>,
}

#[async_trait]
impl Tool for EvidenceCitationPackTool {
    type Request = EvidenceCitationCaseRequest;
    type Response = EvidenceCitationPackResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.evidence.citation_pack",
            "Citation Pack",
            "Return an export/package reference, evidence count, included locators, exclusions, license warnings.",
            Action::EvidenceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: EvidenceCitationCaseRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let _ = self
            .case_service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: e.to_string(),
                retryable: false,
            })?;
        let evidence = self
            .evidence
            .list_for_case(ctx.organization_id, input.case_id)
            .await
            .map_err(|message| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message,
                retryable: true,
            })?;
        let mut included: Vec<String> = Vec::new();
        let mut exclusions: Vec<String> = Vec::new();
        let mut licensing_warnings: Vec<String> = Vec::new();
        for record in &evidence {
            included.push(record.source_reference.clone());
            if let Some(license) = &record.license_scope {
                if license.starts_with("sanitized_fixture") {
                    licensing_warnings.push(format!(
                        "{} is sourced from a sanitized fixture; replace with authoritative content before publication",
                        record.source_reference
                    ));
                }
            }
            if record.kind == "observation" {
                // Internal observations are always included; the public citation
                // pack must surface the audit_event_id, not the user content.
                exclusions.push(format!(
                    "{}: observation note content is not embedded; cite the audit_event_id",
                    record.evidence_id.0
                ));
            }
        }
        let embedded_whole_manuals = included
            .iter()
            .any(|locator| locator.starts_with("azure-ai-search://"));
        let export_reference = format!(
            "case://{}/citation/{}",
            input.case_id.0,
            uuid::Uuid::new_v4()
        );
        let env = CapabilityEnvelope::new(
            ctx.request_id.0,
            EvidenceCitationPackResponse {
                case_id: input.case_id,
                export_reference,
                evidence_count: included.len() as u32,
                included_locators: included,
                exclusions,
                licensing_warnings,
                embedded_whole_manuals,
            },
        );
        let mut env = env;
        env.confidence.basis =
            mxgenius_shared::domain::evidence::ConfidenceBasis::DeterministicLookup;
        env.confidence.explanation =
            "citation pack derived from case-linked evidence; export_reference is a logical locator, not a generated document"
                .into();
        if env.output.evidence_count == 0 {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no evidence is linked to this case; citation pack is empty".into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
        } else {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "info".into(),
                message: "actual export generation is not provided by the supplied build; the export_reference is a logical locator only".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

// 46. conflict_check ------------------------------------------------------

pub struct EvidenceConflictCheckTool {
    case_service: Arc<dyn CaseService>,
    evidence: Arc<dyn EvidenceStore>,
}

#[async_trait]
impl Tool for EvidenceConflictCheckTool {
    type Request = EvidenceConflictCheckRequest;
    type Response = EvidenceConflictCheckResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.evidence.conflict_check",
            "Conflict Check",
            "Return contradictions, competing values, temporal/revision conflicts, severity, unresolved status.",
            Action::EvidenceRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: EvidenceConflictCheckRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let records: Vec<EvidenceRecord> = if let Some(case_id) = input.case_id {
            self.evidence
                .list_for_case(ctx.organization_id, case_id)
                .await
                .map_err(|message| EnvelopeError {
                    code: StableErrorCode::InternalError,
                    severity: "error".into(),
                    message,
                    retryable: true,
                })?
        } else {
            // No case supplied: list_for_org-style call is exposed via
            // `list_for_org` on the in-memory service. For now we surface a
            // typed partial result; the integrator can extend with a
            // case_id-bound list when no case is provided.
            let _ = self.case_service.list_for_org(ctx.organization_id).await;
            Vec::new()
        };
        let mut competing: Vec<EvidenceConflict> = Vec::new();
        let mut temporal: Vec<EvidenceConflict> = Vec::new();
        let mut revision_conflicts: Vec<EvidenceConflict> = Vec::new();
        let mut by_source: BTreeMap<(String, String), Vec<&EvidenceRecord>> = BTreeMap::new();
        for record in &records {
            by_source
                .entry((record.source_type.clone(), record.source_reference.clone()))
                .or_default()
                .push(record);
        }
        for ((source_type, source_ref), group) in by_source {
            if group.len() < 2 {
                continue;
            }
            // Competing values: distinct content_hash for the same source.
            let unique_hashes: std::collections::BTreeSet<&str> =
                group.iter().map(|r| r.content_hash.as_str()).collect();
            if unique_hashes.len() > 1 {
                competing.push(EvidenceConflict {
                    id: format!("competing:{}:{}", source_type, source_ref),
                    kind: "competing_values".into(),
                    description: format!(
                        "{} distinct content hashes observed for {}/{}",
                        unique_hashes.len(),
                        source_type,
                        source_ref
                    ),
                    evidence_ids: group.iter().map(|r| r.evidence_id.0.to_string()).collect(),
                    severity: "medium".into(),
                });
            }
            // Revision conflict: more than one distinct revision reported.
            let revisions: std::collections::BTreeSet<&str> =
                group.iter().filter_map(|r| r.revision.as_deref()).collect();
            if revisions.len() > 1 {
                revision_conflicts.push(EvidenceConflict {
                    id: format!("revision:{}:{}", source_type, source_ref),
                    kind: "revision_conflict".into(),
                    description: format!(
                        "{} distinct revisions reported for {}/{}",
                        revisions.len(),
                        source_type,
                        source_ref
                    ),
                    evidence_ids: group.iter().map(|r| r.evidence_id.0.to_string()).collect(),
                    severity: "high".into(),
                });
            }
            // Temporal conflict: distinct effective_at within the group.
            let effectives: std::collections::BTreeSet<UtcDateTime> =
                group.iter().filter_map(|r| r.effective_at).collect();
            if effectives.len() > 1 {
                temporal.push(EvidenceConflict {
                    id: format!("temporal:{}:{}", source_type, source_ref),
                    kind: "temporal_conflict".into(),
                    description: format!(
                        "{} distinct effective_at values reported for {}/{}",
                        effectives.len(),
                        source_type,
                        source_ref
                    ),
                    evidence_ids: group.iter().map(|r| r.evidence_id.0.to_string()).collect(),
                    severity: "medium".into(),
                });
            }
        }
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            EvidenceConflictCheckResponse {
                contradictions: vec![],
                competing_values: competing,
                temporal_conflicts: temporal,
                revision_conflicts,
                unresolved: false,
            },
        );
        if env.output.competing_values.is_empty()
            && env.output.temporal_conflicts.is_empty()
            && env.output.revision_conflicts.is_empty()
        {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "info".into(),
                message: "no structural conflicts detected in supplied evidence".into(),
                retryable: false,
            });
        }
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message: "semantic contradiction detection is not implemented in this build; only structural hash / revision / temporal conflicts are reported".into(),
            retryable: false,
        });
        env.confidence.basis =
            mxgenius_shared::domain::evidence::ConfidenceBasis::DeterministicLookup;
        Ok(env)
    }
}

// The citation pack tool reuses the case-scoped evidence listing; it is
// bound to the same request type the public contract exposes.
type EvidenceCitationCaseRequest = EvidenceCitationPackRequest;
