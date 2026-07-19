//! `MaintenanceCase` aggregate root and lifecycle.
//!
//! States and priorities are frozen by the contract. Stub fields only — flesh
//! out validation, invariants, and transition guards in this module.

use serde::{Deserialize, Serialize};

use time::OffsetDateTime;

use super::ids::{
    CaseId, DiscrepancyId, EvidenceId, MaintenanceEventId, ObservationId, OrganizationId, UserId,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaseStatus {
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

impl CaseStatus {
    /// Frozen transition graph. Any other transition returns
    /// `INVALID_STATE_TRANSITION`.
    pub fn can_transition_to(self, target: CaseStatus) -> bool {
        use CaseStatus::*;
        matches!(
            (self, target),
            (Draft, Open)
                | (Draft, Cancelled)
                | (Open, Triage)
                | (Open, Cancelled)
                | (Triage, Diagnosing)
                | (Triage, Cancelled)
                | (Diagnosing, Planning)
                | (Diagnosing, Cancelled)
                | (Planning, AwaitingParts)
                | (Planning, Scheduled)
                | (Planning, Cancelled)
                | (AwaitingParts, Scheduled)
                | (AwaitingParts, Cancelled)
                | (Scheduled, InWork)
                | (Scheduled, Cancelled)
                | (InWork, AwaitingInspection)
                | (InWork, Cancelled)
                | (AwaitingInspection, AwaitingApproval)
                | (AwaitingInspection, InWork)
                | (AwaitingApproval, Closed)
                | (AwaitingApproval, InWork)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CasePriority {
    Routine,
    Deferred,
    Urgent,
    Aog,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalState {
    Pending,
    Approved,
    Rejected,
    NotRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Location {
    /// ICAO identifier when known.
    pub icao: Option<String>,
    /// IATA identifier when known.
    pub iata: Option<String>,
    /// Free-text city.
    pub city: Option<String>,
    /// Free-text state / region.
    pub region: Option<String>,
    /// ISO-3166 alpha-2 country code.
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Discrepancy {
    pub id: DiscrepancyId,
    /// Free-text normalization bucket (e.g. ATA chapter, normalized symptom).
    pub normalized_summary: Option<String>,
    /// Source-provided raw discrepancy.
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub id: ObservationId,
    pub case_id: CaseId,
    pub note: String,
    pub author_user_id: UserId,
    pub created_at: OffsetDateTime,
    /// Optional references to media, attachments, or RAG excerpts.
    pub media_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceEvent {
    pub id: MaintenanceEventId,
    pub case_id: CaseId,
    pub from_status: Option<CaseStatus>,
    pub to_status: CaseStatus,
    pub actor_user_id: UserId,
    pub reason: Option<String>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceCase {
    pub case_id: CaseId,
    pub organization_id: OrganizationId,
    pub aircraft_id: String,
    pub status: CaseStatus,
    pub priority: CasePriority,
    pub opened_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub location: Option<Location>,
    pub raw_discrepancy: String,
    pub normalized_discrepancy: Option<Discrepancy>,
    pub assigned_user_ids: Vec<UserId>,
    pub evidence_ids: Vec<EvidenceId>,
    pub approval_state: ApprovalState,
    pub version: i64,
}
