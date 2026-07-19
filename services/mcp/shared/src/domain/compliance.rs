//! Compliance stubs.

use serde::{Deserialize, Serialize};

use time::OffsetDateTime;

use super::ids::{AdvisoryId, DocumentId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplicabilityState {
    Candidate,
    LikelyApplicable,
    ConfirmedApplicable,
    NotApplicable,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirworthinessDirective {
    pub id: AdvisoryId,
    pub ad_number: String,
    pub title: String,
    pub effective_at: Option<OffsetDateTime>,
    pub source_reference: String,
    pub applicability: ApplicabilityState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvisoryNotice {
    pub id: AdvisoryId,
    pub notice_number: String,
    pub title: String,
    pub issued_at: Option<OffsetDateTime>,
    pub source_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegulatoryRequirement {
    pub id: AdvisoryId,
    pub source_reference: String,
    pub document_id: Option<DocumentId>,
    pub summary: String,
}
