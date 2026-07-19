//! Scheduling adapter stub.

use async_trait::async_trait;

use super::source::{AdapterResult, SourceInfo};

#[async_trait]
pub trait SchedulingAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn resource_availability(&self, case_id: uuid::Uuid) -> AdapterResult<serde_json::Value>;
}

pub struct NotConfiguredSchedulingAdapter;

#[async_trait]
impl SchedulingAdapter for NotConfiguredSchedulingAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "scheduling".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn resource_availability(
        &self,
        _case_id: uuid::Uuid,
    ) -> AdapterResult<serde_json::Value> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Scheduling source not configured".into(),
        })
    }
}
