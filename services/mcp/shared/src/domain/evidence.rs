//! Evidence contract — every operational assertion must reference evidence or
//! explicitly mark `INSUFFICIENT_EVIDENCE`.

use serde::{Deserialize, Serialize};

use super::ids::EvidenceId;
use time::OffsetDateTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    Jetnet,
    FaaAd,
    FaaDrs,
    Manual,
    Weather,
    InternalRecord,
    UserObservation,
    SystemCalculation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    RetrievedFact,
    RegulatoryRequirement,
    ManualExcerpt,
    Observation,
    DerivedMetric,
    HumanDecision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceBasis {
    DeterministicLookup,
    RuleMatch,
    RetrievalSupportedInference,
    ModelOnly,
    HumanConfirmed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Confidence {
    pub score: f32,
    pub basis: ConfidenceBasis,
    pub explanation: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceAssetKind {
    Image,
    Diagram,
    Table,
    Attachment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceAssetAvailability {
    Available,
    Missing,
    Unverified,
}

/// A visual or file artifact whose lineage is tied to the evidence source.
/// `source_reference` is stable and must not be a short-lived signed URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceAsset {
    pub asset_id: String,
    pub kind: EvidenceAssetKind,
    pub source_reference: String,
    pub media_type: Option<String>,
    pub page: Option<u32>,
    pub caption: Option<String>,
    pub content_hash: Option<String>,
    pub availability: EvidenceAssetAvailability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub evidence_id: EvidenceId,
    pub source_type: SourceType,
    pub source_reference: String,
    pub kind: EvidenceKind,
    pub title: String,
    pub excerpt: Option<String>,
    pub retrieved_at: OffsetDateTime,
    pub effective_at: Option<OffsetDateTime>,
    pub revision: Option<String>,
    pub license_scope: Option<String>,
    pub content_hash: String,
    /// Provider-native semantic retrieval score. This ranks retrieved source
    /// material; it is not the probability that a maintenance conclusion is correct.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retrieval_score: Option<f32>,
    #[serde(default)]
    pub assets: Vec<EvidenceAsset>,
    /// Hash input. Computed by the source adapter before storage.
    pub content: String,
}
