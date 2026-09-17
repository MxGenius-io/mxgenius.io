//! Azure-backed authoritative manual library export for Equipment Drives.
//!
//! Search remains the source of flattened text while Blob Storage is the
//! source of page-linked figures. The export contract is compiled from that
//! catalog at publication time, so aircraft and manual membership are data,
//! not application constants.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Write};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::corpus_release::{compile_release_manifest, ReleaseFile, EDGE_DRIVE_PROFILE};
use super::equipment_packs::{validate_pack_path, EQUIPMENT_PACK_MAX_BYTES};
use crate::manual_catalog::canonical_aircraft_model as canonical_catalog_aircraft_model;

const SEARCH_API_VERSION: &str = "2024-07-01";
const SEARCH_PAGE_SIZE: usize = 1_000;
const MAX_SEARCH_RECORDS_PER_AIRCRAFT: usize = 100_000;
const MAX_ASSET_BYTES: usize = 20 * 1024 * 1024;
const IMAGE_REGISTER_CANDIDATE_LIMIT: usize = 50;
const RELEASE_PROFILE: &str = EDGE_DRIVE_PROFILE;

#[derive(Debug, thiserror::Error)]
pub enum ManualLibraryError {
    #[error("manual library is not configured: {0}")]
    NotConfigured(&'static str),
    #[error("manual library contract is invalid: {0}")]
    Contract(String),
    #[error("manual library source is unavailable: {0}")]
    Unavailable(String),
    #[error("manual library payload is invalid: {0}")]
    Invalid(String),
}

#[derive(Clone)]
pub struct AzureManualLibrary {
    http: Client,
    search_endpoint: String,
    search_key: String,
    index_name: String,
    asset_origin: String,
    asset_sas: String,
    pack_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualDriveSummary {
    pub profile: String,
    pub pack_id: String,
    pub index_name: String,
    pub aircraft_count: usize,
    pub manual_count: usize,
    pub source_file_count: usize,
    pub chunk_count: usize,
    pub image_count: usize,
    pub content_set_hash: String,
    pub manuals: Vec<ReleaseManualSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManualSummary {
    pub id: String,
    pub display_name: String,
    pub manual_type: String,
    pub aircraft_models: Vec<String>,
    pub chunk_count: usize,
    pub source_file_count: usize,
}

pub struct ManualDriveArchive {
    pub bytes: Vec<u8>,
    pub manifest: Value,
    pub content_hash: String,
    pub file_count: i32,
    pub summary: ManualDriveSummary,
}

pub struct ManualAssetBytes {
    pub bytes: Vec<u8>,
    pub media_type: String,
}

/// Data-derived metadata that maps an image-directed request to one verified
/// Blob asset without invoking the embedding service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualImageRegisterEntry {
    pub manual_id: String,
    pub register_id: String,
    pub record_id: String,
    pub document_id: String,
    pub title: String,
    pub ata: String,
    pub section: String,
    pub page: u32,
    pub asset_id: String,
    pub caption: String,
    pub description: String,
    #[serde(default)]
    pub task_numbers: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    pub source_reference: String,
    pub media_type: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchHit {
    #[serde(rename = "@search.score", default)]
    score: Option<f32>,
    id: String,
    document_id: String,
    content: String,
    content_hash: String,
    source_name: String,
    title: String,
    manual_type: Option<String>,
    aircraft_model: Option<String>,
    ata: Option<String>,
    section: Option<String>,
    #[serde(default)]
    assets_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(rename = "@odata.count")]
    count: Option<usize>,
    #[serde(default)]
    value: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchFacet {
    value: Option<String>,
    count: usize,
}

#[derive(Debug, Deserialize)]
struct FacetResponse {
    #[serde(rename = "@odata.count")]
    count: Option<usize>,
    #[serde(rename = "@search.facets", default)]
    facets: BTreeMap<String, Vec<SearchFacet>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchAsset {
    asset_id: String,
    kind: String,
    source_reference: String,
    media_type: String,
    page: Option<u32>,
    caption: String,
    content_hash: String,
    availability: String,
    #[serde(default)]
    size_bytes: Option<usize>,
    #[serde(default)]
    verified: bool,
    #[serde(default)]
    register_id: Option<String>,
    #[serde(default)]
    task_numbers: Vec<String>,
    #[serde(default)]
    keywords: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum SearchAssetsPayload {
    One(Box<SearchAsset>),
    Many(Vec<SearchAsset>),
}

#[derive(Debug)]
struct DriveFile {
    path: String,
    bytes: Vec<u8>,
}

impl AzureManualLibrary {
    pub fn from_env(http: Client) -> Result<Option<Self>, ManualLibraryError> {
        let configured = [
            "AZURE_SEARCH_ENDPOINT",
            "AZURE_SEARCH_KEY",
            "AZURE_SEARCH_INDEX",
            "MXGENIUS_MANUAL_PACK_ID",
            "MXGENIUS_MANUAL_ASSET_ORIGIN",
            "MXGENIUS_MANUAL_ASSET_SAS",
        ]
        .iter()
        .any(|name| std::env::var(name).is_ok());
        if !configured {
            return Ok(None);
        }

        let search_endpoint = required_env("AZURE_SEARCH_ENDPOINT")?;
        let search_key = required_env("AZURE_SEARCH_KEY")?;
        let index_name = required_env("AZURE_SEARCH_INDEX")?;
        let pack_id = required_env("MXGENIUS_MANUAL_PACK_ID")?;
        let asset_origin = required_env("MXGENIUS_MANUAL_ASSET_ORIGIN")?;
        let asset_sas = required_env("MXGENIUS_MANUAL_ASSET_SAS")?.replace("%26", "&");
        Ok(Some(Self {
            http,
            search_endpoint: search_endpoint.trim_end_matches('/').into(),
            search_key,
            index_name,
            asset_origin: asset_origin.trim_end_matches('/').into(),
            asset_sas,
            pack_id,
        }))
    }

    pub fn pack_id(&self) -> &str {
        &self.pack_id
    }

    /// Resolve a specific visual with a bounded lexical Search lookup. This
    /// path uses the release's own aircraft and asset metadata and never calls
    /// the embedding service.
    pub async fn lookup_registered_image(
        &self,
        query: &str,
        aircraft_model: Option<&str>,
    ) -> Result<Option<ManualImageRegisterEntry>, ManualLibraryError> {
        lookup_registered_image(self, query, aircraft_model).await
    }

    pub async fn export_drive(&self) -> Result<ManualDriveArchive, ManualLibraryError> {
        self.export_drive_scope(None).await
    }

    /// Compile one aircraft family for an Equipment Drive. This keeps the
    /// physical A/B package bounded while the model-facing Search index can
    /// retain the complete multi-aircraft catalog.
    pub async fn export_drive_for_aircraft(
        &self,
        aircraft_model: &str,
    ) -> Result<ManualDriveArchive, ManualLibraryError> {
        let model = aircraft_model.trim();
        if model.is_empty() || model.chars().count() > 120 {
            return Err(ManualLibraryError::Invalid(
                "Equipment Drive aircraft family is invalid".into(),
            ));
        }
        self.export_drive_scope(Some(model)).await
    }

    async fn export_drive_scope(
        &self,
        aircraft_model: Option<&str>,
    ) -> Result<ManualDriveArchive, ManualLibraryError> {
        let mut hits = self.search_records(aircraft_model).await?;
        hits.sort_by_key(|hit| natural_chunk_key(&hit.id));
        let content_set_hash = self.validate_content_set(&hits)?;
        let (manuals, manual_ids) = release_manual_catalog(&hits);
        let mut files = Vec::new();
        let mut sources = BTreeMap::<(String, String), Vec<&SearchHit>>::new();
        let mut assets = BTreeMap::<String, SearchAsset>::new();
        for hit in &hits {
            sources
                .entry((hit.document_id.clone(), hit.source_name.clone()))
                .or_default()
                .push(hit);
            for asset in parse_assets(hit)? {
                if asset.availability == "available" {
                    assets.entry(asset.content_hash.clone()).or_insert(asset);
                }
            }
        }

        for ((document_id, source_name), mut chunks) in sources.clone() {
            chunks.sort_by_key(|hit| natural_chunk_key(&hit.id));
            let fallback_id = chunks[0].id.clone();
            let manual_id = manual_ids.get(&document_id).ok_or_else(|| {
                ManualLibraryError::Invalid(format!(
                    "source {source_name} has no generated manual identity"
                ))
            })?;
            let manual = manuals
                .iter()
                .find(|manual| &manual.id == manual_id)
                .ok_or_else(|| {
                    ManualLibraryError::Invalid("manual catalog is incomplete".into())
                })?;
            let mut body = format!(
                "# {}\n\nSource: {}\nManual type: {}\nCurrency: {} — {}\n\n",
                manual.display_name,
                source_name,
                manual.manual_type,
                "unverified",
                "revision and effective-date metadata were not supplied by the source"
            );
            for hit in chunks {
                body.push_str(&format!(
                    "## {}\n\n{}\n\n<!-- chunk={} hash={} -->\n\n",
                    hit.title, hit.content, hit.id, hit.content_hash
                ));
            }
            files.push(DriveFile {
                path: format!(
                    "LIBRARY/{}/{}",
                    manual_id,
                    safe_source_path(&source_name, &fallback_id)
                ),
                bytes: body.into_bytes(),
            });
        }

        let image_map = assets
            .values()
            .map(|asset| {
                json!({
                    "assetId": asset.asset_id,
                    "kind": asset.kind,
                    "sourceReference": asset.source_reference,
                    "path": asset_drive_path(&asset.source_reference),
                    "mediaType": asset.media_type,
                    "page": asset.page,
                    "caption": asset.caption,
                    "contentHash": asset.content_hash,
                    "sizeBytes": asset.size_bytes
                })
            })
            .collect::<Vec<_>>();

        let mut chunk_index = Vec::new();
        for hit in &hits {
            let local_images = parse_assets(hit)?
                .into_iter()
                .filter(|asset| asset.availability == "available")
                .map(|asset| {
                    json!({
                        "path": asset_drive_path(&asset.source_reference),
                        "page": asset.page,
                        "caption": asset.caption,
                        "contentHash": asset.content_hash
                    })
                })
                .collect::<Vec<_>>();
            let line = json!({
                "id": hit.id,
                "documentId": hit.document_id,
                "source": hit.source_name,
                "title": hit.title,
                "manualType": hit.manual_type,
                "ata": hit.ata,
                "section": hit.section,
                "contentHash": hit.content_hash,
                "images": local_images,
                "content": hit.content
            });
            serde_json::to_writer(&mut chunk_index, &line)
                .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?;
            chunk_index.push(b'\n');
        }
        files.push(DriveFile {
            path: "INDEX/chunks.jsonl".into(),
            bytes: chunk_index,
        });
        files.push(DriveFile {
            path: "INDEX/image-map.json".into(),
            bytes: serde_json::to_vec_pretty(&image_map)
                .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?,
        });
        let release_manifest = json!({
            "schemaVersion": 2,
            "profile": RELEASE_PROFILE,
            "releaseId": self.pack_id,
            "indexName": self.index_name,
            "contentSetHash": content_set_hash,
            "currencyPolicy": {
                "state": "unverified",
                "reason": "Revision and effective-date metadata were not supplied by the source."
            },
            "manuals": manuals.clone()
        });
        files.push(DriveFile {
            path: "MXG/manual-pack.json".into(),
            bytes: serde_json::to_vec_pretty(&release_manifest)
                .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?,
        });
        files.push(DriveFile {
            path: "README.TXT".into(),
            bytes: format!(
                "MXGenius Technical Library\r\nRelease: {}\r\n\r\nThis drive was compiled from the same versioned manual records used by MXGenius model retrieval. Linked figures are content-addressed in IMAGES and mapped in INDEX/image-map.json. Manual currency is unverified when revision metadata is absent.\r\n",
                self.pack_id
            )
            .into_bytes(),
        });

        let archive_overhead = (files.len() + assets.len()).saturating_mul(1_024);
        let mut staged_bytes = files
            .iter()
            .map(|file| file.bytes.len())
            .sum::<usize>()
            .saturating_add(archive_overhead);
        let maximum_archive_bytes = usize::try_from(EQUIPMENT_PACK_MAX_BYTES).map_err(|_| {
            ManualLibraryError::Invalid("Equipment Drive size limit is invalid".into())
        })?;
        if assets.values().all(|asset| asset.size_bytes.is_some()) {
            let projected_bytes = staged_bytes.saturating_add(
                assets
                    .values()
                    .filter_map(|asset| asset.size_bytes)
                    .sum::<usize>(),
            );
            if projected_bytes > maximum_archive_bytes {
                return Err(ManualLibraryError::Contract(
                    "this aircraft library exceeds the 2 GiB Equipment Drive limit; publish a narrower equipment family"
                        .into(),
                ));
            }
        }
        for asset in assets.values() {
            let remaining_bytes = maximum_archive_bytes.saturating_sub(staged_bytes);
            if remaining_bytes == 0 {
                return Err(ManualLibraryError::Contract(
                    "this aircraft library exceeds the 2 GiB Equipment Drive limit; publish a narrower equipment family"
                        .into(),
                ));
            }
            let fetched = self
                .fetch_asset(
                    &asset.source_reference,
                    &asset.content_hash,
                    Some(&asset.media_type),
                    MAX_ASSET_BYTES.min(remaining_bytes),
                )
                .await?;
            staged_bytes = staged_bytes.saturating_add(fetched.bytes.len());
            files.push(DriveFile {
                path: asset_drive_path(&asset.source_reference),
                bytes: fetched.bytes,
            });
        }

        let aircraft_count = hits
            .iter()
            .filter_map(|hit| hit.aircraft_model.as_deref())
            .collect::<BTreeSet<_>>()
            .len();
        let summary = ManualDriveSummary {
            profile: RELEASE_PROFILE.into(),
            pack_id: self.pack_id.clone(),
            index_name: self.index_name.clone(),
            aircraft_count,
            manual_count: manuals.len(),
            source_file_count: sources.len(),
            chunk_count: hits.len(),
            image_count: assets.len(),
            content_set_hash,
            manuals,
        };
        files.push(DriveFile {
            path: "MXG/export.json".into(),
            bytes: serde_json::to_vec_pretty(&summary)
                .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?,
        });
        build_archive(files, summary)
    }

    pub async fn fetch_asset(
        &self,
        source_reference: &str,
        expected_hash: &str,
        declared_media_type: Option<&str>,
        maximum_bytes: usize,
    ) -> Result<ManualAssetBytes, ManualLibraryError> {
        let path = source_reference
            .strip_prefix("azure-blob://")
            .filter(|path| {
                path.starts_with("documents/manual-assets/legacy-rag/")
                    && !path.contains("..")
                    && !path.contains('\\')
                    && !path.contains('?')
                    && !path.contains('#')
            })
            .ok_or_else(|| {
                ManualLibraryError::Invalid("manual image reference is outside the pack".into())
            })?;
        let url = format!(
            "{}/{}?{}",
            self.asset_origin,
            path,
            self.asset_sas.trim_start_matches('?')
        );
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| ManualLibraryError::Unavailable("manual image request failed".into()))?
            .error_for_status()
            .map_err(|_| ManualLibraryError::Unavailable("manual image was rejected".into()))?;
        if response
            .content_length()
            .is_some_and(|length| length == 0 || length > maximum_bytes as u64)
        {
            return Err(ManualLibraryError::Invalid(
                "manual image is outside the allowed size".into(),
            ));
        }
        let response_media_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::to_owned);
        let media_type = declared_media_type
            .filter(|value| matches!(*value, "image/jpeg" | "image/png" | "image/webp"))
            .map(str::to_owned)
            .or(response_media_type)
            .filter(|value| matches!(value.as_str(), "image/jpeg" | "image/png" | "image/webp"))
            .ok_or_else(|| ManualLibraryError::Invalid("manual asset is not an image".into()))?;
        let bytes = response
            .bytes()
            .await
            .map_err(|_| ManualLibraryError::Unavailable("manual image read failed".into()))?;
        if bytes.is_empty() || bytes.len() > maximum_bytes {
            return Err(ManualLibraryError::Invalid(
                "manual image is outside the allowed size".into(),
            ));
        }
        let observed_hash = sha256_prefixed(&bytes);
        if observed_hash != expected_hash {
            return Err(ManualLibraryError::Invalid(format!(
                "manual image hash mismatch for {source_reference}"
            )));
        }
        Ok(ManualAssetBytes {
            bytes: bytes.to_vec(),
            media_type,
        })
    }

    async fn search_records(
        &self,
        aircraft_scope: Option<&str>,
    ) -> Result<Vec<SearchHit>, ManualLibraryError> {
        let url = format!(
            "{}/indexes/{}/docs/search?api-version={SEARCH_API_VERSION}",
            self.search_endpoint, self.index_name
        );
        let facet_response = self
            .http
            .post(&url)
            .header("api-key", &self.search_key)
            .json(&json!({
                "search": "*",
                "filter": "source_class eq 'manual'",
                "count": true,
                "top": 0,
                "facets": ["aircraft_model,count:1000"]
            }))
            .send()
            .await
            .map_err(|error| ManualLibraryError::Unavailable(error.to_string()))?
            .error_for_status()
            .map_err(|error| ManualLibraryError::Unavailable(error.to_string()))?
            .json::<FacetResponse>()
            .await
            .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?;
        let mut aircraft = facet_response
            .facets
            .get("aircraft_model")
            .into_iter()
            .flatten()
            .filter_map(|facet| {
                facet
                    .value
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
            })
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if aircraft.is_empty() {
            return Err(ManualLibraryError::Invalid(
                "manual Search contains no aircraft catalog".into(),
            ));
        }
        let faceted_count = facet_response
            .facets
            .get("aircraft_model")
            .into_iter()
            .flatten()
            .map(|facet| facet.count)
            .sum::<usize>();
        if facet_response
            .count
            .is_some_and(|count| count != faceted_count)
        {
            return Err(ManualLibraryError::Invalid(
                "manual Search contains records without an aircraft identity".into(),
            ));
        }
        if let Some(scope) = aircraft_scope {
            let normalized_scope = compact_match_text(&canonical_catalog_aircraft_model(scope));
            aircraft.retain(|model| compact_match_text(model) == normalized_scope);
            if aircraft.is_empty() {
                return Err(ManualLibraryError::Contract(format!(
                    "the manual catalog has no aircraft family matching {scope}"
                )));
            }
        }

        let mut records = Vec::new();
        for model in aircraft {
            let filter = format!(
                "source_class eq 'manual' and aircraft_model eq '{}'",
                odata_string(&model)
            );
            let mut model_records = Vec::new();
            let mut expected = None;
            while model_records.len() < MAX_SEARCH_RECORDS_PER_AIRCRAFT {
                let response = self
                    .http
                    .post(&url)
                    .header("api-key", &self.search_key)
                    .json(&json!({
                        "search": "*",
                        "filter": filter,
                        "count": model_records.is_empty(),
                        "top": SEARCH_PAGE_SIZE,
                        "skip": model_records.len(),
                        "select": "id,document_id,content,content_hash,source_name,title,aircraft_model,manual_type,ata,section,assets_json"
                    }))
                    .send()
                    .await
                    .map_err(|error| ManualLibraryError::Unavailable(error.to_string()))?
                    .error_for_status()
                    .map_err(|error| ManualLibraryError::Unavailable(error.to_string()))?;
                let page: SearchResponse = response
                    .json()
                    .await
                    .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?;
                expected = expected.or(page.count);
                let page_size = page.value.len();
                model_records.extend(page.value);
                if page_size < SEARCH_PAGE_SIZE {
                    break;
                }
            }
            if model_records.len() >= MAX_SEARCH_RECORDS_PER_AIRCRAFT
                || expected.is_some_and(|count| count != model_records.len())
            {
                return Err(ManualLibraryError::Invalid(format!(
                    "manual Search pagination did not return the complete {model} catalog"
                )));
            }
            records.extend(model_records);
        }
        if aircraft_scope.is_none()
            && facet_response
                .count
                .is_some_and(|count| count != records.len())
        {
            return Err(ManualLibraryError::Invalid(
                "manual Search pagination did not return the complete catalog".into(),
            ));
        }
        Ok(records)
    }

    fn validate_content_set(&self, hits: &[SearchHit]) -> Result<String, ManualLibraryError> {
        if hits.is_empty() {
            return Err(ManualLibraryError::Contract(
                "manual catalog contains no chunks".into(),
            ));
        }
        let mut ids = BTreeSet::new();
        let mut content_lines = Vec::with_capacity(hits.len());
        for hit in hits {
            if !ids.insert(hit.id.as_str())
                || hit.document_id.trim().is_empty()
                || hit.source_name.trim().is_empty()
                || hit
                    .aircraft_model
                    .as_deref()
                    .map_or(true, |value| value.is_empty())
                || hit.content.trim().is_empty()
            {
                return Err(ManualLibraryError::Contract(format!(
                    "manual chunk {} has incomplete or duplicate identity metadata",
                    hit.id
                )));
            }
            let observed_hash = sha256_prefixed(hit.content.as_bytes());
            if observed_hash != hit.content_hash {
                return Err(ManualLibraryError::Contract(format!(
                    "manual chunk {} has a content hash mismatch",
                    hit.id
                )));
            }
            for asset in parse_assets(hit)? {
                validate_search_asset(&asset)?;
            }
            content_lines.push(format!("{}|{}", hit.id, hit.content_hash));
        }
        content_lines.sort();
        Ok(sha256_prefixed(content_lines.join("\n").as_bytes()))
    }
}

fn required_env(name: &'static str) -> Result<String, ManualLibraryError> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or(ManualLibraryError::NotConfigured(name))
}

async fn lookup_registered_image(
    library: &AzureManualLibrary,
    query: &str,
    aircraft_model: Option<&str>,
) -> Result<Option<ManualImageRegisterEntry>, ManualLibraryError> {
    let Some(model) = aircraft_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let catalog_model = canonical_catalog_aircraft_model(model);
    let query_normalized = normalized_match_text(query);
    let query_tokens = query_normalized.split_whitespace().collect::<BTreeSet<_>>();
    if ![
        "show",
        "view",
        "display",
        "open",
        "render",
        "produce",
        "image",
        "figure",
        "diagram",
        "drawing",
        "illustration",
    ]
    .iter()
    .any(|token| query_tokens.contains(token))
    {
        return Ok(None);
    }
    let query_terms = meaningful_terms(&query_normalized);
    if query_terms.is_empty() {
        return Ok(None);
    }
    // Search only the current turn's technical topic words. Conversational
    // framing and active-case context are useful to the model, but they make a
    // deterministic image-register lookup less precise and can displace the
    // verified record from the bounded candidate window.
    let search_text = query_terms.iter().cloned().collect::<Vec<_>>().join(" ");
    let url = format!(
        "{}/indexes/{}/docs/search?api-version={SEARCH_API_VERSION}",
        library.search_endpoint, library.index_name
    );
    let response = library
        .http
        .post(url)
        .header("api-key", &library.search_key)
        .json(&json!({
            "search": search_text,
            "searchFields": "title,section,content,aircraft_model",
            "filter": format!(
                "source_class eq 'manual' and search.ismatch('{}', 'aircraft_model', 'simple', 'all')",
                odata_search_query(&catalog_model)
            ),
            "top": IMAGE_REGISTER_CANDIDATE_LIMIT,
            "select": "id,document_id,content,content_hash,source_name,title,aircraft_model,manual_type,ata,section,assets_json"
        }))
        .send()
        .await
        .map_err(|error| ManualLibraryError::Unavailable(error.to_string()))?
        .error_for_status()
        .map_err(|error| ManualLibraryError::Unavailable(error.to_string()))?
        .json::<SearchResponse>()
        .await
        .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?;

    let mut matches = Vec::new();
    for hit in response.value {
        if !hit.aircraft_model.as_deref().is_some_and(|candidate| {
            compact_match_text(candidate) == compact_match_text(&catalog_model)
        }) {
            continue;
        }
        for asset in parse_assets(&hit)? {
            if asset.availability != "available" {
                continue;
            }
            validate_search_asset(&asset)?;
            // Search chunks can span several source pages. Restrict the
            // generic fallback to the asset's own title, section, and caption
            // so nearby task text cannot falsely rename an unrelated figure.
            let candidate_text = normalized_match_text(&format!(
                "{} {} {}",
                hit.title,
                hit.section.as_deref().unwrap_or_default(),
                asset.caption
            ));
            let term_hits = query_terms
                .iter()
                .filter(|term| candidate_text.contains(term.as_str()))
                .count();
            let verified_score = verified_asset_match_score(
                &query_normalized,
                &query_terms,
                &asset.task_numbers,
                &asset.keywords,
            );
            if (asset.verified && verified_score == 0)
                || (!asset.verified && (term_hits < 2 || term_hits * 4 < query_terms.len() * 3))
            {
                continue;
            }
            let score = (
                if asset.verified {
                    10_000 + verified_score
                } else {
                    term_hits
                },
                hit.score.unwrap_or_default().to_bits(),
            );
            let entry = ManualImageRegisterEntry {
                manual_id: hit.document_id.clone(),
                register_id: asset
                    .register_id
                    .clone()
                    .unwrap_or_else(|| asset.asset_id.clone()),
                record_id: hit.id.clone(),
                document_id: hit.document_id.clone(),
                title: hit.title.clone(),
                ata: hit.ata.clone().unwrap_or_else(|| "unknown".into()),
                section: hit
                    .section
                    .clone()
                    .unwrap_or_else(|| "Manual figure".into()),
                page: asset.page.unwrap_or_default(),
                asset_id: asset.asset_id,
                caption: asset.caption,
                description: truncate_text(&hit.content, 1_200),
                task_numbers: asset.task_numbers,
                keywords: asset.keywords,
                source_reference: asset.source_reference,
                media_type: asset.media_type,
                content_hash: asset.content_hash,
            };
            matches.push((score, entry));
        }
    }
    matches.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .cmp(left_score)
            .then_with(|| left.register_id.cmp(&right.register_id))
    });
    let Some((best_score, best)) = matches.first() else {
        return Ok(None);
    };
    if matches
        .get(1)
        .is_some_and(|(next_score, _)| next_score == best_score)
    {
        return Ok(None);
    }
    Ok(Some(best.clone()))
}

fn verified_asset_match_score(
    query_normalized: &str,
    query_terms: &BTreeSet<String>,
    task_numbers: &[String],
    keywords: &[String],
) -> usize {
    let query_compact = compact_match_text(query_normalized);
    let task_score = task_numbers
        .iter()
        .filter(|task| query_compact.contains(&compact_match_text(task)))
        .map(|task| 1_000 + meaningful_terms(&normalized_match_text(task)).len())
        .max()
        .unwrap_or_default();
    let keyword_score = keywords
        .iter()
        .filter_map(|keyword| {
            let terms = meaningful_terms(&normalized_match_text(keyword));
            (terms.len() >= 2 && terms.iter().all(|term| query_terms.contains(term)))
                .then_some(terms.len())
        })
        .max()
        .unwrap_or_default();
    task_score.max(keyword_score)
}

fn normalized_match_text(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn compact_match_text(value: &str) -> String {
    normalized_match_text(value).replace(' ', "")
}

fn meaningful_terms(value: &str) -> BTreeSet<String> {
    const INTENT_WORDS: &[&str] = &[
        "show",
        "view",
        "display",
        "open",
        "render",
        "produce",
        "image",
        "figure",
        "diagram",
        "drawing",
        "illustration",
        "manual",
        "please",
        "aircraft",
        "about",
        "also",
        "and",
        "bombardier",
        "can",
        "challenger",
        "could",
        "dassault",
        "exact",
        "falcon",
        "the",
        "for",
        "from",
        "explain",
        "guidance",
        "global",
        "gulfstream",
        "help",
        "include",
        "inspect",
        "issue",
        "know",
        "mechanic",
        "most",
        "need",
        "should",
        "related",
        "relevant",
        "useful",
        "verify",
        "want",
        "what",
        "where",
        "would",
        "with",
        "this",
        "that",
        "you",
        "your",
    ];
    value
        .split_whitespace()
        .map(|term| match term {
            "removal" | "removed" | "removing" => "remove".to_owned(),
            "installation" | "installed" | "installing" => "install".to_owned(),
            "reviewed" | "reviewing" | "reviews" => "review".to_owned(),
            "explained" | "explaining" | "explains" => "explain".to_owned(),
            "helped" | "helping" | "helps" => "help".to_owned(),
            "verified" | "verifies" | "verifying" => "verify".to_owned(),
            "mechanics" => "mechanic".to_owned(),
            _ if term.len() > 4 && term.ends_with('s') => term[..term.len() - 1].to_owned(),
            _ => term.to_owned(),
        })
        .filter(|term| term.len() > 2 && !INTENT_WORDS.contains(&term.as_str()))
        .filter(|term| {
            !(term.starts_with("cl") || term.starts_with("gl"))
                || !term[2..]
                    .chars()
                    .all(|character| character.is_ascii_digit())
        })
        .collect()
}

fn truncate_text(value: &str, limit: usize) -> String {
    let mut output = value.chars().take(limit).collect::<String>();
    if value.chars().count() > limit {
        output.push('…');
    }
    output
}

fn odata_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn odata_search_query(value: &str) -> String {
    odata_string(&value.replace('"', " "))
}

fn release_manual_catalog(
    hits: &[SearchHit],
) -> (Vec<ReleaseManualSummary>, BTreeMap<String, String>) {
    #[derive(Default)]
    struct Accumulator {
        display_name: String,
        manual_type: String,
        aircraft_models: BTreeSet<String>,
        source_files: BTreeSet<String>,
        chunk_count: usize,
    }

    let mut catalog = BTreeMap::<String, Accumulator>::new();
    for hit in hits {
        let entry = catalog.entry(hit.document_id.clone()).or_default();
        if entry.display_name.is_empty() {
            entry.display_name = manual_display_name(hit);
        }
        if entry.manual_type.is_empty() {
            entry.manual_type = hit.manual_type.clone().unwrap_or_else(|| "Manual".into());
        }
        if let Some(model) = hit
            .aircraft_model
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            entry.aircraft_models.insert(model.to_owned());
        }
        entry.source_files.insert(hit.source_name.clone());
        entry.chunk_count += 1;
    }

    let mut ids = BTreeMap::new();
    let manuals = catalog
        .into_iter()
        .map(|(document_id, entry)| {
            let suffix = &document_id[..document_id.len().min(12)];
            let id = format!("{}-{suffix}", slug(&entry.display_name));
            ids.insert(document_id, id.clone());
            ReleaseManualSummary {
                id,
                display_name: entry.display_name,
                manual_type: entry.manual_type,
                aircraft_models: entry.aircraft_models.into_iter().collect(),
                chunk_count: entry.chunk_count,
                source_file_count: entry.source_files.len(),
            }
        })
        .collect::<Vec<_>>();
    (manuals, ids)
}

fn manual_display_name(hit: &SearchHit) -> String {
    hit.title
        .split_once(" — ")
        .map(|(value, _)| value)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&hit.source_name)
        .trim()
        .to_owned()
}

fn slug(value: &str) -> String {
    let output = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(12)
        .collect::<Vec<_>>()
        .join("-");
    if output.is_empty() {
        "manual".into()
    } else {
        output
    }
}

fn safe_source_path(source_name: &str, fallback_id: &str) -> String {
    let parts = source_name
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .map(|part| {
            let sanitized = part
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric()
                        || matches!(character, ' ' | '.' | '-' | '_' | '(' | ')')
                    {
                        character
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
                .trim_matches([' ', '.'])
                .to_owned();
            if sanitized.is_empty() {
                "source".into()
            } else {
                sanitized
            }
        })
        .collect::<Vec<String>>();
    if parts.is_empty() {
        format!("{}.md", slug(fallback_id))
    } else {
        parts.join("/")
    }
}

fn natural_chunk_key(value: &str) -> (String, u64, String) {
    let chunk = value
        .rsplit_once("_c")
        .and_then(|(_, value)| value.parse::<u64>().ok())
        .unwrap_or(u64::MAX);
    let stem = value
        .rsplit_once("_c")
        .map_or(value, |(stem, _)| stem)
        .to_owned();
    (stem, chunk, value.to_owned())
}

fn parse_assets(hit: &SearchHit) -> Result<Vec<SearchAsset>, ManualLibraryError> {
    match hit
        .assets_json
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(value) => serde_json::from_str::<SearchAssetsPayload>(value)
            .map(|assets| match assets {
                SearchAssetsPayload::One(asset) => vec![*asset],
                SearchAssetsPayload::Many(assets) => assets,
            })
            .map_err(|error| {
                ManualLibraryError::Invalid(format!("invalid assets_json for {}: {error}", hit.id))
            }),
        None => Ok(Vec::new()),
    }
}

fn validate_search_asset(asset: &SearchAsset) -> Result<(), ManualLibraryError> {
    let hash = asset.content_hash.strip_prefix("sha256:");
    if asset.asset_id.trim().is_empty()
        || asset.caption.trim().is_empty()
        || !asset
            .source_reference
            .starts_with("azure-blob://documents/manual-assets/legacy-rag/")
        || !matches!(
            asset.media_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp"
        )
        || !hash.is_some_and(|value| {
            value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
        })
        || asset
            .size_bytes
            .is_some_and(|size| size == 0 || size > MAX_ASSET_BYTES)
        || (asset.verified
            && (asset
                .register_id
                .as_deref()
                .map(str::trim)
                .map_or(true, str::is_empty)
                || asset.keywords.is_empty()))
    {
        return Err(ManualLibraryError::Contract(format!(
            "manual asset {} has invalid release metadata",
            asset.asset_id
        )));
    }
    Ok(())
}

fn asset_drive_path(source_reference: &str) -> String {
    let filename = source_reference
        .rsplit('/')
        .next()
        .unwrap_or("manual-image.bin");
    format!("IMAGES/{filename}")
}

fn build_archive(
    mut files: Vec<DriveFile>,
    summary: ManualDriveSummary,
) -> Result<ManualDriveArchive, ManualLibraryError> {
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let mut folded = BTreeSet::new();
    let manifest_files = files
        .iter()
        .map(|file| {
            validate_pack_path(&file.path)
                .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?;
            if !folded.insert(file.path.to_ascii_lowercase()) {
                return Err(ManualLibraryError::Invalid(format!(
                    "drive paths collide: {}",
                    file.path
                )));
            }
            Ok(ReleaseFile {
                path: file.path.clone(),
                size_bytes: file.bytes.len(),
                sha256: sha256_prefixed(&file.bytes),
            })
        })
        .collect::<Result<Vec<_>, ManualLibraryError>>()?;
    let manifest = compile_release_manifest(
        &summary.profile,
        &summary.pack_id,
        &summary.content_set_hash,
        serde_json::to_value(&summary)
            .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?,
        manifest_files,
    )
    .map_err(ManualLibraryError::Invalid)?;

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .last_modified_time(zip::DateTime::default())
        .unix_permissions(0o644);
    for file in &files {
        writer
            .start_file(&file.path, options)
            .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?;
        writer
            .write_all(&file.bytes)
            .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?;
    }
    let bytes = writer
        .finish()
        .map_err(|error| ManualLibraryError::Invalid(error.to_string()))?
        .into_inner();
    let file_count = i32::try_from(files.len())
        .map_err(|_| ManualLibraryError::Invalid("drive contains too many files".into()))?;
    Ok(ManualDriveArchive {
        content_hash: sha256_prefixed(&bytes),
        bytes,
        manifest,
        file_count,
        summary,
    })
}

fn sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search_hit(
        id: &str,
        document_id: &str,
        model: &str,
        title: &str,
        source_name: &str,
    ) -> SearchHit {
        let content = format!("Service instructions for {title}");
        SearchHit {
            score: Some(1.0),
            id: id.into(),
            document_id: document_id.into(),
            content_hash: sha256_prefixed(content.as_bytes()),
            content,
            source_name: source_name.into(),
            title: title.into(),
            manual_type: Some("Aircraft Maintenance Manual".into()),
            aircraft_model: Some(model.into()),
            ata: Some("32".into()),
            section: Some("Landing gear".into()),
            assets_json: None,
        }
    }

    #[test]
    fn chunk_keys_sort_numerically_and_drive_archive_is_deterministic() {
        let mut ids = vec!["manual_c11", "manual_c2", "manual_c1"];
        ids.sort_by_key(|value| natural_chunk_key(value));
        assert_eq!(ids, vec!["manual_c1", "manual_c2", "manual_c11"]);

        let summary = ManualDriveSummary {
            profile: RELEASE_PROFILE.into(),
            pack_id: "pack-v1".into(),
            index_name: "manuals-v1".into(),
            aircraft_count: 1,
            manual_count: 1,
            source_file_count: 1,
            chunk_count: 1,
            image_count: 0,
            content_set_hash: format!("sha256:{}", "a".repeat(64)),
            manuals: vec![ReleaseManualSummary {
                id: "amm-a1b2c3".into(),
                display_name: "Maintenance Manual".into(),
                manual_type: "Aircraft Maintenance Manual".into(),
                aircraft_models: vec!["Example 100".into()],
                chunk_count: 1,
                source_file_count: 1,
            }],
        };
        let first = build_archive(
            vec![DriveFile {
                path: "LIBRARY/amm/chapter.md".into(),
                bytes: b"inspect".to_vec(),
            }],
            summary.clone(),
        )
        .expect("archive");
        let second = build_archive(
            vec![DriveFile {
                path: "LIBRARY/amm/chapter.md".into(),
                bytes: b"inspect".to_vec(),
            }],
            summary,
        )
        .expect("archive");
        assert_eq!(first.bytes, second.bytes);
        assert_eq!(first.content_hash, second.content_hash);
        assert_eq!(first.file_count, 1);
        assert_eq!(first.manifest["files"][0]["path"], "LIBRARY/amm/chapter.md");
    }

    #[test]
    fn assets_json_accepts_flattened_singletons_and_arrays() {
        let asset = json!({
            "asset_id": "a1",
            "kind": "diagram",
            "source_reference": "azure-blob://documents/manual-assets/legacy-rag/v3/a1.png",
            "media_type": "image/png",
            "page": 1,
            "caption": "Registered figure",
            "content_hash": format!("sha256:{}", "a".repeat(64)),
            "availability": "available",
            "verified": true,
            "register_id": "IMG-A1",
            "task_numbers": ["56-11-01-220-801"],
            "keywords": ["windshield damage review"]
        });
        let mut singleton = search_hit("record-one", "manual-one", "CL350", "Windows", "AMM");
        singleton.assets_json = Some(asset.to_string());
        assert_eq!(parse_assets(&singleton).expect("singleton asset").len(), 1);

        let mut array = search_hit("record-many", "manual-one", "CL350", "Windows", "AMM");
        array.assets_json = Some(json!([asset.clone(), asset]).to_string());
        assert_eq!(parse_assets(&array).expect("asset array").len(), 2);
    }

    #[test]
    fn asset_contract_is_format_agnostic_but_restricted_to_the_controlled_collection() {
        let asset = SearchAsset {
            asset_id: "figure-1".into(),
            kind: "figure".into(),
            source_reference:
                "azure-blob://documents/manual-assets/legacy-rag/v2/aircraft/figure-1.webp".into(),
            media_type: "image/webp".into(),
            page: Some(42),
            caption: "Hydraulic routing".into(),
            content_hash: format!("sha256:{}", "a".repeat(64)),
            availability: "available".into(),
            size_bytes: Some(42),
            verified: false,
            register_id: None,
            task_numbers: Vec::new(),
            keywords: Vec::new(),
        };
        validate_search_asset(&asset).expect("valid catalog asset");

        let mut invalid = asset.clone();
        invalid.source_reference = "azure-blob://documents/uncontrolled/figure-1.webp".into();
        assert!(validate_search_asset(&invalid).is_err());

        let mut unregistered_verified = asset.clone();
        unregistered_verified.verified = true;
        assert!(validate_search_asset(&unregistered_verified).is_err());
        unregistered_verified.register_id = Some("IMG-EXAMPLE-001".into());
        unregistered_verified.keywords = vec!["hydraulic routing".into()];
        validate_search_asset(&unregistered_verified).expect("verified catalog asset");

        assert_eq!(
            asset_drive_path("azure-blob://documents/manual-assets/legacy-rag/v2/hash.png"),
            "IMAGES/hash.png"
        );
        assert_eq!(natural_chunk_key("manual_without_chunk").1, u64::MAX);
    }

    #[test]
    fn release_catalog_is_derived_from_mixed_aircraft_records() {
        let hits = vec![
            search_hit(
                "falcon-amm_c1",
                "doc-falcon-amm",
                "Falcon 7X",
                "Falcon 7X AMM — Landing gear",
                "falcon/amm/chapter-32.md",
            ),
            search_hit(
                "g650-amm_c1",
                "doc-g650-amm",
                "Gulfstream G650",
                "G650 AMM — Landing gear",
                "g650/amm/chapter-32.md",
            ),
        ];

        let (manuals, ids) = release_manual_catalog(&hits);
        assert_eq!(manuals.len(), 2);
        assert_eq!(ids.len(), 2);
        assert_eq!(manuals[0].aircraft_models, vec!["Falcon 7X"]);
        assert_eq!(manuals[1].aircraft_models, vec!["Gulfstream G650"]);
        assert_eq!(
            safe_source_path("../falcon\\amm/chapter:32.md", "fallback"),
            "falcon/amm/chapter_32.md"
        );
    }

    #[test]
    fn lexical_image_terms_remove_intent_words_without_aircraft_overfitting() {
        assert_eq!(IMAGE_REGISTER_CANDIDATE_LIMIT, 50);
        let normalized =
            normalized_match_text("Please show the Bombardier Global 7500 hydraulic-pump diagram");
        let terms = meaningful_terms(&normalized);
        assert!(!terms.contains("show"));
        assert!(!terms.contains("diagram"));
        assert!(!terms.contains("bombardier"));
        assert!(!terms.contains("global"));
        assert!(terms.contains("7500"));
        assert!(terms.contains("hydraulic"));
        assert!(terms.contains("pump"));
    }

    #[test]
    fn catalog_image_lookup_normalizes_common_family_names() {
        assert_eq!(canonical_catalog_aircraft_model("Challenger 350"), "CL350");
        assert_eq!(
            canonical_catalog_aircraft_model("Bombardier Challenger 350"),
            "CL350"
        );
        assert_eq!(canonical_catalog_aircraft_model("CL350"), "CL350");
        assert_eq!(
            canonical_catalog_aircraft_model("Bombardier CL350"),
            "CL350"
        );
        assert_eq!(canonical_catalog_aircraft_model("Global 7500"), "GL7500");
        assert_eq!(canonical_catalog_aircraft_model("Gulfstream G650"), "G650");
        assert_eq!(
            canonical_catalog_aircraft_model("Dassault Falcon 8X"),
            "Falcon 8X"
        );
        assert_eq!(
            canonical_catalog_aircraft_model("Textron/Cessna CE750 SN 0501-On"),
            "CE750 SN 0501-On"
        );
        assert_eq!(canonical_catalog_aircraft_model("Falcon 8X"), "Falcon 8X");
    }

    #[test]
    fn verified_asset_matching_requires_specific_figure_intent() {
        let tasks = vec!["31-31-01-000-801".to_owned()];
        let keywords = vec![
            "FDR removal".to_owned(),
            "flight data recorder removal".to_owned(),
            "FDR tray retainers".to_owned(),
        ];
        let exact = normalized_match_text(
            "Show the Challenger 350 FDR removal and installation figure with the tray and retainers",
        );
        assert!(
            verified_asset_match_score(&exact, &meaningful_terms(&exact), &tasks, &keywords) > 0
        );

        let natural = normalized_match_text(
            "I need to remove the flight data recorder on a Challenger 350. What should I know, and can you show me the relevant diagram?",
        );
        assert!(
            verified_asset_match_score(&natural, &meaningful_terms(&natural), &tasks, &keywords,)
                > 0,
            "natural remove language must match a verified removal figure"
        );

        let broad = normalized_match_text(
            "I have a Challenger 350 flight data recorder issue; include a useful diagram",
        );
        assert_eq!(
            verified_asset_match_score(&broad, &meaningful_terms(&broad), &tasks, &keywords),
            0,
            "a broad request must not guess a figure"
        );

        let windshield = normalized_match_text(
            "Show me the most useful manual diagram for the windshield damage review",
        );
        assert!(
            verified_asset_match_score(
                &windshield,
                &meaningful_terms(&windshield),
                &["56-11-01-220-801".to_owned()],
                &["windshield damage review".to_owned()],
            ) > 0,
            "the verified windshield alias must select its registered figure"
        );

        let conversational_windshield = normalized_match_text(
            "Show me the most useful manual diagram for reviewing windshield damage on a Challenger 350, and explain what it helps the mechanic verify.",
        );
        let conversational_terms = meaningful_terms(&conversational_windshield);
        assert_eq!(
            conversational_terms,
            ["350", "damage", "review", "windshield"]
                .into_iter()
                .map(str::to_owned)
                .collect()
        );
        assert!(
            verified_asset_match_score(
                &conversational_windshield,
                &conversational_terms,
                &["56-11-01-220-801".to_owned()],
                &["windshield damage review".to_owned()],
            ) > 0,
            "conversational framing must not displace the registered windshield figure"
        );
    }

    #[tokio::test]
    #[ignore = "requires the live Azure Search and Blob read credentials"]
    async fn live_catalog_builds_a_complete_edge_archive() {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(90))
            .build()
            .expect("client");
        let library = AzureManualLibrary::from_env(client)
            .expect("valid live configuration")
            .expect("configured live library");
        let archive = library.export_drive().await.expect("live drive export");
        assert!(archive.bytes.starts_with(b"PK\x03\x04"));
        assert_eq!(archive.summary.profile, RELEASE_PROFILE);
        assert!(archive.summary.aircraft_count > 0);
        assert!(archive.summary.manual_count > 0);
        assert!(archive.summary.chunk_count >= archive.summary.manual_count);
        assert!(archive.file_count as usize > archive.summary.manual_count);
        assert_eq!(
            archive.manifest["files"].as_array().unwrap().len(),
            archive.file_count as usize
        );
    }
}
