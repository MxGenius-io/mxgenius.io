//! JSON-RPC 2.0 dispatcher. Both Streamable HTTP and stdio transports funnel
//! into the same `dispatch` method. The dispatcher resolves the trusted
//! execution context from the inbound `ExecutionContextProvider` and the
//! request, then routes to the appropriate tool/resource/prompt handler.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use time::OffsetDateTime;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::CapabilityEnvelope;
use mxgenius_shared::application::envelope::EnvelopeError;
use mxgenius_shared::application::errors::StableErrorCode;

use crate::context::{AuthError, AuthRequest, ContextProvider, TrustedContextInputs};
use crate::error::ServerError;
use crate::registry::Registry;
use crate::telemetry::{record, CapabilityTrace};

#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub id: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl From<ServerError> for JsonRpcError {
    fn from(err: ServerError) -> Self {
        let code = match err {
            ServerError::InvalidRequest(_) => -32600,
            ServerError::UnknownMethod(_)
            | ServerError::UnknownTool(_)
            | ServerError::UnknownResource(_)
            | ServerError::UnknownPrompt(_) => -32601,
            _ => -32603,
        };
        Self {
            code,
            message: err.to_string(),
            data: None,
        }
    }
}

#[derive(Clone)]
pub struct Dispatcher {
    registry: Registry,
    auth: ContextProvider,
}

impl Dispatcher {
    pub fn new(registry: Registry, auth: ContextProvider) -> Self {
        Self { registry, auth }
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    /// Resolve trusted application identity for non-MCP HTTP surfaces that
    /// share this server boundary (for example, Realtime SDP exchange).
    pub async fn authenticate(
        &self,
        auth_request: &AuthRequest,
    ) -> Result<ExecutionContext, AuthError> {
        self.auth.provide(auth_request).await
    }

    /// Whether `id` is null/absent (a notification). Notifications do not
    /// receive a normal response.
    pub fn is_notification(id: &Value) -> bool {
        id.is_null()
    }

    pub async fn dispatch(&self, req: JsonRpcRequest) -> Option<JsonRpcResponse> {
        self.dispatch_with_auth(req, AuthRequest::default()).await
    }

    pub async fn dispatch_with_auth(
        &self,
        req: JsonRpcRequest,
        auth_request: AuthRequest,
    ) -> Option<JsonRpcResponse> {
        let is_notification = Self::is_notification(&req.id);
        if req.jsonrpc != "2.0" {
            if is_notification {
                return None;
            }
            return Some(JsonRpcResponse {
                jsonrpc: "2.0",
                id: req.id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32600,
                    message: "jsonrpc must be \"2.0\"".into(),
                    data: None,
                }),
            });
        }
        let ctx = match self.auth.provide(&auth_request).await {
            Ok(c) => c,
            Err(err) => {
                if is_notification {
                    return None;
                }
                return Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: req.id,
                    result: None,
                    error: Some(self.auth_error_to_rpc(err)),
                });
            }
        };
        let result = self.handle(&ctx, req.params.clone(), &req.method).await;
        if is_notification {
            return None;
        }
        Some(match result {
            Ok(value) => JsonRpcResponse {
                jsonrpc: "2.0",
                id: req.id,
                result: Some(value),
                error: None,
            },
            Err(err) => JsonRpcResponse {
                jsonrpc: "2.0",
                id: req.id,
                result: None,
                error: Some(err.into()),
            },
        })
    }

    fn auth_error_to_rpc(&self, err: AuthError) -> JsonRpcError {
        use AuthError::*;
        let code = match err {
            Required => -32001,
            InvalidToken(_) => -32002,
            TenantMismatch => -32003,
            Internal(_) => -32603,
        };
        JsonRpcError {
            code,
            message: err.to_string(),
            data: Some(json!({ "stable_code": match &err {
                Required => "AUTH_REQUIRED",
                InvalidToken(_) => "ACCESS_DENIED",
                TenantMismatch => "TENANT_MISMATCH",
                Internal(_) => "INTERNAL_ERROR",
            }})),
        }
    }

    async fn handle(
        &self,
        ctx: &ExecutionContext,
        params: Value,
        method: &str,
    ) -> Result<Value, ServerError> {
        match method {
            "initialize" => Ok(self.initialize(&params)),
            "tools/list" => Ok(self.list_tools()),
            "tools/call" => self.call_tool(ctx, params).await,
            "resources/list" => Ok(self.list_resources()),
            "resources/read" => self.read_resource(params),
            "prompts/list" => Ok(self.list_prompts()),
            "prompts/get" => self.get_prompt(params),
            "notifications/initialized" => Ok(Value::Null),
            other => Err(ServerError::UnknownMethod(other.to_string())),
        }
    }

    fn initialize(&self, _params: &Value) -> Value {
        let info = crate::registry::server_info(&self.registry);
        json!({
            "protocolVersion": "2025-11-25",
            "serverInfo": {
                "name": info.name,
                "version": info.version
            },
            "capabilities": {
                "tools": { "listChanged": false },
                "resources": { "subscribe": false },
                "prompts": { "listChanged": false }
            }
        })
    }

    fn list_tools(&self) -> Value {
        let tools: Vec<Value> = self
            .registry
            .list_tools()
            .into_iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "title": t.title,
                    "description": t.description,
                    "inputSchema": t.input_schema,
                    "outputSchema": t.output_schema,
                    "meta": {
                        "tool_version": t.tool_version,
                        "input_schema_version": t.input_schema_version,
                        "output_schema_version": t.output_schema_version,
                        "domain_schema_version": t.domain_schema_version,
                        "requires_human_approval": t.requires_human_approval
                    }
                })
            })
            .collect();
        json!({ "tools": tools })
    }

    fn list_resources(&self) -> Value {
        let resources: Vec<Value> = self
            .registry
            .list_resources()
            .into_iter()
            .map(|r| {
                json!({
                    "uri": r.uri_template,
                    "name": r.name,
                    "description": r.description,
                    "mimeType": r.mime_type
                })
            })
            .collect();
        json!({ "resources": resources })
    }

    fn list_prompts(&self) -> Value {
        let prompts: Vec<Value> = self
            .registry
            .list_prompts()
            .into_iter()
            .map(|p| {
                json!({
                    "name": p.name,
                    "title": p.title,
                    "description": p.description,
                    "arguments": p.arguments
                })
            })
            .collect();
        json!({ "prompts": prompts })
    }

    async fn call_tool(&self, ctx: &ExecutionContext, params: Value) -> Result<Value, ServerError> {
        let tool_name = params
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ServerError::InvalidRequest("tools/call requires params.name".into()))?
            .to_string();
        let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
        let tool = self
            .registry
            .tool(&tool_name)
            .ok_or_else(|| ServerError::UnknownTool(tool_name.clone()))?;
        let started = OffsetDateTime::now_utc();
        let envelope = tool.invoke(ctx, arguments).await;
        let completed = OffsetDateTime::now_utc();
        let trace = match &envelope {
            Ok(env) => CapabilityTrace {
                trace_id: env.trace_id,
                request_id: env.request_id,
                correlation_id: ctx.correlation_id.0,
                tool_name: tool_name.clone(),
                tool_version: tool.spec().tool_version.clone(),
                input_schema_version: tool.spec().input_schema_version.clone(),
                output_schema_version: tool.spec().output_schema_version.clone(),
                domain_schema_version: tool.spec().domain_schema_version.clone(),
                organization_id: ctx.organization_id.0,
                user_id: ctx.user_id.0,
                role: ctx.role.as_str().to_string(),
                case_id: ctx.case_id.map(|c| c.0),
                started_at: started,
                completed_at: completed,
                latency_ms: (completed - started).whole_milliseconds() as i64,
                status: format!("{:?}", env.status),
                evidence_ids: env.evidence.iter().map(|e| e.evidence_id.0).collect(),
                confidence_basis: Some(format!("{:?}", env.confidence.basis)),
                approval_required: env.requires_human_approval,
                approval_result: None,
                error_codes: env
                    .errors
                    .iter()
                    .map(|e| e.code.as_str().to_string())
                    .collect(),
            },
            Err(err) => CapabilityTrace {
                trace_id: uuid::Uuid::new_v4(),
                request_id: ctx.request_id.0,
                correlation_id: ctx.correlation_id.0,
                tool_name: tool_name.clone(),
                tool_version: tool.spec().tool_version.clone(),
                input_schema_version: tool.spec().input_schema_version.clone(),
                output_schema_version: tool.spec().output_schema_version.clone(),
                domain_schema_version: tool.spec().domain_schema_version.clone(),
                organization_id: ctx.organization_id.0,
                user_id: ctx.user_id.0,
                role: ctx.role.as_str().to_string(),
                case_id: ctx.case_id.map(|c| c.0),
                started_at: started,
                completed_at: completed,
                latency_ms: (completed - started).whole_milliseconds() as i64,
                status: "error".into(),
                evidence_ids: vec![],
                confidence_basis: None,
                approval_required: false,
                approval_result: None,
                error_codes: vec![err.code.as_str().to_string()],
            },
        };
        record(&trace);
        let envelope = envelope
            .map_err(|e| ServerError::Internal(format!("{}: {}", e.code.as_str(), e.message)))?;
        Ok(serde_json::to_value(envelope)?)
    }

    fn read_resource(&self, params: Value) -> Result<Value, ServerError> {
        let uri = params.get("uri").and_then(|v| v.as_str()).ok_or_else(|| {
            ServerError::InvalidRequest("resources/read requires params.uri".into())
        })?;
        let spec = self
            .registry
            .resource(uri)
            .ok_or_else(|| ServerError::UnknownResource(uri.to_string()))?;
        Ok(json!({
            "uri": spec.uri_template,
            "mimeType": spec.mime_type,
            "text": serde_json::to_string_pretty(&spec.shape)?,
        }))
    }

    fn get_prompt(&self, params: Value) -> Result<Value, ServerError> {
        let name = params.get("name").and_then(|v| v.as_str()).ok_or_else(|| {
            ServerError::InvalidRequest("prompts/get requires params.name".into())
        })?;
        let spec = self
            .registry
            .prompt(name)
            .ok_or_else(|| ServerError::UnknownPrompt(name.to_string()))?;
        Ok(json!({
            "name": spec.name,
            "description": spec.description,
            "messages": [{ "role": "user", "content": spec.template }]
        }))
    }
}

// Lint satisfaction
#[allow(dead_code)]
fn _ctx(_: &Arc<TrustedContextInputs>, _: CapabilityEnvelope<()>, _: EnvelopeError) {}
#[allow(dead_code)]
fn _code(_: StableErrorCode) {}
