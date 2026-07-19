//! Part, PartRequirement, Supplier stubs.

use serde::{Deserialize, Serialize};

use super::ids::{CaseId, PartId, PartRequirementId, SupplierId};

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
