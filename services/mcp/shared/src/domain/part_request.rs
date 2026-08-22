//! Part request lifecycle, procurement order lifecycle, and the overdue rule.
//!
//! The overdue rule is published here once, with a SQL surface and an
//! in-memory surface, because the system this design came from computed it
//! independently in a dashboard tile and a list filter, the two drifted, and
//! the tile reported zero while thousands of requests sat past their need-by.
//! Every caller uses [`OVERDUE_SQL_PREDICATE`] or [`is_overdue`]; neither is
//! ever re-expressed inline.

use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};

/// Statuses past which a need-by date no longer means anything.
pub const SETTLED_STATUSES: [&str; 3] = ["received", "installed", "cancelled"];

/// The SQL surface of the overdue rule. Interpolated into queries as the only
/// copy of the predicate.
///
/// Date-component comparison, so a request due today is not overdue until
/// tomorrow regardless of the clock time it was captured at.
///
/// Both sides are pinned to UTC. A bare `required_by::date` casts using the
/// session `TimeZone`, so against a session west of UTC it would land on the
/// previous calendar day while `now()` was evaluated in UTC — the two sides
/// would be comparing different calendars and a request due today would read
/// as one day overdue.
pub const OVERDUE_SQL_PREDICATE: &str = "(pr.required_by IS NOT NULL \
     AND (pr.required_by AT TIME ZONE 'utc')::date < (now() AT TIME ZONE 'utc')::date \
     AND pr.status NOT IN ('received', 'installed', 'cancelled'))";

/// A request with no need-by cannot be measured. Surfaced separately so the
/// backlog of unset dates stays visible instead of counting as on time.
pub const MISSING_NEED_BY_SQL_PREDICATE: &str =
    "(pr.required_by IS NULL AND pr.status NOT IN ('received', 'installed', 'cancelled'))";

fn is_settled(status: &str) -> bool {
    SETTLED_STATUSES.contains(&status)
}

/// In-memory surface of the overdue rule. Must agree with
/// [`OVERDUE_SQL_PREDICATE`] for every input.
pub fn is_overdue(need_by: Option<OffsetDateTime>, status: &str, as_of: OffsetDateTime) -> bool {
    match need_by {
        None => false,
        Some(_) if is_settled(status) => false,
        Some(due) => due.date() < as_of.date(),
    }
}

/// Whole calendar days overdue, or `None` when not overdue. A request due
/// yesterday reads one day, never zero because of clock time.
pub fn days_overdue(
    need_by: Option<OffsetDateTime>,
    status: &str,
    as_of: OffsetDateTime,
) -> Option<i64> {
    if !is_overdue(need_by, status, as_of) {
        return None;
    }
    let due: Date = need_by?.date();
    Some((as_of.date() - due).whole_days())
}

/// A live request that cannot be measured because nobody set a need-by.
pub fn is_missing_need_by(need_by: Option<OffsetDateTime>, status: &str) -> bool {
    need_by.is_none() && !is_settled(status)
}

/// Where a requested part is in its life. Mirrors the `part_requirements.status`
/// check constraint in `0019_part_procurement.sql`.
///
/// Transitions are deliberately any-to-any: operators need to move a request
/// backward, for example `received -> ordered` after a bad receipt. Every
/// change is journaled, so the audit trail is the control rather than the
/// transition topology. Only unknown values are rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartRequestStatus {
    Requested,
    Sourced,
    Ordered,
    Received,
    Installed,
    Cancelled,
}

impl PartRequestStatus {
    pub fn as_str(self) -> &'static str {
        use PartRequestStatus::*;
        match self {
            Requested => "requested",
            Sourced => "sourced",
            Ordered => "ordered",
            Received => "received",
            Installed => "installed",
            Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use PartRequestStatus::*;
        match value {
            "requested" => Some(Requested),
            "sourced" => Some(Sourced),
            "ordered" => Some(Ordered),
            "received" => Some(Received),
            "installed" => Some(Installed),
            "cancelled" => Some(Cancelled),
            _ => None,
        }
    }

    /// A request still open to procurement, which placing an order advances.
    pub fn is_open_to_ordering(self) -> bool {
        matches!(
            self,
            PartRequestStatus::Requested | PartRequestStatus::Sourced
        )
    }

    pub fn is_settled(self) -> bool {
        is_settled(self.as_str())
    }
}

/// How urgently the part is needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartRequestPriority {
    Aog,
    ScheduledMx,
    Stock,
}

impl PartRequestPriority {
    pub fn as_str(self) -> &'static str {
        use PartRequestPriority::*;
        match self {
            Aog => "aog",
            ScheduledMx => "scheduled_mx",
            Stock => "stock",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use PartRequestPriority::*;
        match value {
            "aog" => Some(Aog),
            "scheduled_mx" => Some(ScheduledMx),
            "stock" => Some(Stock),
            _ => None,
        }
    }

    /// Queue ordering weight; lower sorts first.
    pub fn queue_rank(self) -> i16 {
        use PartRequestPriority::*;
        match self {
            Aog => 0,
            ScheduledMx => 1,
            Stock => 2,
        }
    }
}

/// Procurement order lifecycle. Unlike the request, this is a real machine,
/// because procurement is directional: an order that has been placed with a
/// supplier cannot quietly become a draft again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartOrderStatus {
    Draft,
    Placed,
    Confirmed,
    Cancelled,
}

impl PartOrderStatus {
    pub fn as_str(self) -> &'static str {
        use PartOrderStatus::*;
        match self {
            Draft => "draft",
            Placed => "placed",
            Confirmed => "confirmed",
            Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use PartOrderStatus::*;
        match value {
            "draft" => Some(Draft),
            "placed" => Some(Placed),
            "confirmed" => Some(Confirmed),
            "cancelled" => Some(Cancelled),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, PartOrderStatus::Cancelled)
    }

    /// Frozen transition graph:
    /// `draft -> placed | cancelled`, `placed -> confirmed | cancelled`,
    /// `confirmed -> cancelled`.
    pub fn can_transition_to(self, target: PartOrderStatus) -> bool {
        use PartOrderStatus::*;
        matches!(
            (self, target),
            (Draft, Placed)
                | (Draft, Cancelled)
                | (Placed, Confirmed)
                | (Placed, Cancelled)
                | (Confirmed, Cancelled)
        )
    }
}

/// What kind of paperwork the order is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartOrderKind {
    /// Purchase order.
    Po,
    /// Service order.
    So,
}

impl PartOrderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PartOrderKind::Po => "po",
            PartOrderKind::So => "so",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "po" => Some(PartOrderKind::Po),
            "so" => Some(PartOrderKind::So),
            _ => None,
        }
    }
}

/// Commercial arrangement behind the order. `repair` and `exchange` are the
/// two that carry core and repair economics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TypeOfBuy {
    Outright,
    Exchange,
    Repair,
    Loan,
}

impl TypeOfBuy {
    pub fn as_str(self) -> &'static str {
        use TypeOfBuy::*;
        match self {
            Outright => "outright",
            Exchange => "exchange",
            Repair => "repair",
            Loan => "loan",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use TypeOfBuy::*;
        match value {
            "outright" => Some(Outright),
            "exchange" => Some(Exchange),
            "repair" => Some(Repair),
            "loan" => Some(Loan),
            _ => None,
        }
    }

    /// Whether this arrangement can leave a core obligation behind.
    pub fn owes_core(self) -> bool {
        matches!(self, TypeOfBuy::Exchange | TypeOfBuy::Repair)
    }
}
