//! Adapter traits and stub implementations.
//!
//! Each adapter owns its own source contract. Adapters return
//! `AdapterResult::NotConfigured` when the live source is absent, never
//! synthetic success.

pub mod digital_twin;
pub mod faa;
pub mod facility;
pub mod jetnet;
pub mod manual;
pub mod parts;
pub mod repository;
pub mod scheduling;
pub mod source;
pub mod weather;

pub use source::{AdapterError, AdapterHealth, AdapterResult, LicenseScope, SourceInfo};

/// Convenience: produce a `NotConfigured` adapter error.
pub fn not_configured(reason: impl Into<String>) -> AdapterError {
    AdapterError::NotConfigured {
        reason: reason.into(),
    }
}
