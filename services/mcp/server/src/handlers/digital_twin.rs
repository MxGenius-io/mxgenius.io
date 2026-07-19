//! Digital twin tool handlers (5): `mxg.digital_twin.*`.

use std::sync::Arc;

use async_trait::async_trait;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError};
use mxgenius_shared::application::errors::StableErrorCode;

use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    DigitalTwinAttachCaseMarkerRequest, DigitalTwinAttachCaseMarkerResponse,
    DigitalTwinComponentStateRequest, DigitalTwinComponentStateResponse,
    DigitalTwinHighlightZoneRequest, DigitalTwinHighlightZoneResponse,
    DigitalTwinLinkDocumentsRequest, DigitalTwinLinkDocumentsResponse,
    DigitalTwinListModelsRequest, DigitalTwinListModelsResponse,
};

use crate::application::case_service::CaseService;
use crate::handlers::{not_configured, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry, case_service: Arc<dyn CaseService>) {
    reg.register_typed_tool(wrap(not_configured::<
        DigitalTwinListModelsRequest,
        DigitalTwinListModelsResponse,
        _,
    >(
        "mxg.digital_twin.list_models",
        "List Twin Models",
        "Return DigitalTwinModel entries with IDs, files, revision, LOD, applicability.",
        Action::TwinRead,
        |_input| DigitalTwinListModelsResponse { models: vec![] },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        DigitalTwinComponentStateRequest,
        DigitalTwinComponentStateResponse,
        _,
    >(
        "mxg.digital_twin.component_state",
        "Component State",
        "Return canonical component, status, installation, observations, prior cases, evidence.",
        Action::TwinRead,
        |input| DigitalTwinComponentStateResponse {
            component: mxgenius_shared::contracts::ComponentStateDto {
                component_id: input.component_id,
                canonical: false,
                status: "unknown".into(),
                installation_zone: None,
                observations: vec![],
                prior_case_ids: vec![],
                evidence_ids: vec![],
            },
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        DigitalTwinHighlightZoneRequest,
        DigitalTwinHighlightZoneResponse,
        _,
    >(
        "mxg.digital_twin.highlight_zone",
        "Highlight Zone",
        "Return model ID, mesh IDs, zone ID, camera preset, and annotation IDs.",
        Action::TwinRead,
        |input| DigitalTwinHighlightZoneResponse {
            model_id: input.model_id,
            mesh_ids: vec![],
            zone_id: None,
            camera_preset: None,
            annotation_ids: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        DigitalTwinLinkDocumentsRequest,
        DigitalTwinLinkDocumentsResponse,
        _,
    >(
        "mxg.digital_twin.link_documents",
        "Link Documents",
        "Return applicable document sections, diagrams, evidence references, mapping confidence.",
        Action::TwinRead,
        |_input| DigitalTwinLinkDocumentsResponse { documents: vec![] },
    )));
    reg.register_typed_tool(wrap(Arc::new(DigitalTwinAttachCaseMarkerTool {
        service: case_service,
    })));
}

struct DigitalTwinAttachCaseMarkerTool {
    service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for DigitalTwinAttachCaseMarkerTool {
    type Request = DigitalTwinAttachCaseMarkerRequest;
    type Response = DigitalTwinAttachCaseMarkerResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.digital_twin.attach_case_marker",
            "Attach Case Marker",
            "Persist a case-scoped marker for a canonical component or zone.",
            Action::TwinAttachMarker,
            true,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Self::Request,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        input.validate().map_err(|message| EnvelopeError {
            code: StableErrorCode::InvalidInput,
            severity: "error".into(),
            message,
            retryable: false,
        })?;
        let (output, trace_id) = self
            .service
            .attach_twin_marker(ctx, &input)
            .await
            .map_err(EnvelopeError::from)?;
        let mut envelope = CapabilityEnvelope::new(ctx.request_id.0, output);
        envelope.trace_id = trace_id;
        envelope.confidence.basis =
            mxgenius_shared::domain::evidence::ConfidenceBasis::HumanConfirmed;
        envelope.requires_human_approval = true;
        Ok(envelope)
    }
}
