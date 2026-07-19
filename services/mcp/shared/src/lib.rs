//! MXGenius shared core: domain, application, adapters, schemas.
//!
//! See `MXGENIUS_V1_CONTRACT_LOCK.md` for the authoritative contract.
//!
//! This crate is the transport-neutral middle. Both the Axum REST/BFF and the
//! MCP server compile against it. The frontend and the MCP never call each
//! other; both reach the same use cases.

#![deny(unsafe_code)]
#![allow(missing_docs)]

pub mod adapters;
pub mod application;
pub mod contracts;
pub mod domain;
pub mod schemas;

pub use application::context::ExecutionContext;
pub use application::envelope::{
    CapabilityEnvelope, EnvelopeError, EnvelopeStatus, PromotionState,
};
pub use application::errors::StableErrorCode;
pub use application::policy::{Action, PolicyDecision, PolicyMatrix, Role};
pub use domain::evidence::Confidence;

/// Package version exposed to consumers.
pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
