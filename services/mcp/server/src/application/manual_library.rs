//! Azure-backed authoritative manual library export for Equipment Drives.
//!
//! The cloud model and the Pi export deliberately share the same frozen pack
//! manifest. Search remains the source of flattened text while Blob Storage is
//! the source of page-linked figures.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Write};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::equipment_packs::validate_pack_path;

const MANUAL_PACK_MANIFEST: &str =
    include_str!("../../../config/authoritative-manual-pack-v1.json");
const SEARCH_API_VERSION: &str = "2024-07-01";
const SEARCH_PAGE_SIZE: usize = 1_000;
const MAX_SEARCH_RECORDS: usize = 50_000;
const MAX_ASSET_BYTES: usize = 20 * 1024 * 1024;

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
    manifest: ManualPackManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualDriveSummary {
    pub pack_id: String,
    pub index_name: String,
    pub manual_count: usize,
    pub source_file_count: usize,
    pub chunk_count: usize,
    pub image_count: usize,
    pub content_set_hash: String,
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

#[derive(Debug, Clone, Deserialize)]
struct ManualPackManifest {
    schema_version: u32,
    pack_id: String,
    release_state: String,
    index_contract: ManualIndexContract,
    integrity: ManualPackIntegrity,
    currency_policy: CurrencyPolicy,
    manuals: Vec<ManifestManual>,
}

#[derive(Debug, Clone, Deserialize)]
struct ManualIndexContract {
    index_name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ManualPackIntegrity {
    chunk_count: usize,
    logical_manual_count: usize,
    content_set_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CurrencyPolicy {
    state: String,
    reason: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestManual {
    manual_id: String,
    display_name: String,
    manual_type: String,
    document_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchHit {
    id: String,
    document_id: String,
    content: String,
    content_hash: String,
    source_name: String,
    title: String,
    manual_type: Option<String>,
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

        let manifest: ManualPackManifest = serde_json::from_str(MANUAL_PACK_MANIFEST)
            .map_err(|error| ManualLibraryError::Contract(error.to_string()))?;
        let search_endpoint = required_env("AZURE_SEARCH_ENDPOINT")?;
        let search_key = required_env("AZURE_SEARCH_KEY")?;
        let index_name = required_env("AZURE_SEARCH_INDEX")?;
        let pack_id = required_env("MXGENIUS_MANUAL_PACK_ID")?;
        let asset_origin = required_env("MXGENIUS_MANUAL_ASSET_ORIGIN")?;
        let asset_sas = required_env("MXGENIUS_MANUAL_ASSET_SAS")?.replace("%26", "&");
        if index_name != manifest.index_contract.index_name {
            return Err(ManualLibraryError::Contract(format!(
                "configured index {index_name} does not match {}",
                manifest.index_contract.index_name
            )));
        }
        if pack_id != manifest.pack_id {
            return Err(ManualLibraryError::Contract(format!(
                "configured pack {pack_id} does not match {}",
                manifest.pack_id
            )));
        }
        if manifest.release_state != "frozen"
            || manifest.integrity.logical_manual_count != manifest.manuals.len()
            || manifest.schema_version != 1
        {
            return Err(ManualLibraryError::Contract(
                "only the frozen schema-v1 manual pack can be exported".into(),
            ));
        }

        Ok(Some(Self {
            http,
            search_endpoint: search_endpoint.trim_end_matches('/').into(),
            search_key,
            index_name,
            asset_origin: asset_origin.trim_end_matches('/').into(),
            asset_sas,
            manifest,
        }))
    }

    pub fn pack_id(&self) -> &str {
        &self.manifest.pack_id
    }

    pub async fn export_drive(&self) -> Result<ManualDriveArchive, ManualLibraryError> {
        let mut hits = self.search_records().await?;
        hits.sort_by_key(|hit| natural_chunk_key(&hit.id));
        self.validate_content_set(&hits)?;

        let manual_by_document = self
            .manifest
            .manuals
            .iter()
            .flat_map(|manual| {
                manual
                    .document_ids
                    .iter()
                    .map(move |document_id| (document_id.clone(), manual))
            })
            .collect::<BTreeMap<_, _>>();
        let mut files = Vec::new();
        let mut sources = BTreeMap::<String, Vec<&SearchHit>>::new();
        let mut assets = BTreeMap::<String, SearchAsset>::new();
        for hit in &hits {
            sources
                .entry(hit.source_name.clone())
                .or_default()
                .push(hit);
            for asset in parse_assets(hit)? {
                if asset.availability == "available" {
                    assets
                        .entry(asset.source_reference.clone())
                        .or_insert(asset);
                }
            }
        }

        for (source_name, mut chunks) in sources.clone() {
            chunks.sort_by_key(|hit| natural_chunk_key(&hit.id));
            let manual = manual_by_document
                .get(&chunks[0].document_id)
                .ok_or_else(|| {
                    ManualLibraryError::Invalid(format!(
                        "source {source_name} is outside the frozen pack"
                    ))
                })?;
            let mut body = format!(
                "# {}\n\nSource: {}\nManual type: {}\nCurrency: {} — {}\n\n",
                manual.display_name,
                source_name,
                manual.manual_type,
                self.manifest.currency_policy.state,
                self.manifest.currency_policy.reason
            );
            for hit in chunks {
                body.push_str(&format!(
                    "## {}\n\n{}\n\n<!-- chunk={} hash={} -->\n\n",
                    hit.title, hit.content, hit.id, hit.content_hash
                ));
            }
            files.push(DriveFile {
                path: format!("LIBRARY/{}/{}", manual.manual_id, source_name),
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
                    "contentHash": asset.content_hash
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
        files.push(DriveFile {
            path: "MXG/manual-pack.json".into(),
            bytes: MANUAL_PACK_MANIFEST.as_bytes().to_vec(),
        });
        files.push(DriveFile {
            path: "README.TXT".into(),
            bytes: format!(
                "MXGenius CL350 Technical Library\r\nPack: {}\r\n\r\nThis drive contains the same frozen flattened manual corpus used by MXGenius model retrieval. Linked figures are stored in IMAGES and mapped in INDEX/image-map.json. Manual currency is {}: {}\r\n",
                self.manifest.pack_id,
                self.manifest.currency_policy.state,
                self.manifest.currency_policy.reason
            )
            .into_bytes(),
        });

        for asset in assets.values() {
            let fetched = self
                .fetch_asset(
                    &asset.source_reference,
                    &asset.content_hash,
                    Some(&asset.media_type),
                    MAX_ASSET_BYTES,
                )
                .await?;
            files.push(DriveFile {
                path: asset_drive_path(&asset.source_reference),
                bytes: fetched.bytes,
            });
        }

        let summary = ManualDriveSummary {
            pack_id: self.manifest.pack_id.clone(),
            index_name: self.index_name.clone(),
            manual_count: self.manifest.manuals.len(),
            source_file_count: sources.len(),
            chunk_count: hits.len(),
            image_count: assets.len(),
            content_set_hash: self.manifest.integrity.content_set_hash.clone(),
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

    async fn search_records(&self) -> Result<Vec<SearchHit>, ManualLibraryError> {
        let document_ids = self
            .manifest
            .manuals
            .iter()
            .flat_map(|manual| manual.document_ids.iter())
            .cloned()
            .collect::<Vec<_>>();
        let filter = format!(
            "source_class eq 'manual' and search.in(document_id, '{}', ',')",
            document_ids.join(",")
        );
        let url = format!(
            "{}/indexes/{}/docs/search?api-version={SEARCH_API_VERSION}",
            self.search_endpoint, self.index_name
        );
        let mut records = Vec::new();
        let mut expected = None;
        while records.len() < MAX_SEARCH_RECORDS {
            let response = self
                .http
                .post(&url)
                .header("api-key", &self.search_key)
                .json(&json!({
                    "search": "*",
                    "filter": filter,
                    "count": records.is_empty(),
                    "top": SEARCH_PAGE_SIZE,
                    "skip": records.len(),
                    "select": "id,document_id,content,content_hash,source_name,title,manual_type,ata,section,assets_json"
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
            records.extend(page.value);
            if page_size < SEARCH_PAGE_SIZE {
                break;
            }
        }
        if records.len() >= MAX_SEARCH_RECORDS
            || expected.is_some_and(|count| count != records.len())
        {
            return Err(ManualLibraryError::Invalid(
                "manual Search pagination did not return the complete frozen pack".into(),
            ));
        }
        Ok(records)
    }

    fn validate_content_set(&self, hits: &[SearchHit]) -> Result<(), ManualLibraryError> {
        if hits.len() != self.manifest.integrity.chunk_count {
            return Err(ManualLibraryError::Contract(format!(
                "expected {} chunks, received {}",
                self.manifest.integrity.chunk_count,
                hits.len()
            )));
        }
        let approved = self
            .manifest
            .manuals
            .iter()
            .flat_map(|manual| manual.document_ids.iter().cloned())
            .collect::<BTreeSet<_>>();
        let observed = hits
            .iter()
            .map(|hit| hit.document_id.clone())
            .collect::<BTreeSet<_>>();
        if approved != observed {
            return Err(ManualLibraryError::Contract(
                "Search document identities do not match the frozen pack".into(),
            ));
        }
        let mut content_lines = hits
            .iter()
            .map(|hit| format!("{}|{}", hit.id, hit.content_hash))
            .collect::<Vec<_>>();
        content_lines.sort();
        let content_set = content_lines.join("\n");
        let observed_hash = sha256_prefixed(content_set.as_bytes());
        if observed_hash != self.manifest.integrity.content_set_hash {
            return Err(ManualLibraryError::Contract(format!(
                "content set hash mismatch: expected {}, received {observed_hash}",
                self.manifest.integrity.content_set_hash
            )));
        }
        Ok(())
    }
}

fn required_env(name: &'static str) -> Result<String, ManualLibraryError> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or(ManualLibraryError::NotConfigured(name))
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
        Some(value) => serde_json::from_str(value).map_err(|error| {
            ManualLibraryError::Invalid(format!("invalid assets_json for {}: {error}", hit.id))
        }),
        None => Ok(Vec::new()),
    }
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
            Ok(json!({
                "path": file.path,
                "sizeBytes": file.bytes.len(),
                "sha256": sha256_prefixed(&file.bytes)
            }))
        })
        .collect::<Result<Vec<_>, ManualLibraryError>>()?;
    let manifest = json!({
        "schemaVersion": 1,
        "source": summary,
        "files": manifest_files
    });

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

    #[test]
    fn chunk_keys_sort_numerically_and_drive_archive_is_deterministic() {
        let mut ids = vec!["manual_c11", "manual_c2", "manual_c1"];
        ids.sort_by_key(|value| natural_chunk_key(value));
        assert_eq!(ids, vec!["manual_c1", "manual_c2", "manual_c11"]);

        let summary = ManualDriveSummary {
            pack_id: "pack-v1".into(),
            index_name: "manuals-v1".into(),
            manual_count: 1,
            source_file_count: 1,
            chunk_count: 1,
            image_count: 0,
            content_set_hash: format!("sha256:{}", "a".repeat(64)),
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
    fn assets_are_restricted_to_the_controlled_blob_collection() {
        assert_eq!(
            asset_drive_path("azure-blob://documents/manual-assets/legacy-rag/v2/hash.png"),
            "IMAGES/hash.png"
        );
        assert_eq!(natural_chunk_key("manual_without_chunk").1, u64::MAX);
    }

    #[tokio::test]
    #[ignore = "requires the live Azure Search and Blob read credentials"]
    async fn live_frozen_pack_builds_a_complete_edge_archive() {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(90))
            .build()
            .expect("client");
        let library = AzureManualLibrary::from_env(client)
            .expect("valid live configuration")
            .expect("configured live library");
        let archive = library.export_drive().await.expect("live drive export");
        assert!(archive.bytes.starts_with(b"PK\x03\x04"));
        assert_eq!(archive.summary.manual_count, 5);
        assert_eq!(archive.summary.chunk_count, 13_121);
        assert_eq!(archive.summary.image_count, 5);
        assert!(archive.file_count > 5);
        assert_eq!(
            archive.manifest["files"].as_array().unwrap().len(),
            archive.file_count as usize
        );
    }
}
