//! Cannibalization: robbing a serviceable part off one aircraft to return
//! another to service.
//!
//! A rob is an airworthiness claim rather than a stock movement, so the record
//! is gated at every step. It is also deliberately thin: it correlates a donor
//! removal and a receiver install that already exist in the event ledger,
//! rather than restating the lineage those events already carry.

use serde::{Deserialize, Serialize};

/// The approval chain a rob moves through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CannibalizationStatus {
    Proposed,
    Approved,
    Rejected,
    Completed,
    Cancelled,
}

impl CannibalizationStatus {
    pub fn as_str(self) -> &'static str {
        use CannibalizationStatus::*;
        match self {
            Proposed => "proposed",
            Approved => "approved",
            Rejected => "rejected",
            Completed => "completed",
            Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use CannibalizationStatus::*;
        match value {
            "proposed" => Some(Proposed),
            "approved" => Some(Approved),
            "rejected" => Some(Rejected),
            "completed" => Some(Completed),
            "cancelled" => Some(Cancelled),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        use CannibalizationStatus::*;
        matches!(self, Completed | Rejected | Cancelled)
    }

    /// Whether the rob still represents work in flight, which is what blocks
    /// retiring the unit underneath it.
    pub fn is_open(self) -> bool {
        use CannibalizationStatus::*;
        matches!(self, Proposed | Approved)
    }

    /// Frozen chain:
    /// `proposed -> approved | rejected | cancelled`,
    /// `approved -> completed | cancelled`.
    /// Completed, rejected, and cancelled are terminal.
    pub fn can_transition_to(self, target: CannibalizationStatus) -> bool {
        use CannibalizationStatus::*;
        matches!(
            (self, target),
            (Proposed, Approved)
                | (Proposed, Rejected)
                | (Proposed, Cancelled)
                | (Approved, Completed)
                | (Approved, Cancelled)
        )
    }
}

/// Why a proposed rob cannot be recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalProblem {
    NoIdentity,
    NoDonor,
    SelfRob,
}

impl ProposalProblem {
    pub fn message(self) -> &'static str {
        use ProposalProblem::*;
        match self {
            NoIdentity => {
                "a rob must identify the part being taken: give a rotable unit or a serial number"
            }
            NoDonor => {
                "a rob must name where the part came from: give a donor aircraft or a donor removal event"
            }
            SelfRob => "an aircraft cannot rob itself",
        }
    }
}

/// Validates a proposal before anything touches the database, so a missing
/// field is a clear rejection rather than a constraint violation.
pub fn proposal_problem(
    has_rotable: bool,
    serial_number: Option<&str>,
    donor_aircraft: Option<&str>,
    has_donor_event: bool,
    receiver_aircraft: Option<&str>,
) -> Option<ProposalProblem> {
    let serial = serial_number.map(str::trim).filter(|v| !v.is_empty());
    let donor = donor_aircraft.map(str::trim).filter(|v| !v.is_empty());
    let receiver = receiver_aircraft.map(str::trim).filter(|v| !v.is_empty());

    if !has_rotable && serial.is_none() {
        return Some(ProposalProblem::NoIdentity);
    }
    if donor.is_none() && !has_donor_event {
        return Some(ProposalProblem::NoDonor);
    }
    if let (Some(donor), Some(receiver)) = (donor, receiver) {
        if donor.eq_ignore_ascii_case(receiver) {
            return Some(ProposalProblem::SelfRob);
        }
    }
    None
}

/// Whether the approver is allowed to be this person.
///
/// Separation of duties: proposing a rob and blessing it are two different
/// judgements, and one person making both is the control failing rather than
/// a convenience.
pub fn violates_separation_of_duties(proposed_by: &str, deciding_by: &str) -> bool {
    proposed_by == deciding_by
}

/// A life-limited part carries accumulated life across the tail boundary.
/// Recording that is the whole airworthiness point of tracking the rob, so it
/// is required before approval rather than at completion, when the part is
/// already fitted.
pub fn life_transfer_missing(
    is_life_limited: bool,
    hours: Option<f64>,
    cycles: Option<i32>,
) -> bool {
    is_life_limited && hours.is_none() && cycles.is_none()
}

/// Every way a completion can fail to describe a real rob.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionProblem {
    DonorEventMissing,
    ReceiverEventMissing,
    DonorNotRemoval,
    ReceiverNotInstall,
    DonorReasonNotCannibalized,
    RotableMismatch,
    DonorAircraftMismatch,
    ReceiverAircraftMismatch,
    DonorEventAlreadyUsed,
    ReceiverEventAlreadyUsed,
}

impl CompletionProblem {
    pub fn message(self) -> &'static str {
        use CompletionProblem::*;
        match self {
            DonorEventMissing => "the donor removal event does not exist",
            ReceiverEventMissing => "the receiver install event does not exist",
            DonorNotRemoval => "the donor event must be a removal",
            ReceiverNotInstall => "the receiver event must be an install",
            DonorReasonNotCannibalized => {
                "the donor removal must be recorded with the reason 'cannibalized', otherwise this is an ordinary removal and not a rob"
            }
            RotableMismatch => {
                "the donor removal and the receiver install name different rotable units, so this is not one part moving"
            }
            DonorAircraftMismatch => {
                "the donor removal did not happen on the aircraft this rob names as the donor"
            }
            ReceiverAircraftMismatch => {
                "the receiver install did not happen on the aircraft this rob names as the receiver"
            }
            DonorEventAlreadyUsed => {
                "that removal already completes another cannibalization; one event cannot be the donor side of two"
            }
            ReceiverEventAlreadyUsed => {
                "that install already completes another cannibalization; one event cannot be the receiver side of two"
            }
        }
    }
}

/// The facts a completion is checked against, read from the event ledger.
#[derive(Debug, Clone, Default)]
pub struct CompletionFacts<'a> {
    pub donor_event_exists: bool,
    pub receiver_event_exists: bool,
    pub donor_kind: Option<&'a str>,
    pub receiver_kind: Option<&'a str>,
    pub donor_removal_reason: Option<&'a str>,
    pub donor_rotable: Option<uuid::Uuid>,
    pub receiver_rotable: Option<uuid::Uuid>,
    pub donor_event_aircraft: Option<&'a str>,
    pub receiver_event_aircraft: Option<&'a str>,
    pub claimed_donor_aircraft: Option<&'a str>,
    pub claimed_receiver_aircraft: Option<&'a str>,
    pub donor_event_already_completed: bool,
    pub receiver_event_already_completed: bool,
}

/// Checks every condition a completed rob must satisfy. Returns the first
/// problem found, ordered so the caller is told about a missing event before
/// being told something about its contents.
pub fn completion_problem(facts: &CompletionFacts<'_>) -> Option<CompletionProblem> {
    use CompletionProblem::*;

    if !facts.donor_event_exists {
        return Some(DonorEventMissing);
    }
    if !facts.receiver_event_exists {
        return Some(ReceiverEventMissing);
    }
    if facts.donor_kind != Some("removal") {
        return Some(DonorNotRemoval);
    }
    if facts.receiver_kind != Some("install") {
        return Some(ReceiverNotInstall);
    }
    if facts.donor_removal_reason != Some("cannibalized") {
        return Some(DonorReasonNotCannibalized);
    }
    // Only compared when both sides carry a link; a rob of an untracked part
    // is still a rob.
    if let (Some(donor), Some(receiver)) = (facts.donor_rotable, facts.receiver_rotable) {
        if donor != receiver {
            return Some(RotableMismatch);
        }
    }
    if let (Some(claimed), Some(actual)) =
        (facts.claimed_donor_aircraft, facts.donor_event_aircraft)
    {
        if !claimed.eq_ignore_ascii_case(actual) {
            return Some(DonorAircraftMismatch);
        }
    }
    if let (Some(claimed), Some(actual)) = (
        facts.claimed_receiver_aircraft,
        facts.receiver_event_aircraft,
    ) {
        if !claimed.eq_ignore_ascii_case(actual) {
            return Some(ReceiverAircraftMismatch);
        }
    }
    if facts.donor_event_already_completed {
        return Some(DonorEventAlreadyUsed);
    }
    if facts.receiver_event_already_completed {
        return Some(ReceiverEventAlreadyUsed);
    }
    None
}
