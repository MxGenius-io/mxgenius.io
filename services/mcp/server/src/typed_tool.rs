//! Wire-facing tool trait with `serde_json::Value` at the boundary.
//!
//! Each `TypedTool` wraps an inner typed `Tool<Req, Resp>` and handles
//! JSON deserialization/serialization, schema publication, capability
//! tracing, and policy enforcement at the dispatcher seam.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::{PolicyDecision, PolicyMatrix};

use crate::tool::{Tool, ToolSpec};

/// A tool as the dispatcher sees it. The wire format is `serde_json::Value`;
/// the inner tool is generic over its concrete request/response types.
#[async_trait]
pub trait TypedTool: Send + Sync {
    fn spec(&self) -> ToolSpec;
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        arguments: Value,
    ) -> Result<CapabilityEnvelope<Value>, EnvelopeError>;
}

/// Adapter from typed `Tool<Req, Resp>` to the wire-facing `TypedTool`.
pub struct TypedToolImpl<Req, Resp> {
    inner: Arc<dyn Tool<Request = Req, Response = Resp>>,
    _phantom: std::marker::PhantomData<(Req, Resp)>,
}

impl<Req, Resp> TypedToolImpl<Req, Resp> {
    pub fn new(inner: Arc<dyn Tool<Request = Req, Response = Resp>>) -> Self {
        Self {
            inner,
            _phantom: std::marker::PhantomData,
        }
    }
}

#[async_trait]
impl<Req, Resp> TypedTool for TypedToolImpl<Req, Resp>
where
    Req: serde::de::DeserializeOwned + schemars::JsonSchema + Send + Sync + 'static,
    Resp: serde::Serialize + schemars::JsonSchema + Send + Sync + 'static,
{
    fn spec(&self) -> ToolSpec {
        self.inner.spec()
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        arguments: Value,
    ) -> Result<CapabilityEnvelope<Value>, EnvelopeError> {
        if let Some(field) = trusted_context_override(&arguments) {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: format!(
                    "tool arguments cannot supply trusted execution-context field {field}"
                ),
                retryable: false,
            });
        }
        let spec = self.inner.spec();
        let decision = PolicyMatrix::is_authorized(ctx.role, spec.action);
        if decision == PolicyDecision::Deny {
            return Err(EnvelopeError {
                code: StableErrorCode::AccessDenied,
                severity: "error".into(),
                message: format!(
                    "role {} is not authorized for {}",
                    ctx.role.as_str(),
                    spec.name
                ),
                retryable: false,
            });
        }
        let confirmation_accepted =
            ctx.human_confirmed || confirmation_matches(ctx, &spec, &arguments);
        if (spec.requires_human_approval || decision == PolicyDecision::RequireHumanApproval)
            && !confirmation_accepted
        {
            return Err(EnvelopeError {
                code: StableErrorCode::HumanApprovalRequired,
                severity: "error".into(),
                message: format!("trusted human confirmation is required for {}", spec.name),
                retryable: false,
            });
        }
        let req: Req = match serde_json::from_value(arguments) {
            Ok(r) => r,
            Err(err) => {
                return Err(EnvelopeError {
                    code: mxgenius_shared::application::errors::StableErrorCode::InvalidInput,
                    severity: "error".into(),
                    message: format!("input validation failed: {err}"),
                    retryable: false,
                });
            }
        };
        // Inner domain services receive only the result of the trusted seam's
        // binding check, never a model- or transport-supplied boolean.
        let mut effective_context = ctx.clone();
        effective_context.human_confirmed = confirmation_accepted;
        let env = self.inner.invoke(&effective_context, req).await?;
        let output = serde_json::to_value(&env.output).map_err(|e| EnvelopeError {
            code: mxgenius_shared::application::errors::StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("output serialization failed: {e}"),
            retryable: false,
        })?;
        let out: CapabilityEnvelope<Value> = CapabilityEnvelope {
            request_id: env.request_id,
            status: env.status,
            output,
            evidence: env.evidence,
            confidence: env.confidence,
            warnings: env.warnings,
            errors: env.errors,
            trace_id: env.trace_id,
            requires_human_approval: env.requires_human_approval,
            promotion_state: env.promotion_state,
            completed_at: env.completed_at,
        };
        Ok(out)
    }
}

fn confirmation_matches(ctx: &ExecutionContext, spec: &ToolSpec, arguments: &Value) -> bool {
    let Some(grant) = &ctx.confirmation else {
        return false;
    };
    if grant.expires_at <= time::OffsetDateTime::now_utc() || grant.tool_name != spec.name {
        return false;
    }
    let object_id = arguments
        .get("case_id")
        .or_else(|| arguments.get("aircraft_id"))
        .or_else(|| arguments.get("part_id"))
        .and_then(Value::as_str);
    let object_version = arguments.get("expected_version").and_then(Value::as_i64);
    object_id == Some(grant.object_id.as_str()) && object_version == grant.object_version
}

fn trusted_context_override(arguments: &Value) -> Option<&str> {
    const FORBIDDEN: &[&str] = &[
        "confirm",
        "human_confirmed",
        "approval_granted",
        "tenant",
        "tenant_id",
        "organization_id",
        "user_id",
        "actor",
        "actor_user_id",
        "role",
    ];
    let object = arguments.as_object()?;
    FORBIDDEN
        .iter()
        .copied()
        .find(|field| object.contains_key(*field))
}

/// Helper to wrap a typed tool in a wire-facing `TypedTool`.
pub fn wrap<Req, Resp>(inner: Arc<dyn Tool<Request = Req, Response = Resp>>) -> Arc<dyn TypedTool>
where
    Req: serde::de::DeserializeOwned + schemars::JsonSchema + Send + Sync + 'static,
    Resp: serde::Serialize + schemars::JsonSchema + Send + Sync + 'static,
{
    Arc::new(TypedToolImpl::<Req, Resp>::new(inner))
}
