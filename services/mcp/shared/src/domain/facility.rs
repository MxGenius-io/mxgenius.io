//! MRO facility stubs.

use serde::{Deserialize, Serialize};

use super::ids::{FacilityCapabilityId, FacilityId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MROFacility {
    pub id: FacilityId,
    pub name: String,
    pub source_reference: Option<String>,
    pub icao: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FacilityCapability {
    pub id: FacilityCapabilityId,
    pub facility_id: FacilityId,
    pub task_code: String,
    pub rating: Option<String>,
    pub evidence_reference: Option<String>,
}
