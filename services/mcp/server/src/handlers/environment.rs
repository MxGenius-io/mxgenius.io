//! Model-callable stable product orientation: `mxg.environment.describe`.

use std::sync::Arc;

use async_trait::async_trait;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{EnvironmentDescribeRequest, EnvironmentDescribeResponse};

use crate::application::environment_manifest;
use crate::handlers::spec;
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(registry: &mut Registry) {
    registry.register_typed_tool(wrap(Arc::new(EnvironmentDescribeTool)));
}

pub struct EnvironmentDescribeTool;

#[async_trait]
impl Tool for EnvironmentDescribeTool {
    type Request = EnvironmentDescribeRequest;
    type Response = EnvironmentDescribeResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.environment.describe",
            "Describe MXGenius Environment",
            "Describe stable MXGenius surfaces, purposes, capabilities, terminology, and semantic guidance targets. Use surface_id or target_id for detail. Current UI, case, role, readiness, and selection state are supplied separately and are never inferred by this tool.",
            Action::CaseRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: EnvironmentDescribeRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let output = environment_manifest::describe(&input).map_err(|message| EnvelopeError {
            code: StableErrorCode::InvalidInput,
            severity: "error".into(),
            message,
            retryable: false,
        })?;
        let mut envelope = CapabilityEnvelope::new(ctx.request_id.0, output);
        envelope.confidence.score = 1.0;
        envelope.confidence.explanation =
            "product orientation came from the compiled shared environment manifest".into();
        Ok(envelope)
    }
}
