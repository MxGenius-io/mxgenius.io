//! Resource registrations. Per the contract, expose canonical, read-only
//! objects through URI templates. Stubs return metadata-only stubs.

use serde::Serialize;
use serde_json::{json, Value};

use crate::registry::Registry;

#[derive(Debug, Clone, Serialize)]
pub struct ResourceSpec {
    pub uri_template: String,
    pub name: String,
    pub description: String,
    pub mime_type: String,
    /// Stub: the real handler will return a bounded excerpt or a metadata
    /// envelope; never the entire manual.
    pub shape: Value,
}

pub fn register_all(reg: &mut Registry) {
    let resources: Vec<ResourceSpec> = vec![
        res(
            "mxg://aircraft/{aircraft_id}",
            "Aircraft",
            "application/json",
        ),
        res(
            "mxg://aircraft/{aircraft_id}/configuration",
            "Aircraft Configuration",
            "application/json",
        ),
        res(
            "mxg://aircraft/{aircraft_id}/compliance",
            "Aircraft Compliance",
            "application/json",
        ),
        res(
            "mxg://aircraft/{aircraft_id}/documents",
            "Aircraft Documents",
            "application/json",
        ),
        res(
            "mxg://cases/{case_id}",
            "Maintenance Case",
            "application/json",
        ),
        res(
            "mxg://cases/{case_id}/timeline",
            "Case Timeline",
            "application/json",
        ),
        res(
            "mxg://cases/{case_id}/evidence",
            "Case Evidence",
            "application/json",
        ),
        res(
            "mxg://cases/{case_id}/work-package",
            "Case Work Package",
            "application/json",
        ),
        res(
            "mxg://components/{component_id}",
            "Component",
            "application/json",
        ),
        res(
            "mxg://documents/{document_id}",
            "Technical Document",
            "application/json",
        ),
        res(
            "mxg://documents/{document_id}/revisions/{revision_id}",
            "Document Revision",
            "application/json",
        ),
        res(
            "mxg://facilities/{facility_id}",
            "MRO Facility",
            "application/json",
        ),
        res("mxg://parts/{part_id}", "Part", "application/json"),
        res(
            "mxg://schemas/domain",
            "Domain Schema",
            "application/schema+json",
        ),
        res(
            "mxg://schemas/capabilities",
            "Capabilities Schema",
            "application/schema+json",
        ),
        res(
            "mxg://governance/tool-policy",
            "Tool Policy",
            "application/json",
        ),
    ];
    for r in resources {
        reg.register_resource(r);
    }
}

fn res(uri: &str, name: &str, mime: &str) -> ResourceSpec {
    ResourceSpec {
        uri_template: uri.to_string(),
        name: name.to_string(),
        description: format!("Stub resource: {uri}"),
        mime_type: mime.to_string(),
        shape: json!({ "stub": true, "uri_template": uri }),
    }
}
