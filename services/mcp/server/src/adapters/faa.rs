//! Official FAA Dynamic Regulatory System adapter.
//!
//! The DRS data-pull API requires an issued key. Credentials remain
//! environment-only and the adapter fails closed when the key is absent.

use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde_json::{json, Map, Value};
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::adapters::faa::{AdQuery, FaaAdAdapter, FaaDrsAdapter, SaibAdapter};
use mxgenius_shared::adapters::source::{
    AdapterError, AdapterHealth, AdapterResult, LicenseScope, SourceInfo,
};
use mxgenius_shared::domain::compliance::{
    AdvisoryNotice, AirworthinessDirective, ApplicabilityState,
};
use mxgenius_shared::domain::ids::AdvisoryId;

const FAA_NAMESPACE: Uuid = Uuid::from_u128(0x733a0931_1ec1_41b6_9ce2_59a76f6f68a2);
const DRS_PAGE_SIZE: usize = 750;

#[derive(Clone)]
pub struct FaaDrsHttpAdapter {
    client: Client,
    base_url: Url,
    api_key_header: String,
    api_key: String,
    ad_document_types: Vec<String>,
    saib_document_type: String,
    max_pages: usize,
}

impl FaaDrsHttpAdapter {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = std::env::var("MXGENIUS_DRS_ENDPOINT")
            .unwrap_or_else(|_| "https://drs.faa.gov/api/drs/".into())
            .parse::<Url>()?;
        let api_key = required_env("MXGENIUS_DRS_API_KEY")?;
        let api_key_header =
            std::env::var("MXGENIUS_DRS_API_KEY_HEADER").unwrap_or_else(|_| "x-api-key".into());
        let ad_document_types = std::env::var("MXGENIUS_DRS_AD_DOCUMENT_TYPES")
            .unwrap_or_else(|_| "ADFRAWD,ADFREAD".into())
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let saib_document_type =
            std::env::var("MXGENIUS_DRS_SAIB_DOCUMENT_TYPE").unwrap_or_else(|_| "SAIB".into());
        let max_pages = std::env::var("MXGENIUS_DRS_MAX_PAGES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(20);
        let timeout = std::env::var("MXGENIUS_DRS_TIMEOUT_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(20);
        if ad_document_types.is_empty() || max_pages == 0 {
            anyhow::bail!("DRS document types and page limit must not be empty");
        }
        Ok(Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(timeout))
                .build()?,
            base_url,
            api_key_header,
            api_key,
            ad_document_types,
            saib_document_type,
            max_pages,
        })
    }

    async fn retrieve_documents(
        &self,
        document_type: &str,
        document_filters: Map<String, Value>,
    ) -> AdapterResult<Vec<DrsDocument>> {
        let header = reqwest::header::HeaderName::from_bytes(self.api_key_header.as_bytes())
            .map_err(|_| AdapterError::InvalidInput("invalid DRS API key header".into()))?;
        let url = self
            .base_url
            .join(&format!("data-pull/{document_type}/filtered"))
            .map_err(|error| AdapterError::InvalidInput(error.to_string()))?;
        let mut documents = Vec::new();
        for page in 0..self.max_pages {
            let response = self
                .client
                .post(url.clone())
                .header(header.clone(), &self.api_key)
                .json(&json!({
                    "offset": page * DRS_PAGE_SIZE,
                    "sortOrder": "DESC",
                    "documentFilters": document_filters
                }))
                .send()
                .await
                .map_err(map_request_error)?;
            let status = response.status();
            if status == StatusCode::TOO_MANY_REQUESTS {
                return Err(AdapterError::RateLimited(
                    "FAA DRS rate limit reached".into(),
                ));
            }
            if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                return Err(AdapterError::NotLicensed(
                    "FAA DRS rejected the configured API key".into(),
                ));
            }
            if !status.is_success() {
                return Err(AdapterError::Unavailable(format!(
                    "FAA DRS returned HTTP {status}"
                )));
            }
            let value: Value = response.json().await.map_err(|error| {
                AdapterError::Internal(format!("invalid DRS response: {error}"))
            })?;
            if let Some(message) = value.get("errorMessage").and_then(Value::as_str) {
                return Err(AdapterError::InvalidInput(message.to_owned()));
            }
            documents.extend(
                value
                    .get("documents")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(parse_document),
            );
            let has_more = value
                .pointer("/summary/hasMoreItems")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !has_more {
                return Ok(documents);
            }
        }
        Err(AdapterError::Internal(format!(
            "FAA DRS result exceeded the configured {} page safety limit",
            self.max_pages
        )))
    }

    fn info(&self, name: &str) -> SourceInfo {
        SourceInfo {
            name: name.into(),
            health: AdapterHealth::Healthy,
            license: Some(LicenseScope {
                scope: "faa_drs_api_key".into(),
                valid_until: None,
            }),
            last_checked: OffsetDateTime::now_utc(),
        }
    }
}

#[async_trait]
impl FaaAdAdapter for FaaDrsHttpAdapter {
    async fn source_info(&self) -> SourceInfo {
        self.info("faa_drs_ad")
    }

    async fn applicable_ads(
        &self,
        aircraft: &AdQuery,
    ) -> AdapterResult<Vec<AirworthinessDirective>> {
        let make = aircraft
            .make
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AdapterError::InvalidInput("aircraft make is required".into()))?;
        let model = aircraft
            .model
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AdapterError::InvalidInput("aircraft model is required".into()))?;
        let mut documents = Vec::new();
        for document_type in &self.ad_document_types {
            documents.extend(
                self.retrieve_documents(document_type, ad_filters(document_type, make, model))
                    .await?,
            );
        }
        documents.sort_by(|a, b| a.identifier.cmp(&b.identifier));
        documents.dedup_by(|a, b| a.identifier == b.identifier);
        Ok(documents
            .into_iter()
            .map(|document| AirworthinessDirective {
                id: advisory_id(&document.identifier),
                ad_number: document.identifier,
                title: document.title,
                effective_at: document.effective_at,
                source_reference: document.source_reference,
                // DRS metadata establishes candidate relevance, not final
                // serial/effectivity applicability or maintenance authority.
                applicability: ApplicabilityState::Candidate,
            })
            .collect())
    }
}

#[async_trait]
impl FaaDrsAdapter for FaaDrsHttpAdapter {
    async fn source_info(&self) -> SourceInfo {
        self.info("faa_drs")
    }

    async fn search(&self, query: &str) -> AdapterResult<Vec<AdvisoryNotice>> {
        let mut documents = Vec::new();
        for document_type in &self.ad_document_types {
            documents.extend(self.retrieve_documents(document_type, Map::new()).await?);
        }
        notices(filter_documents(documents, query))
    }
}

#[async_trait]
impl SaibAdapter for FaaDrsHttpAdapter {
    async fn source_info(&self) -> SourceInfo {
        self.info("faa_drs_saib")
    }

    async fn search(&self, query: &str) -> AdapterResult<Vec<AdvisoryNotice>> {
        let documents = self
            .retrieve_documents(&self.saib_document_type, Map::new())
            .await?;
        notices(filter_documents(documents, query))
    }
}

#[derive(Debug)]
struct DrsDocument {
    identifier: String,
    title: String,
    source_reference: String,
    effective_at: Option<OffsetDateTime>,
    metadata: Value,
}

fn notices(documents: Vec<DrsDocument>) -> AdapterResult<Vec<AdvisoryNotice>> {
    Ok(documents
        .into_iter()
        .map(|document| AdvisoryNotice {
            id: advisory_id(&document.identifier),
            notice_number: document.identifier,
            title: document.title,
            issued_at: document.effective_at,
            source_reference: document.source_reference,
        })
        .collect())
}

fn advisory_id(identifier: &str) -> AdvisoryId {
    AdvisoryId(Uuid::new_v5(&FAA_NAMESPACE, identifier.as_bytes()))
}

fn parse_document(value: &Value) -> Option<DrsDocument> {
    let identifier = value_string(
        value,
        &[
            "documentNumber",
            "adNumber",
            "saibNumber",
            "identifier",
            "number",
            "id",
        ],
    )?;
    let title = value_string(value, &["title", "documentTitle", "subject", "name"])
        .unwrap_or_else(|| identifier.clone());
    let source_reference = value_string(value, &["documentURL", "sourceLink", "url", "link"])
        .filter(|url| is_official_faa_url(url))
        .unwrap_or_else(|| "https://drs.faa.gov/browse".into());
    let effective_at = value_string(value, &["effectiveDate", "saibIssueDate", "issueDate"])
        .and_then(|date| parse_faa_date(&date));
    Some(DrsDocument {
        identifier,
        title,
        source_reference,
        effective_at,
        metadata: value.clone(),
    })
}

fn ad_filters(document_type: &str, make: &str, model: &str) -> Map<String, Value> {
    let prefix = if document_type == "ADFREAD" {
        "adfread"
    } else {
        "adfrawd"
    };
    let mut filters = Map::new();
    filters.insert(
        format!("drs:{prefix}Make"),
        json!(faa_make_candidates(make)),
    );
    if let Some(models) = faa_model_candidates(model) {
        filters.insert(format!("drs:{prefix}Model"), json!(models));
    }
    filters
}

fn faa_make_candidates(make: &str) -> Vec<String> {
    let normalized = make.to_ascii_lowercase();
    let candidates: &[&str] = if normalized.contains("bombardier") {
        &["Bombardier Inc."]
    } else if normalized.contains("gulfstream") {
        &[
            "Gulfstream Aerospace LP",
            "Gulfstream American Corporation",
            "Gulfstream Aerospace Corporation",
        ]
    } else if normalized.contains("dassault") {
        &["Dassault Aviation"]
    } else if normalized.contains("embraer") {
        &["Embraer S.A."]
    } else if normalized.contains("pilatus") {
        &["Pilatus Aircraft Limited"]
    } else if normalized.contains("cessna") || normalized.contains("textron") {
        &["Textron Aviation Inc."]
    } else if normalized.contains("boeing") {
        &["The Boeing Company"]
    } else if normalized.contains("airbus") {
        &["Airbus SAS", "Airbus Canada Limited Partnership"]
    } else {
        return vec![make.to_owned()];
    };
    candidates.iter().map(|value| (*value).to_owned()).collect()
}

fn faa_model_candidates(model: &str) -> Option<Vec<String>> {
    let normalized = model.to_ascii_lowercase().replace(['-', ' '], "");
    let values: &[&str] = if normalized.contains("global7500") {
        &["BD-700-2A12"]
    } else if normalized.contains("global6500") {
        &["BD-700-1A11"]
    } else if normalized.contains("global5500") {
        &["BD-700-1A10"]
    } else if normalized.contains("challenger300") || normalized.contains("challenger350") {
        &["BD-100-1A10"]
    } else {
        return None;
    };
    Some(values.iter().map(|value| (*value).to_owned()).collect())
}

fn filter_documents(documents: Vec<DrsDocument>, query: &str) -> Vec<DrsDocument> {
    let terms = query
        .split_whitespace()
        .map(|term| term.to_ascii_lowercase())
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return documents;
    }
    documents
        .into_iter()
        .filter(|document| {
            let haystack = document.metadata.to_string().to_ascii_lowercase();
            terms.iter().all(|term| haystack.contains(term))
        })
        .collect()
}

fn parse_faa_date(value: &str) -> Option<OffsetDateTime> {
    let date = time::Date::parse(
        value.get(..10)?,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .ok()?;
    Some(date.with_hms(0, 0, 0).ok()?.assume_utc())
}

fn is_official_faa_url(candidate: &str) -> bool {
    Url::parse(candidate)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .map(|host| host == "faa.gov" || host.ends_with(".faa.gov"))
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
    value.as_object()?.iter().find_map(|(candidate, value)| {
        let normalized = normalize_key(candidate);
        (normalized == expected || normalized.strip_prefix("drs") == Some(expected.as_str()))
            .then_some(value)
    })
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

fn map_request_error(error: reqwest::Error) -> AdapterError {
    if error.is_timeout() {
        AdapterError::Timeout("FAA DRS request timed out".into())
    } else {
        AdapterError::Unavailable(format!("FAA DRS request failed: {error}"))
    }
}

fn required_env(name: &str) -> anyhow::Result<String> {
    std::env::var(name)
        .map_err(|_| anyhow::anyhow!("required environment variable {name} is unset"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_faa_source_links() {
        assert!(is_official_faa_url("https://drs.faa.gov/browse"));
        assert!(!is_official_faa_url("https://example.com/fake-ad"));
    }

    #[test]
    fn parses_namespaced_drs_metadata() {
        let doc = parse_document(&json!({
            "drs:documentNumber": "2026-01-01",
            "drs:title": "Example",
            "drs:effectiveDate": "2026-07-19",
            "documentURL": "https://drs.faa.gov/browse"
        }))
        .expect("document");
        assert_eq!(doc.identifier, "2026-01-01");
        assert_eq!(doc.title, "Example");
        assert!(doc.effective_at.is_some());
    }

    #[test]
    fn maps_global_7500_to_faa_type_model() {
        assert_eq!(
            faa_model_candidates("Global 7500"),
            Some(vec!["BD-700-2A12".into()])
        );
    }
}
