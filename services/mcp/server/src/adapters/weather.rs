//! Public AviationWeather.gov Data API adapter.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde_json::Value;
use time::OffsetDateTime;

use mxgenius_shared::adapters::source::{AdapterError, AdapterHealth, AdapterResult, SourceInfo};
use mxgenius_shared::adapters::weather::AviationWeatherAdapter;
use mxgenius_shared::domain::scheduling::WeatherContext;

#[derive(Clone)]
pub struct AviationWeatherHttpAdapter {
    client: Client,
    base_url: Url,
}

impl AviationWeatherHttpAdapter {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = std::env::var("MXGENIUS_AVIATION_WEATHER_ENDPOINT")
            .unwrap_or_else(|_| "https://aviationweather.gov/api/data/".into())
            .parse::<Url>()?;
        let user_agent = std::env::var("MXGENIUS_AVIATION_WEATHER_USER_AGENT")
            .unwrap_or_else(|_| "MxGenius/0.1 (https://mxgenius.io)".into());
        Ok(Self {
            client: Client::builder()
                .user_agent(user_agent)
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(15))
                .build()?,
            base_url,
        })
    }

    async fn product(&self, product: &str, icao: &str) -> AdapterResult<Option<Value>> {
        let url = self
            .base_url
            .join(product)
            .map_err(|error| AdapterError::InvalidInput(error.to_string()))?;
        let response = self
            .client
            .get(url)
            .query(&[("ids", icao), ("format", "json")])
            .send()
            .await
            .map_err(super::provider_auth::map_request_error)?;
        if response.status() == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            return Err(AdapterError::RateLimited(
                "AviationWeather.gov rate limit reached".into(),
            ));
        }
        if !response.status().is_success() {
            return Err(AdapterError::Unavailable(format!(
                "AviationWeather.gov returned HTTP {}",
                response.status()
            )));
        }
        let rows: Vec<Value> = response.json().await.map_err(|error| {
            AdapterError::Internal(format!("invalid AviationWeather.gov response: {error}"))
        })?;
        Ok(rows.into_iter().next())
    }
}

#[async_trait]
impl AviationWeatherAdapter for AviationWeatherHttpAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "aviationweather.gov".into(),
            health: AdapterHealth::Healthy,
            license: None,
            last_checked: OffsetDateTime::now_utc(),
        }
    }

    async fn airport_now(&self, icao: &str) -> AdapterResult<WeatherContext> {
        let icao = icao.trim().to_ascii_uppercase();
        if icao.len() != 4 || !icao.chars().all(|value| value.is_ascii_alphanumeric()) {
            return Err(AdapterError::InvalidInput(
                "airport_icao must be a four-character ICAO identifier".into(),
            ));
        }
        let metar = self.product("metar", &icao).await?;
        let taf = self.product("taf", &icao).await?;
        let observed_at = metar
            .as_ref()
            .and_then(|value| value.get("obsTime"))
            .and_then(Value::as_i64)
            .and_then(|value| OffsetDateTime::from_unix_timestamp(value).ok())
            .unwrap_or_else(OffsetDateTime::now_utc);
        if metar.is_none() && taf.is_none() {
            return Err(AdapterError::Unavailable(format!(
                "no METAR or TAF is available for {icao}"
            )));
        }
        let mut source_url = self
            .base_url
            .join("metar")
            .map_err(|error| AdapterError::Internal(error.to_string()))?;
        source_url
            .query_pairs_mut()
            .append_pair("ids", &icao)
            .append_pair("format", "json");
        Ok(WeatherContext {
            airport_icao: icao.clone(),
            observed_at,
            flight_category: metar
                .as_ref()
                .and_then(|value| value.get("fltCat"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            source_reference: source_url.to_string(),
            metar: metar
                .as_ref()
                .and_then(|value| value.get("rawOb"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            taf: taf
                .as_ref()
                .and_then(|value| value.get("rawTAF"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            decoded: Some(serde_json::json!({"metar": metar, "taf": taf})),
        })
    }

    async fn forecast_window(
        &self,
        icao: &str,
        _start: OffsetDateTime,
        _end: OffsetDateTime,
    ) -> AdapterResult<Vec<WeatherContext>> {
        Ok(vec![self.airport_now(icao).await?])
    }
}
