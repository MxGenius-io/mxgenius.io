//! JetNet adapter trait and a `NotConfigured` default implementation.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};
use crate::domain::ids::AircraftId;

#[async_trait]
pub trait JetNetAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    /// Look up aircraft by registration / serial / source id. Returns raw
    /// source DTOs. The MCP layer maps to canonical `Aircraft` records.
    async fn lookup(&self, query: &JetNetLookupQuery) -> AdapterResult<Vec<JetNetAircraftDto>>;
    async fn profile(&self, source_id: &str) -> AdapterResult<JetNetAircraftDto>;
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct JetNetLookupQuery {
    pub registration: Option<String>,
    pub serial_number: Option<String>,
    pub source_id: Option<String>,
}

/// Source DTO — never the canonical domain object. Map to `Aircraft` in the
/// application layer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JetNetAircraftDto {
    /// Stable identifier assigned by JetNet. This value is retained only as
    /// source lineage; callers use `aircraft_id` after canonicalization.
    pub source_id: String,
    pub aircraft_id: AircraftId,
    pub registration: Option<String>,
    pub serial_number: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i32>,
    pub base_icao: Option<String>,
}

/// Default stub used when no live JetNet credential is configured.
pub struct NotConfiguredJetNetAdapter;

#[async_trait]
impl JetNetAdapter for NotConfiguredJetNetAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "jetnet".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn lookup(&self, _q: &JetNetLookupQuery) -> AdapterResult<Vec<JetNetAircraftDto>> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "JetNet credentials not configured".into(),
        })
    }
    async fn profile(&self, _source_id: &str) -> AdapterResult<JetNetAircraftDto> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "JetNet credentials not configured".into(),
        })
    }
}
