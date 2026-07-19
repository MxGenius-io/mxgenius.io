//! Evidence tool handlers (4): `mxg.evidence.*`.
//!
//! `mxg.evidence.collect` is part of the first vertical slice and operates
//! against the in-memory evidence store. The other three return typed
//! `NOT_CONFIGURED` envelopes with no invented facts.

use std::sync::Arc;

use async_trait::async_trait;
use sha2::Digest;
use time::OffsetDateTime;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::CapabilityEnvelope;
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    EvidenceCitationPackRequest, EvidenceCitationPackResponse, EvidenceCollectRequest,
    EvidenceCollectResponse, EvidenceConflictCheckRequest, EvidenceConflictCheckResponse,
    EvidenceDto, EvidenceTraceCaseRequest, EvidenceTraceCaseResponse,
};
use mxgenius_shared::domain::datetime::UtcDateTime;

use crate::application::evidence_service::{EvidenceRecord, EvidenceStore};
use crate::handlers::{not_configured, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry, evidence: Arc<dyn EvidenceStore>) {
    reg.register_typed_tool(wrap(Arc::new(EvidenceCollectTool { service: evidence })));
    reg.register_typed_tool(wrap(not_configured::<EvidenceTraceCaseRequest, EvidenceTraceCaseResponse, _>(
        "mxg.evidence.trace_case",
        "Trace Case Evidence",
        "Return the case evidence graph: nodes, links, derivations, supersessions, conflicts, decisions.",
        Action::EvidenceRead,
        |_input| EvidenceTraceCaseResponse {
            nodes: vec![],
            links: vec![],
            conflicts: vec![],
            decisions: vec![],
            source_freshness: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<EvidenceCitationPackRequest, EvidenceCitationPackResponse, _>(
        "mxg.evidence.citation_pack",
        "Citation Pack",
        "Return an export/package reference, evidence count, included locators, exclusions, license warnings.",
        Action::EvidenceRead,
        |input| EvidenceCitationPackResponse {
            case_id: input.case_id,
            export_reference: String::new(),
            evidence_count: 0,
            included_locators: vec![],
            exclusions: vec![],
            licensing_warnings: vec![],
            embedded_whole_manuals: false,
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<EvidenceConflictCheckRequest, EvidenceConflictCheckResponse, _>(
        "mxg.evidence.conflict_check",
        "Conflict Check",
        "Return contradictions, competing values, temporal/revision conflicts, severity, unresolved status.",
        Action::EvidenceRead,
        |_input| EvidenceConflictCheckResponse {
            contradictions: vec![],
            competing_values: vec![],
            temporal_conflicts: vec![],
            revision_conflicts: vec![],
            unresolved: false,
        },
    )));
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
