//! Traceability: what paperwork came with a part, where it travelled, and
//! when it went on or came off an aircraft.

use serde::{Deserialize, Serialize};

/// The paperwork a part arrived with. This is the airworthiness provenance
/// of the unit, so the vocabulary distinguishes documents that carry
/// different weight rather than lumping them together.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceType {
    /// FAA 8130-3 airworthiness approval tag.
    Form8130,
    /// EASA Form 1.
    EasaForm1,
    /// Technical Standard Order authorization.
    Tso,
    /// Released under both FAA and EASA.
    DualRelease,
    /// Certificate of conformance, source not recorded. Legacy value: rows
    /// captured before the manufacturer/vendor distinction existed. Never
    /// assigned to new records.
    Coc,
    /// Certificate of conformance from the manufacturer.
    CocMfr,
    /// Certificate of conformance from a vendor, which is worth less than the
    /// manufacturer's because the vendor is attesting to someone else's work.
    CocVendor,
    /// ATA Specification 106 used-parts trace form.
    Ata106,
    /// Teardown report from a disassembled unit.
    Teardown,
    /// No paperwork. Not a neutral value: an unmarked part is not airworthy
    /// until someone establishes what it is.
    None,
}

impl TraceType {
    pub fn as_str(self) -> &'static str {
        use TraceType::*;
        match self {
            Form8130 => "form_8130",
            EasaForm1 => "easa_form1",
            Tso => "tso",
            DualRelease => "dual_release",
            Coc => "coc",
            CocMfr => "coc_mfr",
            CocVendor => "coc_vendor",
            Ata106 => "ata106",
            Teardown => "teardown",
            None => "none",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use TraceType::*;
        match value {
            "form_8130" => Some(Form8130),
            "easa_form1" => Some(EasaForm1),
            "tso" => Some(Tso),
            "dual_release" => Some(DualRelease),
            "coc" => Some(Coc),
            "coc_mfr" => Some(CocMfr),
            "coc_vendor" => Some(CocVendor),
            "ata106" => Some(Ata106),
            "teardown" => Some(Teardown),
            "none" => Some(None),
            _ => Option::None,
        }
    }

    /// Values a new record may be assigned. `coc` is excluded: it exists only
    /// to keep historical rows valid, and offering it would keep producing
    /// records that cannot say whose conformance certificate it was.
    pub fn assignable() -> [TraceType; 9] {
        use TraceType::*;
        [
            Form8130,
            EasaForm1,
            Tso,
            DualRelease,
            CocMfr,
            CocVendor,
            Ata106,
            Teardown,
            None,
        ]
    }

    /// Whether the document is an approval for return to service, as opposed
    /// to a statement of conformance or a trace of custody. Advisory for
    /// display; it is not an airworthiness determination.
    pub fn is_airworthiness_release(self) -> bool {
        use TraceType::*;
        matches!(self, Form8130 | EasaForm1 | DualRelease)
    }
}

/// One atomic movement of a part on or off an aircraft. A swap is two events,
/// never one row with both sides, which is what lets a cannibalization be a
/// thin correlation over two existing events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartEventKind {
    Install,
    Removal,
}

impl PartEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PartEventKind::Install => "install",
            PartEventKind::Removal => "removal",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "install" => Some(PartEventKind::Install),
            "removal" => Some(PartEventKind::Removal),
            _ => None,
        }
    }

    pub fn accepts_removal_reason(self) -> bool {
        matches!(self, PartEventKind::Removal)
    }
}

/// Why a part came off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemovalReason {
    Scheduled,
    Unscheduled,
    /// Robbed to keep another aircraft flying. The value a cannibalization
    /// record correlates against.
    Cannibalized,
    Repair,
}

impl RemovalReason {
    pub fn as_str(self) -> &'static str {
        use RemovalReason::*;
        match self {
            Scheduled => "scheduled",
            Unscheduled => "unscheduled",
            Cannibalized => "cannibalized",
            Repair => "repair",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use RemovalReason::*;
        match value {
            "scheduled" => Some(Scheduled),
            "unscheduled" => Some(Unscheduled),
            "cannibalized" => Some(Cannibalized),
            "repair" => Some(Repair),
            _ => None,
        }
    }
}

/// What a shipment leg is for. Separates a procurement inbound from a repair
/// round trip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShipmentPurpose {
    Procurement,
    RepairOut,
    RepairReturn,
    Transfer,
    Return,
}

impl ShipmentPurpose {
    pub fn as_str(self) -> &'static str {
        use ShipmentPurpose::*;
        match self {
            Procurement => "procurement",
            RepairOut => "repair_out",
            RepairReturn => "repair_return",
            Transfer => "transfer",
            Return => "return",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use ShipmentPurpose::*;
        match value {
            "procurement" => Some(Procurement),
            "repair_out" => Some(RepairOut),
            "repair_return" => Some(RepairReturn),
            "transfer" => Some(Transfer),
            "return" => Some(Return),
            _ => None,
        }
    }
}

/// Where a leg is. There is no separate completed flag: `Delivered` is the
/// fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShipmentStatus {
    Pending,
    InTransit,
    Delivered,
    Exception,
}

impl ShipmentStatus {
    pub fn as_str(self) -> &'static str {
        use ShipmentStatus::*;
        match self {
            Pending => "pending",
            InTransit => "in_transit",
            Delivered => "delivered",
            Exception => "exception",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use ShipmentStatus::*;
        match value {
            "pending" => Some(Pending),
            "in_transit" => Some(InTransit),
            "delivered" => Some(Delivered),
            "exception" => Some(Exception),
            _ => None,
        }
    }

    /// A delivered leg must record when it landed.
    pub fn requires_received_at(self) -> bool {
        matches!(self, ShipmentStatus::Delivered)
    }

    /// Legal moves. A leg may go to exception from anywhere live, and back to
    /// in transit once the exception is resolved.
    pub fn can_transition_to(self, target: ShipmentStatus) -> bool {
        use ShipmentStatus::*;
        matches!(
            (self, target),
            (Pending, InTransit)
                | (Pending, Delivered)
                | (Pending, Exception)
                | (InTransit, Delivered)
                | (InTransit, Exception)
                | (Exception, InTransit)
                | (Exception, Delivered)
        )
    }
}
