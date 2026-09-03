//! Typed contracts for the 45 active v1 capabilities retained from the
//! originally numbered 50-capability specification. The original numbering is
//! preserved in the modules for traceability. Each active tool has a request
//! and response type, and all types derive `Serialize`, `Deserialize`, and
//! `JsonSchema` so the dispatcher can publish authoritative schemas via
//! `tools/list` and validate inbound payloads.
//!
//! Source of truth: `MXGENIUS_50_CAPABILITY_SPEC.md` and
//! `MXGENIUS_V1_CONTRACT_LOCK.md`. See `docs/contract-decisions.md` for any
//! ambiguity resolution.

pub mod aircraft;
pub mod analytics;
pub mod case;
pub mod common;
pub mod compliance;
pub mod digital_twin;
pub mod evidence;
pub mod parts;
pub mod scheduling;
pub mod weather;

pub use aircraft::*;
pub use analytics::*;
pub use case::*;
pub use common::*;
pub use compliance::*;
pub use digital_twin::*;
pub use evidence::*;
pub use parts::*;
pub use scheduling::*;
pub use weather::*;
