//! MRO discovery contracts (5): `mxg.mro.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;
use crate::domain::ids::{CaseId, FacilityId};

// 18. mxg.mro.search -------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct MroSearchRequest {
    pub location: Option<String>,
    pub radius_nm: Option<u32>,
    pub aircraft_type: Option<String>,
    pub task_capability: Option<String>,
    pub ratings: Option<Vec<String>>,
    pub operating_time_need: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroFacilityDto {
    pub facility_id: FacilityId,
    pub name: String,
    pub source_reference: Option<String>,
    pub icao: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub source_completeness: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroSearchResponse {
    pub facilities: Vec<MroFacilityDto>,
}

// 19. mxg.mro.capability_match -------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroCapabilityMatchRequest {
    pub case_id: CaseId,
    pub facility_id: FacilityId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroCapabilityMatchResponse {
    pub facility_id: FacilityId,
    pub supported_tasks: Vec<String>,
    pub gaps: Vec<String>,
    pub ratings_evidence: Vec<String>,
    pub completeness: String,
    /// No score is asserted when required facility evidence is unavailable.
    pub match_score: Option<f32>,
}

// 20. mxg.mro.rank --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroRankRequest {
    pub case_id: CaseId,
    pub constraints: Option<Vec<String>>,
    pub factor_weights: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroRankedFacility {
    pub rank: u32,
    pub facility_id: FacilityId,
    pub name: String,
    pub match_score: f32,
    pub factor_evidence: Vec<FactorEvidence>,
    pub unknown_factors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FactorEvidence {
    pub factor: String,
    pub value: serde_json::Value,
    pub evidence_reference: Option<String>,
    pub unknown: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroRankResponse {
    pub ranked: Vec<MroRankedFacility>,
    pub advisory: bool,
}

// 21. mxg.mro.contact_pack ------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroContactPackRequest {
    pub facility_id: FacilityId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ContactEntry {
    pub contact_id: String,
    pub name: String,
    pub role: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct OperatingHours {
    pub timezone: Option<String>,
    pub schedule: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroContactPackResponse {
    pub facility_id: FacilityId,
    pub facility_name: String,
    pub contacts: Vec<ContactEntry>,
    pub operating_hours: Option<OperatingHours>,
    pub escalation_channels: Vec<String>,
    pub source_freshness: Option<UtcDateTime>,
    pub source_references: Vec<String>,
}

// 22. mxg.mro.route_eta ---------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroRouteEtaRequest {
    pub origin: String,
    pub destination_facility: String,
    pub mode: String, // ground | air
    pub departure_time: Option<UtcDateTime>,
    pub route: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MroRouteEtaResponse {
    pub distance_nm: Option<f64>,
    pub estimated_duration_minutes: Option<i64>,
    pub assumptions: Vec<String>,
    pub constraints: Vec<String>,
    pub weather_link: Option<String>,
    pub uncertainty: String,
}
