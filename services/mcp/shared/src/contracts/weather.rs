//! Weather contracts (5): `mxg.weather.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;

use super::common::{BoundingBox, HazardKind, Severity};

// 23. mxg.weather.airport_now ---------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherAirportNowRequest {
    pub airport_icao: String,
    pub airport_iata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherAirportNowResponse {
    pub airport_icao: String,
    pub observed_at: Option<UtcDateTime>,
    pub forecast_at: Option<UtcDateTime>,
    pub flight_category: Option<String>,
    pub metar: Option<String>,
    pub taf: Option<String>,
    pub decoded: Option<serde_json::Value>,
    pub source: String,
}

// 24. mxg.weather.maintenance_window --------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherMaintenanceWindowRequest {
    pub airport_icao: String,
    pub start: UtcDateTime,
    pub end: UtcDateTime,
    pub work_type: String,
    pub threshold_profile: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceWindow {
    pub start: UtcDateTime,
    pub end: UtcDateTime,
    pub suitability: String,
    pub drivers: Vec<String>,
    pub source_validity: UtcDateTime,
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherMaintenanceWindowResponse {
    pub airport_icao: String,
    pub windows: Vec<MaintenanceWindow>,
}

// 25. mxg.weather.ramp_risk -----------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherRampRiskRequest {
    pub airport_icao: String,
    pub start: UtcDateTime,
    pub duration_minutes: u32,
    pub work_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherRampRiskResponse {
    pub airport_icao: String,
    /// No level is asserted when the weather adapter is unavailable.
    pub risk_level: Option<Severity>,
    pub drivers: Vec<String>,
    pub advisory_only: bool,
}

// 26. mxg.weather.ferry_assessment ----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherFerryAssessmentRequest {
    pub origin: String,
    pub destination: String,
    pub departure_window_start: UtcDateTime,
    pub departure_window_end: UtcDateTime,
    pub route: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherFerryAssessmentResponse {
    pub origin: String,
    pub destination: String,
    pub feasibility_state: String,
    pub constraints: Vec<String>,
    pub hazards: Vec<String>,
    pub missing_information: Vec<String>,
    pub advisory_only: bool,
}

// 27. mxg.weather.hazard_overlay -----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherHazardOverlayRequest {
    pub bounding_box: BoundingBox,
    pub time: UtcDateTime,
    pub kinds: Vec<HazardKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct HazardObject {
    pub id: String,
    pub kind: HazardKind,
    pub geometry: serde_json::Value,
    pub valid_from: UtcDateTime,
    pub valid_to: UtcDateTime,
    pub source_reference: String,
    pub severity: Severity,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherHazardOverlayResponse {
    pub hazards: Vec<HazardObject>,
}
