//! Digital twin catalog adapter.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};
use crate::domain::digital_twin::DigitalTwinModel;

#[async_trait]
pub trait DigitalTwinCatalogAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn list_models(&self) -> AdapterResult<Vec<DigitalTwinModel>>;
}

pub struct NotConfiguredDigitalTwinAdapter;

#[async_trait]
impl DigitalTwinCatalogAdapter for NotConfiguredDigitalTwinAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "digital_twin".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn list_models(&self) -> AdapterResult<Vec<DigitalTwinModel>> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Digital twin catalog not configured".into(),
        })
    }
}
