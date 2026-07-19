//! Parts contracts (5): `mxg.parts.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;
use crate::domain::ids::{CaseId, PartId};

// 13. mxg.parts.resolve ----------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct PartsResolveRequest {
    pub part_number: Option<String>,
    pub description_query: Option<String>,
    pub aircraft_id: Option<String>,
    pub component_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsResolveMatch {
    pub part_id: PartId,
    pub part_number: String,
    pub description: String,
    pub manufacturer: Option<String>,
    pub applicability: String,
    pub ambiguity_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsResolveResponse {
    pub matches: Vec<PartsResolveMatch>,
}

// 14. mxg.parts.alternates -------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsAlternatesRequest {
    pub part_id: PartId,
    pub aircraft_id: Option<String>,
    pub component_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsAlternatesResponse {
    pub alternates: Vec<PartsResolveMatch>,
    pub supersessions: Vec<PartsResolveMatch>,
    pub insufficient_evidence: bool,
}

// 15. mxg.parts.inventory --------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsInventoryRequest {
    pub part_id: PartId,
    pub destination: String,
    pub radius_nm: Option<u32>,
    pub acceptable_conditions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsInventoryOption {
    pub supplier_id: Option<String>,
    pub location: String,
    pub quantity: i32,
    pub condition: String,
    pub certificate_state: String,
    pub price: Option<f64>,
    pub currency: Option<String>,
    pub source_freshness: Option<UtcDateTime>,
    pub source_reference: String,
    pub supplier_confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsInventoryResponse {
    pub options: Vec<PartsInventoryOption>,
}

// 16. mxg.parts.rank_options ---------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsRankOptionsRequest {
    pub case_id: Option<CaseId>,
    pub part_requirement_id: Option<String>,
    pub destination: String,
    pub required_by: UtcDateTime,
    pub acceptable_conditions: Vec<String>,
    pub priorities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsRankOption {
    pub rank: u32,
    pub supplier_id: Option<String>,
    pub eta: Option<UtcDateTime>,
    pub availability: String,
    pub location: String,
    pub condition: String,
    pub certificate_state: String,
    pub price: Option<f64>,
    pub warranty: Option<String>,
    pub confidence: f32,
    pub assumptions: Vec<String>,
    pub blocking_items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsRankOptionsResponse {
    pub ranked: Vec<PartsRankOption>,
    pub advisory: bool,
}

// 17. mxg.parts.attach_certificate ---------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsAttachCertificateRequest {
    pub case_id: CaseId,
    pub part_id: Option<PartId>,
    pub part_requirement_id: Option<String>,
    pub certificate_type: String,
    pub document_reference: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CertificateRecordDto {
    pub certificate_id: String,
    pub case_id: CaseId,
    pub part_id: Option<PartId>,
    pub certificate_type: String,
    pub document_reference: String,
    pub file_present: bool,
    pub validation_state: String,
    pub created_at: UtcDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsAttachCertificateResponse {
    pub certificate: Option<CertificateRecordDto>,
    pub audit_event_id: Option<String>,
}
