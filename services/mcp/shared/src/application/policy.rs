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

    /// Every role, in privilege order. `parse` reads this list and the
    /// membership CHECK constraints mirror it, so a variant added to the enum
    /// without being added here fails `the_role_list_is_exhaustive`.
    pub const ALL: [Role; 8] = [
        Self::Viewer,
        Self::Technician,
        Self::Planner,
        Self::Controller,
        Self::Procurement,
        Self::Quality,
        Self::Manager,
        Self::Administrator,
    ];

    /// Exact match on the wire name `as_str` emits. Unknown values are
    /// rejected, never defaulted: the callers are a database membership row
    /// and a local developer override, and a wrong answer on either is a wrong
    /// answer about authority. Driving this off `ALL` rather than a second
    /// `match` means the two lists cannot drift.
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|role| role.as_str() == value)
    }

    /// Whether this role may carry a qualified approval — the precondition on
    /// actions like closing a maintenance case.
    ///
    /// Published here because it was written out twice, in the trusted-local
    /// and OIDC context builders, and a third copy was about to appear.
    pub fn can_grant_qualified_approval(self) -> bool {
        matches!(self, Self::Quality | Self::Manager | Self::Administrator)
    }
}

#[cfg(test)]
mod role_tests {
    use super::*;

    #[test]
    fn every_role_round_trips_through_its_wire_name() {
        for role in Role::ALL {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
    }

    #[test]
    fn unknown_role_names_are_rejected_rather_than_defaulted() {
        for value in ["", "admin", "Administrator", "administrator ", "root"] {
            assert_eq!(Role::parse(value), None, "{value:?} must not parse");
        }
    }

    /// Adding a ninth variant makes this match non-exhaustive, which is a
    /// compile error inside the test and forces the author to visit `ALL`.
    #[test]
    fn the_role_list_is_exhaustive() {
        assert_eq!(Role::ALL.len(), 8);
        for role in Role::ALL {
            match role {
                Role::Viewer
                | Role::Technician
                | Role::Planner
                | Role::Controller
                | Role::Procurement
                | Role::Quality
                | Role::Manager
                | Role::Administrator => {}
            }
        }
    }

    /// The local role override is safe because it can only ever narrow
    /// authority: the mode it lives in already runs as Administrator, and
    /// Administrator is admitted by every gate. Pin that so a future gate
    /// which excludes Administrator cannot land silently.
    #[test]
    fn administrator_is_never_the_role_that_gets_refused() {
        assert!(Role::Administrator.can_grant_qualified_approval());
        for role in Role::ALL {
            if role.can_grant_qualified_approval() {
                assert!(
                    matches!(role, Role::Quality | Role::Manager | Role::Administrator),
                    "{role:?} should not carry qualified approval"
                );
            }
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
