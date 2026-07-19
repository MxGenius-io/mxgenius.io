//! Compliance contracts (5): `mxg.compliance.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::{IsoDate, UtcDateTime};
use crate::domain::ids::{CaseId, DocumentId};

use super::common::Severity;

// 28. mxg.compliance.applicable_ads --------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceApplicableAdsRequest {
    pub aircraft_id: String,
    pub case_id: Option<CaseId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApplicabilityDto {
    Candidate,
    LikelyApplicable,
    ConfirmedApplicable,
    NotApplicable,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ApplicableAd {
    pub ad_number: String,
    pub title: String,
    pub effective_at: Option<UtcDateTime>,
    pub source_reference: String,
    pub applicability: ApplicabilityDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceApplicableAdsResponse {
    pub ads: Vec<ApplicableAd>,
}

// 29. mxg.compliance.saib_search -----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceSaibSearchRequest {
    pub aircraft_type: Option<String>,
    pub component: Option<String>,
    pub query: Option<String>,
    pub start_date: Option<IsoDate>,
    pub end_date: Option<IsoDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SaibResult {
    pub identifier: String,
    pub title: String,
    pub issued_at: Option<IsoDate>,
    pub applicability_text: Option<String>,
    pub source_link: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceSaibSearchResponse {
    pub results: Vec<SaibResult>,
}

// 30. mxg.compliance.manual_currency -------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceManualCurrencyRequest {
    pub document_id: DocumentId,
    pub aircraft_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceManualCurrencyResponse {
    pub document_id: DocumentId,
    pub known_revision: Option<String>,
    pub effective_date: Option<IsoDate>,
    pub supersession_state: String,
    pub currency_state: String,
    pub source: String,
    pub warnings: Vec<String>,
}

// 31. mxg.compliance.record_audit ----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceRecordAuditRequest {
    pub case_id: CaseId,
    pub scope: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RecordAuditFinding {
    pub kind: String,
    pub severity: Severity,
    pub description: String,
    pub evidence_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceRecordAuditResponse {
    pub case_id: CaseId,
    pub missing_fields: Vec<String>,
    pub missing_evidence: Vec<String>,
    pub missing_signatures: Vec<String>,
    pub missing_approvals: Vec<String>,
    pub part_documentation_gaps: Vec<String>,
    pub unresolved_warnings: Vec<RecordAuditFinding>,
    pub completeness: String,
}

// 32. mxg.compliance.return_to_service_pack -----------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceReturnToServicePackRequest {
    pub case_id: CaseId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComplianceReturnToServicePackResponse {
    pub case_id: CaseId,
    pub assembled_documents: Vec<DocumentRefRts>,
    pub evidence: Vec<String>,
    pub approvals_present: Vec<String>,
    pub approvals_needed: Vec<String>,
    pub record_gaps: Vec<String>,
    pub warnings: Vec<String>,
    /// Present only when a review pack was actually assembled.
    pub review_metadata: Option<RtsReviewMetadata>,
    /// Always false. RTS authority is never granted by this tool.
    pub authorized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DocumentRefRts {
    pub document_id: String,
    pub title: String,
    pub revision: Option<String>,
    pub effective_date: Option<IsoDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RtsReviewMetadata {
    pub generated_at: UtcDateTime,
    pub generated_by_user_id: String,
    pub scope: String,
}
