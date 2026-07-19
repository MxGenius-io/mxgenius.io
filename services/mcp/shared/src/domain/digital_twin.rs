//! Digital twin stubs.

use serde::{Deserialize, Serialize};

use time::OffsetDateTime;

use super::ids::{CaseId, MarkerId, ModelId, ObservationId, TwinModelId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalTwinModel {
    pub id: TwinModelId,
    pub name: String,
    pub revision: String,
    pub lod: String,
    pub applicable_aircraft: Vec<String>,
    pub resource_url: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalTwinMarker {
    pub id: MarkerId,
    pub case_id: CaseId,
    pub model_id: ModelId,
    pub component_id: Option<String>,
    pub zone_id: Option<String>,
    pub severity: String,
    pub observation_id: Option<ObservationId>,
    pub created_at: OffsetDateTime,
}
