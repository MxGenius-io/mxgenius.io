//! Role-based access control and the action matrix. Names are frozen; the
//! matrix is the v1 baseline and should be fleshed out in this module.

#![allow(clippy::redundant_guards)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    Technician,
    Planner,
    Controller,
    Procurement,
    Quality,
    Manager,
    Administrator,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Technician => "technician",
            Self::Planner => "planner",
            Self::Controller => "controller",
            Self::Procurement => "procurement",
            Self::Quality => "quality",
            Self::Manager => "manager",
            Self::Administrator => "administrator",
        }
    }
}

/// A capability-level action. Tools map themselves to actions in
/// `PolicyMatrix::is_authorized`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    // Aircraft
    AircraftRead,
    // Maintenance case
    CaseCreate,
    CaseRead,
    CaseUpdateStatus,
    CaseAttachObservation,
    // Parts
    PartsRead,
    PartsAttachCertificate,
    // MRO
    MroRead,
    // Weather
    WeatherRead,
    // Compliance
    ComplianceRead,
    ComplianceReturnToService,
    // Digital twin
    TwinRead,
    TwinAttachMarker,
    // Scheduling
    SchedulingRead,
    SchedulingPublish,
    // Evidence
    EvidenceRead,
    // Analytics
    AnalyticsRead,
    // Admin
    Administer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Deny,
    RequireHumanApproval,
}

#[derive(Debug, Default, Clone)]
pub struct PolicyMatrix;

impl PolicyMatrix {
    /// Baseline policy. Stub: flesh out the full role/action matrix here.
    pub fn is_authorized(role: Role, action: Action) -> PolicyDecision {
        use Action::*;
        use PolicyDecision::*;
        use Role::*;
        match (role, action) {
            (Administrator, _) => Allow,
            (Viewer, a)
                if matches!(
                    a,
                    AircraftRead
                        | CaseRead
                        | PartsRead
                        | MroRead
                        | WeatherRead
                        | ComplianceRead
                        | TwinRead
                        | SchedulingRead
                        | EvidenceRead
                        | AnalyticsRead
                ) =>
            {
                Allow
            }
            (Technician, a)
                if matches!(
                    a,
                    AircraftRead
                        | CaseRead
                        | CaseAttachObservation
                        | PartsRead
                        | MroRead
                        | WeatherRead
                        | ComplianceRead
                        | TwinRead
                        | TwinAttachMarker
                        | SchedulingRead
                        | EvidenceRead
                        | AnalyticsRead
                ) =>
            {
                Allow
            }
            (Technician, CaseCreate | CaseUpdateStatus) => RequireHumanApproval,
            (Planner, a)
                if matches!(
                    a,
                    AircraftRead
                        | CaseRead
                        | CaseCreate
                        | CaseUpdateStatus
                        | PartsRead
                        | MroRead
                        | WeatherRead
                        | ComplianceRead
                        | TwinRead
                        | SchedulingRead
                        | SchedulingPublish
                        | EvidenceRead
                        | AnalyticsRead
                ) =>
            {
                Allow
            }
            (Controller, a)
                if matches!(
                    a,
                    AircraftRead
                        | CaseRead
                        | CaseUpdateStatus
                        | PartsRead
                        | MroRead
                        | WeatherRead
                        | ComplianceRead
                        | TwinRead
                        | SchedulingRead
                        | EvidenceRead
                        | AnalyticsRead
                ) =>
            {
                Allow
            }
            (Procurement, a)
                if matches!(
                    a,
                    AircraftRead
                        | CaseRead
                        | PartsRead
                        | PartsAttachCertificate
                        | MroRead
                        | WeatherRead
                        | ComplianceRead
                        | TwinRead
                        | SchedulingRead
                        | EvidenceRead
                        | AnalyticsRead
                ) =>
            {
                Allow
            }
            (Quality, a)
                if matches!(
                    a,
                    AircraftRead
                        | CaseRead
                        | PartsRead
                        | PartsAttachCertificate
                        | MroRead
                        | WeatherRead
                        | ComplianceRead
                        | ComplianceReturnToService
                        | TwinRead
                        | SchedulingRead
                        | EvidenceRead
                        | AnalyticsRead
                ) =>
            {
                Allow
            }
            (Manager, _) => Allow,
            _ => Deny,
        }
    }
}
