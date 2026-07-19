//! Weather adapter trait + NotConfigured default.

use async_trait::async_trait;
use time::OffsetDateTime;

use super::source::{AdapterResult, SourceInfo};
use crate::domain::scheduling::WeatherContext;

#[async_trait]
pub trait AviationWeatherAdapter: Send + Sync {
    async fn source_info(&self) -> SourceInfo;
    async fn airport_now(&self, icao: &str) -> AdapterResult<WeatherContext>;
    async fn forecast_window(
        &self,
        icao: &str,
        start: OffsetDateTime,
        end: OffsetDateTime,
    ) -> AdapterResult<Vec<WeatherContext>>;
}

pub struct NotConfiguredWeatherAdapter;

#[async_trait]
impl AviationWeatherAdapter for NotConfiguredWeatherAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "weather".into(),
            health: super::source::AdapterHealth::NotConfigured,
            license: None,
            last_checked: time::OffsetDateTime::now_utc(),
        }
    }
    async fn airport_now(&self, _icao: &str) -> AdapterResult<WeatherContext> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Aviation weather source not configured".into(),
        })
    }
    async fn forecast_window(
        &self,
        _icao: &str,
        _start: OffsetDateTime,
        _end: OffsetDateTime,
    ) -> AdapterResult<Vec<WeatherContext>> {
        Err(super::source::AdapterError::NotConfigured {
            reason: "Aviation weather source not configured".into(),
        })
    }
}
