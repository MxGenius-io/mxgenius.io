//! Tool / resource / prompt registry. Built once at startup, immutable after.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

use crate::adapters::aircraft::FixtureJetNetAdapter;
use crate::adapters::manual::FixtureManualCorpusAdapter;
use crate::application::aircraft_catalog::InMemoryAircraftCatalog;
use crate::application::case_service::CaseService;
use crate::application::evidence_service::EvidenceStore;
use crate::prompts::PromptSpec;
use crate::resources::ResourceSpec;
use crate::tool::ToolSpec;
use crate::typed_tool::TypedTool;
use mxgenius_shared::adapters::faa::{NotConfiguredFaaAdAdapter, NotConfiguredSaibAdapter};

#[derive(Clone, Default)]
pub struct Registry {
    tools: BTreeMap<String, Arc<dyn TypedTool>>,
    resources: BTreeMap<String, ResourceSpec>,
    prompts: BTreeMap<String, PromptSpec>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_typed_tool(&mut self, tool: Arc<dyn TypedTool>) {
        self.tools.insert(tool.spec().name.clone(), tool);
    }

    pub fn register_resource(&mut self, spec: ResourceSpec) {
        self.resources.insert(spec.uri_template.clone(), spec);
    }

    pub fn register_prompt(&mut self, spec: PromptSpec) {
        self.prompts.insert(spec.name.clone(), spec);
    }

    pub fn tool(&self, name: &str) -> Option<Arc<dyn TypedTool>> {
        self.tools.get(name).cloned()
    }

    pub fn resource(&self, uri_template: &str) -> Option<&ResourceSpec> {
        self.resources.get(uri_template)
    }

    pub fn prompt(&self, name: &str) -> Option<&PromptSpec> {
        self.prompts.get(name)
    }

    pub fn list_tools(&self) -> Vec<ToolSpec> {
        self.tools.values().map(|t| t.spec()).collect()
    }

    pub fn list_resources(&self) -> Vec<ResourceSpec> {
        self.resources.values().cloned().collect()
    }

    pub fn list_prompts(&self) -> Vec<PromptSpec> {
        self.prompts.values().cloned().collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub tool_count: usize,
    pub resource_count: usize,
    pub prompt_count: usize,
}

pub fn server_info(reg: &Registry) -> ServerInfo {
    ServerInfo {
        name: "mxgenius-mcp",
        version: mxgenius_shared::PACKAGE_VERSION,
        tool_count: reg.list_tools().len(),
        resource_count: reg.list_resources().len(),
        prompt_count: reg.list_prompts().len(),
    }
}

pub fn stub_input_value() -> Value {
    Value::Object(Default::default())
}

/// Default registry with all 50 tools, the application services wired in,
/// the resource templates, and the orchestration prompts.
pub fn default_registry(
    case_service: Arc<dyn CaseService>,
    evidence_service: Arc<dyn EvidenceStore>,
) -> Registry {
    registry_with_adapters(
        case_service,
        evidence_service,
        RegistryAdapters {
            manual: Arc::new(FixtureManualCorpusAdapter),
            jetnet: Arc::new(FixtureJetNetAdapter),
            aircraft_catalog: Arc::new(InMemoryAircraftCatalog::default()),
            faa_ad: Arc::new(NotConfiguredFaaAdAdapter),
            saib: Arc::new(NotConfiguredSaibAdapter),
            allow_fixture_compliance: true,
        },
    )
}

#[derive(Clone)]
pub struct RegistryAdapters {
    pub manual: Arc<dyn mxgenius_shared::adapters::manual::ManualCorpusAdapter>,
    pub jetnet: Arc<dyn mxgenius_shared::adapters::jetnet::JetNetAdapter>,
    pub aircraft_catalog: Arc<dyn crate::application::aircraft_catalog::AircraftCatalog>,
    pub faa_ad: Arc<dyn mxgenius_shared::adapters::faa::FaaAdAdapter>,
    pub saib: Arc<dyn mxgenius_shared::adapters::faa::SaibAdapter>,
    pub allow_fixture_compliance: bool,
}

pub fn registry_with_adapters(
    case_service: Arc<dyn CaseService>,
    evidence_service: Arc<dyn EvidenceStore>,
    adapters: RegistryAdapters,
) -> Registry {
    let mut reg = Registry::new();
    super::handlers::register_all(&mut reg, case_service, evidence_service, adapters);
    super::resources::register_all(&mut reg);
    super::prompts::register_all(&mut reg);
    reg
}
