//! Safe semantic browser guidance: `mxg.ui.guide`.

use std::sync::Arc;

use async_trait::async_trait;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{EnvironmentDescribeRequest, UiGuideRequest, UiGuideResponse};

use crate::application::environment_manifest;
use crate::handlers::spec;
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(registry: &mut Registry) {
    registry.register_typed_tool(wrap(Arc::new(UiGuideTool)));
}

pub struct UiGuideTool;

#[async_trait]
impl Tool for UiGuideTool {
    type Request = UiGuideRequest;
    type Response = UiGuideResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.ui.guide",
            "Guide the MXGenius Interface",
            "Prepare a safe, reversible browser guide for one canonical environment target. Use behavior=auto only when the user explicitly asks to be shown, guided, or taken there; otherwise use behavior=offer. This tool accepts no selectors or scripts and cannot submit, approve, delete, or mutate business records.",
            Action::CaseRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: UiGuideRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        input.validate().map_err(invalid_input)?;
        environment_manifest::describe(&EnvironmentDescribeRequest {
            surface_id: Some(input.surface_id.clone()),
            target_id: Some(input.target_id.clone()),
        })
        .map_err(invalid_input)?;

        let output = UiGuideResponse {
            surface_id: input.surface_id.trim().to_owned(),
            target_id: input.target_id.trim().to_owned(),
            guidance: input.guidance.trim().to_owned(),
            behavior: input.behavior,
        };
        let mut envelope = CapabilityEnvelope::new(ctx.request_id.0, output);
        envelope.confidence.score = 1.0;
        envelope.confidence.explanation =
            "the semantic target and surface ownership were verified against the shared environment manifest"
                .into();
        Ok(envelope)
    }
}

fn invalid_input(message: String) -> EnvelopeError {
    EnvelopeError {
        code: StableErrorCode::InvalidInput,
        severity: "error".into(),
        message,
        retryable: false,
    }
}
