//! Canonical domain types.
//!
//! Names are frozen by `MXGENIUS_V1_CONTRACT_LOCK.md`. Each entity is a stub
//! here; flesh out fields, validation, and constructors in this module before
//! extending any transport, migration, or test.

pub mod case;
pub mod case_transition_test;
pub mod compliance;
pub mod datetime;
pub mod digital_twin;
pub mod document;
pub mod evidence;
pub mod facility;
pub mod ids;
pub mod organization;
pub mod part;
pub mod scheduling;

pub use case::{CasePriority, CaseStatus, Discrepancy, Location, MaintenanceCase, Observation};
pub use compliance::{AdvisoryNotice, AirworthinessDirective, ApplicabilityState};
pub use digital_twin::{DigitalTwinMarker, DigitalTwinModel};
pub use document::{DocumentRevision, TechnicalDocument};
pub use evidence::{Confidence, ConfidenceBasis, Evidence, EvidenceKind, SourceType};
pub use facility::{FacilityCapability, MROFacility};
pub use ids::*;
pub use organization::{Organization, OrganizationMembership, User};
pub use part::{Part, PartRequirement, Supplier};
pub use scheduling::{ScheduleOption, WeatherContext};
