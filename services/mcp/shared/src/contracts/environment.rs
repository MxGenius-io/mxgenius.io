//! Stable product-environment contract: `mxg.environment.describe`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct EnvironmentDescribeRequest {
    /// Optional canonical surface ID, such as `parts` or `settings`.
    #[schemars(length(min = 1, max = 80))]
    pub surface_id: Option<String>,
    /// Optional semantic target ID, such as `parts-receiving`.
    #[schemars(length(min = 1, max = 120))]
    pub target_id: Option<String>,
}

impl EnvironmentDescribeRequest {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value, max) in [
            ("surface_id", self.surface_id.as_deref(), 80_usize),
            ("target_id", self.target_id.as_deref(), 120_usize),
        ] {
            if let Some(value) = value {
                let value = value.trim();
                if value.is_empty() || value.chars().count() > max {
                    return Err(format!("{name} must contain 1 to {max} characters"));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EnvironmentCapability {
    pub id: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EnvironmentSurface {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub route: Option<String>,
    pub purpose: String,
    pub capabilities: Vec<EnvironmentCapability>,
    pub target_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EnvironmentTarget {
    pub id: String,
    pub title: String,
    pub surface_id: String,
    pub guidance: String,
    pub status: String,
    pub touchpoints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EnvironmentTerm {
    pub term: String,
    pub meaning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EnvironmentDescribeResponse {
    pub manifest_version: String,
    pub product: String,
    pub surfaces: Vec<EnvironmentSurface>,
    pub targets: Vec<EnvironmentTarget>,
    pub terminology: Vec<EnvironmentTerm>,
}
