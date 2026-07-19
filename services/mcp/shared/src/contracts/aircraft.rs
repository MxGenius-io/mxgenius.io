//! Aircraft contracts (6): `mxg.aircraft.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;
use crate::domain::ids::AircraftId;

use super::common::{DrillThroughRef, HistoryKind};

// 1. mxg.aircraft.lookup ---------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct AircraftLookupRequest {
    /// Aircraft registration (tail number). At least one of registration,
    /// serial_number, source_id is required.
    #[schemars(length(min = 1, max = 32))]
    pub registration: Option<String>,
    #[schemars(length(min = 1, max = 64))]
    pub serial_number: Option<String>,
    #[schemars(length(min = 1, max = 128))]
    pub source_id: Option<String>,
}

impl AircraftLookupRequest {
    pub fn validate(&self) -> Result<(), String> {
        let identifiers = [
            ("registration", self.registration.as_deref(), 32_usize),
            ("serial_number", self.serial_number.as_deref(), 64),
            ("source_id", self.source_id.as_deref(), 128),
        ];
        if identifiers.iter().all(|(_, value, _)| value.is_none()) {
            return Err(
                "at least one of registration, serial_number, source_id is required".into(),
            );
        }
        for (name, value, max) in identifiers {
            if let Some(value) = value {
                let trimmed = value.trim();
                if trimmed.is_empty() || trimmed.len() > max {
                    return Err(format!("{name} must contain 1 to {max} characters"));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftMatch {
    pub aircraft_id: AircraftId,
    pub registration: Option<String>,
    pub serial_number: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub source_reference: String,
    pub source_freshness: Option<UtcDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftLookupResponse {
    /// Set only when resolution is unambiguous. `None` when the caller should
    /// disambiguate via the matches list.
    pub aircraft_id: Option<AircraftId>,
    pub matches: Vec<AircraftMatch>,
}

// 2. mxg.aircraft.profile --------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftProfileRequest {
    pub aircraft_id: AircraftId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftProfileResponse {
    pub aircraft_id: AircraftId,
    pub registration: Option<String>,
    pub serial_number: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i32>,
    pub status: Option<String>,
    pub operator: Option<String>,
    pub owner: Option<String>,
    pub base: Option<String>,
    pub images: Vec<String>,
    pub source_freshness: Option<UtcDateTime>,
}

// 3. mxg.aircraft.location_context ----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftLocationContextRequest {
    pub aircraft_id: AircraftId,
    pub as_of: Option<UtcDateTime>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LocationKind {
    Base,
    KnownLicensedLocation,
    LiveTracking,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftLocationContextResponse {
    pub aircraft_id: AircraftId,
    pub kind: LocationKind,
    pub airport_icao: Option<String>,
    pub airport_iata: Option<String>,
    pub coordinates: Option<GeoCoord>,
    pub jurisdiction_country: Option<String>,
    pub timestamp: Option<UtcDateTime>,
    pub source_reference: Option<String>,
    pub live_tracking_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct GeoCoord {
    pub lat: f64,
    pub lon: f64,
}

// 4. mxg.aircraft.utilization_summary --------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftUtilizationSummaryRequest {
    pub aircraft_id: AircraftId,
    pub start_date: Option<UtcDateTime>,
    pub end_date: Option<UtcDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftUtilizationSummaryResponse {
    pub aircraft_id: AircraftId,
    pub airframe_hours: Option<f64>,
    pub estimated_hours: Option<f64>,
    pub cycles: Option<i64>,
    pub age_years: Option<f64>,
    pub trend: Option<String>,
    pub source_timestamps: Vec<UtcDateTime>,
    pub missing_fields: Vec<String>,
}

// 5. mxg.aircraft.related_entities ----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftRelatedEntitiesRequest {
    pub aircraft_id: AircraftId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipKind {
    Owner,
    Operator,
    Company,
    Contact,
    Insurer,
    Lessor,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RelatedEntityRef {
    pub id: String,
    pub kind: RelationshipKind,
    pub name: Option<String>,
    pub source_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftRelatedEntitiesResponse {
    pub aircraft_id: AircraftId,
    pub entities: Vec<RelatedEntityRef>,
}

// 6. mxg.aircraft.history_window ------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftHistoryWindowRequest {
    pub aircraft_id: AircraftId,
    pub start_date: UtcDateTime,
    pub end_date: UtcDateTime,
    pub kinds: Option<Vec<HistoryKind>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct HistoryEvent {
    pub event_id: String,
    pub kind: HistoryKind,
    pub occurred_at: UtcDateTime,
    pub summary: String,
    pub source_reference: String,
    pub license_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AircraftHistoryWindowResponse {
    pub aircraft_id: AircraftId,
    pub events: Vec<HistoryEvent>,
    pub source_timestamps: Vec<UtcDateTime>,
    pub completeness: String,
    // Drill-through is reserved for analytics: keep an empty vec here.
    pub drill_through: Vec<DrillThroughRef>,
}
