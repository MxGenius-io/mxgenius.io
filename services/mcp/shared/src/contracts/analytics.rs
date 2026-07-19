//! Analytics contracts (4): `mxg.analytics.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::{IsoDate, UtcDateTime};

use super::common::DrillThroughRef;

// 47. mxg.analytics.fleet_health ---------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsFleetHealthRequest {
    pub fleet_filter: Option<String>,
    pub operator_filter: Option<String>,
    pub start_date: Option<IsoDate>,
    pub end_date: Option<IsoDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FleetHealthMetric {
    pub name: String,
    pub definition: String,
    pub value: serde_json::Value,
    pub freshness: UtcDateTime,
    pub drill_through: Vec<DrillThroughRef>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsFleetHealthResponse {
    pub metrics: Vec<FleetHealthMetric>,
    pub segments: Vec<String>,
}

// 48. mxg.analytics.repeat_defects --------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsRepeatDefectsRequest {
    pub fleet_filter: Option<String>,
    pub start_date: Option<IsoDate>,
    pub end_date: Option<IsoDate>,
    pub grouping: Option<String>, // ata | component | symptom
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RepeatDefect {
    pub bucket: String,
    pub count: u32,
    pub recurrence_interval_days: Option<f64>,
    pub outcomes: Vec<String>,
    pub sample_size: u32,
    pub drill_through_case_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsRepeatDefectsResponse {
    pub defects: Vec<RepeatDefect>,
}

// 49. mxg.analytics.parts_risk -----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsPartsRiskRequest {
    pub scope: Option<String>, // tenant | site | fleet
    pub horizon_start: Option<IsoDate>,
    pub horizon_end: Option<IsoDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsRisk {
    pub part_number: String,
    pub kind: String, // shortage | lead_time | certificate | supplier
    pub severity: String,
    pub supporting_history: Vec<String>,
    pub uncertainty: String,
    pub blocking_case_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsPartsRiskResponse {
    pub risks: Vec<PartsRisk>,
}

// 50. mxg.analytics.exec_kpis -----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsExecKpisRequest {
    pub period_start: IsoDate,
    pub period_end: IsoDate,
    pub fleet_filter: Option<String>,
    pub site_filter: Option<String>,
    pub operator_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ExecKpi {
    pub name: String,
    pub definition: String,
    pub time_boundary: String,
    pub value: serde_json::Value,
    pub drill_through: Vec<DrillThroughRef>,
    pub data_completeness: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsExecKpisResponse {
    pub kpis: Vec<ExecKpi>,
}
