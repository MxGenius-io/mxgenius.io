//! Manual retrieval contract: `mxg.manual.search`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::adapters::manual::ManualRetrievalState;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct ManualSearchRequest {
    /// Natural-language maintenance question or description to retrieve against.
    #[schemars(length(min = 1, max = 4_000))]
    pub question: String,
    /// Aircraft family from the user's request. The conductor supplies the active
    /// case aircraft only when neither the user nor recent conversation chose one.
    #[schemars(length(min = 1, max = 120))]
    pub aircraft_model: Option<String>,
    /// Optional manual family such as AMM, IPC, SSM, SPM, or NDT.
    #[schemars(length(min = 1, max = 64))]
    pub manual_type: Option<String>,
    /// Optional ATA chapter.
    #[schemars(length(min = 1, max = 8))]
    pub ata: Option<String>,
    /// Include verified image metadata linked to the retrieved records.
    #[serde(default)]
    pub include_images: Option<bool>,
    /// Requested result count. The service clamps this to 1-12 for model use.
    #[schemars(range(min = 1, max = 12))]
    pub limit: Option<u32>,
}

impl ManualSearchRequest {
    pub fn validate(&self) -> Result<(), String> {
        let question = self.question.trim();
        if question.is_empty() || question.chars().count() > 4_000 {
            return Err("question must contain 1 to 4000 characters".into());
        }
        for (name, value, max) in [
            ("aircraft_model", self.aircraft_model.as_deref(), 120_usize),
            ("manual_type", self.manual_type.as_deref(), 64),
            ("ata", self.ata.as_deref(), 8),
        ] {
            if let Some(value) = value {
                let value = value.trim();
                if value.is_empty() || value.chars().count() > max {
                    return Err(format!("{name} must contain 1 to {max} characters"));
                }
            }
        }
        if self.limit.is_some_and(|limit| !(1..=12).contains(&limit)) {
            return Err("limit must be between 1 and 12".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ManualSearchAsset {
    pub asset_id: String,
    pub kind: String,
    pub source_reference: String,
    pub media_type: Option<String>,
    pub page: Option<u32>,
    pub caption: Option<String>,
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ManualSearchRecord {
    /// Stable label for citations within this tool result.
    pub citation: String,
    pub title: String,
    pub excerpt: String,
    pub revision: Option<String>,
    pub effective_at: Option<String>,
    pub source_reference: String,
    pub content_hash: String,
    pub match_percent: Option<u8>,
    pub license_scope: Option<String>,
    pub images: Vec<ManualSearchAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ManualSearchResponse {
    pub state: ManualRetrievalState,
    pub aircraft_model: Option<String>,
    pub manual_type: Option<String>,
    pub ata: Option<String>,
    pub returned: u32,
    pub records: Vec<ManualSearchRecord>,
}
