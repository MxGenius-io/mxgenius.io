//! MaintenanceCase contracts (6): `mxg.maintenance_case.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;
use crate::domain::ids::CaseId;

use super::common::ContextIncludeFlags;

// 7. mxg.maintenance_case.create ------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseCreateRequest {
    #[schemars(length(min = 1, max = 128))]
    pub aircraft_id: String,
    #[schemars(length(min = 1, max = 10000))]
    pub raw_discrepancy: String,
    pub priority: PriorityDto,
    pub location: Option<LocationDto>,
    #[schemars(length(min = 1, max = 128))]
    pub initial_component_id: Option<String>,
}

impl MaintenanceCaseCreateRequest {
    pub fn validate(&self) -> Result<(), String> {
        bounded_nonblank("aircraft_id", &self.aircraft_id, 128)?;
        bounded_nonblank("raw_discrepancy", &self.raw_discrepancy, 10_000)?;
        if let Some(component) = &self.initial_component_id {
            bounded_nonblank("initial_component_id", component, 128)?;
        }
        if let Some(location) = &self.location {
            location.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PriorityDto {
    Routine,
    Deferred,
    Urgent,
    Aog,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LocationDto {
    #[schemars(length(min = 4, max = 4))]
    pub icao: Option<String>,
    #[schemars(length(min = 3, max = 3))]
    pub iata: Option<String>,
    #[schemars(length(min = 1, max = 128))]
    pub city: Option<String>,
    #[schemars(length(min = 1, max = 128))]
    pub region: Option<String>,
    #[schemars(length(min = 2, max = 2))]
    pub country: Option<String>,
}

impl LocationDto {
    pub fn validate(&self) -> Result<(), String> {
        if self.icao.is_none()
            && self.iata.is_none()
            && self.city.is_none()
            && self.region.is_none()
            && self.country.is_none()
        {
            return Err("location must contain at least one locator".into());
        }
        validate_code("location.icao", self.icao.as_deref(), 4)?;
        validate_code("location.iata", self.iata.as_deref(), 3)?;
        validate_code("location.country", self.country.as_deref(), 2)?;
        for (name, value) in [
            ("location.city", self.city.as_deref()),
            ("location.region", self.region.as_deref()),
        ] {
            if let Some(value) = value {
                bounded_nonblank(name, value, 128)?;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseCreateResponse {
    pub case: CaseDto,
    pub created_event_ids: Vec<String>,
    pub audit_event_id: String,
}

// 8. mxg.maintenance_case.get ---------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseGetRequest {
    pub case_id: CaseId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseGetResponse {
    pub case: CaseDto,
    pub unresolved_conflicts: Vec<ConflictRef>,
}

// 9. mxg.maintenance_case.build_context -----------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseBuildContextRequest {
    pub case_id: CaseId,
    pub include: Option<ContextIncludeFlags>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseBuildContextResponse {
    pub case: CaseDto,
    pub documents: Vec<DocumentRef>,
    pub regulatory_items: Vec<RegulatoryRef>,
    pub weather: Option<WeatherSlice>,
    pub parts_state: Option<PartsSlice>,
    pub facility_state: Option<FacilitySlice>,
    pub timeline: Vec<TimelineEntry>,
    pub unresolved_conflicts: Vec<ConflictRef>,
    pub evidence_map: Vec<EvidenceLink>,
}

// 10. mxg.maintenance_case.similar_cases ---------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseSimilarCasesRequest {
    pub case_id: Option<CaseId>,
    #[schemars(length(min = 1, max = 2000))]
    pub query: Option<String>,
    #[schemars(range(min = 1, max = 100))]
    pub limit: Option<u32>,
}

impl MaintenanceCaseSimilarCasesRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.case_id.is_none() && self.query.is_none() {
            return Err("case_id or query is required".into());
        }
        if let Some(query) = &self.query {
            bounded_nonblank("query", query, 2_000)?;
        }
        if let Some(limit) = self.limit {
            if !(1..=100).contains(&limit) {
                return Err("limit must be between 1 and 100".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SimilarCaseMatch {
    pub case_id: CaseId,
    pub score: f32,
    pub matching_factors: Vec<String>,
    pub outcome: Option<String>,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseSimilarCasesResponse {
    pub matches: Vec<SimilarCaseMatch>,
}

// 11. mxg.maintenance_case.update_status ----------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseUpdateStatusRequest {
    pub case_id: CaseId,
    pub target_status: CaseStatusDto,
    #[schemars(range(min = 1))]
    pub expected_version: i64,
    #[schemars(length(min = 1, max = 2000))]
    pub reason: Option<String>,
}

impl MaintenanceCaseUpdateStatusRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.expected_version < 1 {
            return Err("expected_version must be at least 1".into());
        }
        if let Some(reason) = &self.reason {
            bounded_nonblank("reason", reason, 2_000)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CaseStatusDto {
    Draft,
    Open,
    Triage,
    Diagnosing,
    Planning,
    AwaitingParts,
    Scheduled,
    InWork,
    AwaitingInspection,
    AwaitingApproval,
    Closed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStateDto {
    Pending,
    Approved,
    Rejected,
    NotRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseUpdateStatusResponse {
    pub case: CaseDto,
    pub prior_status: CaseStatusDto,
    pub new_status: CaseStatusDto,
    pub new_version: i64,
    pub maintenance_event_id: String,
    pub audit_event_id: String,
}

// 12. mxg.maintenance_case.attach_observation ----------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseAttachObservationRequest {
    pub case_id: CaseId,
    #[schemars(length(min = 1, max = 10000))]
    pub note: String,
    #[schemars(length(min = 1, max = 128))]
    pub component_id: Option<String>,
    #[schemars(length(max = 20))]
    pub media_refs: Vec<String>,
}

impl MaintenanceCaseAttachObservationRequest {
    pub fn validate(&self) -> Result<(), String> {
        bounded_nonblank("note", &self.note, 10_000)?;
        if let Some(component) = &self.component_id {
            bounded_nonblank("component_id", component, 128)?;
        }
        if self.media_refs.len() > 20 {
            return Err("media_refs may contain at most 20 entries".into());
        }
        for reference in &self.media_refs {
            bounded_nonblank("media_refs entry", reference, 2_048)?;
        }
        Ok(())
    }
}

fn bounded_nonblank(name: &str, value: &str, max: usize) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() || value.len() > max {
        return Err(format!("{name} must contain 1 to {max} characters"));
    }
    Ok(())
}

fn validate_code(name: &str, value: Option<&str>, length: usize) -> Result<(), String> {
    if let Some(value) = value {
        if value.len() != length || !value.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(format!(
                "{name} must be {length} ASCII alphanumeric characters"
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MaintenanceCaseAttachObservationResponse {
    pub observation_id: String,
    pub evidence_id: String,
    pub maintenance_event_id: String,
    pub audit_event_id: String,
}

// Shared case shape --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CaseDto {
    pub case_id: CaseId,
    pub organization_id: String,
    pub aircraft_id: String,
    pub status: CaseStatusDto,
    pub priority: PriorityDto,
    pub opened_at: UtcDateTime,
    pub updated_at: UtcDateTime,
    pub location: Option<LocationDto>,
    pub raw_discrepancy: String,
    pub normalized_discrepancy: Option<NormalizedDiscrepancyDto>,
    pub assigned_user_ids: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub approval_state: ApprovalStateDto,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct NormalizedDiscrepancyDto {
    pub summary: Option<String>,
    pub raw: String,
}

// Sub-shapes used inside build_context ------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DocumentRef {
    pub document_id: String,
    pub title: String,
    pub revision: Option<String>,
    pub effective_date: Option<crate::domain::datetime::IsoDate>,
    pub currency_state: String,
    pub source_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RegulatoryRef {
    pub id: String,
    pub kind: String, // ad | saib | drs
    pub identifier: String,
    pub title: String,
    pub applicability: String,
    pub source_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WeatherSlice {
    pub airport_icao: Option<String>,
    pub observed_at: Option<UtcDateTime>,
    pub flight_category: Option<String>,
    pub source: Option<String>,
    pub not_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartsSlice {
    pub required: Vec<String>,
    pub readiness: String,
    pub not_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FacilitySlice {
    pub candidates: Vec<String>,
    pub best_match: Option<String>,
    pub not_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TimelineEntry {
    pub event_id: String,
    pub event_type: String,
    pub occurred_at: UtcDateTime,
    pub actor_user_id: String,
    pub summary: String,
    pub from_status: Option<CaseStatusDto>,
    pub to_status: Option<CaseStatusDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ConflictRef {
    pub kind: String,
    pub severity: String,
    pub description: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceLink {
    pub evidence_id: String,
    pub kind: String,
    pub title: String,
    pub source_type: String,
}
