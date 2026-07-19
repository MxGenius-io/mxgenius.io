//! Prompt registrations. Names are frozen by the contract.

use serde::Serialize;
use serde_json::{json, Value};

use crate::registry::Registry;

#[derive(Debug, Clone, Serialize)]
pub struct PromptSpec {
    pub name: String,
    pub title: String,
    pub description: String,
    pub arguments: Vec<PromptArgument>,
    /// Template body stub. Flesh out to render the orchestration.
    pub template: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromptArgument {
    pub name: String,
    pub description: String,
    pub required: bool,
    pub schema: Value,
}

pub fn register_all(reg: &mut Registry) {
    for p in all() {
        reg.register_prompt(p);
    }
}

pub fn all() -> Vec<PromptSpec> {
    vec![
        prompt(
            "open-aog-case",
            "Open AOG Case",
            "Triage an AOG situation and open a high-priority MaintenanceCase.",
            &[("aircraft_id", "Aircraft identifier", true)],
        ),
        prompt(
            "diagnose-discrepancy",
            "Diagnose Discrepancy",
            "Walk through evidence-backed diagnosis for a known discrepancy.",
            &[("case_id", "MaintenanceCase identifier", true)],
        ),
        prompt(
            "build-recovery-plan",
            "Build Recovery Plan",
            "Draft a recovery plan over the atomic case / parts / facility tools.",
            &[("case_id", "MaintenanceCase identifier", true)],
        ),
        prompt(
            "review-aircraft-compliance",
            "Review Aircraft Compliance",
            "Inspect applicable ADs / SAIBs and document currency for an aircraft.",
            &[("aircraft_id", "Aircraft identifier", true)],
        ),
        prompt(
            "find-part-and-facility",
            "Find Part and Facility",
            "Search parts, suppliers, and MRO facilities for a case requirement.",
            &[("case_id", "MaintenanceCase identifier", true)],
        ),
        prompt(
            "prepare-shift-handoff",
            "Prepare Shift Handoff",
            "Summarise a case in handoff form for the next shift.",
            &[("case_id", "MaintenanceCase identifier", true)],
        ),
        prompt(
            "prepare-return-to-service-review",
            "Prepare RTS Review",
            "Assemble the case return-to-service review pack (review only, never approval).",
            &[("case_id", "MaintenanceCase identifier", true)],
        ),
        prompt(
            "compare-maintenance-options",
            "Compare Maintenance Options",
            "Compare facilities, weather windows, and parts readiness for a case.",
            &[("case_id", "MaintenanceCase identifier", true)],
        ),
    ]
}

fn prompt(name: &str, title: &str, description: &str, args: &[(&str, &str, bool)]) -> PromptSpec {
    PromptSpec {
        name: name.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        arguments: args
            .iter()
            .map(|(n, d, req)| PromptArgument {
                name: (*n).to_string(),
                description: (*d).to_string(),
                required: *req,
                schema: json!({"type": "string"}),
            })
            .collect(),
        template: format!("[stub template for {name}]"),
    }
}
