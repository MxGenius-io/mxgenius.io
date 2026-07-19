//! Capability trace. Per the contract, every invocation records trace_id,
//! request_id, correlation_id, tool_name, latency, status, evidence_ids, etc.
//!
//! The stub writes structured traces to the `tracing` crate's subscriber.
//! Fleshed-out implementation will persist to `capability_traces` in the DB.

use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityTrace {
    pub trace_id: Uuid,
    pub request_id: Uuid,
    pub correlation_id: Uuid,
    pub tool_name: String,
    pub tool_version: String,
    pub input_schema_version: String,
    pub output_schema_version: String,
    pub domain_schema_version: String,
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub case_id: Option<Uuid>,
    pub started_at: OffsetDateTime,
    pub completed_at: OffsetDateTime,
    pub latency_ms: i64,
    pub status: String,
    pub evidence_ids: Vec<Uuid>,
    pub confidence_basis: Option<String>,
    pub approval_required: bool,
    pub approval_result: Option<String>,
    pub error_codes: Vec<String>,
}

pub fn record(trace: &CapabilityTrace) {
    tracing::info!(target: "mxgenius.mcp.trace", trace = ?trace);
}
