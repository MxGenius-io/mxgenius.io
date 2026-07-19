//! Universal capability result envelope. Shape is frozen by the contract.

use serde::{Deserialize, Serialize};

use time::OffsetDateTime;
use uuid::Uuid;

use super::errors::StableErrorCode;
use crate::domain::evidence::Confidence;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvelopeStatus {
    Ok,
    Partial,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PromotionState {
    Shadow,
    Test,
    Approved,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeError {
    pub code: StableErrorCode,
    /// `info` | `warn` | `error` | `fatal`. String is used at the wire level
    /// to keep the envelope flat; flesh out as a typed enum if needed.
    pub severity: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityEnvelope<T> {
    pub request_id: Uuid,
    pub status: EnvelopeStatus,
    pub output: T,
    pub evidence: Vec<crate::domain::evidence::Evidence>,
    pub confidence: Confidence,
    pub warnings: Vec<EnvelopeError>,
    pub errors: Vec<EnvelopeError>,
    pub trace_id: Uuid,
    pub requires_human_approval: bool,
    pub promotion_state: PromotionState,
    pub completed_at: OffsetDateTime,
}

impl<T> CapabilityEnvelope<T> {
    /// Construct a fully-populated envelope from a typed output.
    pub fn new(request_id: Uuid, output: T) -> Self {
        let now = OffsetDateTime::now_utc();
        Self {
            request_id,
            status: EnvelopeStatus::Ok,
            output,
            evidence: Vec::new(),
            confidence: Confidence {
                score: 1.0,
                basis: crate::domain::evidence::ConfidenceBasis::DeterministicLookup,
                explanation: "deterministic capability result".into(),
            },
            warnings: Vec::new(),
            errors: Vec::new(),
            trace_id: Uuid::new_v4(),
            requires_human_approval: false,
            promotion_state: PromotionState::Shadow,
            completed_at: now,
        }
    }

    /// Construct a `not-configured` envelope for a capability whose live
    /// adapter is intentionally unavailable in this deployment.
    pub fn not_configured(request_id: Uuid, tool: &str, output: T) -> Self {
        let mut env = Self::new(request_id, output);
        env.status = EnvelopeStatus::Partial;
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "warn".into(),
            message: format!("{tool} is not configured in this build"),
            retryable: false,
        });
        env.confidence.score = 0.0;
        env.confidence.basis = crate::domain::evidence::ConfidenceBasis::ModelOnly;
        env.confidence.explanation = "capability unavailable; no result was produced".into();
        env
    }

    pub fn with_error(mut self, err: EnvelopeError) -> Self {
        self.status = EnvelopeStatus::Error;
        self.errors.push(err);
        self
    }

    pub fn with_warning(mut self, w: EnvelopeError) -> Self {
        self.warnings.push(w);
        self
    }

    pub fn with_evidence(mut self, ev: crate::domain::evidence::Evidence) -> Self {
        self.evidence.push(ev);
        self
    }
}
