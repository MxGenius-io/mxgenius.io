//! JetNet source adapters. Credentials remain environment-only and are never
//! copied into evidence, logs, or browser-visible responses.

use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde_json::Value;
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::adapters::jetnet::{JetNetAdapter, JetNetAircraftDto, JetNetLookupQuery};
use mxgenius_shared::adapters::source::{
    AdapterError, AdapterHealth, AdapterResult, LicenseScope, SourceInfo,
};
use mxgenius_shared::domain::ids::AircraftId;

const AIRCRAFT_NAMESPACE: Uuid = Uuid::from_u128(0x3a4c5b6c_2c7e_4f47_9a3e_2a2a2a2a2a2a);
const FIXTURE_AIRCRAFT_JSON: &str = include_str!("../../../fixtures/jetnet/aircraft.json");
const FIXTURE_PROFILE_JSON: &str = include_str!("../../../fixtures/jetnet/profile.json");

pub fn canonical_aircraft_id(source_id: &str) -> AircraftId {
    AircraftId(Uuid::new_v5(&AIRCRAFT_NAMESPACE, source_id.as_bytes()))
}

pub struct JetNetHttpAdapter {
    client: Client,
    base_url: Url,
    api_token: String,
    bearer_token: String,
}

impl JetNetHttpAdapter {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = std::env::var("MXGENIUS_JETNET_BASE_URL")
            .unwrap_or_else(|_| "https://customer.jetnetconnect.com/api/".into())
            .parse::<Url>()?;
        let api_token = required_env("MXGENIUS_JETNET_API_TOKEN")?;
        let bearer_token = required_env("MXGENIUS_JETNET_BEARER_TOKEN")?;
        let timeout = std::env::var("MXGENIUS_JETNET_TIMEOUT_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(20);
        Ok(Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(timeout))
                .build()?,
            base_url,
            api_token,
            bearer_token,
        })
    }

    fn endpoint(&self, segments: &[&str]) -> AdapterResult<Url> {
        let mut url = self.base_url.clone();
        let mut path = url.path_segments_mut().map_err(|_| {
            AdapterError::InvalidInput("JetNet base URL cannot accept path segments".into())
        })?;
        path.pop_if_empty();
        for segment in segments {
            path.push(segment);
        }
        path.push(&self.api_token);
        drop(path);
        Ok(url)
    }

    async fn get_json(&self, url: Url) -> AdapterResult<Value> {
        let response = self
            .client
            .get(url)
            .bearer_auth(&self.bearer_token)
            .send()
            .await
            .map_err(map_request_error)?;
        let status = response.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(AdapterError::RateLimited(
                "JetNet rate limit reached".into(),
            ));
        }
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(AdapterError::NotLicensed(
                "JetNet rejected the configured credentials".into(),
            ));
        }
        if !status.is_success() {
            return Err(AdapterError::Unavailable(format!(
                "JetNet returned HTTP {status}"
            )));
        }
        response
            .json()
            .await
            .map_err(|error| AdapterError::Internal(format!("invalid JetNet response: {error}")))
    }
}

#[async_trait]
impl JetNetAdapter for JetNetHttpAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "jetnet".into(),
            health: AdapterHealth::Healthy,
            license: Some(LicenseScope {
                scope: "configured_customer_account".into(),
                valid_until: None,
            }),
            last_checked: OffsetDateTime::now_utc(),
        }
    }

    async fn lookup(&self, query: &JetNetLookupQuery) -> AdapterResult<Vec<JetNetAircraftDto>> {
        if query.registration.is_none() && query.serial_number.is_none() {
            if let Some(source_id) = query.source_id.as_deref() {
                return self.profile(source_id).await.map(|profile| vec![profile]);
            }
        }
        let url = self.endpoint(&["Aircraft", "getAircraftList"])?;
        let value = self.get_json(url).await?;
        let mut rows = extract_records(&value)
            .into_iter()
            .filter_map(parse_aircraft)
            .filter(|aircraft| matches_query(aircraft, query))
            .collect::<Vec<_>>();
        rows.sort_by(|a, b| a.source_id.cmp(&b.source_id));
        rows.dedup_by(|a, b| a.source_id == b.source_id);
        Ok(rows)
    }

    async fn profile(&self, source_id: &str) -> AdapterResult<JetNetAircraftDto> {
        if source_id.trim().is_empty() {
            return Err(AdapterError::InvalidInput(
                "JetNet source id is empty".into(),
            ));
        }
        let url = self.endpoint(&["Aircraft", "getAircraft", source_id])?;
        let value = self.get_json(url).await?;
        extract_records(&value)
            .into_iter()
            .find_map(parse_aircraft)
            .or_else(|| parse_aircraft(&value))
            .ok_or_else(|| AdapterError::Internal("JetNet profile contained no aircraft".into()))
    }
}

#[derive(Default)]
pub struct FixtureJetNetAdapter;

#[async_trait]
impl JetNetAdapter for FixtureJetNetAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "jetnet_fixture".into(),
            health: AdapterHealth::Healthy,
            license: Some(LicenseScope {
                scope: "sanitized_fixture".into(),
                valid_until: None,
            }),
            last_checked: OffsetDateTime::now_utc(),
        }
    }

    async fn lookup(&self, query: &JetNetLookupQuery) -> AdapterResult<Vec<JetNetAircraftDto>> {
        let value: Value = serde_json::from_str(FIXTURE_AIRCRAFT_JSON)
            .map_err(|error| AdapterError::Internal(error.to_string()))?;
        Ok(extract_records(&value)
            .into_iter()
            .filter_map(parse_aircraft)
            .filter(|aircraft| matches_query(aircraft, query))
            .collect())
    }

    async fn profile(&self, source_id: &str) -> AdapterResult<JetNetAircraftDto> {
        let value: Value = serde_json::from_str(FIXTURE_PROFILE_JSON)
            .map_err(|error| AdapterError::Internal(error.to_string()))?;
        let aircraft = parse_aircraft(&value)
            .ok_or_else(|| AdapterError::Internal("invalid aircraft fixture".into()))?;
        if aircraft.source_id == source_id {
            Ok(aircraft)
        } else {
            Err(AdapterError::Unavailable(
                "fixture aircraft was not found".into(),
            ))
        }
    }
}

fn required_env(name: &str) -> anyhow::Result<String> {
    std::env::var(name)
        .map_err(|_| anyhow::anyhow!("required environment variable {name} is unset"))
}

fn map_request_error(error: reqwest::Error) -> AdapterError {
    if error.is_timeout() {
        AdapterError::Timeout("JetNet request timed out".into())
    } else {
        AdapterError::Unavailable(format!("JetNet request failed: {error}"))
    }
}

fn extract_records(value: &Value) -> Vec<&Value> {
    if let Some(rows) = value.as_array() {
        return rows.iter().collect();
    }
    for key in ["data", "result", "results", "items", "aircraft"] {
        if let Some(child) = get_case_insensitive(value, key) {
            let rows = extract_records(child);
            if !rows.is_empty() {
                return rows;
            }
        }
    }
    vec![value]
}

fn parse_aircraft(value: &Value) -> Option<JetNetAircraftDto> {
    let source_id = value_string(value, &["aircraftid", "aircraft_id", "id"])?;
    Some(JetNetAircraftDto {
        aircraft_id: canonical_aircraft_id(&source_id),
        source_id,
        registration: value_string(
            value,
            &[
                "registration",
                "tailnumber",
                "tail_number",
                "regnumber",
                "regnbr",
            ],
        ),
        serial_number: value_string(
            value,
            &["serialnumber", "serial_number", "serialno", "sernbr", "msn"],
        ),
        make: value_string(value, &["make", "manufacturer", "aircraftmake"]),
        model: value_string(value, &["model", "modelname", "aircraftmodel"]),
        year: value_i32(value, &["year", "yearmfr", "manufactureyear"]),
        base_icao: value_string(value, &["baseicao", "base_icao", "icao"]),
    })
}

fn matches_query(aircraft: &JetNetAircraftDto, query: &JetNetLookupQuery) -> bool {
    option_is_match(&aircraft.registration, &query.registration)
        || option_is_match(&aircraft.serial_number, &query.serial_number)
        || query
            .source_id
            .as_deref()
            .map(|expected| aircraft.source_id.eq_ignore_ascii_case(expected.trim()))
            .unwrap_or(false)
}

fn option_is_match(actual: &Option<String>, expected: &Option<String>) -> bool {
    expected
        .as_deref()
        .map(|expected| {
            actual
                .as_deref()
                .map(|actual| actual.eq_ignore_ascii_case(expected.trim()))
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn get_case_insensitive<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    let expected = normalize_key(key);
    value
        .as_object()?
        .iter()
        .find_map(|(candidate, value)| (normalize_key(candidate) == expected).then_some(value))
}

fn value_string(value: &Value, aliases: &[&str]) -> Option<String> {
    aliases.iter().find_map(|alias| {
        let value = get_case_insensitive(value, alias)?;
        match value {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        }
    })
}

fn value_i32(value: &Value, aliases: &[&str]) -> Option<i32> {
    aliases.iter().find_map(|alias| {
        let value = get_case_insensitive(value, alias)?;
        value
            .as_i64()
            .and_then(|number| i32::try_from(number).ok())
            .or_else(|| value.as_str()?.parse::<i32>().ok())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_jetnet_field_shapes() {
        let value = serde_json::json!({
            "AircraftId": 42,
            "TailNumber": "N42MX",
            "SerialNumber": "SN-42",
            "Manufacturer": "Bombardier",
            "ModelName": "Global 7500",
            "YearMfr": 2022
        });
        let aircraft = parse_aircraft(&value).expect("aircraft");
        assert_eq!(aircraft.source_id, "42");
        assert_eq!(aircraft.registration.as_deref(), Some("N42MX"));
        assert_eq!(aircraft.model.as_deref(), Some("Global 7500"));
    }

    #[test]
    fn canonical_id_is_stable() {
        assert_eq!(canonical_aircraft_id("42"), canonical_aircraft_id("42"));
        assert_ne!(canonical_aircraft_id("42"), canonical_aircraft_id("43"));
    }
}
