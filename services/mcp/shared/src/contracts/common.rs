//! Common input/output shapes shared across domains.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::ids::AircraftId;

/// Confidence score at the wire. Mirrors the envelope's `confidence` block.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ConfidenceDto {
    pub score: f32,
    pub basis: String,
    pub explanation: String,
}

/// Bounding box for hazard-overlay and similar geospatial inputs.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BoundingBox {
    pub min_lat: f64,
    pub min_lon: f64,
    pub max_lat: f64,
    pub max_lon: f64,
}

/// Hazard kinds the weather overlay understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HazardKind {
    Convective,
    Icing,
    Turbulence,
    Ifr,
    Windshear,
    Ash,
    Dust,
    Volcanic,
}

/// Severity used for case markers and conflicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

/// Optional include flags used by `mxg.maintenance_case.build_context`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct ContextIncludeFlags {
    pub documents: bool,
    pub compliance: bool,
    pub weather: bool,
    pub parts: bool,
    pub facilities: bool,
    pub timeline: bool,
}

/// History kinds filter for `mxg.aircraft.history_window`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HistoryKind {
    Maintenance,
    Compliance,
    Operational,
    Cosmetic,
}

/// Generic "drill-through" reference used by analytics outputs.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DrillThroughRef {
    pub kind: String,
    pub id: String,
    pub label: Option<String>,
}

/// Lightweight reference to a canonical aircraft.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftRef {
    pub aircraft_id: AircraftId,
    pub registration: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
}
