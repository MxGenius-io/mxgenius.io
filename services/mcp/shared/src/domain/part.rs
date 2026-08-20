//! Part, PartRequirement, Supplier stubs, and the stock unit lifecycle.

use serde::{Deserialize, Serialize};

use super::ids::{CaseId, PartId, PartRequirementId, SupplierId};

/// Physical stock unit lifecycle. Mirrors the `stock_units.status` check
/// constraint in `0015_parts_inventory.sql`; the two must stay in step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StockUnitStatus {
    Quarantine,
    Available,
    Reserved,
    Issued,
    Rejected,
    InRepair,
    Shipped,
    Scrapped,
    Archived,
}

impl StockUnitStatus {
    pub fn as_str(self) -> &'static str {
        use StockUnitStatus::*;
        match self {
            Quarantine => "quarantine",
            Available => "available",
            Reserved => "reserved",
            Issued => "issued",
            Rejected => "rejected",
            InRepair => "in_repair",
            Shipped => "shipped",
            Scrapped => "scrapped",
            Archived => "archived",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        use StockUnitStatus::*;
        match value {
            "quarantine" => Some(Quarantine),
            "available" => Some(Available),
            "reserved" => Some(Reserved),
            "issued" => Some(Issued),
            "rejected" => Some(Rejected),
            "in_repair" => Some(InRepair),
            "shipped" => Some(Shipped),
            "scrapped" => Some(Scrapped),
            "archived" => Some(Archived),
            _ => None,
        }
    }

    /// Terminal operational states never leave except by archival.
    pub fn is_terminal(self) -> bool {
        use StockUnitStatus::*;
        matches!(self, Issued | Shipped | Scrapped | Archived)
    }

    /// Frozen transition graph from `ROCKY_PARTS_VERTICAL_SLICE.md`. Any other
    /// transition is rejected as an invalid state transition.
    pub fn can_transition_to(self, target: StockUnitStatus) -> bool {
        use StockUnitStatus::*;
        matches!(
            (self, target),
            (Quarantine, Available)
                | (Quarantine, Rejected)
                | (Available, Reserved)
                | (Available, Issued)
                | (Available, InRepair)
                | (Available, Shipped)
                | (Available, Scrapped)
                | (Reserved, Issued)
                | (Reserved, Available)
                | (Reserved, InRepair)
                | (Issued, Available)
                | (Rejected, InRepair)
                | (Rejected, Scrapped)
                | (Rejected, Shipped)
                | (InRepair, Available)
                | (InRepair, Scrapped)
                | (Available, Archived)
                | (Rejected, Archived)
                | (Issued, Archived)
                | (Shipped, Archived)
                | (Scrapped, Archived)
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Part {
    pub id: PartId,
    pub part_number: String,
    pub description: String,
    pub manufacturer: Option<String>,
    pub canonical: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartRequirement {
    pub id: PartRequirementId,
    pub case_id: CaseId,
    pub part_id: PartId,
    pub quantity: i32,
    pub required_by: Option<time::OffsetDateTime>,
    pub acceptable_conditions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Supplier {
    pub id: SupplierId,
    pub name: String,
    pub source_reference: Option<String>,
}
