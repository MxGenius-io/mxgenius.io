//! Manual / RAG corpus adapter trait and NotConfigured default.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};
use crate::domain::evidence::Evidence;

#[async_trait]
pub trait ManualCorpusAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn search(&self, q: &ManualQuery) -> AdapterResult<ManualSearchResult>;
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ManualQuery {
    pub aircraft_id: Option<String>,
    pub aircraft_model: Option<String>,
    pub ata: Option<String>,
    pub text: String,
    pub limit: Option<u32>,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ManualRetrievalState {
    NotRequested,
    VerifiedMatch,
    NoRelevantSection,
    ManualAbsent,
    ApplicabilityUnknown,
    RetrievalUnavailable,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ManualSearchResult {
    pub state: ManualRetrievalState,
    pub aircraft_model: Option<String>,
    pub ata: Option<String>,
    pub evidence: Vec<Evidence>,
}

impl ManualSearchResult {
    pub fn empty(state: ManualRetrievalState, query: &ManualQuery) -> Self {
        Self {
            state,
            aircraft_model: query.aircraft_model.clone(),
            ata: query.ata.clone(),
            evidence: Vec::new(),
        }
    }
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
    async fn search(&self, _q: &ManualQuery) -> AdapterResult<ManualSearchResult> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Manual corpus root not configured".into(),
        })
    }
}
