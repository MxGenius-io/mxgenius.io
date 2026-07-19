//! Transport-neutral application layer.
//!
//! `envelope` is the universal tool result shape. `errors` defines the stable
//! error code set. `context` is the trusted execution context injected by the
//! server. `policy` is the role/action matrix and the state-transition guard.

pub mod context;
pub mod envelope;
pub mod errors;
pub mod policy;
