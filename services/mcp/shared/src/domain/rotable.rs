//! Serialized rotables: where a unit is, and what has to be settled before it
//! can be retired.

use serde::{Deserialize, Serialize};

/// Where a tracked rotable currently is. A projection of the latest part event
/// for the unit, not independent truth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RotableStatus {
    InStock,
    Installed,
    InRepair,
    InTransit,
    OnLoan,
    Scrapped,
}

impl RotableStatus {
    pub fn as_str(self) -> &'static str {
        use RotableStatus::*;
        match self {
            InStock => "in_stock",
            Installed => "installed",
            InRepair => "in_repair",
            InTransit => "in_transit",
            OnLoan => "on_loan",
            Scrapped => "scrapped",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use RotableStatus::*;
        match value {
            "in_stock" => Some(InStock),
            "installed" => Some(Installed),
            "in_repair" => Some(InRepair),
            "in_transit" => Some(InTransit),
            "on_loan" => Some(OnLoan),
            "scrapped" => Some(Scrapped),
            _ => None,
        }
    }
}

/// Why a proposed status/aircraft pairing does not describe a real situation.
///
/// This is checked at the API boundary rather than as a database constraint.
/// A bulk register import routinely carries rows that already contradict it,
/// and a CHECK would reject the whole import instead of letting somebody fix
/// the contradiction afterwards.
pub fn status_aircraft_contradiction(
    status: RotableStatus,
    aircraft_id: Option<&str>,
) -> Option<&'static str> {
    use RotableStatus::*;
    let on_aircraft = aircraft_id.is_some_and(|value| !value.trim().is_empty());
    match (status, on_aircraft) {
        (InStock, true) => Some(
            "a unit installed on an aircraft is not in stock; set the status to installed, or clear the aircraft",
        ),
        (Scrapped, true) => Some(
            "a scrapped unit cannot be installed on an aircraft; clear the aircraft, or choose a different status",
        ),
        (Installed, false) => Some(
            "an installed unit must record the aircraft it is installed on; set the aircraft, or change the status",
        ),
        // in_repair, in_transit, and on_loan are deliberately unconstrained: a
        // unit away for repair can legitimately still record the tail it came
        // off, which is often the only way to find it again.
        _ => None,
    }
}

/// Whether an edit actually touched the status/aircraft pairing.
///
/// Coherence is only judged when it did. Legacy rows are already
/// contradictory, and checking unconditionally rejects a notes-only edit
/// because of data the user never entered and cannot see. Guard the hands,
/// not the history.
pub fn edit_touches_pairing(status_supplied: bool, aircraft_supplied: bool) -> bool {
    status_supplied || aircraft_supplied
}

/// An obligation that outlives the unit it is attached to, and therefore
/// blocks retiring it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetirementBlocker {
    /// A core is still owed back to a supplier.
    CoreDue,
    /// A cannibalization is proposed or approved against this unit.
    OpenCannibalization,
    /// A warranty claim has not been settled.
    OpenWarrantyClaim,
}

impl RetirementBlocker {
    pub fn message(self) -> &'static str {
        use RetirementBlocker::*;
        match self {
            CoreDue => "a core exchange on this unit is still due",
            OpenCannibalization => "a cannibalization on this unit is still open",
            OpenWarrantyClaim => "a warranty claim on this unit is still open",
        }
    }
}

/// Core statuses that still represent an outstanding obligation.
pub const OPEN_CORE_STATUSES: [&str; 1] = ["due"];

/// Warranty statuses that still represent an outstanding claim. A denied,
/// credited, or closed claim is settled; the rest are money in flight.
pub const OPEN_WARRANTY_STATUSES: [&str; 3] = ["open", "submitted", "approved"];

/// Cannibalization statuses that still represent an open action.
pub const OPEN_CANNIBALIZATION_STATUSES: [&str; 2] = ["proposed", "approved"];

/// Longest retirement reason accepted. The reason is prepended to the unit's
/// notes rather than stored in its own column, so it has to stay short enough
/// that it does not bury the history beneath it.
pub const MAX_RETIREMENT_REASON: usize = 500;

/// Builds the note a retirement leaves behind.
///
/// The stamp goes first because retiring the unit is the last thing that
/// happened to it, and existing notes are preserved verbatim underneath
/// rather than replaced.
pub fn retirement_note(reason: &str, actor: &str, at_utc: &str, existing: Option<&str>) -> String {
    let stamp = format!("[RETIRED {at_utc} UTC by {actor}] {}", reason.trim());
    match existing.map(str::trim).filter(|value| !value.is_empty()) {
        Some(previous) => format!("{stamp}\n\n{previous}"),
        None => stamp,
    }
}
