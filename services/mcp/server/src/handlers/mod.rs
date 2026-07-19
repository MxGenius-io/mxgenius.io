//! Tool handler module: registers all 50 v1 tools. Each tool has its own
//! request and response contract from `mxgenius-shared::contracts::*`.
//!
//! The first vertical slice (aircraft.lookup, aircraft.profile,
//! maintenance_case.create, maintenance_case.get,
//! maintenance_case.build_context, evidence.collect) is backed by fixture
//! data and an in-memory case repository. Every other tool returns a
//! typed `NOT_CONFIGURED` envelope with no invented operational facts.

use std::sync::Arc;

use async_trait::async_trait;
use schemars::gen::SchemaGenerator;
use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{
    CapabilityEnvelope, EnvelopeError, EnvelopeStatus, PromotionState,
};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;

use crate::registry::Registry;
use crate::tool::{Tool, ToolSpec};

pub mod aircraft;
pub mod analytics;
pub mod case;
pub mod compliance;
pub mod digital_twin;
pub mod evidence;
pub mod mro;
pub mod parts;
pub mod scheduling;
pub mod weather;

pub fn register_all(
    reg: &mut Registry,
    case_service: std::sync::Arc<dyn crate::application::case_service::CaseService>,
    evidence_service: std::sync::Arc<dyn crate::application::evidence_service::EvidenceStore>,
    adapters: crate::registry::RegistryAdapters,
) {
    aircraft::register(reg, adapters.jetnet, adapters.aircraft_catalog.clone());
    case::register(
        reg,
        case_service.clone(),
        adapters.manual,
        adapters.allow_fixture_compliance,
    );
    parts::register(reg);
    mro::register(reg);
    weather::register(reg);
    compliance::register(
        reg,
        adapters.aircraft_catalog,
        adapters.faa_ad,
        adapters.saib,
    );
    digital_twin::register(reg, case_service);
    scheduling::register(reg);
    evidence::register(reg, evidence_service);
    analytics::register(reg);
}

fn schema_generator() -> SchemaGenerator {
    let settings = schemars::gen::SchemaSettings::openapi3();
    SchemaGenerator::new(settings)
}

fn input_schema_for<T: JsonSchema>() -> Value {
    let gen = schema_generator();
    serde_json::to_value(gen.into_root_schema_for::<T>())
        .unwrap_or_else(|_| json!({"type": "object"}))
}

/// Build the output envelope schema: a hand-rolled envelope shape with
/// `output` typed to the tool's response. We avoid deriving JsonSchema on
/// `CapabilityEnvelope<T>` because that would force the envelope to require
/// `T: JsonSchema` even when callers only need a `serde_json::Value` body.
fn output_schema_for<T: JsonSchema>() -> Value {
    let gen = schema_generator();
    let output_schema = serde_json::to_value(gen.into_root_schema_for::<T>())
        .unwrap_or_else(|_| json!({"type": "object"}));
    mxgenius_shared::schemas::envelope_schema_with_output(output_schema)
}

pub fn spec<I: JsonSchema, O: JsonSchema>(
    name: &str,
    title: &str,
    description: &str,
    action: Action,
    requires_human_approval: bool,
) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        title: title.into(),
        description: description.into(),
        input_schema: input_schema_for::<I>(),
        output_schema: output_schema_for::<O>(),
        tool_version: mxgenius_shared::PACKAGE_VERSION.to_string(),
        input_schema_version: "1.0.0".into(),
        output_schema_version: "1.0.0".into(),
        domain_schema_version: "1.0.0".into(),
        action,
        requires_human_approval,
    }
}

/// A typed handler that always returns a `NOT_CONFIGURED` envelope. The
/// `default_factory` produces a fresh typed response from the request,
/// so the caller can echo identifiers into the response (no invented facts).
pub struct NotConfiguredTool<Req, Resp> {
    pub tool_spec: ToolSpec,
    pub default_factory: Box<dyn Fn(Req) -> Resp + Send + Sync>,
    _phantom: std::marker::PhantomData<(Req, Resp)>,
}

impl<Req, Resp> NotConfiguredTool<Req, Resp>
where
    Req: DeserializeOwned + JsonSchema + Send + Sync + 'static,
    Resp: Serialize + JsonSchema + Send + Sync + 'static,
{
    pub fn new<F>(
        name: &str,
        title: &str,
        description: &str,
        action: Action,
        requires_human_approval: bool,
        default_factory: F,
    ) -> Self
    where
        F: Fn(Req) -> Resp + Send + Sync + 'static,
    {
        Self {
            tool_spec: spec::<Req, Resp>(name, title, description, action, requires_human_approval),
            default_factory: Box::new(default_factory),
            _phantom: std::marker::PhantomData,
        }
    }
}

#[async_trait]
impl<Req, Resp> Tool for NotConfiguredTool<Req, Resp>
where
    Req: DeserializeOwned + JsonSchema + Send + Sync + 'static,
    Resp: Serialize + JsonSchema + Send + Sync + 'static,
{
    type Request = Req;
    type Response = Resp;

    fn spec(&self) -> ToolSpec {
        self.tool_spec.clone()
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Req,
    ) -> Result<CapabilityEnvelope<Resp>, EnvelopeError> {
        let tool_name = self.tool_spec.name.clone();
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, (self.default_factory)(input));
        env.status = EnvelopeStatus::Partial;
        env.promotion_state = PromotionState::Shadow;
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "warn".into(),
            message: format!("{tool_name} is not configured in this build"),
            retryable: false,
        });
        env.confidence.score = 0.0;
        env.confidence.basis = mxgenius_shared::domain::evidence::ConfidenceBasis::ModelOnly;
        env.confidence.explanation = "no live adapter; typed contract returned default".into();
        Ok(env)
    }
}

pub(crate) fn not_configured<Req, Resp, F>(
    name: &str,
    title: &str,
    description: &str,
    action: Action,
    default_factory: F,
) -> Arc<dyn Tool<Request = Req, Response = Resp>>
where
    Req: DeserializeOwned + JsonSchema + Send + Sync + 'static,
    Resp: Serialize + JsonSchema + Send + Sync + 'static,
    F: Fn(Req) -> Resp + Send + Sync + 'static,
{
    Arc::new(NotConfiguredTool::<Req, Resp>::new(
        name,
        title,
        description,
        action,
        false,
        default_factory,
    ))
}

pub(crate) fn not_configured_mutating<Req, Resp, F>(
    name: &str,
    title: &str,
    description: &str,
    action: Action,
    default_factory: F,
) -> Arc<dyn Tool<Request = Req, Response = Resp>>
where
    Req: DeserializeOwned + JsonSchema + Send + Sync + 'static,
    Resp: Serialize + JsonSchema + Send + Sync + 'static,
    F: Fn(Req) -> Resp + Send + Sync + 'static,
{
    Arc::new(NotConfiguredTool::<Req, Resp>::new(
        name,
        title,
        description,
        action,
        true,
        default_factory,
    ))
}
