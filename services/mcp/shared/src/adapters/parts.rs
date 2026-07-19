//! Parts inventory and supplier adapter stubs.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};
use crate::domain::ids::PartId;

#[async_trait]
pub trait PartsInventoryAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn inventory(
        &self,
        part_id: PartId,
        destination: &str,
    ) -> AdapterResult<serde_json::Value>;
}

pub struct NotConfiguredPartsInventoryAdapter;

#[async_trait]
impl PartsInventoryAdapter for NotConfiguredPartsInventoryAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "parts_inventory".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn inventory(&self, _p: PartId, _d: &str) -> AdapterResult<serde_json::Value> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Parts inventory source not configured".into(),
        })
    }
}

#[async_trait]
pub trait SupplierAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn suppliers_for(&self, part_id: PartId) -> AdapterResult<serde_json::Value>;
}

pub struct NotConfiguredSupplierAdapter;

#[async_trait]
impl SupplierAdapter for NotConfiguredSupplierAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "supplier".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn suppliers_for(&self, _p: PartId) -> AdapterResult<serde_json::Value> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Supplier source not configured".into(),
        })
    }
}
