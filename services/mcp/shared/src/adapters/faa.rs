//! FAA AD / DRS / SAIB adapter traits and NotConfigured defaults.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};
use crate::domain::compliance::{AdvisoryNotice, AirworthinessDirective};

#[async_trait]
pub trait FaaAdAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn applicable_ads(
        &self,
        aircraft: &AdQuery,
    ) -> AdapterResult<Vec<AirworthinessDirective>>;
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct AdQuery {
    pub aircraft_id: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub ata: Option<String>,
}

pub struct NotConfiguredFaaAdAdapter;

#[async_trait]
impl FaaAdAdapter for NotConfiguredFaaAdAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "faa_ad".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn applicable_ads(&self, _q: &AdQuery) -> AdapterResult<Vec<AirworthinessDirective>> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "FAA AD source not configured".into(),
        })
    }
}

#[async_trait]
pub trait FaaDrsAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn search(&self, query: &str) -> AdapterResult<Vec<AdvisoryNotice>>;
}

pub struct NotConfiguredFaaDrsAdapter;

#[async_trait]
impl FaaDrsAdapter for NotConfiguredFaaDrsAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "faa_drs".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn search(&self, _q: &str) -> AdapterResult<Vec<AdvisoryNotice>> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "FAA DRS source not configured".into(),
        })
    }
}

#[async_trait]
pub trait SaibAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn search(&self, query: &str) -> AdapterResult<Vec<AdvisoryNotice>>;
}

pub struct NotConfiguredSaibAdapter;

#[async_trait]
impl SaibAdapter for NotConfiguredSaibAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "saib".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn search(&self, _q: &str) -> AdapterResult<Vec<AdvisoryNotice>> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "SAIB source not configured".into(),
        })
    }
}
