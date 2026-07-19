//! Scheduling contracts (5): `mxg.scheduling.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;
use crate::domain::ids::{CaseId, FacilityId, ScheduleOptionId};

use super::common::Severity;

// 38. mxg.scheduling.window_options -------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingWindowOptionsRequest {
    pub case_id: CaseId,
    pub horizon_start: UtcDateTime,
    pub horizon_end: UtcDateTime,
    pub site_facility_id: Option<FacilityId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ScheduleOptionDto {
    pub id: ScheduleOptionId,
    pub start: UtcDateTime,
    pub end: UtcDateTime,
    pub facility_id: Option<FacilityId>,
    pub constraints: Vec<String>,
    pub readiness: String,
    pub assumptions: Vec<String>,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingWindowOptionsResponse {
    pub options: Vec<ScheduleOptionDto>,
}

// 39. mxg.scheduling.resource_match -------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingResourceMatchRequest {
    pub case_id: CaseId,
    pub site_facility_id: Option<FacilityId>,
    pub target_window_start: Option<UtcDateTime>,
    pub target_window_end: Option<UtcDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ResourceMatchEntry {
    pub resource_kind: String, // labor | bay | tooling | facility_capability
    pub name: String,
    pub matched: bool,
    pub gap_reason: Option<String>,
    pub source_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingResourceMatchResponse {
    pub entries: Vec<ResourceMatchEntry>,
    pub data_completeness: String,
}

// 40. mxg.scheduling.conflict_scan --------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingConflictScanRequest {
    pub case_ids: Vec<CaseId>,
    pub schedule_option_id: Option<ScheduleOptionId>,
    pub resources: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingConflict {
    pub id: String,
    pub kind: String,
    pub severity: Severity,
    pub description: String,
    pub affected_objects: Vec<String>,
    pub possible_resolutions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingConflictScanResponse {
    pub conflicts: Vec<SchedulingConflict>,
}

// 41. mxg.scheduling.parts_readiness -------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingPartsReadinessRequest {
    pub case_id: CaseId,
    pub target_start: UtcDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingPartsReadinessResponse {
    pub case_id: CaseId,
    pub readiness_state: String,
    pub blocking_requirements: Vec<String>,
    pub eta_gaps: Vec<String>,
    pub certificate_gaps: Vec<String>,
    pub evidence_ids: Vec<String>,
}

// 42. mxg.scheduling.publish_plan ---------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingPublishPlanRequest {
    pub case_id: CaseId,
    pub schedule_option_id: ScheduleOptionId,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SchedulingPublishPlanResponse {
    pub case_id: CaseId,
    pub new_version: Option<i64>,
    pub audit_event_id: Option<String>,
    pub published: bool,
    pub note: String,
}
