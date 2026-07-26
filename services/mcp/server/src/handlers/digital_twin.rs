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
    DigitalTwinListModelsRequest, DigitalTwinListModelsResponse, TwinMeshDto, TwinModelDto,
};
use mxgenius_shared::domain::datetime::UtcDateTime;
use mxgenius_shared::domain::evidence::ConfidenceBasis;
use mxgenius_shared::domain::ids::{ModelId, TwinModelId};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::case_service::CaseService;
use crate::handlers::{not_configured, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    case_service: Arc<dyn CaseService>,
    pool: Option<sqlx::PgPool>,
) {
    if let Some(pool) = pool {
        reg.register_typed_tool(wrap(Arc::new(DigitalTwinListModelsTool {
            pool: pool.clone(),
        })));
        reg.register_typed_tool(wrap(Arc::new(DigitalTwinHighlightZoneTool {
            pool: pool.clone(),
        })));
    } else {
        reg.register_typed_tool(wrap(not_configured::<
            DigitalTwinListModelsRequest,
            DigitalTwinListModelsResponse,
            _,
        >(
            "mxg.digital_twin.list_models",
            "List Twin Models",
            "Return uploaded DigitalTwinModel entries with revision, applicability, and mesh inventory.",
            Action::TwinRead,
            |_input| DigitalTwinListModelsResponse { models: vec![] },
        )));
        reg.register_typed_tool(wrap(not_configured::<
            DigitalTwinHighlightZoneRequest,
            DigitalTwinHighlightZoneResponse,
            _,
        >(
            "mxg.digital_twin.highlight_zone",
            "Highlight Zone",
            "Set the user's current model highlight by mesh, component, or zone.",
            Action::TwinRead,
            |input| DigitalTwinHighlightZoneResponse {
                model_id: input.model_id,
                mesh_ids: vec![],
                mesh_path: input.mesh_path,
                component_id: input.component_id,
                zone_id: input.zone_id,
                source: None,
                camera_preset: None,
                annotation_ids: vec![],
                updated_at: None,
            },
        )));
    }
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

fn internal_error(message: impl Into<String>) -> EnvelopeError {
    EnvelopeError {
        code: StableErrorCode::InternalError,
        severity: "error".into(),
        message: message.into(),
        retryable: true,
    }
}

fn invalid_input(message: impl Into<String>) -> EnvelopeError {
    EnvelopeError {
        code: StableErrorCode::InvalidInput,
        severity: "error".into(),
        message: message.into(),
        retryable: false,
    }
}

fn entity_not_found(message: impl Into<String>) -> EnvelopeError {
    EnvelopeError {
        code: StableErrorCode::EntityNotFound,
        severity: "error".into(),
        message: message.into(),
        retryable: false,
    }
}

struct DigitalTwinListModelsTool {
    pool: sqlx::PgPool,
}

#[async_trait]
impl Tool for DigitalTwinListModelsTool {
    type Request = DigitalTwinListModelsRequest;
    type Response = DigitalTwinListModelsResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.digital_twin.list_models",
            "List Twin Models",
            "List tenant-uploaded GLB models and their model-readable mesh/node inventories.",
            Action::TwinRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Self::Request,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let rows: Vec<(
            Uuid,
            String,
            String,
            String,
            Vec<String>,
            Value,
            OffsetDateTime,
        )> = sqlx::query_as(
            r#"SELECT id,name,revision,lod,applicable_aircraft,mesh_manifest,updated_at
                   FROM digital_twin_models
                   WHERE organization_id=$1
                     AND ($2::text IS NULL OR lower(name) LIKE '%' || lower($2) || '%'
                          OR EXISTS (SELECT 1 FROM unnest(applicable_aircraft) a
                                     WHERE lower(a) LIKE '%' || lower($2) || '%'))
                     AND ($3::text IS NULL OR lower(name) LIKE '%' || lower($3) || '%')
                     AND ($4::text IS NULL OR mesh_manifest::text ILIKE '%' || $4 || '%')
                   ORDER BY updated_at DESC
                   LIMIT 100"#,
        )
        .bind(ctx.organization_id.0)
        .bind(input.aircraft_type.as_deref())
        .bind(input.model.as_deref())
        .bind(input.component.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|error| internal_error(format!("digital twin catalog query failed: {error}")))?;
        let models = rows
            .into_iter()
            .map(
                |(id, name, revision, lod, applicable_aircraft, manifest, updated_at)| {
                    let mesh_manifest =
                        serde_json::from_value::<Vec<TwinMeshDto>>(manifest).unwrap_or_default();
                    TwinModelDto {
                        id: TwinModelId(id),
                        name,
                        revision,
                        lod,
                        applicable_aircraft,
                        resource_url: format!("/api/digital-twin/models/{id}/content"),
                        mesh_manifest,
                        freshness: Some(UtcDateTime(updated_at)),
                    }
                },
            )
            .collect();
        let mut envelope =
            CapabilityEnvelope::new(ctx.request_id.0, DigitalTwinListModelsResponse { models });
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        envelope.confidence.explanation =
            "Tenant-scoped uploaded model catalog and parsed GLB metadata.".into();
        Ok(envelope)
    }
}

struct DigitalTwinHighlightZoneTool {
    pool: sqlx::PgPool,
}

#[async_trait]
impl Tool for DigitalTwinHighlightZoneTool {
    type Request = DigitalTwinHighlightZoneRequest;
    type Response = DigitalTwinHighlightZoneResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.digital_twin.highlight_zone",
            "Highlight Mesh or Zone",
            "Set a mesh highlight in the active 3D viewer, or set read_current=true to read the user's exact raycast/model highlight. Use list_models first to obtain model and mesh IDs.",
            Action::TwinRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Self::Request,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        if input.read_current {
            let row: Option<(
                Uuid,
                Value,
                Option<String>,
                Option<String>,
                Option<String>,
                String,
                OffsetDateTime,
            )> = sqlx::query_as(
                r#"SELECT model_id,mesh_ids,mesh_path,component_id,zone_id,source,updated_at
                   FROM digital_twin_highlight_state
                   WHERE organization_id=$1 AND user_id=$2"#,
            )
            .bind(ctx.organization_id.0)
            .bind(ctx.user_id.0)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| {
                internal_error(format!("digital twin highlight query failed: {error}"))
            })?;
            let output = row.map_or(
                DigitalTwinHighlightZoneResponse {
                    model_id: None,
                    mesh_ids: vec![],
                    mesh_path: None,
                    component_id: None,
                    zone_id: None,
                    source: None,
                    camera_preset: None,
                    annotation_ids: vec![],
                    updated_at: None,
                },
                |(model_id, mesh_ids, mesh_path, component_id, zone_id, source, updated_at)| {
                    DigitalTwinHighlightZoneResponse {
                        model_id: Some(ModelId(model_id)),
                        mesh_ids: serde_json::from_value(mesh_ids).unwrap_or_default(),
                        mesh_path,
                        component_id,
                        zone_id,
                        source: Some(source),
                        camera_preset: None,
                        annotation_ids: vec![],
                        updated_at: Some(UtcDateTime(updated_at)),
                    }
                },
            );
            let mut envelope = CapabilityEnvelope::new(ctx.request_id.0, output);
            envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
            envelope.confidence.explanation = "Current tenant/user viewer highlight state.".into();
            return Ok(envelope);
        }
        let model_id = input
            .model_id
            .ok_or_else(|| invalid_input("model_id is required when setting a highlight"))?;
        let selector = input
            .mesh_id
            .as_deref()
            .or(input.component_id.as_deref())
            .or(input.zone_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid_input("mesh_id, component_id, or zone_id is required"))?;
        let manifest: Option<Value> = sqlx::query_scalar(
            "SELECT mesh_manifest FROM digital_twin_models WHERE organization_id=$1 AND id=$2",
        )
        .bind(ctx.organization_id.0)
        .bind(model_id.0)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| internal_error(format!("digital twin model query failed: {error}")))?;
        let manifest = manifest.ok_or_else(|| entity_not_found("digital twin model not found"))?;
        let meshes = serde_json::from_value::<Vec<TwinMeshDto>>(manifest).unwrap_or_default();
        let selected = meshes
            .iter()
            .find(|mesh| mesh.mesh_id.eq_ignore_ascii_case(selector))
            .or_else(|| {
                meshes.iter().find(|mesh| {
                    mesh.mesh_id
                        .to_lowercase()
                        .contains(&selector.to_lowercase())
                })
            })
            .ok_or_else(|| entity_not_found(format!("mesh selector '{selector}' was not found")))?;
        let mesh_ids = vec![selected.mesh_id.clone()];
        sqlx::query(
            r#"INSERT INTO digital_twin_highlight_state
               (organization_id,user_id,model_id,mesh_ids,mesh_path,component_id,zone_id,source,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'model_tool',now())
               ON CONFLICT (organization_id,user_id) DO UPDATE SET
                 model_id=EXCLUDED.model_id, mesh_ids=EXCLUDED.mesh_ids,
                 mesh_path=EXCLUDED.mesh_path, component_id=EXCLUDED.component_id,
                 zone_id=EXCLUDED.zone_id, source=EXCLUDED.source, updated_at=now()"#,
        )
        .bind(ctx.organization_id.0)
        .bind(ctx.user_id.0)
        .bind(model_id.0)
        .bind(serde_json::json!(mesh_ids))
        .bind(input.mesh_path.as_deref())
        .bind(input.component_id.as_deref())
        .bind(input.zone_id.as_deref())
        .execute(&self.pool)
        .await
        .map_err(|error| internal_error(format!("digital twin highlight update failed: {error}")))?;
        let output = DigitalTwinHighlightZoneResponse {
            model_id: Some(model_id),
            mesh_ids,
            mesh_path: input.mesh_path,
            component_id: input.component_id,
            zone_id: input.zone_id,
            source: Some("model_tool".into()),
            camera_preset: Some("fit_selection".into()),
            annotation_ids: vec![],
            updated_at: Some(UtcDateTime::now()),
        };
        let mut envelope = CapabilityEnvelope::new(ctx.request_id.0, output);
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        envelope.confidence.explanation =
            "Mesh selector was resolved against the parsed uploaded GLB manifest.".into();
        Ok(envelope)
    }
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
