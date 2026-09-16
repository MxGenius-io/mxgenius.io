use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::adapters::manual::{
    ManualCorpusAdapter, ManualQuery, ManualRetrievalState, ManualSearchResult,
};
use mxgenius_shared::adapters::source::{AdapterError, AdapterHealth, AdapterResult, SourceInfo};
use mxgenius_shared::domain::evidence::{Evidence, EvidenceAsset, EvidenceKind, SourceType};
use mxgenius_shared::domain::ids::EvidenceId;

const EVIDENCE_NAMESPACE: &str = "3a4c5b6c-2c7e-4f47-9a3e-2a2a2a2a2a2a";
const FIXTURE_EXCERPTS: &str = include_str!("../../../fixtures/manual_corpus/excerpts.json");
const SEARCH_API_VERSION: &str = "2024-07-01";
const EMBEDDING_PROBE_TEXT: &str = "MXGenius authoritative manual retrieval readiness probe";
const MINIMUM_RETRIEVAL_SCORE: f32 = 0.01;
const DEFAULT_VECTOR_DIMENSIONS: usize = 384;

#[derive(Clone)]
pub struct AzureManualCorpusAdapter {
    http: Client,
    search_endpoint: String,
    search_key: String,
    index_name: String,
    embeddings_endpoint: String,
    embeddings_key: String,
    embeddings_model: String,
    embeddings_auth: EmbeddingsAuth,
    document_filter: String,
    pack_id: String,
    expected_dimensions: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EmbeddingsAuth {
    Bearer,
    ApiKey,
}

impl AzureManualCorpusAdapter {
    pub fn from_env() -> AdapterResult<Self> {
        let search_endpoint = required_env("AZURE_SEARCH_ENDPOINT")?;
        let search_key = required_env("AZURE_SEARCH_KEY")?;
        let index_name = required_env("AZURE_SEARCH_INDEX")?;
        let embeddings_key = required_env("MXGENIUS_EMBEDDINGS_API_KEY")?;
        let embeddings_endpoint = required_env("MXGENIUS_EMBEDDINGS_ENDPOINT")?;
        let embeddings_model = required_env("MXGENIUS_EMBEDDINGS_MODEL")?;
        let embeddings_auth = match required_env("MXGENIUS_EMBEDDINGS_AUTH")?
            .to_ascii_lowercase()
            .as_str()
        {
            "bearer" => EmbeddingsAuth::Bearer,
            "api-key" | "api_key" => EmbeddingsAuth::ApiKey,
            value => {
                return Err(AdapterError::InvalidInput(format!(
                    "unsupported MXGENIUS_EMBEDDINGS_AUTH value {value}"
                )))
            }
        };
        let pack_id = required_env("MXGENIUS_MANUAL_PACK_ID")?;
        let document_filter = required_env("MXGENIUS_MANUAL_SEARCH_FILTER")?;
        let expected_dimensions =
            optional_positive_usize("MXGENIUS_EMBEDDINGS_DIMENSIONS", DEFAULT_VECTOR_DIMENSIONS)?;
        if document_filter.trim().is_empty() {
            return Err(AdapterError::NotConfigured {
                reason: "MXGENIUS_MANUAL_SEARCH_FILTER must identify authoritative manual records"
                    .into(),
            });
        }
        validate_runtime_contract(&embeddings_endpoint, embeddings_auth)?;

        Ok(Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|error| AdapterError::Internal(error.to_string()))?,
            search_endpoint: search_endpoint.trim_end_matches('/').into(),
            search_key,
            index_name,
            embeddings_endpoint: embeddings_endpoint.trim().into(),
            embeddings_key,
            embeddings_model,
            embeddings_auth,
            document_filter,
            pack_id,
            expected_dimensions,
        })
    }

    pub async fn validate_contract(&self) -> AdapterResult<()> {
        let url = format!(
            "{}/indexes/{}?api-version={SEARCH_API_VERSION}",
            self.search_endpoint, self.index_name
        );
        let response = self
            .http
            .get(url)
            .header("api-key", &self.search_key)
            .send()
            .await
            .map_err(map_reqwest_error)?
            .error_for_status()
            .map_err(map_reqwest_error)?;
        let index: SearchIndexDefinition = response.json().await.map_err(|error| {
            AdapterError::Internal(format!("invalid Azure Search index definition: {error}"))
        })?;
        if index.name != self.index_name {
            return Err(AdapterError::Unavailable(format!(
                "manual index identity mismatch: expected {}, received {}",
                self.index_name, index.name
            )));
        }
        let dimensions = index
            .fields
            .iter()
            .find(|field| field.name == "content_vector")
            .and_then(|field| field.dimensions)
            .ok_or_else(|| {
                AdapterError::Unavailable(
                    "manual index does not declare content_vector dimensions".into(),
                )
            })?;
        if dimensions != self.expected_dimensions {
            return Err(AdapterError::Unavailable(format!(
                "manual index vector mismatch: expected {}, received {dimensions}",
                self.expected_dimensions
            )));
        }
        self.embed(EMBEDDING_PROBE_TEXT).await?;
        Ok(())
    }

    async fn embed(&self, text: &str) -> AdapterResult<Vec<f32>> {
        let request = self.http.post(&self.embeddings_endpoint).json(&json!({
            "model": self.embeddings_model,
            "input": text,
        }));
        let request = match self.embeddings_auth {
            EmbeddingsAuth::Bearer => request.bearer_auth(&self.embeddings_key),
            EmbeddingsAuth::ApiKey => request.header("api-key", &self.embeddings_key),
        };
        let response = request
            .send()
            .await
            .map_err(map_reqwest_error)?
            .error_for_status()
            .map_err(map_reqwest_error)?;
        let payload: EmbeddingResponse = response.json().await.map_err(|error| {
            AdapterError::Internal(format!("invalid embedding response: {error}"))
        })?;
        if payload.model != self.embeddings_model {
            return Err(AdapterError::Unavailable(format!(
                "embedding model mismatch: expected {}, received {}",
                self.embeddings_model, payload.model
            )));
        }
        let vector = payload
            .data
            .into_iter()
            .next()
            .map(|item| item.embedding)
            .unwrap_or_default();
        if vector.is_empty() {
            return Err(AdapterError::Unavailable(
                "embedding service returned an empty vector".into(),
            ));
        }
        if vector.len() != self.expected_dimensions {
            return Err(AdapterError::Unavailable(format!(
                "embedding dimension mismatch: expected {}, received {}",
                self.expected_dimensions,
                vector.len()
            )));
        }
        if vector.iter().any(|value| !value.is_finite()) {
            return Err(AdapterError::Unavailable(
                "embedding service returned a non-finite vector".into(),
            ));
        }
        Ok(vector)
    }
}

#[async_trait]
impl ManualCorpusAdapter for AzureManualCorpusAdapter {
    async fn source_info(&self) -> SourceInfo {
        let health = match self.validate_contract().await {
            Ok(()) => AdapterHealth::Healthy,
            Err(error) => {
                tracing::warn!(target: "mxgenius.manual", %error, "manual retrieval contract check failed");
                AdapterHealth::Unavailable
            }
        };
        SourceInfo {
            name: format!("azure_ai_search:{};pack={}", self.index_name, self.pack_id),
            health,
            license: None,
            last_checked: OffsetDateTime::now_utc(),
        }
    }

    async fn search(&self, query: &ManualQuery) -> AdapterResult<ManualSearchResult> {
        let text = query.text.trim();
        if text.is_empty() {
            return Err(AdapterError::InvalidInput(
                "manual query text is blank".into(),
            ));
        }
        let aircraft_model = query
            .aircraft_model
            .as_deref()
            .and_then(normalize_aircraft_model);
        let vector = self.embed(text).await?;
        let limit = query.limit.unwrap_or(8).clamp(1, 33);
        let candidate_limit = (limit * 3).min(99);
        let base_filter = aircraft_model.as_deref().map_or_else(
            || self.document_filter.clone(),
            |model| {
                format!(
                    "({}) and search.ismatch('{}', 'aircraft_model', 'simple', 'all')",
                    self.document_filter,
                    odata_search_query(model)
                )
            },
        );
        let filter = scoped_manual_filter(
            &base_filter,
            query.manual_type.as_deref(),
            query.ata.as_deref(),
        );
        let url = format!(
            "{}/indexes/{}/docs/search?api-version=2023-11-01",
            self.search_endpoint, self.index_name
        );
        let response = self
            .http
            .post(url)
            .header("api-key", &self.search_key)
            .json(&json!({
                "search": text,
                "searchFields": "title,section,content,aircraft_model",
                "vectorQueries": [{
                    "vector": vector,
                    "k": candidate_limit,
                    "fields": "content_vector",
                    "kind": "vector"
                }],
                "vectorFilterMode": "preFilter",
                "select": "id,document_id,content,title,source_blob,aircraft_model,manual_type,ata,revision,effective_date,content_hash,assets_json,lineage_state",
                "filter": filter,
                "top": candidate_limit
            }))
            .send()
            .await
            .map_err(map_reqwest_error)?
            .error_for_status()
            .map_err(map_reqwest_error)?;
        let payload: SearchResponse = response.json().await.map_err(|error| {
            AdapterError::Internal(format!("invalid Azure Search response: {error}"))
        })?;

        let (evidence, observed_model) = collect_qualified_evidence(
            &self.index_name,
            payload.value,
            aircraft_model.as_deref(),
            limit as usize,
        );
        let resolved_model = aircraft_model.or(observed_model);
        Ok(ManualSearchResult {
            state: if evidence.is_empty() {
                ManualRetrievalState::NoRelevantSection
            } else if resolved_model.is_none() {
                ManualRetrievalState::ApplicabilityUnknown
            } else {
                ManualRetrievalState::VerifiedMatch
            },
            aircraft_model: resolved_model,
            ata: query.ata.clone(),
            evidence,
        })
    }
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    model: String,
    #[serde(default)]
    data: Vec<EmbeddingItem>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingItem {
    #[serde(default)]
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct SearchIndexDefinition {
    name: String,
    #[serde(default)]
    fields: Vec<SearchFieldDefinition>,
}

#[derive(Debug, Deserialize)]
struct SearchFieldDefinition {
    name: String,
    dimensions: Option<usize>,
}

fn validate_runtime_contract(
    embeddings_endpoint: &str,
    embeddings_auth: EmbeddingsAuth,
) -> AdapterResult<()> {
    let endpoint = embeddings_endpoint.trim();
    if !endpoint.starts_with("https://") || !endpoint.ends_with("/v1/embeddings") {
        return Err(AdapterError::InvalidInput(
            "MXGENIUS_EMBEDDINGS_ENDPOINT must use HTTPS and end in /v1/embeddings".to_string(),
        ));
    }
    if !matches!(
        embeddings_auth,
        EmbeddingsAuth::Bearer | EmbeddingsAuth::ApiKey
    ) {
        return Err(AdapterError::InvalidInput(
            "MXGENIUS_EMBEDDINGS_AUTH is unsupported".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    value: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    #[serde(rename = "@search.score")]
    score: Option<f32>,
    id: String,
    document_id: String,
    content: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    source_blob: Option<String>,
    #[serde(default)]
    aircraft_model: Option<String>,
    #[serde(default)]
    manual_type: Option<String>,
    #[serde(default)]
    ata: Option<String>,
    #[serde(default)]
    revision: Option<String>,
    #[serde(default)]
    effective_date: Option<OffsetDateTime>,
    #[serde(default)]
    content_hash: Option<String>,
    #[serde(default)]
    assets_json: Option<String>,
    #[serde(default)]
    lineage_state: Option<String>,
}

fn evidence_from_hit(index_name: &str, hit: SearchHit) -> Evidence {
    let hash = Sha256::digest(hit.content.as_bytes());
    let namespace = Uuid::parse_str(EVIDENCE_NAMESPACE).expect("valid evidence namespace");
    let assets: Vec<EvidenceAsset> = hit
        .assets_json
        .as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_default();
    let source_reference = hit.source_blob.as_deref().map_or_else(
        || {
            format!(
                "azure-ai-search://{}/{}/{}",
                index_name, hit.document_id, hit.id
            )
        },
        |blob| format!("azure-blob://{}#chunk={}", blob, hit.id),
    );
    let title = hit
        .title
        .clone()
        .unwrap_or_else(|| format!("Manual excerpt {}", hit.document_id));
    let license_scope = Some(format!(
        "manual_corpus;aircraft_model={};manual_type={};ata={};lineage={}",
        hit.aircraft_model.as_deref().unwrap_or("unknown"),
        hit.manual_type.as_deref().unwrap_or("unknown"),
        hit.ata.as_deref().unwrap_or("unknown"),
        hit.lineage_state.as_deref().unwrap_or("unknown")
    ));
    Evidence {
        evidence_id: EvidenceId(Uuid::new_v5(&namespace, &hash)),
        source_type: SourceType::Manual,
        source_reference,
        kind: EvidenceKind::ManualExcerpt,
        title,
        excerpt: Some(hit.content.clone()),
        retrieved_at: OffsetDateTime::now_utc(),
        effective_at: hit.effective_date,
        revision: hit.revision,
        license_scope,
        content_hash: hit
            .content_hash
            .unwrap_or_else(|| format!("sha256:{}", hex::encode(hash))),
        retrieval_score: hit.score,
        assets,
        content: hit.content,
    }
}

fn collect_qualified_evidence(
    index_name: &str,
    hits: Vec<SearchHit>,
    aircraft_model: Option<&str>,
    limit: usize,
) -> (Vec<Evidence>, Option<String>) {
    let mut seen_hashes = HashSet::new();
    let mut observed_models = BTreeMap::new();
    let evidence = hits
        .into_iter()
        .filter(|hit| {
            !hit.content.trim().is_empty()
                && hit
                    .score
                    .is_some_and(|score| score >= MINIMUM_RETRIEVAL_SCORE)
                && aircraft_model.map_or(true, |requested| {
                    hit.aircraft_model
                        .as_deref()
                        .is_some_and(|candidate| aircraft_models_match(candidate, requested))
                })
        })
        .filter_map(|hit| {
            if let Some(model) = hit
                .aircraft_model
                .as_deref()
                .and_then(normalize_aircraft_model)
            {
                observed_models.insert(compact_aircraft_model(&model), model);
            }
            let evidence = evidence_from_hit(index_name, hit);
            seen_hashes
                .insert(evidence.content_hash.clone())
                .then_some(evidence)
        })
        .take(limit)
        .collect::<Vec<_>>();
    let observed_model = (observed_models.len() == 1)
        .then(|| observed_models.into_values().next())
        .flatten();
    (evidence, observed_model)
}

#[derive(Debug, Deserialize)]
struct FixtureExcerpt {
    document_id: String,
    section: String,
    title: String,
    text: String,
}

pub struct FixtureManualCorpusAdapter;

#[async_trait]
impl ManualCorpusAdapter for FixtureManualCorpusAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: "fixture_manual_corpus".into(),
            health: AdapterHealth::Healthy,
            license: None,
            last_checked: OffsetDateTime::now_utc(),
        }
    }

    async fn search(&self, query: &ManualQuery) -> AdapterResult<ManualSearchResult> {
        let Some(requested_model) = query.aircraft_model.as_deref() else {
            return Ok(ManualSearchResult::empty(
                ManualRetrievalState::ApplicabilityUnknown,
                query,
            ));
        };
        if !aircraft_models_match(requested_model, "CL350") {
            return Ok(ManualSearchResult::empty(
                ManualRetrievalState::ManualAbsent,
                query,
            ));
        }
        let excerpts: Vec<FixtureExcerpt> = serde_json::from_str(FIXTURE_EXCERPTS)
            .map_err(|error| AdapterError::Internal(error.to_string()))?;
        let terms: Vec<String> = query
            .text
            .split_whitespace()
            .map(str::to_ascii_lowercase)
            .collect();
        let evidence = excerpts
            .into_iter()
            .filter(|item| {
                let haystack = format!("{} {}", item.title, item.text).to_ascii_lowercase();
                terms.is_empty() || terms.iter().any(|term| haystack.contains(term))
            })
            .take(query.limit.unwrap_or(8) as usize)
            .map(|item| {
                let mut evidence = evidence_from_hit(
                    "fixture",
                    SearchHit {
                        score: Some(0.72),
                        id: item.section,
                        document_id: item.document_id,
                        content: item.text,
                        title: None,
                        source_blob: None,
                        aircraft_model: Some("CL350".into()),
                        manual_type: None,
                        ata: query.ata.clone(),
                        revision: None,
                        effective_date: None,
                        content_hash: None,
                        assets_json: None,
                        lineage_state: Some("sanitized_fixture".into()),
                    },
                );
                evidence.title = item.title;
                evidence.source_reference = evidence.source_reference.replacen(
                    "azure-ai-search://fixture/",
                    "fixture://manual_corpus/",
                    1,
                );
                evidence.license_scope = Some("sanitized_fixture".into());
                evidence
            })
            .collect::<Vec<_>>();
        Ok(ManualSearchResult {
            state: if evidence.is_empty() {
                ManualRetrievalState::NoRelevantSection
            } else {
                ManualRetrievalState::VerifiedMatch
            },
            aircraft_model: Some("CL350".into()),
            ata: query.ata.clone(),
            evidence,
        })
    }
}

fn compact_aircraft_model(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

fn normalize_aircraft_model(requested: &str) -> Option<String> {
    let value = requested.trim();
    (!value.is_empty() && value.chars().count() <= 120).then(|| value.to_owned())
}

fn aircraft_models_match(left: &str, right: &str) -> bool {
    let left = compact_aircraft_model(left);
    !left.is_empty() && left == compact_aircraft_model(right)
}

fn odata_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn odata_search_query(value: &str) -> String {
    odata_string(&value.replace('"', " "))
}

fn scoped_manual_filter(base_filter: &str, manual_type: Option<&str>, ata: Option<&str>) -> String {
    let mut filter = base_filter.to_owned();
    if let Some(manual_type) = manual_type.filter(|value| {
        !value.is_empty()
            && value.len() <= 24
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
    }) {
        filter = format!(
            "({filter}) and manual_type eq '{}'",
            odata_string(manual_type)
        );
    }
    if let Some(ata) = ata.filter(|value| {
        (2..=3).contains(&value.len()) && value.chars().all(|character| character.is_ascii_digit())
    }) {
        filter = format!("({filter}) and ata eq '{}'", odata_string(ata));
    }
    filter
}

fn required_env(name: &str) -> AdapterResult<String> {
    std::env::var(name).map_err(|_| AdapterError::NotConfigured {
        reason: format!("{name} is unset"),
    })
}

fn optional_positive_usize(name: &str, fallback: usize) -> AdapterResult<usize> {
    match std::env::var(name) {
        Ok(value) => value
            .trim()
            .parse::<usize>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                AdapterError::InvalidInput(format!("{name} must be a positive integer"))
            }),
        Err(_) => Ok(fallback),
    }
}

fn map_reqwest_error(error: reqwest::Error) -> AdapterError {
    if error.is_timeout() {
        AdapterError::Timeout(error.to_string())
    } else if error.status().is_some_and(|status| status.as_u16() == 429) {
        AdapterError::RateLimited(error.to_string())
    } else {
        AdapterError::Unavailable(error.to_string())
    }
}

#[cfg(test)]
mod contract_tests {
    use super::*;

    #[test]
    fn runtime_contract_accepts_any_https_embedding_release() {
        assert!(validate_runtime_contract(
            "https://mxg-manual-embeddings.internal.example/v1/embeddings",
            EmbeddingsAuth::Bearer,
        )
        .is_ok());
        assert!(validate_runtime_contract(
            "https://another-approved-embedding-service.example/v1/embeddings",
            EmbeddingsAuth::ApiKey,
        )
        .is_ok());
    }

    #[test]
    fn runtime_contract_rejects_insecure_or_wrong_embedding_routes() {
        for endpoint in [
            "http://manual-embeddings/v1/embeddings",
            "https://manual-embeddings.example/embed",
        ] {
            assert!(validate_runtime_contract(endpoint, EmbeddingsAuth::Bearer).is_err());
        }
    }

    #[test]
    fn aircraft_matching_is_generic_and_punctuation_insensitive() {
        for (left, right) in [
            ("CL350", "CL-350"),
            ("Falcon 7X", "falcon-7x"),
            ("G 650", "G650"),
        ] {
            assert!(aircraft_models_match(left, right));
        }
        assert!(!aircraft_models_match("CL350", "CL650"));
        assert_eq!(
            normalize_aircraft_model(" Falcon 8X ").as_deref(),
            Some("Falcon 8X")
        );
    }

    #[test]
    fn explicit_manual_and_ata_scope_are_applied_to_the_search_filter() {
        let base = "source_class eq 'manual' and aircraft_model eq 'CL350'";
        assert_eq!(
            scoped_manual_filter(base, Some("IPC"), Some("11")),
            "((source_class eq 'manual' and aircraft_model eq 'CL350') and manual_type eq 'IPC') and ata eq '11'"
        );
        assert_eq!(
            scoped_manual_filter(base, Some("UNKNOWN"), Some("not-an-ata")),
            "(source_class eq 'manual' and aircraft_model eq 'CL350') and manual_type eq 'UNKNOWN'"
        );
        assert_eq!(
            scoped_manual_filter(base, Some("SPM"), Some("20")),
            "((source_class eq 'manual' and aircraft_model eq 'CL350') and manual_type eq 'SPM') and ata eq '20'"
        );
        assert_eq!(
            scoped_manual_filter(base, Some("NDT"), Some("01")),
            "((source_class eq 'manual' and aircraft_model eq 'CL350') and manual_type eq 'NDT') and ata eq '01'"
        );
    }

    #[test]
    fn relevance_gate_rejects_weak_and_wrong_aircraft_hits_then_deduplicates() {
        fn hit(id: &str, document_id: &str, model: &str, score: f32, hash: &str) -> SearchHit {
            SearchHit {
                score: Some(score),
                id: id.into(),
                document_id: document_id.into(),
                content: format!("qualified manual content {id}"),
                title: Some(format!("Manual {id}")),
                source_blob: None,
                aircraft_model: Some(model.into()),
                manual_type: Some("AMM".into()),
                ata: Some("28".into()),
                revision: None,
                effective_date: None,
                content_hash: Some(hash.into()),
                assets_json: None,
                lineage_state: Some("text_only".into()),
            }
        }

        let (evidence, observed_model) = collect_qualified_evidence(
            "manuals-authoritative-v2",
            vec![
                hit("weak", "one", "Falcon 7X", 0.009, "sha256:weak"),
                hit("wrong-model", "two", "Falcon 8X", 0.8, "sha256:model"),
                hit("first", "three", "Falcon-7X", 0.8, "sha256:kept"),
                hit("duplicate", "four", "Falcon 7X", 0.7, "sha256:kept"),
            ],
            Some("Falcon 7X"),
            8,
        );
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].content_hash, "sha256:kept");
        assert_eq!(observed_model.as_deref(), Some("Falcon 7X"));
    }

    #[test]
    fn unscoped_retrieval_infers_only_an_unambiguous_aircraft() {
        fn hit(id: &str, model: &str) -> SearchHit {
            SearchHit {
                score: Some(0.8),
                id: id.into(),
                document_id: format!("doc-{id}"),
                content: format!("manual content for {model}"),
                title: Some(format!("{model} manual")),
                source_blob: None,
                aircraft_model: Some(model.into()),
                manual_type: Some("AMM".into()),
                ata: None,
                revision: None,
                effective_date: None,
                content_hash: Some(format!("sha256:{id}")),
                assets_json: None,
                lineage_state: Some("text_only".into()),
            }
        }

        let (_, one_model) = collect_qualified_evidence(
            "catalog",
            vec![hit("one", "G 650"), hit("two", "G650")],
            None,
            8,
        );
        assert_eq!(one_model.as_deref(), Some("G650"));

        let (_, mixed_models) = collect_qualified_evidence(
            "catalog",
            vec![hit("one", "Falcon 7X"), hit("two", "Global 7500")],
            None,
            8,
        );
        assert!(mixed_models.is_none());
    }
}
