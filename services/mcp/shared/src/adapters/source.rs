//! Common source contract — name, health, license, freshness.

use serde::{Deserialize, Serialize};

use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseScope {
    pub scope: String,
    pub valid_until: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInfo {
    pub name: String,
    pub health: AdapterHealth,
    pub license: Option<LicenseScope>,
    pub last_checked: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterHealth {
    Healthy,
    Degraded,
    Unavailable,
    NotConfigured,
}

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("not configured: {reason}")]
    NotConfigured { reason: String },
    #[error("source unavailable: {0}")]
    Unavailable(String),
    #[error("source timeout: {0}")]
    Timeout(String),
    #[error("source rate-limited: {0}")]
    RateLimited(String),
    #[error("source not licensed: {0}")]
    NotLicensed(String),
    #[error("source stale: {0}")]
    Stale(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("internal error: {0}")]
    Internal(String),
}

pub type AdapterResult<T> = Result<T, AdapterError>;
