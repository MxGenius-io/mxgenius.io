//! Schedule option and weather context stubs.

use serde::{Deserialize, Serialize};

use time::OffsetDateTime;

use super::ids::{CaseId, FacilityId, ScheduleOptionId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleOption {
    pub id: ScheduleOptionId,
    pub case_id: CaseId,
    pub facility_id: Option<FacilityId>,
    pub start: OffsetDateTime,
    pub end: OffsetDateTime,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherContext {
    pub airport_icao: String,
    pub observed_at: OffsetDateTime,
    pub flight_category: Option<String>,
    pub source_reference: String,
}
