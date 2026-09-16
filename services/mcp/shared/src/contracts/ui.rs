//! Safe semantic browser guidance contract: `mxg.ui.guide`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UiGuideBehavior {
    /// The user explicitly asked to be shown or taken to a product surface.
    Auto,
    /// Offer a reversible **Show me** action without changing the current view.
    Offer,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UiGuideRequest {
    /// Canonical surface ID from `mxg.environment.describe`.
    #[schemars(length(min = 1, max = 80))]
    pub surface_id: String,
    /// Canonical semantic target ID owned by that surface.
    #[schemars(length(min = 1, max = 120))]
    pub target_id: String,
    /// Short user-facing explanation shown beside the highlighted target.
    #[schemars(length(min = 1, max = 400))]
    pub guidance: String,
    /// `auto` only for an explicit show/take/guide request; otherwise `offer`.
    pub behavior: UiGuideBehavior,
}

impl UiGuideRequest {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value, max) in [
            ("surface_id", self.surface_id.as_str(), 80_usize),
            ("target_id", self.target_id.as_str(), 120_usize),
            ("guidance", self.guidance.as_str(), 400_usize),
        ] {
            let value = value.trim();
            if value.is_empty() || value.chars().count() > max {
                return Err(format!("{name} must contain 1 to {max} characters"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UiGuideResponse {
    pub surface_id: String,
    pub target_id: String,
    pub guidance: String,
    pub behavior: UiGuideBehavior,
}
