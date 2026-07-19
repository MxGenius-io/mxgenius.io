//! Stable error codes. The full set is frozen by the contract lock and must
//! not be extended without a versioned migration of the error envelope.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StableErrorCode {
    AuthRequired,
    AccessDenied,
    TenantMismatch,
    InvalidInput,
    EntityNotFound,
    AmbiguousMatch,
    InvalidStateTransition,
    VersionConflict,
    SourceUnavailable,
    SourceTimeout,
    SourceRateLimited,
    SourceNotLicensed,
    SourceStale,
    InsufficientEvidence,
    DocumentRevisionUnknown,
    ApplicabilityUnknown,
    HumanApprovalRequired,
    ConflictingEvidence,
    NotConfigured,
    InternalError,
}

impl StableErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AuthRequired => "AUTH_REQUIRED",
            Self::AccessDenied => "ACCESS_DENIED",
            Self::TenantMismatch => "TENANT_MISMATCH",
            Self::InvalidInput => "INVALID_INPUT",
            Self::EntityNotFound => "ENTITY_NOT_FOUND",
            Self::AmbiguousMatch => "AMBIGUOUS_MATCH",
            Self::InvalidStateTransition => "INVALID_STATE_TRANSITION",
            Self::VersionConflict => "VERSION_CONFLICT",
            Self::SourceUnavailable => "SOURCE_UNAVAILABLE",
            Self::SourceTimeout => "SOURCE_TIMEOUT",
            Self::SourceRateLimited => "SOURCE_RATE_LIMITED",
            Self::SourceNotLicensed => "SOURCE_NOT_LICENSED",
            Self::SourceStale => "SOURCE_STALE",
            Self::InsufficientEvidence => "INSUFFICIENT_EVIDENCE",
            Self::DocumentRevisionUnknown => "DOCUMENT_REVISION_UNKNOWN",
            Self::ApplicabilityUnknown => "APPLICABILITY_UNKNOWN",
            Self::HumanApprovalRequired => "HUMAN_APPROVAL_REQUIRED",
            Self::ConflictingEvidence => "CONFLICTING_EVIDENCE",
            Self::NotConfigured => "NOT_CONFIGURED",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }
}
