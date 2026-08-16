use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
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
const MANUAL_PACK_MANIFEST: &str =
    include_str!("../../../config/authoritative-manual-pack-v1.json");
const SEARCH_API_VERSION: &str = "2024-07-01";
const EMBEDDING_PROBE_TEXT: &str = "MXGenius authoritative manual retrieval readiness probe";
const MINIMUM_RETRIEVAL_SCORE: f32 = 0.01;

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
    aircraft_models: Vec<String>,
    document_ids: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EmbeddingsAuth {
    Bearer,
    ApiKey,
}

impl AzureManualCorpusAdapter {
    pub fn from_env() -> AdapterResult<Self> {
        let manifest: ManualPackManifest =
            serde_json::from_str(MANUAL_PACK_MANIFEST).map_err(|error| {
                AdapterError::Internal(format!("invalid manual pack manifest: {error}"))
            })?;
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
        if document_filter.trim().is_empty() {
            return Err(AdapterError::NotConfigured {
                reason: "MXGENIUS_MANUAL_SEARCH_FILTER must identify authoritative manual records"
                    .into(),
            });
        }
        validate_static_contract(
            &manifest,
            &index_name,
            &embeddings_endpoint,
            &embeddings_model,
            embeddings_auth,
            &pack_id,
        )?;

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
            expected_dimensions: manifest.index_contract.vector_dimensions,
            aircraft_models: manifest.aircraft_models,
            document_ids: manifest
                .manuals
                .into_iter()
                .flat_map(|manual| manual.document_ids)
                .collect(),
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
        let Some(requested_model) = query.aircraft_model.as_deref() else {
            return Ok(ManualSearchResult::empty(
                ManualRetrievalState::ApplicabilityUnknown,
                query,
            ));
        };
        let Some(aircraft_model) = canonical_aircraft_model(requested_model, &self.aircraft_models)
        else {
            return Ok(ManualSearchResult::empty(
                ManualRetrievalState::ManualAbsent,
                query,
            ));
        };
        let vector = self.embed(text).await?;
        let limit = query.limit.unwrap_or(8).clamp(1, 33);
        let candidate_limit = (limit * 3).min(99);
        let approved_documents = self
            .document_ids
            .iter()
            .map(|value| odata_string(value))
            .collect::<Vec<_>>()
            .join(",");
        let base_filter = format!(
            "({}) and aircraft_model eq '{}' and search.in(document_id, '{}', ',')",
            self.document_filter,
            odata_string(&aircraft_model),
            approved_documents
        );
        let filter = query
            .ata
            .as_deref()
            .filter(|ata| {
                (2..=3).contains(&ata.len())
                    && ata.chars().all(|character| character.is_ascii_digit())
            })
            .map_or_else(
                || base_filter.clone(),
                |ata| format!("({base_filter}) and ata eq '{ata}'"),
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

        let evidence = collect_qualified_evidence(
            &self.index_name,
            payload.value,
            &aircraft_model,
            &self.document_ids,
            limit as usize,
        );
        Ok(ManualSearchResult {
            state: if evidence.is_empty() {
                ManualRetrievalState::NoRelevantSection
            } else {
                ManualRetrievalState::VerifiedMatch
            },
            aircraft_model: Some(aircraft_model),
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

#[derive(Debug, Deserialize)]
struct ManualPackManifest {
    pack_id: String,
    aircraft_models: Vec<String>,
    index_contract: ManualIndexContract,
    manuals: Vec<ManifestManual>,
}

#[derive(Debug, Deserialize)]
struct ManifestManual {
    document_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ManualIndexContract {
    index_name: String,
    embedding_service: String,
    embedding_model: String,
    vector_dimensions: usize,
}

fn validate_static_contract(
    manifest: &ManualPackManifest,
    index_name: &str,
    embeddings_endpoint: &str,
    embeddings_model: &str,
    embeddings_auth: EmbeddingsAuth,
    pack_id: &str,
) -> AdapterResult<()> {
    if index_name != manifest.index_contract.index_name {
        return Err(AdapterError::InvalidInput(format!(
            "AZURE_SEARCH_INDEX must be {} for pack {}",
            manifest.index_contract.index_name, manifest.pack_id
        )));
    }
    if embeddings_model != manifest.index_contract.embedding_model {
        return Err(AdapterError::InvalidInput(format!(
            "MXGENIUS_EMBEDDINGS_MODEL must be {} for pack {}",
            manifest.index_contract.embedding_model, manifest.pack_id
        )));
    }
    if pack_id != manifest.pack_id {
        return Err(AdapterError::InvalidInput(format!(
            "MXGENIUS_MANUAL_PACK_ID must be {}",
            manifest.pack_id
        )));
    }
    if embeddings_auth != EmbeddingsAuth::Bearer {
        return Err(AdapterError::InvalidInput(
            "MXGENIUS_EMBEDDINGS_AUTH must be bearer for the private MiniLM service".into(),
        ));
    }
    let endpoint = embeddings_endpoint.trim();
    let expected_endpoint_prefix =
        format!("https://{}.", manifest.index_contract.embedding_service);
    if !endpoint.starts_with(&expected_endpoint_prefix)
        || !endpoint.contains(".internal.")
        || !endpoint.ends_with("/v1/embeddings")
    {
        return Err(AdapterError::InvalidInput(format!(
            "MXGENIUS_EMBEDDINGS_ENDPOINT must use the private {} service and /v1/embeddings",
            manifest.index_contract.embedding_service
        )));
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
    aircraft_model: &str,
    document_ids: &[String],
    limit: usize,
) -> Vec<Evidence> {
    let mut seen_hashes = HashSet::new();
    hits.into_iter()
        .filter(|hit| {
            !hit.content.trim().is_empty()
                && hit
                    .score
                    .is_some_and(|score| score >= MINIMUM_RETRIEVAL_SCORE)
                && hit.aircraft_model.as_deref() == Some(aircraft_model)
                && document_ids.contains(&hit.document_id)
        })
        .map(|hit| evidence_from_hit(index_name, hit))
        .filter(|evidence| seen_hashes.insert(evidence.content_hash.clone()))
        .take(limit)
        .collect()
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
        if canonical_aircraft_model(requested_model, &["CL350".into()]).is_none() {
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

fn canonical_aircraft_model(requested: &str, supported: &[String]) -> Option<String> {
    let compact = requested
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect::<String>();
    supported.iter().find_map(|model| {
        let supported_compact = model
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .flat_map(char::to_uppercase)
            .collect::<String>();
        let matches = compact == supported_compact
            || (supported_compact == "CL350"
                && matches!(compact.as_str(), "CHALLENGER350" | "BD1001A10"));
        matches.then(|| model.clone())
    })
}

fn odata_string(value: &str) -> String {
    value.replace('\'', "''")
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

#[cfg(test)]
mod contract_tests {
    use super::*;

    fn manifest() -> ManualPackManifest {
        serde_json::from_str(MANUAL_PACK_MANIFEST).expect("embedded manual manifest")
    }

    #[test]
    fn frozen_pack_accepts_only_its_minilm_v2_contract() {
        let manifest = manifest();
        assert!(validate_static_contract(
            &manifest,
            "manuals-authoritative-v2",
            "https://mxg-manual-embeddings.internal.example/v1/embeddings",
            "all-MiniLM-L6-v2",
            EmbeddingsAuth::Bearer,
            "mxg-cl350-starter-manuals-v1",
        )
        .is_ok());
    }

    #[test]
    fn frozen_pack_rejects_partial_or_competing_contracts() {
        let manifest = manifest();
        for (index, endpoint, model, auth, pack) in [
            (
                "manuals-authoritative-v1",
                "https://mxg-manual-embeddings.internal.example/v1/embeddings",
                "all-MiniLM-L6-v2",
                EmbeddingsAuth::Bearer,
                "mxg-cl350-starter-manuals-v1",
            ),
            (
                "manuals-authoritative-v2",
                "https://api.openai.com/v1/embeddings",
                "all-MiniLM-L6-v2",
                EmbeddingsAuth::Bearer,
                "mxg-cl350-starter-manuals-v1",
            ),
            (
                "manuals-authoritative-v2",
                "http://manual-embeddings/v1/embeddings",
                "all-MiniLM-L6-v2",
                EmbeddingsAuth::Bearer,
                "mxg-cl350-starter-manuals-v1",
            ),
            (
                "manuals-authoritative-v2",
                "https://mxg-manual-embeddings.internal.example/v1/embeddings",
                "all-MiniLM-L6-v2",
                EmbeddingsAuth::ApiKey,
                "mxg-cl350-starter-manuals-v1",
            ),
            (
                "manuals-authoritative-v2",
                "https://mxg-manual-embeddings.internal.example/v1/embeddings",
                "all-MiniLM-L6-v2",
                EmbeddingsAuth::Bearer,
                "another-pack",
            ),
        ] {
            assert!(
                validate_static_contract(&manifest, index, endpoint, model, auth, pack).is_err()
            );
        }
    }

    #[test]
    fn model_aliases_resolve_only_to_the_frozen_pack() {
        let supported = vec!["CL350".to_string()];
        for alias in ["CL350", "CL-350", "Challenger 350", "BD-100-1A10"] {
            assert_eq!(
                canonical_aircraft_model(alias, &supported).as_deref(),
                Some("CL350")
            );
        }
        assert_eq!(canonical_aircraft_model("Global 6000", &supported), None);
    }

    #[test]
    fn relevance_gate_rejects_weak_wrong_aircraft_and_unapproved_hits_then_deduplicates() {
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

        let approved = vec!["approved".to_string()];
        let evidence = collect_qualified_evidence(
            "manuals-authoritative-v2",
            vec![
                hit("weak", "approved", "CL350", 0.009, "sha256:weak"),
                hit("wrong-model", "approved", "CL650", 0.8, "sha256:model"),
                hit("wrong-doc", "other", "CL350", 0.8, "sha256:doc"),
                hit("first", "approved", "CL350", 0.8, "sha256:kept"),
                hit("duplicate", "approved", "CL350", 0.7, "sha256:kept"),
            ],
            "CL350",
            &approved,
            8,
        );
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].content_hash, "sha256:kept");
    }
}
