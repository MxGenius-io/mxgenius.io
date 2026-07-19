use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::adapters::manual::{ManualCorpusAdapter, ManualQuery};
use mxgenius_shared::adapters::source::{AdapterError, AdapterHealth, AdapterResult, SourceInfo};
use mxgenius_shared::domain::evidence::{Evidence, EvidenceAsset, EvidenceKind, SourceType};
use mxgenius_shared::domain::ids::EvidenceId;

const EVIDENCE_NAMESPACE: &str = "3a4c5b6c-2c7e-4f47-9a3e-2a2a2a2a2a2a";
const FIXTURE_EXCERPTS: &str = include_str!("../../../fixtures/manual_corpus/excerpts.json");

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
}

#[derive(Clone, Copy)]
enum EmbeddingsAuth {
    Bearer,
    ApiKey,
}

impl AzureManualCorpusAdapter {
    pub fn from_env() -> AdapterResult<Self> {
        let search_endpoint = required_env("AZURE_SEARCH_ENDPOINT")?;
        let search_key = required_env("AZURE_SEARCH_KEY")?;
        let embeddings_key = std::env::var("MXGENIUS_EMBEDDINGS_API_KEY")
            .or_else(|_| std::env::var("OPENAI_API_KEY"))
            .map_err(|_| AdapterError::NotConfigured {
                reason: "MXGENIUS_EMBEDDINGS_API_KEY or OPENAI_API_KEY is unset".into(),
            })?;
        let embeddings_endpoint = std::env::var("MXGENIUS_EMBEDDINGS_ENDPOINT")
            .unwrap_or_else(|_| "https://api.openai.com/v1/embeddings".into());
        let embeddings_auth = match std::env::var("MXGENIUS_EMBEDDINGS_AUTH")
            .unwrap_or_else(|_| "bearer".into())
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
        let document_filter = required_env("MXGENIUS_MANUAL_SEARCH_FILTER")?;
        if document_filter.trim().is_empty() {
            return Err(AdapterError::NotConfigured {
                reason: "MXGENIUS_MANUAL_SEARCH_FILTER must identify authoritative manual records"
                    .into(),
            });
        }

        Ok(Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|error| AdapterError::Internal(error.to_string()))?,
            search_endpoint: search_endpoint.trim_end_matches('/').into(),
            search_key,
            index_name: std::env::var("AZURE_SEARCH_INDEX")
                .unwrap_or_else(|_| "manuals-authoritative-v1".into()),
            embeddings_endpoint,
            embeddings_key,
            embeddings_model: std::env::var("MXGENIUS_EMBEDDINGS_MODEL")
                .unwrap_or_else(|_| "text-embedding-3-small".into()),
            embeddings_auth,
            document_filter,
        })
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
        Ok(vector)
    }
}

#[async_trait]
impl ManualCorpusAdapter for AzureManualCorpusAdapter {
    async fn source_info(&self) -> SourceInfo {
        SourceInfo {
            name: format!("azure_ai_search:{}", self.index_name),
            health: AdapterHealth::Healthy,
            license: None,
            last_checked: OffsetDateTime::now_utc(),
        }
    }

    async fn search(&self, query: &ManualQuery) -> AdapterResult<Vec<Evidence>> {
        let text = query.text.trim();
        if text.is_empty() {
            return Err(AdapterError::InvalidInput(
                "manual query text is blank".into(),
            ));
        }
        let vector = self.embed(text).await?;
        let limit = query.limit.unwrap_or(8).clamp(1, 25);
        let candidate_limit = (limit * 3).min(75);
        let url = format!(
            "{}/indexes/{}/docs/search?api-version=2023-11-01",
            self.search_endpoint, self.index_name
        );
        let response = self
            .http
            .post(url)
            .header("api-key", &self.search_key)
            .json(&json!({
                "vectorQueries": [{
                    "vector": vector,
                    "k": candidate_limit,
                    "fields": "content_vector",
                    "kind": "vector"
                }],
                "select": "id,document_id,content,title,source_blob,revision,effective_date,content_hash,assets_json,lineage_state",
                "filter": self.document_filter,
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

        let mut seen_hashes = HashSet::new();
        Ok(payload
            .value
            .into_iter()
            .filter(|hit| !hit.content.trim().is_empty())
            .map(|hit| evidence_from_hit(&self.index_name, hit))
            .filter(|evidence| seen_hashes.insert(evidence.content_hash.clone()))
            .take(limit as usize)
            .collect())
    }
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    #[serde(default)]
    data: Vec<EmbeddingItem>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingItem {
    #[serde(default)]
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    value: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    id: String,
    document_id: String,
    content: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    source_blob: Option<String>,
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
    let license_scope = hit
        .lineage_state
        .map(|state| format!("manual_corpus;lineage={state}"));
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
        assets,
        content: hit.content,
    }
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

    async fn search(&self, query: &ManualQuery) -> AdapterResult<Vec<Evidence>> {
        let excerpts: Vec<FixtureExcerpt> = serde_json::from_str(FIXTURE_EXCERPTS)
            .map_err(|error| AdapterError::Internal(error.to_string()))?;
        let terms: Vec<String> = query
            .text
            .split_whitespace()
            .map(str::to_ascii_lowercase)
            .collect();
        Ok(excerpts
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
                        id: item.section,
                        document_id: item.document_id,
                        content: item.text,
                        title: None,
                        source_blob: None,
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
            .collect())
    }
}

fn required_env(name: &str) -> AdapterResult<String> {
    std::env::var(name).map_err(|_| AdapterError::NotConfigured {
        reason: format!("{name} is unset"),
    })
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
