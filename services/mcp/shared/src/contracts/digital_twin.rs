//! Digital twin contracts (5): `mxg.digital_twin.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;
use crate::domain::ids::{CaseId, ModelId, TwinModelId};

use super::common::Severity;

// 33. mxg.digital_twin.list_models ---------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinListModelsRequest {
    pub aircraft_type: Option<String>,
    pub model: Option<String>,
    pub component: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TwinModelDto {
    pub id: TwinModelId,
    pub name: String,
    pub revision: String,
    pub lod: String,
    pub applicable_aircraft: Vec<String>,
    pub resource_url: String,
    pub freshness: Option<UtcDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinListModelsResponse {
    pub models: Vec<TwinModelDto>,
}

// 34. mxg.digital_twin.component_state -----------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinComponentStateRequest {
    pub aircraft_id: String,
    pub component_id: String,
    pub case_id: Option<CaseId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ComponentStateDto {
    pub component_id: String,
    pub canonical: bool,
    pub status: String,
    pub installation_zone: Option<String>,
    pub observations: Vec<String>,
    pub prior_case_ids: Vec<CaseId>,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinComponentStateResponse {
    pub component: ComponentStateDto,
}

// 35. mxg.digital_twin.highlight_zone ------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinHighlightZoneRequest {
    pub model_id: ModelId,
    pub component_id: Option<String>,
    pub zone_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinHighlightZoneResponse {
    pub model_id: ModelId,
    pub mesh_ids: Vec<String>,
    pub zone_id: Option<String>,
    pub camera_preset: Option<String>,
    pub annotation_ids: Vec<String>,
}

// 36. mxg.digital_twin.link_documents ------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinLinkDocumentsRequest {
    pub aircraft_id: Option<String>,
    pub component_id: Option<String>,
    pub model_id: Option<ModelId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LinkedDocument {
    pub document_id: String,
    pub section: Option<String>,
    pub diagram_reference: Option<String>,
    pub confidence: f32,
    pub evidence_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinLinkDocumentsResponse {
    pub documents: Vec<LinkedDocument>,
}

// 37. mxg.digital_twin.attach_case_marker -------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinAttachCaseMarkerRequest {
    pub case_id: CaseId,
    pub component_id: Option<String>,
    pub zone_id: Option<String>,
    pub severity: Severity,
    pub observation_id: Option<String>,
}

impl DigitalTwinAttachCaseMarkerRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self
            .component_id
            .as_deref()
            .map_or(true, |value| value.trim().is_empty())
            && self
                .zone_id
                .as_deref()
                .map_or(true, |value| value.trim().is_empty())
        {
            return Err("component_id or zone_id is required".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DigitalTwinAttachCaseMarkerResponse {
    pub marker_id: Option<String>,
    pub case_id: CaseId,
    pub audit_event_id: Option<String>,
    pub created_at: Option<UtcDateTime>,
}
