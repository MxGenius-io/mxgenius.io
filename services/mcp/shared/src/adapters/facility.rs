//! MRO directory adapter stub.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};

#[async_trait]
pub trait MroDirectoryAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn search(&self, q: &MroSearchQuery) -> AdapterResult<serde_json::Value>;
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct MroSearchQuery {
    pub location: Option<String>,
    pub aircraft_type: Option<String>,
    pub task_capability: Option<String>,
    pub radius_nm: Option<u32>,
}

pub struct NotConfiguredMroDirectoryAdapter;

#[async_trait]
impl MroDirectoryAdapter for NotConfiguredMroDirectoryAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "mro_directory".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn search(&self, _q: &MroSearchQuery) -> AdapterResult<serde_json::Value> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "MRO directory source not configured".into(),
        })
    }
}
