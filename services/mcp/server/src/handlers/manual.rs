//! Model-callable manual retrieval: `mxg.manual.search`.

use std::collections::BTreeSet;
use std::sync::Arc;

use async_trait::async_trait;

use mxgenius_shared::adapters::manual::{ManualCorpusAdapter, ManualQuery, ManualRetrievalState};
use mxgenius_shared::adapters::source::AdapterError;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError, EnvelopeStatus};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    ManualSearchAsset, ManualSearchRecord, ManualSearchRequest, ManualSearchResponse,
};
use mxgenius_shared::domain::evidence::EvidenceAssetAvailability;

use crate::handlers::spec;
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry, manual: Arc<dyn ManualCorpusAdapter>) {
    reg.register_typed_tool(wrap(Arc::new(ManualSearchTool { manual })));
}

pub struct ManualSearchTool {
    manual: Arc<dyn ManualCorpusAdapter>,
}

fn truncate_chars(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn retrieval_percent(score: Option<f32>) -> Option<u8> {
    score.map(|value| (value.clamp(0.0, 1.0) * 100.0).round() as u8)
}

fn normalized_topic_terms(value: &str) -> BTreeSet<String> {
    const GENERIC_TERMS: &[&str] = &[
        "aircraft",
        "amm",
        "bombardier",
        "challenger",
        "chapter",
        "dassault",
        "diagram",
        "falcon",
        "figure",
        "from",
        "gulfstream",
        "image",
        "include",
        "inspect",
        "issue",
        "manual",
        "most",
        "page",
        "please",
        "show",
        "task",
        "that",
        "this",
        "useful",
        "what",
        "with",
    ];
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|term| term.len() > 2)
        .map(str::to_ascii_lowercase)
        .map(|term| {
            if term.len() > 4 && term.ends_with('s') {
                term[..term.len() - 1].to_owned()
            } else {
                term
            }
        })
        .filter(|term| !GENERIC_TERMS.contains(&term.as_str()))
        .filter(|term| {
            !(term.starts_with("cl") || term.starts_with("gl"))
                || !term[2..]
                    .chars()
                    .all(|character| character.is_ascii_digit())
        })
        .collect()
}

fn image_is_relevant_to_question(question: &str, title: &str, caption: &str) -> bool {
    let question_terms = normalized_topic_terms(question);
    if question_terms.len() < 2 {
        return false;
    }
    let candidate_terms = normalized_topic_terms(&format!("{title} {caption}"));
    let matched = question_terms.intersection(&candidate_terms).count();
    matched >= 2 && matched * 4 >= question_terms.len() * 3
}

fn adapter_error_code(error: &AdapterError) -> StableErrorCode {
    match error {
        AdapterError::NotConfigured { .. } => StableErrorCode::NotConfigured,
        AdapterError::Unavailable(_) => StableErrorCode::SourceUnavailable,
        AdapterError::Timeout(_) => StableErrorCode::SourceTimeout,
        AdapterError::RateLimited(_) => StableErrorCode::SourceRateLimited,
        AdapterError::NotLicensed(_) => StableErrorCode::SourceNotLicensed,
        AdapterError::Stale(_) => StableErrorCode::SourceStale,
        AdapterError::InvalidInput(_) => StableErrorCode::InvalidInput,
        AdapterError::Internal(_) => StableErrorCode::InternalError,
    }
}

#[async_trait]
impl Tool for ManualSearchTool {
    type Request = ManualSearchRequest;
    type Response = ManualSearchResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.manual.search",
            "Search Approved Manuals",
            "Search the frozen approved manual corpus for the user's actual question. Prefer the aircraft named by the user; omit aircraft_model only when the active or recent conversational scope should be used. Returns bounded source excerpts and verified image metadata for grounded citations.",
            Action::CaseRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: ManualSearchRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        input.validate().map_err(|message| EnvelopeError {
            code: StableErrorCode::InvalidInput,
            severity: "error".into(),
            message,
            retryable: false,
        })?;

        let include_images = input.include_images.unwrap_or(true);
        let manual_type = input
            .manual_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_ascii_uppercase);
        let ata = input
            .ata
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        let query = ManualQuery {
            aircraft_id: None,
            aircraft_model: input
                .aircraft_model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
            manual_type: manual_type.clone(),
            ata: ata.clone(),
            text: input.question.trim().to_owned(),
            limit: Some(input.limit.unwrap_or(8).clamp(1, 12)),
        };

        let result = match self.manual.search(&query).await {
            Ok(result) => result,
            Err(error) => {
                let mut envelope = CapabilityEnvelope::new(
                    ctx.request_id.0,
                    ManualSearchResponse {
                        state: ManualRetrievalState::RetrievalUnavailable,
                        aircraft_model: query.aircraft_model,
                        manual_type,
                        ata,
                        returned: 0,
                        records: Vec::new(),
                    },
                );
                envelope.status = EnvelopeStatus::Partial;
                envelope.warnings.push(EnvelopeError {
                    code: adapter_error_code(&error),
                    severity: "warn".into(),
                    message: format!("manual retrieval was unavailable: {error}"),
                    retryable: !matches!(
                        error,
                        AdapterError::InvalidInput(_)
                            | AdapterError::NotLicensed(_)
                            | AdapterError::NotConfigured { .. }
                    ),
                });
                envelope.confidence.score = 0.0;
                envelope.confidence.explanation =
                    "the configured manual corpus did not return a result".into();
                return Ok(envelope);
            }
        };

        let records = result
            .evidence
            .iter()
            .enumerate()
            .map(|(index, evidence)| ManualSearchRecord {
                citation: format!("M-{:02}", index + 1),
                title: evidence.title.clone(),
                excerpt: truncate_chars(evidence.excerpt.as_deref().unwrap_or_default(), 1_600),
                revision: evidence.revision.clone(),
                effective_at: evidence.effective_at.map(|value| value.to_string()),
                source_reference: evidence.source_reference.clone(),
                content_hash: evidence.content_hash.clone(),
                match_percent: retrieval_percent(evidence.retrieval_score),
                license_scope: evidence.license_scope.clone(),
                images: if include_images {
                    evidence
                        .assets
                        .iter()
                        .filter(|asset| asset.availability == EvidenceAssetAvailability::Available)
                        .filter(|asset| {
                            image_is_relevant_to_question(
                                &query.text,
                                &evidence.title,
                                asset.caption.as_deref().unwrap_or_default(),
                            )
                        })
                        .map(|asset| ManualSearchAsset {
                            asset_id: asset.asset_id.clone(),
                            kind: format!("{:?}", asset.kind).to_ascii_lowercase(),
                            source_reference: asset.source_reference.clone(),
                            media_type: asset.media_type.clone(),
                            page: asset.page,
                            caption: asset.caption.clone(),
                            content_hash: asset.content_hash.clone(),
                        })
                        .collect()
                } else {
                    Vec::new()
                },
            })
            .collect::<Vec<_>>();
        let returned = records.len() as u32;
        let mut envelope = CapabilityEnvelope::new(
            ctx.request_id.0,
            ManualSearchResponse {
                state: result.state,
                aircraft_model: result.aircraft_model,
                manual_type,
                ata: result.ata,
                returned,
                records,
            },
        );
        if returned == 0 {
            envelope.status = EnvelopeStatus::Partial;
            envelope.confidence.score = 0.0;
            envelope.confidence.explanation =
                "the approved corpus was searched but returned no qualified record".into();
        } else {
            envelope.confidence.score = 0.7;
            envelope.confidence.explanation =
                "ranked excerpts came from the configured approved manual corpus".into();
        }
        Ok(envelope)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linked_images_require_specific_topical_alignment() {
        assert!(!image_is_relevant_to_question(
            "What should I inspect for a Challenger 350 flight data recorder issue? Include a useful diagram.",
            "CL350 AMM PT 2 — CHAPTER 31 INDICATING RECORDING SYSTEMS p.165",
            "Manual figure from CHAPTER 31 INDICATING RECORDING SYSTEMS_p165_img1.png",
        ));
        assert!(!image_is_relevant_to_question(
            "Show the Falcon 8X main landing gear wheel removal torque figure",
            "8X AMM — Removal / installation of the main landing gear main doors",
            "Main landing gear main doors figure",
        ));
        assert!(image_is_relevant_to_question(
            "Show the Falcon 8X main landing gear main door removal figure",
            "8X AMM — Removal / installation of the main landing gear main doors",
            "Main landing gear main doors figure",
        ));
    }
}
