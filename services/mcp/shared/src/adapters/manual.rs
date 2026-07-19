//! Manual / RAG corpus adapter trait and NotConfigured default.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};
use crate::domain::evidence::Evidence;

#[async_trait]
pub trait ManualCorpusAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn search(&self, q: &ManualQuery) -> AdapterResult<Vec<Evidence>>;
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ManualQuery {
    pub aircraft_id: Option<String>,
    pub ata: Option<String>,
    pub text: String,
    pub limit: Option<u32>,
}

pub struct NotConfiguredManualAdapter;

#[async_trait]
impl ManualCorpusAdapter for NotConfiguredManualAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "manual_corpus".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn search(&self, _q: &ManualQuery) -> AdapterResult<Vec<Evidence>> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Manual corpus root not configured".into(),
        })
    }
}
