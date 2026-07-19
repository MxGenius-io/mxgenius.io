//! Stateless MCP Streamable HTTP transport at `POST /mcp`.
//! The runtime returns JSON responses and deliberately does not open an SSE
//! channel; `GET /mcp` therefore returns 405 as allowed by the protocol.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::confirmation::PostgresConfirmationGrantIssuer;
use crate::context::{AuthError, AuthRequest};
use crate::dispatcher::{Dispatcher, JsonRpcRequest};
use mxgenius_shared::domain::ids::{CorrelationId, OrganizationId};

const PROTOCOL_VERSION: &str = "2025-11-25";
const MAX_REALTIME_SDP_BYTES: usize = 64 * 1024;
const OPENAI_REALTIME_CALLS_URL: &str = "https://api.openai.com/v1/realtime/calls";
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const MAX_CHAT_MESSAGE_BYTES: usize = 20 * 1024;

#[derive(Clone)]
struct AppState {
    dispatcher: Dispatcher,
    health: HealthState,
    realtime_client: reqwest::Client,
    confirmation_issuer: Option<Arc<PostgresConfirmationGrantIssuer>>,
}

#[derive(Clone)]
pub enum HealthState {
    Local,
    Postgres(sqlx::PgPool),
}

pub fn router(dispatcher: Dispatcher) -> Router {
    router_with_health(dispatcher, HealthState::Local)
}

pub fn router_with_health(dispatcher: Dispatcher, health: HealthState) -> Router {
    let realtime_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .build()
        .expect("valid Realtime HTTP client configuration");
    let confirmation_issuer = match &health {
        HealthState::Postgres(pool) => std::env::var("MXGENIUS_CONFIRMATION_SECRET")
            .ok()
            .and_then(|secret| {
                PostgresConfirmationGrantIssuer::new(
                    pool.clone(),
                    secret.as_bytes(),
                    std::env::var("MXGENIUS_CONFIRMATION_ISSUER")
                        .unwrap_or_else(|_| "mxgenius-application".into()),
                    std::env::var("MXGENIUS_CONFIRMATION_AUDIENCE")
                        .unwrap_or_else(|_| "mxgenius-mcp".into()),
                )
                .ok()
            })
            .map(Arc::new),
        HealthState::Local => None,
    };
    let state = AppState {
        dispatcher,
        health,
        realtime_client,
        confirmation_issuer,
    };
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/adapterz", get(adapterz))
        .route("/chat", post(chat))
        .route("/confirmations", post(issue_confirmation))
        .route("/orchestration/cases/first-slice", post(first_case_slice))
        .route("/realtime/calls", post(create_realtime_call))
        .route("/mcp", get(method_not_allowed).post(handle))
        .with_state(state)
        .layer(cors_layer())
        .layer(TraceLayer::new_for_http())
}

fn cors_layer() -> CorsLayer {
    let configured = std::env::var("MXGENIUS_MCP_ALLOWED_ORIGINS").unwrap_or_else(|_| {
        "http://127.0.0.1,http://localhost,https://mxgenius.io,https://www.mxgenius.io".into()
    });
    let origins = configured
        .split(',')
        .filter_map(|value| HeaderValue::from_str(value.trim()).ok())
        .collect::<Vec<_>>();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::ACCEPT,
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static("mcp-protocol-version"),
            HeaderName::from_static("x-correlation-id"),
            HeaderName::from_static("x-mxg-confirmation-grant"),
            HeaderName::from_static("x-mxg-organization-id"),
        ])
        .expose_headers([
            HeaderName::from_static("x-correlation-id"),
            HeaderName::from_static("x-mxg-realtime-call-id"),
        ])
}

pub async fn serve(
    addr: SocketAddr,
    dispatcher: Dispatcher,
    health: HealthState,
) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(target: "mxgenius.mcp.http", "listening on http://{addr}/mcp");
    axum::serve(listener, router_with_health(dispatcher, health)).await?;
    Ok(())
}

async fn healthz() -> &'static str {
    "ok"
}

async fn readyz(State(state): State<AppState>) -> Response {
    match database_ready(&state.health).await {
        Ok(mode) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ready": true, "mode": mode,
                "database": if mode == "local" { "not_required" } else { "ready" }
            })),
        )
            .into_response(),
        Err(message) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "ready": false, "database": "unavailable", "reason": message
            })),
        )
            .into_response(),
    }
}

async fn adapterz(State(state): State<AppState>) -> Response {
    match database_ready(&state.health).await {
        Ok(mode) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "mode": mode,
                "core": {"persistence": if mode == "local" { "in_memory" } else { "postgres" }},
                "adapters": {
                    "aircraft": if mode == "local" { "fixture" } else { "not_configured" },
                    "manuals": if mode == "local" { "fixture" } else { "not_configured" },
                    "faa": "not_configured", "weather": "not_configured",
                    "parts": "not_configured", "mro": "not_configured",
                    "scheduling": "not_configured", "digital_twin": "not_configured"
                }
            })),
        )
            .into_response(),
        Err(message) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "mode": "production", "core": {"postgres": "unavailable"}, "reason": message
            })),
        )
            .into_response(),
    }
}

async fn database_ready(health: &HealthState) -> Result<&'static str, String> {
    match health {
        HealthState::Local => Ok("local"),
        HealthState::Postgres(pool) => sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(pool)
            .await
            .map(|_| "production")
            .map_err(|_| "database readiness check failed".into()),
    }
}

async fn method_not_allowed() -> StatusCode {
    StatusCode::METHOD_NOT_ALLOWED
}

#[derive(Debug, Deserialize)]
struct ConfirmationRequest {
    tool_name: String,
    arguments: Value,
    #[serde(default)]
    qualified_approval: bool,
}

async fn issue_confirmation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ConfirmationRequest>,
) -> Response {
    if !origin_allowed(&headers) {
        return realtime_error(
            StatusCode::FORBIDDEN,
            "ORIGIN_DENIED",
            "invalid Origin header",
        );
    }
    let mut auth = match auth_request(&headers) {
        Ok(value) => value,
        Err(message) => return realtime_error(StatusCode::BAD_REQUEST, "INVALID_REQUEST", message),
    };
    auth.confirmation_grant = None;
    let context = match state.dispatcher.authenticate(&auth).await {
        Ok(value) => value,
        Err(AuthError::Required | AuthError::InvalidToken(_)) => {
            return realtime_error(
                StatusCode::UNAUTHORIZED,
                "AUTH_REQUIRED",
                "authentication required",
            )
        }
        Err(AuthError::TenantMismatch) => {
            return realtime_error(
                StatusCode::FORBIDDEN,
                "TENANT_MISMATCH",
                "tenant access denied",
            )
        }
        Err(AuthError::Internal(_)) => {
            return realtime_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "authentication service unavailable",
            )
        }
    };
    let Some(spec) = state
        .dispatcher
        .registry()
        .tool(&input.tool_name)
        .map(|tool| tool.spec())
    else {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "UNKNOWN_CAPABILITY",
            "capability is not in the locked registry",
        );
    };
    if !spec.requires_human_approval {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "CONFIRMATION_NOT_REQUIRED",
            "capability does not accept an operational confirmation grant",
        );
    }
    let object_id = input
        .arguments
        .get("case_id")
        .or_else(|| input.arguments.get("aircraft_id"))
        .or_else(|| input.arguments.get("part_id"))
        .and_then(Value::as_str);
    let Some(object_id) = object_id else {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_CONFIRMATION_TARGET",
            "capability arguments do not identify a confirmable object",
        );
    };
    let object_version = input
        .arguments
        .get("expected_version")
        .and_then(Value::as_i64);
    let qualified_role = matches!(
        context.role,
        mxgenius_shared::application::policy::Role::Quality
            | mxgenius_shared::application::policy::Role::Manager
            | mxgenius_shared::application::policy::Role::Administrator
    );
    if input.qualified_approval && !qualified_role {
        return realtime_error(
            StatusCode::FORBIDDEN,
            "QUALIFIED_APPROVAL_DENIED",
            "the authenticated role cannot issue qualified approval",
        );
    }
    let Some(issuer) = &state.confirmation_issuer else {
        return realtime_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "CONFIRMATIONS_NOT_CONFIGURED",
            "confirmation grants are not configured",
        );
    };
    match issuer
        .issue(
            &context,
            &input.tool_name,
            object_id,
            object_version,
            input.qualified_approval,
        )
        .await
    {
        Ok(grant) => (StatusCode::CREATED, Json(grant)).into_response(),
        Err(error) => {
            tracing::error!(target: "mxgenius.confirmation", error = %error, correlation_id = %context.correlation_id, "confirmation grant issuance failed");
            realtime_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "CONFIRMATION_ISSUANCE_FAILED",
                "confirmation grant could not be issued",
            )
        }
    }
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    message: String,
    #[serde(default)]
    fleet_signals: Value,
    #[serde(default)]
    case_context: Option<Value>,
}

async fn chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ChatRequest>,
) -> Response {
    if !origin_allowed(&headers) {
        return realtime_error(
            StatusCode::FORBIDDEN,
            "ORIGIN_DENIED",
            "invalid Origin header",
        );
    }
    let message = input.message.trim();
    if message.is_empty() || message.len() > MAX_CHAT_MESSAGE_BYTES {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_MESSAGE",
            "message must be between 1 byte and 20 KiB",
        );
    }
    let mut auth = match auth_request(&headers) {
        Ok(value) => value,
        Err(message) => return realtime_error(StatusCode::BAD_REQUEST, "INVALID_REQUEST", message),
    };
    auth.confirmation_grant = None;
    let context = match state.dispatcher.authenticate(&auth).await {
        Ok(value) => value,
        Err(AuthError::Required | AuthError::InvalidToken(_)) => {
            return realtime_error(
                StatusCode::UNAUTHORIZED,
                "AUTH_REQUIRED",
                "authentication required",
            )
        }
        Err(AuthError::TenantMismatch) => {
            return realtime_error(
                StatusCode::FORBIDDEN,
                "TENANT_MISMATCH",
                "tenant access denied",
            )
        }
        Err(AuthError::Internal(_)) => {
            return realtime_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "authentication service unavailable",
            )
        }
    };
    let api_key = match std::env::var("OPENAI_API_KEY") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            return realtime_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "OPENAI_NOT_CONFIGURED",
                "OpenAI service is not configured",
            )
        }
    };

    let mut capability_trace = Vec::new();
    let authoritative_case_context = if let Some(case_id) = input
        .case_context
        .as_ref()
        .and_then(|value| value.get("case_id"))
        .and_then(Value::as_str)
    {
        let read_auth = AuthRequest {
            confirmation_grant: None,
            ..auth
        };
        let current = match invoke(
            &state.dispatcher,
            read_auth.clone(),
            "mxg.maintenance_case.get",
            json!({"case_id": case_id}),
        )
        .await
        {
            Ok(value) => value,
            Err(response) => return response,
        };
        capability_trace.push(trace_summary("mxg.maintenance_case.get", &current));
        let built = match invoke(
            &state.dispatcher,
            read_auth,
            "mxg.maintenance_case.build_context",
            json!({
                "case_id": case_id,
                "include": {
                    "documents": true, "compliance": true, "weather": true,
                    "parts": true, "facilities": true, "timeline": true
                }
            }),
        )
        .await
        {
            Ok(value) => value,
            Err(response) => return response,
        };
        capability_trace.push(trace_summary("mxg.maintenance_case.build_context", &built));
        json!({
            "case": current.pointer("/output/case").cloned().unwrap_or(Value::Null),
            "context": built.get("output").cloned().unwrap_or(Value::Null)
        })
    } else {
        Value::Null
    };
    let compatibility_signals = match &input.fleet_signals {
        Value::Array(items) => Value::Array(items.iter().take(50).cloned().collect()),
        _ => Value::Null,
    };
    let grounded_context = json!({
        "authoritative_case_context": authoritative_case_context,
        "compatibility_fleet_signals": compatibility_signals
    });
    let model =
        std::env::var("MXGENIUS_OPENAI_TEXT_MODEL").unwrap_or_else(|_| "gpt-5.6-sol".into());
    let request_body = json!({
        "model": model,
        "instructions": "You are the MXGenius aviation maintenance copilot. Base aircraft- and case-specific claims only on the supplied authoritative context. Clearly distinguish compatibility fleet signals from authoritative case evidence. Cite available document titles or evidence identifiers inline. If evidence is missing, partial, conflicting, stale, or not configured, say so. Never claim return-to-service authority and never claim an operational mutation occurred. Be concise and operationally useful.",
        "input": [{
            "role": "user",
            "content": [{
                "type": "input_text",
                "text": format!("User request:\n{message}\n\nMXGenius context (JSON):\n{grounded_context}")
            }]
        }],
        "reasoning": {"effort": "low"},
        "max_output_tokens": 1600,
        "store": false
    });
    let upstream = match state
        .realtime_client
        .post(OPENAI_RESPONSES_URL)
        .bearer_auth(api_key)
        .header(
            "OpenAI-Safety-Identifier",
            realtime_safety_identifier(&context),
        )
        .header("x-client-request-id", context.correlation_id.to_string())
        .json(&request_body)
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(target: "mxgenius.openai", error = %error, correlation_id = %context.correlation_id, "OpenAI Responses request failed");
            return realtime_error(
                StatusCode::BAD_GATEWAY,
                "OPENAI_UPSTREAM_UNAVAILABLE",
                "OpenAI service did not return a response",
            );
        }
    };
    let upstream_status = upstream.status();
    if !upstream_status.is_success() {
        tracing::warn!(target: "mxgenius.openai", %upstream_status, correlation_id = %context.correlation_id, "OpenAI Responses request rejected");
        let status = if upstream_status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            StatusCode::TOO_MANY_REQUESTS
        } else {
            StatusCode::BAD_GATEWAY
        };
        return realtime_error(
            status,
            "OPENAI_UPSTREAM_REJECTED",
            "OpenAI service rejected the request",
        );
    }
    let payload: Value = match upstream.json().await {
        Ok(value) => value,
        Err(_) => {
            return realtime_error(
                StatusCode::BAD_GATEWAY,
                "INVALID_OPENAI_RESPONSE",
                "OpenAI service returned an invalid response",
            )
        }
    };
    let answer = extract_openai_output_text(&payload);
    if answer.is_empty() {
        return realtime_error(
            StatusCode::BAD_GATEWAY,
            "EMPTY_OPENAI_RESPONSE",
            "OpenAI service returned no answer",
        );
    }
    (
        StatusCode::OK,
        Json(json!({
            "response": {
                "answer": answer,
                "model": payload.get("model"),
                "response_id": payload.get("id"),
                "usage": payload.get("usage"),
                "capability_trace": capability_trace,
                "correlation_id": context.correlation_id
            }
        })),
    )
        .into_response()
}

fn extract_openai_output_text(payload: &Value) -> String {
    payload
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter(|content| content.get("type").and_then(Value::as_str) == Some("output_text"))
        .filter_map(|content| content.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("")
}

async fn create_realtime_call(
    State(state): State<AppState>,
    headers: HeaderMap,
    offer: Bytes,
) -> Response {
    if !origin_allowed(&headers) {
        return realtime_error(
            StatusCode::FORBIDDEN,
            "ORIGIN_DENIED",
            "invalid Origin header",
        );
    }
    let content_type_is_sdp = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("application/sdp"))
        .unwrap_or(false);
    if !content_type_is_sdp {
        return realtime_error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "INVALID_CONTENT_TYPE",
            "Content-Type must be application/sdp",
        );
    }
    if offer.is_empty() || offer.len() > MAX_REALTIME_SDP_BYTES {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_SDP",
            "SDP offer must be between 1 byte and 64 KiB",
        );
    }
    let offer = match std::str::from_utf8(&offer) {
        Ok(value) if value.starts_with("v=0") => value,
        _ => {
            return realtime_error(
                StatusCode::BAD_REQUEST,
                "INVALID_SDP",
                "request body is not a valid SDP offer",
            )
        }
    };
    let mut auth = match auth_request(&headers) {
        Ok(value) => value,
        Err(message) => return realtime_error(StatusCode::BAD_REQUEST, "INVALID_REQUEST", message),
    };
    // A Realtime connection is never itself confirmation of an operational action.
    auth.confirmation_grant = None;
    let context = match state.dispatcher.authenticate(&auth).await {
        Ok(value) => value,
        Err(AuthError::Required | AuthError::InvalidToken(_)) => {
            return realtime_error(
                StatusCode::UNAUTHORIZED,
                "AUTH_REQUIRED",
                "authentication required",
            )
        }
        Err(AuthError::TenantMismatch) => {
            return realtime_error(
                StatusCode::FORBIDDEN,
                "TENANT_MISMATCH",
                "tenant access denied",
            )
        }
        Err(AuthError::Internal(_)) => {
            return realtime_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "authentication service unavailable",
            )
        }
    };
    let api_key = match std::env::var("OPENAI_API_KEY") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            return realtime_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "REALTIME_NOT_CONFIGURED",
                "Realtime service is not configured",
            )
        }
    };
    let model =
        std::env::var("MXGENIUS_REALTIME_MODEL").unwrap_or_else(|_| "gpt-realtime-2.1".into());
    let voice = std::env::var("MXGENIUS_REALTIME_VOICE").unwrap_or_else(|_| "marin".into());
    let session = json!({
        "type": "realtime",
        "model": model,
        "output_modalities": ["audio"],
        "audio": {
            "input": {
                "transcription": {"model": std::env::var("MXGENIUS_REALTIME_TRANSCRIPTION_MODEL").unwrap_or_else(|_| "gpt-realtime-whisper".into())},
                "turn_detection": {"type": "semantic_vad"}
            },
            "output": {"voice": voice}
        },
        "instructions": "You are the MXGenius maintenance copilot. Treat application tools as authoritative. Never claim an operational mutation succeeded without an explicit application confirmation result."
    });
    let form = reqwest::multipart::Form::new()
        .text("sdp", offer.to_owned())
        .text("session", session.to_string());
    let safety_identifier = realtime_safety_identifier(&context);
    let upstream = match state
        .realtime_client
        .post(OPENAI_REALTIME_CALLS_URL)
        .bearer_auth(api_key)
        .header("OpenAI-Safety-Identifier", safety_identifier)
        .header("x-client-request-id", context.correlation_id.to_string())
        .multipart(form)
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(target: "mxgenius.realtime", error = %error, correlation_id = %context.correlation_id, "Realtime call exchange failed");
            return realtime_error(
                StatusCode::BAD_GATEWAY,
                "REALTIME_UPSTREAM_UNAVAILABLE",
                "Realtime service did not accept the connection",
            );
        }
    };
    let status = upstream.status();
    let call_id = upstream
        .headers()
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .filter(|value| value.starts_with("rtc_"))
        .map(str::to_owned);
    if !status.is_success() {
        tracing::warn!(target: "mxgenius.realtime", upstream_status = %status, correlation_id = %context.correlation_id, "Realtime call exchange rejected");
        let response_status = if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            StatusCode::TOO_MANY_REQUESTS
        } else if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            StatusCode::SERVICE_UNAVAILABLE
        } else {
            StatusCode::BAD_GATEWAY
        };
        return realtime_error(
            response_status,
            "REALTIME_UPSTREAM_REJECTED",
            "Realtime service rejected the connection",
        );
    }
    let answer = match upstream.text().await {
        Ok(value) if value.starts_with("v=0") => value,
        _ => {
            return realtime_error(
                StatusCode::BAD_GATEWAY,
                "INVALID_REALTIME_RESPONSE",
                "Realtime service returned an invalid SDP answer",
            )
        }
    };
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/sdp"),
    );
    if let Ok(value) = HeaderValue::from_str(&context.correlation_id.to_string()) {
        response_headers.insert("x-correlation-id", value);
    }
    if let Some(call_id) = call_id.and_then(|value| HeaderValue::from_str(&value).ok()) {
        response_headers.insert("x-mxg-realtime-call-id", call_id);
    }
    (StatusCode::OK, response_headers, answer).into_response()
}

fn realtime_safety_identifier(
    context: &mxgenius_shared::application::context::ExecutionContext,
) -> String {
    use sha2::{Digest, Sha256};

    let salt = std::env::var("MXGENIUS_SAFETY_IDENTIFIER_SALT").unwrap_or_default();
    let input = format!("{salt}:{}:{}", context.organization_id, context.user_id);
    hex::encode(Sha256::digest(input.as_bytes()))
}

fn realtime_error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({"error": {"code": code, "message": message}})),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct FirstCaseSliceRequest {
    registration: String,
    discrepancy: String,
    #[serde(default = "default_priority")]
    priority: String,
    #[serde(default)]
    include: Option<Value>,
}

#[derive(Debug, Serialize)]
struct CapabilityTraceSummary {
    tool: String,
    trace_id: Option<Value>,
    request_id: Option<Value>,
    status: Option<Value>,
    warnings: Value,
    confidence: Option<Value>,
}

fn default_priority() -> String {
    "routine".into()
}

async fn first_case_slice(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<FirstCaseSliceRequest>,
) -> Response {
    if !origin_allowed(&headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error": {"code": "ORIGIN_DENIED", "message": "invalid Origin header"}})),
        )
            .into_response();
    }
    if input.registration.trim().is_empty() || input.discrepancy.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": {"code": "INVALID_REQUEST", "message": "registration and discrepancy are required"}}))).into_response();
    }
    let auth = match auth_request(&headers) {
        Ok(request) => request,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": {"code": "INVALID_REQUEST", "message": message}})),
            )
                .into_response()
        }
    };
    let read_auth = AuthRequest {
        confirmation_grant: None,
        ..auth.clone()
    };
    let mut trace = Vec::new();

    let lookup = match invoke(
        &state.dispatcher,
        read_auth.clone(),
        "mxg.aircraft.lookup",
        json!({"registration": input.registration.trim()}),
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    trace.push(trace_summary("mxg.aircraft.lookup", &lookup));
    let Some(aircraft_id) = lookup
        .pointer("/output/aircraft_id")
        .and_then(Value::as_str)
    else {
        let matches = lookup
            .pointer("/output/matches")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let code = if matches.as_array().is_some_and(|items| items.is_empty()) {
            "AIRCRAFT_NOT_FOUND"
        } else {
            "AIRCRAFT_AMBIGUOUS"
        };
        return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": {"code": code, "message": "aircraft could not be resolved unambiguously", "matches": matches}, "trace": trace}))).into_response();
    };

    let created = match invoke(
        &state.dispatcher,
        auth,
        "mxg.maintenance_case.create",
        json!({
            "aircraft_id": aircraft_id,
            "raw_discrepancy": input.discrepancy.trim(),
            "priority": input.priority
        }),
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    trace.push(trace_summary("mxg.maintenance_case.create", &created));
    let Some(case_id) = created
        .pointer("/output/case/case_id")
        .and_then(Value::as_str)
    else {
        return (StatusCode::BAD_GATEWAY, Json(json!({"error": {"code": "INVALID_CAPABILITY_OUTPUT", "message": "case creation returned no case ID"}, "trace": trace}))).into_response();
    };
    let case_id = case_id.to_owned();

    let current = match invoke(
        &state.dispatcher,
        read_auth.clone(),
        "mxg.maintenance_case.get",
        json!({"case_id": case_id}),
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    trace.push(trace_summary("mxg.maintenance_case.get", &current));
    let include = input.include.unwrap_or_else(|| {
        json!({
            "documents": true, "compliance": true, "weather": true,
            "parts": true, "facilities": true, "timeline": true
        })
    });
    let context = match invoke(
        &state.dispatcher,
        read_auth,
        "mxg.maintenance_case.build_context",
        json!({"case_id": case_id, "include": include}),
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    trace.push(trace_summary(
        "mxg.maintenance_case.build_context",
        &context,
    ));

    (
        StatusCode::OK,
        Json(json!({
            "case_id": case_id,
            "aircraft": lookup.pointer("/output").cloned().unwrap_or(Value::Null),
            "case": current.pointer("/output/case").cloned().unwrap_or(Value::Null),
            "context": context.get("output").cloned().unwrap_or(Value::Null),
            "trace": trace
        })),
    )
        .into_response()
}

async fn invoke(
    dispatcher: &Dispatcher,
    auth: AuthRequest,
    tool: &str,
    arguments: Value,
) -> Result<Value, Response> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = dispatcher
        .dispatch_with_auth(
            JsonRpcRequest {
                jsonrpc: "2.0".into(),
                method: "tools/call".into(),
                params: json!({"name": tool, "arguments": arguments}),
                id: json!(request_id),
            },
            auth,
        )
        .await
        .expect("orchestration calls are never notifications");
    if let Some(error) = response.error {
        let status = match error.code {
            -32001 | -32002 => StatusCode::UNAUTHORIZED,
            -32003 => StatusCode::FORBIDDEN,
            _ => StatusCode::BAD_GATEWAY,
        };
        return Err((status, Json(json!({"error": {
            "code": error.data.as_ref().and_then(|data| data.get("stable_code")).cloned().unwrap_or_else(|| json!("CAPABILITY_FAILED")),
            "message": error.message,
            "tool": tool
        }}))).into_response());
    }
    response.result.ok_or_else(|| (StatusCode::BAD_GATEWAY, Json(json!({"error": {
        "code": "EMPTY_CAPABILITY_RESPONSE", "message": "capability returned no result", "tool": tool
    }}))).into_response())
}

fn trace_summary(tool: &str, envelope: &Value) -> CapabilityTraceSummary {
    CapabilityTraceSummary {
        tool: tool.into(),
        trace_id: envelope.get("trace_id").cloned(),
        request_id: envelope.get("request_id").cloned(),
        status: envelope.get("status").cloned(),
        warnings: envelope
            .get("warnings")
            .cloned()
            .unwrap_or_else(|| json!([])),
        confidence: envelope.get("confidence").cloned(),
    }
}

async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    if !origin_allowed(&headers) {
        return (StatusCode::FORBIDDEN, "invalid Origin header").into_response();
    }
    if !accepts_streamable_http(&headers) {
        return (
            StatusCode::NOT_ACCEPTABLE,
            "Accept must include application/json and text/event-stream",
        )
            .into_response();
    }
    if req.method != "initialize" && !protocol_version_allowed(&headers) {
        return (
            StatusCode::BAD_REQUEST,
            format!("unsupported MCP-Protocol-Version; expected {PROTOCOL_VERSION}"),
        )
            .into_response();
    }

    let auth_request = match auth_request(&headers) {
        Ok(request) => request,
        Err(message) => return (StatusCode::BAD_REQUEST, message).into_response(),
    };
    match state.dispatcher.dispatch_with_auth(req, auth_request).await {
        Some(resp) => (StatusCode::OK, Json(resp)).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}

fn auth_request(headers: &HeaderMap) -> Result<AuthRequest, &'static str> {
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let selected_organization_id = headers
        .get("x-mxg-organization-id")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.parse::<OrganizationId>())
        .transpose()
        .map_err(|_| "invalid x-mxg-organization-id")?;
    let correlation_id = headers
        .get("x-correlation-id")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.parse::<uuid::Uuid>().map(CorrelationId))
        .transpose()
        .map_err(|_| "invalid x-correlation-id")?;
    let confirmation_grant = headers
        .get("x-mxg-confirmation-grant")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    Ok(AuthRequest {
        authorization,
        selected_organization_id,
        confirmation_grant,
        correlation_id,
    })
}

fn accepts_streamable_http(headers: &HeaderMap) -> bool {
    let Some(value) = headers.get(header::ACCEPT).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let value = value.to_ascii_lowercase();
    value
        .split(',')
        .any(|v| v.trim().starts_with("application/json"))
        && value
            .split(',')
            .any(|v| v.trim().starts_with("text/event-stream"))
}

fn protocol_version_allowed(headers: &HeaderMap) -> bool {
    headers
        .get("mcp-protocol-version")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == PROTOCOL_VERSION)
        .unwrap_or(true)
}

fn origin_allowed(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let configured = std::env::var("MXGENIUS_MCP_ALLOWED_ORIGINS").unwrap_or_else(|_| {
        "http://127.0.0.1,http://localhost,https://mxgenius.io,https://www.mxgenius.io".into()
    });
    configured
        .split(',')
        .map(str::trim)
        .any(|allowed| allowed == origin)
}
