//! Canonical domain types.
//!
//! Names are frozen by `MXGENIUS_V1_CONTRACT_LOCK.md`. Each entity is a stub
//! here; flesh out fields, validation, and constructors in this module before
//! extending any transport, migration, or test.

pub mod cannibalization;
pub mod cannibalization_test;
pub mod case;
pub mod case_transition_test;
pub mod compliance;
pub mod datetime;
pub mod digital_twin;
pub mod document;
pub mod evidence;
pub mod ids;
pub mod organization;
pub mod part;
pub mod part_alternate;
pub mod part_import;
pub mod part_import_test;
pub mod part_request;
pub mod part_request_test;
pub mod part_trace;
pub mod part_trace_test;
pub mod receiving_inspection;
pub mod rotable;
pub mod rotable_test;
pub mod scheduling;
pub mod stock_unit_transition_test;

pub use case::{CasePriority, CaseStatus, Discrepancy, Location, MaintenanceCase, Observation};
pub use compliance::{AdvisoryNotice, AirworthinessDirective, ApplicabilityState};
pub use digital_twin::{DigitalTwinMarker, DigitalTwinModel};
pub use document::{DocumentRevision, TechnicalDocument};
pub use evidence::{Confidence, ConfidenceBasis, Evidence, EvidenceKind, SourceType};
pub use ids::*;
pub use organization::{Organization, OrganizationMembership, User};
pub use part::{Part, PartRequirement, StockUnitStatus, Supplier};
pub use part_alternate::AlternateRelation;
pub use receiving_inspection::{
    Disposition, DiscrepancyType, GateResult, InspectionGates, Outcome,
};
pub use part_import::{ImportFormat, ImportMode};
pub use part_request::{
    PartOrderKind, PartOrderStatus, PartRequestPriority, PartRequestStatus, TypeOfBuy,
};
pub use part_trace::{PartEventKind, RemovalReason, ShipmentPurpose, ShipmentStatus, TraceType};
pub use scheduling::{ScheduleOption, WeatherContext};
