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

// 18. mxg.parts.order_history ---------------------------------------------

/// Ask what this organization has actually bought, and what it recorded
/// paying. Either identifier resolves the catalog part; `part_number` is the
/// field a technician has in hand.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct PartsOrderHistoryRequest {
    pub part_number: Option<String>,
    pub part_id: Option<PartId>,
    /// Optional lower bound on `ordered_at`. Orders with no recorded order
    /// date are excluded when this is set, because an unknown date cannot be
    /// shown to fall inside the window.
    pub ordered_since: Option<UtcDateTime>,
}

/// One catalog part the answer covers.
///
/// A part number is unique only per manufacturer, so a bare part number can
/// legitimately cover several catalog rows. Naming them keeps the caller from
/// reading one manufacturer's history as the whole story.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsOrderHistoryPart {
    pub part_id: PartId,
    pub part_number: String,
    pub description: String,
    pub manufacturer: Option<String>,
}

/// One recorded order line.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsOrderHistoryEntry {
    pub order_id: String,
    pub order_number: Option<String>,
    pub order_kind: String,
    pub type_of_buy: String,
    pub supplier_name: Option<String>,
    pub buyer_name: Option<String>,
    pub ordered_at: Option<UtcDateTime>,
    pub status: String,
    /// Quantity from the requirement this order was placed against. Present so
    /// a caller can judge whether a recorded cost is a line total or a unit
    /// price; this tool does not divide one by the other.
    pub requirement_quantity: i32,
    pub recorded_cost_usd: Option<f64>,
    pub invoice_amount_usd: Option<f64>,
    pub backordered: bool,
}

/// Cost figures for one `type_of_buy`.
///
/// Deliberately not blended across buy types: an outright purchase, an
/// exchange, a repair, and a loan are different transactions, and one average
/// spanning them would describe none of them.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsOrderHistoryCostSummary {
    pub type_of_buy: String,
    pub order_count: i64,
    /// Orders in this group that carry a recorded cost. The remainder are
    /// counted above but cannot contribute to an average.
    pub priced_order_count: i64,
    pub average_recorded_cost_usd: Option<f64>,
    pub minimum_recorded_cost_usd: Option<f64>,
    pub maximum_recorded_cost_usd: Option<f64>,
    pub most_recent_recorded_cost_usd: Option<f64>,
    pub most_recent_ordered_at: Option<UtcDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsOrderHistoryResponse {
    /// True only when at least one order counted below exists. A draft or a
    /// cancelled order is not a purchase.
    pub ever_ordered: bool,
    pub parts: Vec<PartsOrderHistoryPart>,
    /// Always `USD`: the underlying columns are USD-denominated by definition.
    pub currency: String,
    /// The order statuses that were counted, published so the caller never has
    /// to guess what the totals include.
    pub counted_statuses: Vec<String>,
    pub order_count: i64,
    pub excluded_draft_count: i64,
    pub excluded_cancelled_count: i64,
    pub cost_summary: Vec<PartsOrderHistoryCostSummary>,
    /// Most recent first, bounded. Aggregates above are computed over every
    /// matching order, not only the ones listed here.
    pub orders: Vec<PartsOrderHistoryEntry>,
    pub orders_truncated: bool,
}
