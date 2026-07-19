//! Evidence contracts (4): `mxg.evidence.*`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::datetime::UtcDateTime;
use crate::domain::ids::CaseId;

// 43. mxg.evidence.collect ----------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceCollectRequest {
    #[schemars(length(max = 100))]
    pub source_references: Option<Vec<String>>,
    pub case_id: Option<CaseId>,
    #[schemars(length(max = 100))]
    pub raw_items: Option<Vec<RawEvidenceItem>>,
}

impl EvidenceCollectRequest {
    pub fn validate(&self) -> Result<(), String> {
        let source_count = self.source_references.as_ref().map_or(0, Vec::len);
        let raw_count = self.raw_items.as_ref().map_or(0, Vec::len);
        if source_count + raw_count == 0 {
            return Err("source_references or raw_items must contain at least one item".into());
        }
        if source_count > 100 || raw_count > 100 || source_count + raw_count > 100 {
            return Err("evidence collection accepts at most 100 total items".into());
        }
        if let Some(references) = &self.source_references {
            for reference in references {
                bounded_nonblank("source_references entry", reference, 2_048)?;
            }
        }
        if let Some(items) = &self.raw_items {
            for item in items {
                item.validate()?;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RawEvidenceItem {
    #[schemars(length(min = 1, max = 64))]
    pub source_type: String,
    #[schemars(length(min = 1, max = 2048))]
    pub source_reference: String,
    #[schemars(length(min = 1, max = 64))]
    pub kind: String,
    #[schemars(length(min = 1, max = 512))]
    pub title: String,
    #[schemars(length(max = 10000))]
    pub excerpt: Option<String>,
    pub effective_at: Option<UtcDateTime>,
    pub revision: Option<String>,
    pub license_scope: Option<String>,
    #[schemars(length(min = 1, max = 1000000))]
    pub content: String,
}

impl RawEvidenceItem {
    pub fn validate(&self) -> Result<(), String> {
        bounded_nonblank("source_type", &self.source_type, 64)?;
        bounded_nonblank("source_reference", &self.source_reference, 2_048)?;
        bounded_nonblank("kind", &self.kind, 64)?;
        bounded_nonblank("title", &self.title, 512)?;
        bounded_nonblank("content", &self.content, 1_000_000)?;
        if self
            .excerpt
            .as_ref()
            .is_some_and(|value| value.len() > 10_000)
        {
            return Err("excerpt must contain at most 10000 characters".into());
        }
        Ok(())
    }
}

fn bounded_nonblank(name: &str, value: &str, max: usize) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() || value.len() > max {
        return Err(format!("{name} must contain 1 to {max} characters"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceCollectResponse {
    pub evidence: Vec<EvidenceDto>,
    pub collection_warnings: Vec<String>,
    pub deduplicated_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceDto {
    pub evidence_id: String,
    pub source_type: String,
    pub source_reference: String,
    pub kind: String,
    pub title: String,
    pub excerpt: Option<String>,
    pub retrieved_at: UtcDateTime,
    pub effective_at: Option<UtcDateTime>,
    pub revision: Option<String>,
    pub license_scope: Option<String>,
    pub content_hash: String,
    pub supersedes: Option<String>,
}

// 44. mxg.evidence.trace_case -------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceTraceCaseRequest {
    pub case_id: CaseId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceGraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceGraphLink {
    pub from: String,
    pub to: String,
    pub kind: String, // derived_from | supersedes | conflicts_with | supports
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceTraceCaseResponse {
    pub nodes: Vec<EvidenceGraphNode>,
    pub links: Vec<EvidenceGraphLink>,
    pub conflicts: Vec<String>,
    pub decisions: Vec<String>,
    pub source_freshness: Vec<UtcDateTime>,
}

// 45. mxg.evidence.citation_pack ---------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceCitationPackRequest {
    pub case_id: CaseId,
    pub format: Option<String>, // markdown | json | pdf-stub
    pub options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceCitationPackResponse {
    pub case_id: CaseId,
    pub export_reference: String,
    pub evidence_count: u32,
    pub included_locators: Vec<String>,
    pub exclusions: Vec<String>,
    pub licensing_warnings: Vec<String>,
    pub embedded_whole_manuals: bool,
}

// 46. mxg.evidence.conflict_check ---------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceConflictCheckRequest {
    pub case_id: Option<CaseId>,
    pub evidence_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceConflictCheckResponse {
    pub contradictions: Vec<EvidenceConflict>,
    pub competing_values: Vec<EvidenceConflict>,
    pub temporal_conflicts: Vec<EvidenceConflict>,
    pub revision_conflicts: Vec<EvidenceConflict>,
    pub unresolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EvidenceConflict {
    pub id: String,
    pub kind: String,
    pub description: String,
    pub evidence_ids: Vec<String>,
    pub severity: String,
}
