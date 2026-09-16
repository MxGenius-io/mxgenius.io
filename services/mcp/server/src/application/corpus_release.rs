//! Shared publication-boundary contract for manual corpus releases.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{json, Value};

pub const EDGE_DRIVE_PROFILE: &str = "edge-drive";
pub const MODEL_CONTEXT_PROFILE: &str = "model-context";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseFile {
    pub path: String,
    pub size_bytes: usize,
    pub sha256: String,
}

/// Wrap a data-derived source description and its verified files in the same
/// release envelope regardless of whether the consumer is a Pi drive or model
/// ingestion. Consumer-specific transformation stays in the source payload.
pub fn compile_release_manifest(
    profile: &str,
    release_id: &str,
    content_set_hash: &str,
    source: Value,
    mut files: Vec<ReleaseFile>,
) -> Result<Value, String> {
    if !matches!(profile, EDGE_DRIVE_PROFILE | MODEL_CONTEXT_PROFILE) {
        return Err("release profile is unsupported".into());
    }
    if release_id.trim().is_empty() {
        return Err("release identity is required".into());
    }
    validate_sha256(content_set_hash)?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let mut paths = BTreeSet::new();
    for file in &files {
        if file.path.trim().is_empty()
            || file.path.starts_with('/')
            || file.path.contains('\\')
            || file
                .path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err(format!("release path is unsafe: {}", file.path));
        }
        if !paths.insert(file.path.to_ascii_lowercase()) {
            return Err(format!("release paths collide: {}", file.path));
        }
        validate_sha256(&file.sha256)?;
    }
    Ok(json!({
        "schemaVersion": 1,
        "profile": profile,
        "releaseId": release_id,
        "contentSetHash": content_set_hash,
        "source": source,
        "files": files
    }))
}

fn validate_sha256(value: &str) -> Result<(), String> {
    let Some(hash) = value.strip_prefix("sha256:") else {
        return Err("release hash must use the sha256 scheme".into());
    };
    if hash.len() != 64 || !hash.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("release hash is malformed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiler_is_profiled_but_not_aircraft_specific() {
        let hash = format!("sha256:{}", "a".repeat(64));
        let manifest = compile_release_manifest(
            MODEL_CONTEXT_PROFILE,
            "mixed-aircraft-release",
            &hash,
            json!({ "aircraftModels": ["Falcon 7X", "Gulfstream G650"] }),
            vec![ReleaseFile {
                path: "source/catalog.json".into(),
                size_bytes: 42,
                sha256: hash.clone(),
            }],
        )
        .expect("release");
        assert_eq!(manifest["profile"], MODEL_CONTEXT_PROFILE);
        assert_eq!(
            manifest["source"]["aircraftModels"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
}
