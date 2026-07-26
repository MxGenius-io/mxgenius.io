//! Stateless MCP Streamable HTTP transport at `POST /mcp`.
//! The runtime returns JSON responses and deliberately does not open an SSE
//! channel; `GET /mcp` therefore returns 405 as allowed by the protocol.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Digest;
use sqlx::FromRow;
use time::OffsetDateTime;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::confirmation::PostgresConfirmationGrantIssuer;
use crate::context::{AuthError, AuthRequest};
use crate::dispatcher::{Dispatcher, JsonRpcRequest};
use mxgenius_shared::adapters::manual::{
    ManualCorpusAdapter, ManualQuery, NotConfiguredManualAdapter,
};
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::domain::evidence::{Evidence, EvidenceAssetAvailability};
use mxgenius_shared::domain::ids::{CorrelationId, OrganizationId};

const PROTOCOL_VERSION: &str = "2025-11-25";
const MAX_REALTIME_SDP_BYTES: usize = 64 * 1024;
const OPENAI_REALTIME_CALLS_URL: &str = "https://api.openai.com/v1/realtime/calls";
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const MAX_CHAT_MESSAGE_BYTES: usize = 20 * 1024;
const MAX_PROFILE_IMAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TWIN_MODEL_BYTES: usize = 100 * 1024 * 1024;
const MAX_PROFILE_SETTINGS_BYTES: usize = 32 * 1024;
const CHAT_MEMORY_TURN_LIMIT: i64 = 24;
const MODEL_MANUAL_RECORD_LIMIT: usize = 12;

#[derive(Clone)]
struct AppState {
    dispatcher: Dispatcher,
    health: HealthState,
    realtime_client: reqwest::Client,
    confirmation_issuer: Option<Arc<PostgresConfirmationGrantIssuer>>,
    manual: Arc<dyn ManualCorpusAdapter>,
}

#[derive(Clone)]
pub enum HealthState {
    Local,
    Postgres(sqlx::PgPool),
}

pub fn router(dispatcher: Dispatcher) -> Router {
    router_with_health_and_manual(
        dispatcher,
        HealthState::Local,
        Arc::new(NotConfiguredManualAdapter),
    )
}

pub fn router_with_health(dispatcher: Dispatcher, health: HealthState) -> Router {
    router_with_health_and_manual(dispatcher, health, Arc::new(NotConfiguredManualAdapter))
}

pub fn router_with_health_and_manual(
    dispatcher: Dispatcher,
    health: HealthState,
    manual: Arc<dyn ManualCorpusAdapter>,
) -> Router {
    let realtime_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(90))
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
        manual,
    };
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/adapterz", get(adapterz))
        .route("/manual-assets", get(manual_asset))
        .route("/chat", post(chat))
        .route("/api/cases", get(list_cases))
        .route("/api/cases/:case_id", get(get_case))
        .route("/api/threads", get(list_threads).post(create_thread))
        .route(
            "/api/threads/:thread_id",
            get(get_thread).patch(update_thread).delete(archive_thread),
        )
        .route(
            "/api/threads/:thread_id/messages",
            get(list_thread_messages),
        )
        .route("/api/profile", get(get_profile).patch(update_profile))
        .route(
            "/api/profile/image",
            get(get_profile_image)
                .put(put_profile_image)
                .delete(delete_profile_image),
        )
        .route(
            "/api/digital-twin/models",
            get(list_twin_models).post(upload_twin_model),
        )
        .route(
            "/api/digital-twin/models/:model_id/content",
            get(get_twin_model_content),
        )
        .route(
            "/api/digital-twin/highlight",
            get(get_twin_highlight).put(put_twin_highlight),
        )
        .route("/confirmations", post(issue_confirmation))
        .route("/orchestration/cases/first-slice", post(first_case_slice))
        .route("/realtime/calls", post(create_realtime_call))
        .route("/mcp", get(method_not_allowed).post(handle))
        .with_state(state)
        .layer(DefaultBodyLimit::max(MAX_TWIN_MODEL_BYTES))
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
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
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
    manual: Arc<dyn ManualCorpusAdapter>,
) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(target: "mxgenius.mcp.http", "listening on http://{addr}/mcp");
    axum::serve(
        listener,
        router_with_health_and_manual(dispatcher, health, manual),
    )
    .await?;
    Ok(())
}

async fn healthz() -> &'static str {
    "ok"
}

#[derive(Debug, Deserialize)]
struct ManualAssetQuery {
    reference: String,
}

async fn manual_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(input): Query<ManualAssetQuery>,
) -> Response {
    if !origin_allowed(&headers) {
        return realtime_error(
            StatusCode::FORBIDDEN,
            "ORIGIN_DENIED",
            "invalid Origin header",
        );
    }
    let Some(path) = input.reference.strip_prefix("azure-blob://") else {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_ASSET_REFERENCE",
            "manual asset reference is invalid",
        );
    };
    if !path.starts_with("documents/manual-assets/legacy-rag/")
        || path.contains("..")
        || path.contains('\\')
        || path.contains('?')
        || path.contains('#')
    {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_ASSET_REFERENCE",
            "manual asset is outside the controlled evidence collection",
        );
    }
    let sas = match std::env::var("MXGENIUS_MANUAL_ASSET_SAS") {
        Ok(value) if !value.trim().is_empty() => value.replace("%26", "&"),
        _ => {
            return realtime_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "MANUAL_ASSETS_NOT_CONFIGURED",
                "manual image delivery is not configured",
            )
        }
    };
    let origin = std::env::var("MXGENIUS_MANUAL_ASSET_ORIGIN")
        .unwrap_or_else(|_| "https://mxgstorage50106.blob.core.windows.net".into());
    let url = format!(
        "{}/{}?{}",
        origin.trim_end_matches('/'),
        path,
        sas.trim_start_matches('?')
    );
    let upstream = match state.realtime_client.get(url).send().await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(target: "mxgenius.manual_asset", %error, "manual asset fetch failed");
            return realtime_error(
                StatusCode::BAD_GATEWAY,
                "MANUAL_ASSET_UNAVAILABLE",
                "manual image could not be retrieved",
            );
        }
    };
    if !upstream.status().is_success() {
        return realtime_error(
            StatusCode::BAD_GATEWAY,
            "MANUAL_ASSET_UNAVAILABLE",
            "manual image could not be retrieved",
        );
    }
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("application/octet-stream")
        .to_owned();
    let body = match upstream.bytes().await {
        Ok(value) if value.len() <= 20 * 1024 * 1024 => value,
        _ => {
            return realtime_error(
                StatusCode::BAD_GATEWAY,
                "MANUAL_ASSET_INVALID",
                "manual image exceeded the delivery limit",
            )
        }
    };
    let mut response_headers = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        response_headers.insert(header::CONTENT_TYPE, value);
    }
    response_headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600"),
    );
    (StatusCode::OK, response_headers, body).into_response()
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
        Ok(mode) => {
            let manual = state.manual.source_info().await;
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "mode": mode,
                    "core": {"persistence": if mode == "local" { "in_memory" } else { "postgres" }},
                    "adapters": {
                        "aircraft": if mode == "local" { "fixture" } else { "not_configured" },
                        "manuals": manual.health,
                        "manual_source": manual.name,
                        "faa": "not_configured", "weather": "not_configured",
                        "parts": "not_configured", "mro": "not_configured",
                        "scheduling": "not_configured", "digital_twin": "not_configured"
                    }
                })),
            )
                .into_response()
        }
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

fn postgres_pool(state: &AppState) -> Option<&sqlx::PgPool> {
    match &state.health {
        HealthState::Postgres(pool) => Some(pool),
        HealthState::Local => None,
    }
}

fn persistence_not_configured() -> Response {
    realtime_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "PERSISTENCE_NOT_CONFIGURED",
        "server-side persistence is not configured",
    )
}

async fn application_context(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<ExecutionContext, Response> {
    if !origin_allowed(headers) {
        return Err(realtime_error(
            StatusCode::FORBIDDEN,
            "ORIGIN_DENIED",
            "invalid Origin header",
        ));
    }
    let mut auth = auth_request(headers)
        .map_err(|message| realtime_error(StatusCode::BAD_REQUEST, "INVALID_REQUEST", message))?;
    auth.confirmation_grant = None;
    match state.dispatcher.authenticate(&auth).await {
        Ok(value) => Ok(value),
        Err(AuthError::Required | AuthError::InvalidToken(_)) => Err(realtime_error(
            StatusCode::UNAUTHORIZED,
            "AUTH_REQUIRED",
            "authentication required",
        )),
        Err(AuthError::TenantMismatch) => Err(realtime_error(
            StatusCode::FORBIDDEN,
            "TENANT_MISMATCH",
            "tenant access denied",
        )),
        Err(AuthError::Internal(_)) => Err(realtime_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "authentication service unavailable",
        )),
    }
}

fn persistence_error(operation: &'static str, error: impl std::fmt::Display) -> Response {
    tracing::error!(
        target: "mxgenius.persistence",
        %error,
        operation,
        "server-side persistence operation failed"
    );
    realtime_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "PERSISTENCE_UNAVAILABLE",
        "server-side persistence is temporarily unavailable",
    )
}

#[derive(Debug, Serialize, FromRow)]
struct CaseApiRow {
    case_id: Uuid,
    aircraft_id: String,
    status: String,
    priority: String,
    opened_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    location: Option<Value>,
    raw_discrepancy: String,
    normalized_discrepancy: Option<Value>,
    assigned_user_ids: Vec<Uuid>,
    evidence_ids: Vec<Uuid>,
    approval_state: String,
    version: i64,
}

async fn list_cases(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    match sqlx::query_as::<_, CaseApiRow>(
        r#"SELECT case_id, aircraft_id, status, priority, opened_at, updated_at,
                  location, raw_discrepancy, normalized_discrepancy,
                  assigned_user_ids, evidence_ids, approval_state, version
           FROM maintenance_cases
           WHERE organization_id=$1
           ORDER BY updated_at DESC
           LIMIT 250"#,
    )
    .bind(context.organization_id.0)
    .fetch_all(pool)
    .await
    {
        Ok(cases) => (StatusCode::OK, Json(json!({"cases": cases}))).into_response(),
        Err(error) => persistence_error("cases.list", error),
    }
}

async fn get_case(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    match sqlx::query_as::<_, CaseApiRow>(
        r#"SELECT case_id, aircraft_id, status, priority, opened_at, updated_at,
                  location, raw_discrepancy, normalized_discrepancy,
                  assigned_user_ids, evidence_ids, approval_state, version
           FROM maintenance_cases
           WHERE organization_id=$1 AND case_id=$2"#,
    )
    .bind(context.organization_id.0)
    .bind(case_id)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(case)) => (StatusCode::OK, Json(json!({"case": case}))).into_response(),
        Ok(None) => realtime_error(StatusCode::NOT_FOUND, "CASE_NOT_FOUND", "case not found"),
        Err(error) => persistence_error("cases.get", error),
    }
}

#[derive(Debug, Serialize, FromRow)]
struct ThreadApiRow {
    id: Uuid,
    case_id: Option<Uuid>,
    title: String,
    status: String,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
struct CreateThreadRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    case_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct UpdateThreadRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

fn normalized_thread_title(value: Option<&str>) -> Option<String> {
    let title = value.unwrap_or("New conversation").trim();
    if title.is_empty() || title.chars().count() > 160 {
        return None;
    }
    Some(title.to_owned())
}

async fn case_exists(
    pool: &sqlx::PgPool,
    organization_id: Uuid,
    case_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2)",
    )
    .bind(organization_id)
    .bind(case_id)
    .fetch_one(pool)
    .await
}

async fn insert_thread(
    pool: &sqlx::PgPool,
    context: &ExecutionContext,
    title: &str,
    case_id: Option<Uuid>,
) -> Result<ThreadApiRow, sqlx::Error> {
    sqlx::query_as::<_, ThreadApiRow>(
        r#"INSERT INTO chat_threads
           (id, organization_id, user_id, case_id, title, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'active',now(),now())
           RETURNING id, case_id, title, status, created_at, updated_at"#,
    )
    .bind(Uuid::new_v4())
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(case_id)
    .bind(title)
    .fetch_one(pool)
    .await
}

async fn list_threads(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    match sqlx::query_as::<_, ThreadApiRow>(
        r#"SELECT id, case_id, title, status, created_at, updated_at
           FROM chat_threads
           WHERE organization_id=$1 AND user_id=$2
           ORDER BY updated_at DESC
           LIMIT 100"#,
    )
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .fetch_all(pool)
    .await
    {
        Ok(threads) => (StatusCode::OK, Json(json!({"threads": threads}))).into_response(),
        Err(error) => persistence_error("threads.list", error),
    }
}

async fn create_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateThreadRequest>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let title = match normalized_thread_title(input.title.as_deref()) {
        Some(value) => value,
        None => {
            return realtime_error(
                StatusCode::BAD_REQUEST,
                "INVALID_THREAD_TITLE",
                "thread title must contain between 1 and 160 characters",
            )
        }
    };
    if let Some(case_id) = input.case_id {
        match case_exists(pool, context.organization_id.0, case_id).await {
            Ok(true) => {}
            Ok(false) => {
                return realtime_error(
                    StatusCode::BAD_REQUEST,
                    "CASE_NOT_FOUND",
                    "thread case was not found",
                )
            }
            Err(error) => return persistence_error("threads.case_check", error),
        }
    }
    match insert_thread(pool, &context, &title, input.case_id).await {
        Ok(thread) => (StatusCode::CREATED, Json(json!({"thread": thread}))).into_response(),
        Err(error) => persistence_error("threads.create", error),
    }
}

async fn get_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(thread_id): Path<Uuid>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    match sqlx::query_as::<_, ThreadApiRow>(
        r#"SELECT id, case_id, title, status, created_at, updated_at
           FROM chat_threads
           WHERE id=$1 AND organization_id=$2 AND user_id=$3"#,
    )
    .bind(thread_id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(thread)) => (StatusCode::OK, Json(json!({"thread": thread}))).into_response(),
        Ok(None) => realtime_error(
            StatusCode::NOT_FOUND,
            "THREAD_NOT_FOUND",
            "conversation thread not found",
        ),
        Err(error) => persistence_error("threads.get", error),
    }
}

async fn update_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(thread_id): Path<Uuid>,
    Json(input): Json<UpdateThreadRequest>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let title = match input.title.as_deref() {
        Some(value) => match normalized_thread_title(Some(value)) {
            Some(value) => Some(value),
            None => {
                return realtime_error(
                    StatusCode::BAD_REQUEST,
                    "INVALID_THREAD_TITLE",
                    "thread title must contain between 1 and 160 characters",
                )
            }
        },
        None => None,
    };
    if input
        .status
        .as_deref()
        .is_some_and(|value| !matches!(value, "active" | "archived"))
    {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_THREAD_STATUS",
            "thread status must be active or archived",
        );
    }
    match sqlx::query_as::<_, ThreadApiRow>(
        r#"UPDATE chat_threads
           SET title=COALESCE($1,title), status=COALESCE($2,status), updated_at=now()
           WHERE id=$3 AND organization_id=$4 AND user_id=$5
           RETURNING id, case_id, title, status, created_at, updated_at"#,
    )
    .bind(title)
    .bind(input.status)
    .bind(thread_id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(thread)) => (StatusCode::OK, Json(json!({"thread": thread}))).into_response(),
        Ok(None) => realtime_error(
            StatusCode::NOT_FOUND,
            "THREAD_NOT_FOUND",
            "conversation thread not found",
        ),
        Err(error) => persistence_error("threads.update", error),
    }
}

async fn archive_thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(thread_id): Path<Uuid>,
) -> Response {
    update_thread(
        State(state),
        headers,
        Path(thread_id),
        Json(UpdateThreadRequest {
            title: None,
            status: Some("archived".into()),
        }),
    )
    .await
}

#[derive(Debug, Serialize, FromRow)]
struct MessageApiRow {
    id: Uuid,
    thread_id: Uuid,
    role: String,
    content: String,
    response_id: Option<String>,
    payload: Option<Value>,
    created_at: OffsetDateTime,
}

async fn list_thread_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(thread_id): Path<Uuid>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    match sqlx::query_as::<_, MessageApiRow>(
        r#"SELECT m.id, m.thread_id, m.role, m.content, m.response_id, m.payload, m.created_at
           FROM chat_messages m
           JOIN chat_threads t ON t.id=m.thread_id
           WHERE m.thread_id=$1 AND t.organization_id=$2 AND t.user_id=$3
           ORDER BY m.created_at, m.id
           LIMIT 500"#,
    )
    .bind(thread_id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .fetch_all(pool)
    .await
    {
        Ok(messages) => (StatusCode::OK, Json(json!({"messages": messages}))).into_response(),
        Err(error) => persistence_error("threads.messages", error),
    }
}

#[derive(Debug, Serialize)]
struct ProfileResponse {
    display_name: Option<String>,
    email: Option<String>,
    timezone: Option<String>,
    settings: Value,
    image_url: Option<&'static str>,
    updated_at: Option<OffsetDateTime>,
}

#[derive(Debug, FromRow)]
struct ProfileQueryRow {
    display_name: Option<String>,
    email: Option<String>,
    timezone: Option<String>,
    settings: Value,
    updated_at: Option<OffsetDateTime>,
    has_image: bool,
}

#[derive(Debug, Deserialize)]
struct UpdateProfileRequest {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    timezone: Option<String>,
    #[serde(default = "empty_object")]
    settings: Value,
}

fn empty_object() -> Value {
    json!({})
}

fn validate_profile_update(
    input: &UpdateProfileRequest,
) -> Result<(), (&'static str, &'static str)> {
    if input
        .display_name
        .as_deref()
        .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 120)
    {
        return Err((
            "INVALID_DISPLAY_NAME",
            "display name must contain between 1 and 120 characters",
        ));
    }
    if input
        .timezone
        .as_deref()
        .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 80)
    {
        return Err((
            "INVALID_TIMEZONE",
            "timezone must contain between 1 and 80 characters",
        ));
    }
    if !input.settings.is_object() || input.settings.to_string().len() > MAX_PROFILE_SETTINGS_BYTES
    {
        return Err((
            "INVALID_PROFILE_SETTINGS",
            "profile settings must be a JSON object no larger than 32 KiB",
        ));
    }
    Ok(())
}

async fn get_profile(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let result = sqlx::query_as::<_, ProfileQueryRow>(
        r#"SELECT COALESCE(p.display_name,u.display_name) AS display_name,
                  u.email, p.timezone, COALESCE(p.settings,'{}'::jsonb) AS settings,
                  p.updated_at,
                  EXISTS(
                    SELECT 1 FROM profile_images i
                    WHERE i.organization_id=$1 AND i.user_id=$2
                  ) AS has_image
           FROM users u
           LEFT JOIN user_profiles p
             ON p.organization_id=$1 AND p.user_id=u.id
           WHERE u.id=$2"#,
    )
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .fetch_optional(pool)
    .await;
    match result {
        Ok(Some(profile)) => (
            StatusCode::OK,
            Json(ProfileResponse {
                display_name: profile.display_name,
                email: profile.email,
                timezone: profile.timezone,
                settings: profile.settings,
                image_url: profile.has_image.then_some("/api/profile/image"),
                updated_at: profile.updated_at,
            }),
        )
            .into_response(),
        Ok(None) => realtime_error(
            StatusCode::NOT_FOUND,
            "PROFILE_NOT_FOUND",
            "profile identity was not found",
        ),
        Err(error) => persistence_error("profile.get", error),
    }
}

async fn update_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<UpdateProfileRequest>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err((code, message)) = validate_profile_update(&input) {
        return realtime_error(StatusCode::BAD_REQUEST, code, message);
    }
    input.display_name = input.display_name.map(|value| value.trim().to_owned());
    input.timezone = input.timezone.map(|value| value.trim().to_owned());
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let result = sqlx::query(
        r#"INSERT INTO user_profiles
           (organization_id,user_id,display_name,timezone,settings,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,now(),now())
           ON CONFLICT (organization_id,user_id) DO UPDATE SET
             display_name=EXCLUDED.display_name,
             timezone=EXCLUDED.timezone,
             settings=EXCLUDED.settings,
             updated_at=now()"#,
    )
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(input.display_name)
    .bind(input.timezone)
    .bind(input.settings)
    .execute(pool)
    .await;
    match result {
        Ok(_) => get_profile(State(state), headers).await,
        Err(error) => persistence_error("profile.update", error),
    }
}

async fn get_profile_image(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let result: Result<Option<(String, Vec<u8>, String)>, sqlx::Error> = sqlx::query_as(
        r#"SELECT media_type, content, content_hash FROM profile_images
           WHERE organization_id=$1 AND user_id=$2"#,
    )
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .fetch_optional(pool)
    .await;
    match result {
        Ok(Some((media_type, content, content_hash))) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, media_type)
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header(header::ETAG, format!("\"{content_hash}\""))
            .body(Body::from(content))
            .expect("valid profile image response"),
        Ok(None) => realtime_error(
            StatusCode::NOT_FOUND,
            "PROFILE_IMAGE_NOT_FOUND",
            "profile image not found",
        ),
        Err(error) => persistence_error("profile.image.get", error),
    }
}

async fn put_profile_image(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if body.is_empty() || body.len() > MAX_PROFILE_IMAGE_BYTES {
        return realtime_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "INVALID_PROFILE_IMAGE_SIZE",
            "profile image must be between 1 byte and 2 MiB",
        );
    }
    let media_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default();
    if !matches!(media_type, "image/jpeg" | "image/png" | "image/webp") {
        return realtime_error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "INVALID_PROFILE_IMAGE_TYPE",
            "profile image must be JPEG, PNG, or WebP",
        );
    }
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let content_hash = format!("sha256:{}", hex::encode(sha2::Sha256::digest(&body)));
    let result = sqlx::query(
        r#"INSERT INTO profile_images
           (organization_id,user_id,media_type,content,content_hash,updated_at)
           VALUES ($1,$2,$3,$4,$5,now())
           ON CONFLICT (organization_id,user_id) DO UPDATE SET
             media_type=EXCLUDED.media_type,
             content=EXCLUDED.content,
             content_hash=EXCLUDED.content_hash,
             updated_at=now()"#,
    )
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(media_type)
    .bind(body.as_ref())
    .bind(&content_hash)
    .execute(pool)
    .await;
    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "image_url": "/api/profile/image",
                "content_hash": content_hash
            })),
        )
            .into_response(),
        Err(error) => persistence_error("profile.image.put", error),
    }
}

async fn delete_profile_image(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    match sqlx::query("DELETE FROM profile_images WHERE organization_id=$1 AND user_id=$2")
        .bind(context.organization_id.0)
        .bind(context.user_id.0)
        .execute(pool)
        .await
    {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => persistence_error("profile.image.delete", error),
    }
}

#[derive(Debug, Deserialize)]
struct UploadTwinModelQuery {
    name: String,
    #[serde(default)]
    revision: Option<String>,
    #[serde(default)]
    lod: Option<String>,
    #[serde(default)]
    applicable_aircraft: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct TwinModelApiRow {
    id: Uuid,
    name: String,
    revision: String,
    lod: String,
    applicable_aircraft: Vec<String>,
    content_hash: String,
    mesh_manifest: Value,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

fn twin_model_response(row: TwinModelApiRow) -> Value {
    json!({
        "id": row.id,
        "name": row.name,
        "revision": row.revision,
        "lod": row.lod,
        "applicable_aircraft": row.applicable_aircraft,
        "content_hash": row.content_hash,
        "mesh_manifest": row.mesh_manifest,
        "resource_url": format!("/api/digital-twin/models/{}/content", row.id),
        "created_at": row.created_at,
        "updated_at": row.updated_at
    })
}

fn glb_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .and_then(|value| value.try_into().ok())
        .map(u32::from_le_bytes)
}

fn parse_glb_mesh_manifest(bytes: &[u8]) -> Result<Value, &'static str> {
    if bytes.len() < 20 || bytes.get(0..4) != Some(b"glTF") {
        return Err("file is not a binary glTF (GLB) asset");
    }
    if glb_u32(bytes, 4) != Some(2) {
        return Err("only GLB version 2 is supported");
    }
    let declared_length = glb_u32(bytes, 8).unwrap_or_default() as usize;
    if declared_length != bytes.len() {
        return Err("GLB declared length does not match the uploaded content");
    }
    let json_length = glb_u32(bytes, 12).unwrap_or_default() as usize;
    if glb_u32(bytes, 16) != Some(0x4E4F534A) || 20 + json_length > bytes.len() {
        return Err("GLB does not contain a valid JSON metadata chunk");
    }
    let document: Value = serde_json::from_slice(&bytes[20..20 + json_length])
        .map_err(|_| "GLB JSON metadata is invalid")?;
    let meshes = document
        .get("meshes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let nodes = document
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let accessors = document
        .get("accessors")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut manifest = Vec::new();
    for (node_index, node) in nodes.iter().enumerate() {
        let Some(mesh_index) = node.get("mesh").and_then(Value::as_u64) else {
            continue;
        };
        let mesh = meshes.get(mesh_index as usize);
        let mesh_id = node
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| {
                mesh.and_then(|value| value.get("name"))
                    .and_then(Value::as_str)
            })
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("mesh-{mesh_index}-node-{node_index}"));
        let position_accessor = mesh
            .and_then(|value| value.get("primitives"))
            .and_then(Value::as_array)
            .and_then(|primitives| primitives.first())
            .and_then(|primitive| primitive.pointer("/attributes/POSITION"))
            .and_then(Value::as_u64)
            .and_then(|index| accessors.get(index as usize));
        manifest.push(json!({
            "mesh_id": mesh_id,
            "node_index": node_index,
            "mesh_index": mesh_index,
            "vertex_count": position_accessor
                .and_then(|accessor| accessor.get("count"))
                .and_then(Value::as_u64),
            "bounds_min": position_accessor.and_then(|accessor| accessor.get("min")).cloned(),
            "bounds_max": position_accessor.and_then(|accessor| accessor.get("max")).cloned()
        }));
    }
    if manifest.is_empty() {
        return Err("GLB contains no named or selectable mesh nodes");
    }
    Ok(Value::Array(manifest))
}

async fn list_twin_models(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    match sqlx::query_as::<_, TwinModelApiRow>(
        r#"SELECT id,name,revision,lod,applicable_aircraft,content_hash,
                  mesh_manifest,created_at,updated_at
           FROM digital_twin_models
           WHERE organization_id=$1
           ORDER BY updated_at DESC
           LIMIT 100"#,
    )
    .bind(context.organization_id.0)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => (
            StatusCode::OK,
            Json(json!({"models": rows.into_iter().map(twin_model_response).collect::<Vec<_>>()})),
        )
            .into_response(),
        Err(error) => persistence_error("digital_twin.models.list", error),
    }
}

async fn upload_twin_model(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(input): Query<UploadTwinModelQuery>,
    body: Bytes,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if body.len() < 20 || body.len() > MAX_TWIN_MODEL_BYTES {
        return realtime_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "INVALID_TWIN_MODEL_SIZE",
            "GLB model must be between 20 bytes and 100 MiB",
        );
    }
    let media_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default();
    if media_type != "model/gltf-binary" {
        return realtime_error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "INVALID_TWIN_MODEL_TYPE",
            "digital twin uploads must use the model/gltf-binary content type",
        );
    }
    let name = input.name.trim();
    let revision = input.revision.as_deref().unwrap_or("1").trim();
    let lod = input.lod.as_deref().unwrap_or("uploaded").trim();
    if name.is_empty()
        || name.chars().count() > 160
        || revision.is_empty()
        || revision.chars().count() > 80
        || lod.is_empty()
        || lod.chars().count() > 40
    {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_TWIN_MODEL_METADATA",
            "name, revision, or LOD metadata is invalid",
        );
    }
    let mesh_manifest = match parse_glb_mesh_manifest(&body) {
        Ok(value) => value,
        Err(message) => {
            return realtime_error(StatusCode::BAD_REQUEST, "INVALID_GLB", message);
        }
    };
    let applicable_aircraft = input
        .applicable_aircraft
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .take(50)
        .map(|value| value.chars().take(120).collect::<String>())
        .collect::<Vec<_>>();
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let id = Uuid::new_v4();
    let content_hash = format!("sha256:{}", hex::encode(sha2::Sha256::digest(&body)));
    let result = sqlx::query_as::<_, TwinModelApiRow>(
        r#"INSERT INTO digital_twin_models
           (id,organization_id,uploaded_by,name,revision,lod,applicable_aircraft,
            media_type,content,content_hash,mesh_manifest,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'model/gltf-binary',$8,$9,$10,now(),now())
           ON CONFLICT (organization_id,content_hash) DO UPDATE SET
             name=EXCLUDED.name, revision=EXCLUDED.revision, lod=EXCLUDED.lod,
             applicable_aircraft=EXCLUDED.applicable_aircraft,
             mesh_manifest=EXCLUDED.mesh_manifest, updated_at=now()
           RETURNING id,name,revision,lod,applicable_aircraft,content_hash,
                     mesh_manifest,created_at,updated_at"#,
    )
    .bind(id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(name)
    .bind(revision)
    .bind(lod)
    .bind(applicable_aircraft)
    .bind(body.as_ref())
    .bind(&content_hash)
    .bind(mesh_manifest)
    .fetch_one(pool)
    .await;
    match result {
        Ok(row) => (StatusCode::CREATED, Json(twin_model_response(row))).into_response(),
        Err(error) => persistence_error("digital_twin.models.upload", error),
    }
}

async fn get_twin_model_content(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(model_id): Path<Uuid>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let row: Result<Option<(Vec<u8>, String)>, sqlx::Error> = sqlx::query_as(
        r#"SELECT content,content_hash FROM digital_twin_models
           WHERE organization_id=$1 AND id=$2"#,
    )
    .bind(context.organization_id.0)
    .bind(model_id)
    .fetch_optional(pool)
    .await;
    match row {
        Ok(Some((content, content_hash))) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "model/gltf-binary")
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header(header::ETAG, format!("\"{content_hash}\""))
            .body(Body::from(content))
            .expect("valid GLB response"),
        Ok(None) => realtime_error(
            StatusCode::NOT_FOUND,
            "TWIN_MODEL_NOT_FOUND",
            "digital twin model not found",
        ),
        Err(error) => persistence_error("digital_twin.models.content", error),
    }
}

#[derive(Debug, Deserialize)]
struct PutTwinHighlightRequest {
    model_id: Uuid,
    mesh_id: String,
    #[serde(default)]
    mesh_path: Option<String>,
    #[serde(default)]
    component_id: Option<String>,
    #[serde(default)]
    zone_id: Option<String>,
}

async fn put_twin_highlight(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<PutTwinHighlightRequest>,
) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mesh_id = input.mesh_id.trim();
    if mesh_id.is_empty() || mesh_id.chars().count() > 400 {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_MESH_SELECTOR",
            "mesh_id must contain between 1 and 400 characters",
        );
    }
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let exists: Result<bool, sqlx::Error> = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM digital_twin_models WHERE organization_id=$1 AND id=$2)",
    )
    .bind(context.organization_id.0)
    .bind(input.model_id)
    .fetch_one(pool)
    .await;
    match exists {
        Ok(false) => {
            return realtime_error(
                StatusCode::NOT_FOUND,
                "TWIN_MODEL_NOT_FOUND",
                "digital twin model not found",
            )
        }
        Err(error) => return persistence_error("digital_twin.highlight.model", error),
        Ok(true) => {}
    }
    let mesh_ids = json!([mesh_id]);
    let result = sqlx::query(
        r#"INSERT INTO digital_twin_highlight_state
           (organization_id,user_id,model_id,mesh_ids,mesh_path,component_id,zone_id,source,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'user_raycast',now())
           ON CONFLICT (organization_id,user_id) DO UPDATE SET
             model_id=EXCLUDED.model_id, mesh_ids=EXCLUDED.mesh_ids,
             mesh_path=EXCLUDED.mesh_path, component_id=EXCLUDED.component_id,
             zone_id=EXCLUDED.zone_id, source=EXCLUDED.source, updated_at=now()"#,
    )
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(input.model_id)
    .bind(&mesh_ids)
    .bind(input.mesh_path.as_deref())
    .bind(input.component_id.as_deref())
    .bind(input.zone_id.as_deref())
    .execute(pool)
    .await;
    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "model_id": input.model_id,
                "mesh_ids": mesh_ids,
                "mesh_path": input.mesh_path,
                "component_id": input.component_id,
                "zone_id": input.zone_id,
                "source": "user_raycast"
            })),
        )
            .into_response(),
        Err(error) => persistence_error("digital_twin.highlight.put", error),
    }
}

async fn get_twin_highlight(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let context = match application_context(&state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let pool = match postgres_pool(&state) {
        Some(value) => value,
        None => return persistence_not_configured(),
    };
    let row: Result<
        Option<(
            Uuid,
            Value,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            OffsetDateTime,
        )>,
        sqlx::Error,
    > = sqlx::query_as(
        r#"SELECT model_id,mesh_ids,mesh_path,component_id,zone_id,source,updated_at
               FROM digital_twin_highlight_state
               WHERE organization_id=$1 AND user_id=$2"#,
    )
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .fetch_optional(pool)
    .await;
    match row {
        Ok(Some((model_id, mesh_ids, mesh_path, component_id, zone_id, source, updated_at))) => (
            StatusCode::OK,
            Json(json!({
                "model_id": model_id,
                "mesh_ids": mesh_ids,
                "mesh_path": mesh_path,
                "component_id": component_id,
                "zone_id": zone_id,
                "source": source,
                "updated_at": updated_at
            })),
        )
            .into_response(),
        Ok(None) => (
            StatusCode::OK,
            Json(json!({"model_id": null, "mesh_ids": []})),
        )
            .into_response(),
        Err(error) => persistence_error("digital_twin.highlight.get", error),
    }
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    message: String,
    #[serde(default)]
    thread_id: Option<Uuid>,
    #[serde(default)]
    history: Vec<ChatTurn>,
    #[serde(default)]
    fleet_signals: Value,
    #[serde(default)]
    case_context: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChatTurn {
    role: String,
    content: String,
}

fn first_message_title(message: &str) -> String {
    let title = message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect::<String>();
    if title.is_empty() {
        "New conversation".into()
    } else {
        title
    }
}

async fn prepare_chat_memory(
    pool: &sqlx::PgPool,
    context: &ExecutionContext,
    requested_thread_id: Option<Uuid>,
    case_id: Option<Uuid>,
    message: &str,
) -> Result<(Uuid, Vec<ChatTurn>), Response> {
    let thread = if let Some(thread_id) = requested_thread_id {
        match sqlx::query_as::<_, ThreadApiRow>(
            r#"SELECT id, case_id, title, status, created_at, updated_at
               FROM chat_threads
               WHERE id=$1 AND organization_id=$2 AND user_id=$3"#,
        )
        .bind(thread_id)
        .bind(context.organization_id.0)
        .bind(context.user_id.0)
        .fetch_optional(pool)
        .await
        {
            Ok(Some(thread)) if thread.status == "active" => thread,
            Ok(Some(_)) => {
                return Err(realtime_error(
                    StatusCode::CONFLICT,
                    "THREAD_ARCHIVED",
                    "conversation thread is archived",
                ))
            }
            Ok(None) => {
                return Err(realtime_error(
                    StatusCode::NOT_FOUND,
                    "THREAD_NOT_FOUND",
                    "conversation thread not found",
                ))
            }
            Err(error) => return Err(persistence_error("chat.thread.get", error)),
        }
    } else {
        if let Some(case_id) = case_id {
            match case_exists(pool, context.organization_id.0, case_id).await {
                Ok(true) => {}
                Ok(false) => {
                    return Err(realtime_error(
                        StatusCode::BAD_REQUEST,
                        "CASE_NOT_FOUND",
                        "chat case was not found",
                    ))
                }
                Err(error) => return Err(persistence_error("chat.case_check", error)),
            }
        }
        insert_thread(pool, context, &first_message_title(message), case_id)
            .await
            .map_err(|error| persistence_error("chat.thread.create", error))?
    };
    if case_id.is_some() && thread.case_id != case_id {
        return Err(realtime_error(
            StatusCode::CONFLICT,
            "THREAD_CASE_MISMATCH",
            "conversation thread belongs to a different case context",
        ));
    }
    let history = sqlx::query_as::<_, (String, String)>(
        r#"SELECT role, content FROM (
             SELECT role, content, created_at, id
             FROM chat_messages
             WHERE thread_id=$1 AND organization_id=$2 AND user_id=$3
             ORDER BY created_at DESC, id DESC
             LIMIT $4
           ) recent
           ORDER BY created_at, id"#,
    )
    .bind(thread.id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(CHAT_MEMORY_TURN_LIMIT)
    .fetch_all(pool)
    .await
    .map_err(|error| persistence_error("chat.memory.load", error))?
    .into_iter()
    .map(|(role, content)| ChatTurn { role, content })
    .collect();
    Ok((thread.id, history))
}

async fn persist_chat_exchange(
    pool: &sqlx::PgPool,
    context: &ExecutionContext,
    thread_id: Uuid,
    message: &str,
    assistant_content: &str,
    response_id: Option<&str>,
    assistant_payload: &Value,
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"INSERT INTO chat_messages
           (id,thread_id,organization_id,user_id,role,content,created_at)
           VALUES ($1,$2,$3,$4,'user',$5,now())"#,
    )
    .bind(Uuid::new_v4())
    .bind(thread_id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(message)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"INSERT INTO chat_messages
           (id,thread_id,organization_id,user_id,role,content,response_id,payload,created_at)
           VALUES ($1,$2,$3,$4,'assistant',$5,$6,$7,now())"#,
    )
    .bind(Uuid::new_v4())
    .bind(thread_id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .bind(assistant_content)
    .bind(response_id)
    .bind(assistant_payload)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE chat_threads SET updated_at=now() WHERE id=$1 AND organization_id=$2 AND user_id=$3",
    )
    .bind(thread_id)
    .bind(context.organization_id.0)
    .bind(context.user_id.0)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await
}

fn maintenance_advisory_schema() -> Value {
    let cited_text = || {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "text": {"type": "string"},
                "citations": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["text", "citations"]
        })
    };
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "response_kind": {"type": "string", "enum": ["maintenance_advisory", "conversation"]},
            "conversation_answer": {"type": "string"},
            "advisory_title": {"type": "string"},
            "synthesis": {"type": "string"},
            "verify_first": {"type": "array", "items": cited_text()},
            "leading_historical_patterns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "pattern": {"type": "string"},
                        "evidence_strength_percent": {"type": "integer", "minimum": 0, "maximum": 100},
                        "citations": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["pattern", "evidence_strength_percent", "citations"]
                }
            },
            "what_worked": {"type": "array", "items": cited_text()},
            "labor_by_action": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "action": {"type": "string"},
                        "estimated_hours": {"type": "string"},
                        "basis": {"type": "string"},
                        "citations": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["action", "estimated_hours", "basis", "citations"]
                }
            },
            "parts_used_in_records": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "part_number": {"type": "string"},
                        "description": {"type": "string"},
                        "citations": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["part_number", "description", "citations"]
                }
            },
            "limitations": {"type": "array", "items": {"type": "string"}},
            "follow_up_question": {"type": "string"}
        },
        "required": [
            "response_kind", "conversation_answer", "advisory_title", "synthesis",
            "verify_first", "leading_historical_patterns", "what_worked",
            "labor_by_action", "parts_used_in_records", "limitations", "follow_up_question"
        ]
    })
}

fn truncate_chars(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn retrieval_percent(score: Option<f32>) -> Option<u8> {
    score.map(|value| (value.clamp(0.0, 1.0) * 100.0).round() as u8)
}

fn advisory_citations_are_valid(
    advisory: &Value,
    allowed: &std::collections::HashSet<String>,
) -> bool {
    match advisory {
        Value::Object(fields) => fields.iter().all(|(key, value)| {
            if key == "citations" {
                value.as_array().is_some_and(|citations| {
                    citations.iter().all(|citation| {
                        citation
                            .as_str()
                            .is_some_and(|label| allowed.contains(label))
                    })
                })
            } else {
                advisory_citations_are_valid(value, allowed)
            }
        }),
        Value::Array(items) => items
            .iter()
            .all(|item| advisory_citations_are_valid(item, allowed)),
        _ => true,
    }
}

fn manual_reference(evidence: &Evidence, index: usize, excerpt_limit: usize) -> Value {
    let images = evidence
        .assets
        .iter()
        .filter(|asset| asset.availability == EvidenceAssetAvailability::Available)
        .map(|asset| {
            json!({
                "asset_id": asset.asset_id,
                "kind": asset.kind,
                "source_reference": asset.source_reference,
                "media_type": asset.media_type,
                "page": asset.page,
                "caption": asset.caption,
                "content_hash": asset.content_hash
            })
        })
        .collect::<Vec<_>>();
    json!({
        "citation": format!("M-{:02}", index + 1),
        "rank": index + 1,
        "match_percent": retrieval_percent(evidence.retrieval_score),
        "title": evidence.title,
        "excerpt": truncate_chars(evidence.excerpt.as_deref().unwrap_or_default(), excerpt_limit),
        "revision": evidence.revision,
        "effective_at": evidence.effective_at,
        "source_reference": evidence.source_reference,
        "content_hash": evidence.content_hash,
        "retrieved_at": evidence.retrieved_at,
        "license_scope": evidence.license_scope,
        "images": images
    })
}

fn extract_ata_chapter(text: &str) -> Option<String> {
    let uppercase = text.to_ascii_uppercase();
    let mut remainder = uppercase.as_str();
    while let Some(marker) = remainder.find("ATA") {
        let after_marker = &remainder[marker + 3..];
        let digits = after_marker
            .trim_start_matches(|character: char| {
                character.is_ascii_whitespace() || matches!(character, '-' | ':' | '#')
            })
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .take(3)
            .collect::<String>();
        if digits.len() >= 2 {
            return Some(digits);
        }
        remainder = after_marker;
    }
    None
}

fn should_search_manual(message: &str, case_id: Option<Uuid>) -> bool {
    if case_id.is_some() {
        return true;
    }
    let text = message.to_ascii_lowercase();
    [
        "aircraft",
        "maintenance",
        "manual",
        "inspect",
        "inspection",
        "fault",
        "failure",
        "discrepancy",
        "engine",
        "hydraulic",
        "avionic",
        "fuel",
        "pressure",
        "leak",
        "temperature",
        "vibration",
        "warning",
        "indication",
        "electrical",
        "pneumatic",
        "brake",
        "landing gear",
        "flight control",
        "ata ",
        "part number",
        "procedure",
        "troubleshoot",
    ]
    .iter()
    .any(|term| text.contains(term))
}

fn build_manual_search_query(
    message: &str,
    history: &[ChatTurn],
    authoritative_case_context: &Value,
) -> String {
    let mut parts = vec![message.trim().to_owned()];
    parts.extend(
        history
            .iter()
            .rev()
            .filter(|turn| turn.role == "user")
            .take(3)
            .map(|turn| turn.content.trim().to_owned())
            .filter(|value| !value.is_empty()),
    );
    if let Some(discrepancy) = authoritative_case_context
        .pointer("/case/raw_discrepancy")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("Active case discrepancy: {discrepancy}"));
    }
    truncate_chars(&parts.join("\n"), 2_000)
}

async fn chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ChatRequest>,
) -> Response {
    let chat_started = Instant::now();
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
    if input.history.len() > 12
        || input.history.iter().any(|turn| {
            !matches!(turn.role.as_str(), "user" | "assistant")
                || turn.content.trim().is_empty()
                || turn.content.len() > MAX_CHAT_MESSAGE_BYTES
        })
    {
        return realtime_error(
            StatusCode::BAD_REQUEST,
            "INVALID_CHAT_HISTORY",
            "history must contain at most 12 bounded user or assistant turns",
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
    let requested_case_id = match input
        .case_context
        .as_ref()
        .and_then(|value| value.get("case_id"))
        .and_then(Value::as_str)
    {
        Some(value) => match Uuid::parse_str(value) {
            Ok(case_id) => Some(case_id),
            Err(_) => {
                return realtime_error(
                    StatusCode::BAD_REQUEST,
                    "INVALID_CASE_ID",
                    "case context contains an invalid case id",
                )
            }
        },
        None => None,
    };
    let persistent_pool = match &state.health {
        HealthState::Postgres(pool) => Some(pool.clone()),
        HealthState::Local => None,
    };
    let (thread_id, conversation_history) = if let Some(pool) = &persistent_pool {
        match prepare_chat_memory(pool, &context, input.thread_id, requested_case_id, message).await
        {
            Ok((thread_id, history)) => (Some(thread_id), history),
            Err(response) => return response,
        }
    } else {
        (None, input.history.clone())
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
            ..auth.clone()
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
    let aircraft_id = authoritative_case_context
        .pointer("/case/aircraft_id")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let manual_search_query =
        build_manual_search_query(message, &conversation_history, &authoritative_case_context);
    let (manual_evidence, manual_warning) =
        if should_search_manual(&manual_search_query, requested_case_id) {
            match state
                .manual
                .search(&ManualQuery {
                    aircraft_id,
                    ata: extract_ata_chapter(&manual_search_query),
                    text: manual_search_query,
                    limit: Some(33),
                })
                .await
            {
                Ok(evidence) => (evidence, None),
                Err(error) => (vec![], Some(error.to_string())),
            }
        } else {
            (vec![], None)
        };
    let manual_model_context = manual_evidence
        .iter()
        .take(MODEL_MANUAL_RECORD_LIMIT)
        .enumerate()
        .map(|(index, evidence)| manual_reference(evidence, index, 1_200))
        .collect::<Vec<_>>();
    let compatibility_signals = match &input.fleet_signals {
        Value::Array(items) => Value::Array(items.iter().take(50).cloned().collect()),
        _ => Value::Null,
    };
    let grounded_context = json!({
        "authoritative_case_context": authoritative_case_context,
        "compatibility_fleet_signals": compatibility_signals,
        "authoritative_manual_records": manual_model_context,
        "manual_retrieval_warning": manual_warning.clone()
    });
    let model =
        std::env::var("MXGENIUS_OPENAI_TEXT_MODEL").unwrap_or_else(|_| "gpt-5.6-sol".into());
    let mut conversation_input = input
        .history
        .iter()
        .map(|turn| {
            json!({
                "role": turn.role,
                "content": [{"type": "input_text", "text": turn.content}]
            })
        })
        .collect::<Vec<_>>();
    conversation_input.push(json!({
        "role": "user",
        "content": [{
            "type": "input_text",
            "text": format!("User request:\n{message}\n\nMXGenius context (JSON):\n{grounded_context}")
        }]
    }));
    let model_tools = state
        .dispatcher
        .registry()
        .list_tools()
        .into_iter()
        .filter(|tool| {
            tool.availability == "available" && crate::tool::is_read_only_action(tool.action)
        })
        .map(|tool| {
            json!({
                "type": "function",
                "name": tool.name.replace('.', "__"),
                "description": format!("{} Canonical capability: {}", tool.description, tool.name),
                "parameters": tool.input_schema,
                "strict": false
            })
        })
        .collect::<Vec<_>>();
    let mut request_body = json!({
        "model": model,
        "instructions": "You are the MXGenius aviation maintenance copilot. Return the required structured response. Use supplied read-only tools when authoritative application state is needed. Use response_kind=conversation for ordinary conversation and response_kind=maintenance_advisory for a technical maintenance question. For an advisory, mirror the familiar MRO sequence: synthesis, verify first, leading historical patterns, what worked, labor by action, parts used in records, limitations, and a follow-up question. Treat supplied manual records as authoritative retrieved technical evidence, not proof that work was performed on this aircraft. Use only their M-## labels in citations. Never invent a citation, part, labor value, diagnosis, record, or percentage. evidence_strength_percent rates support in the supplied sources, not probability of a diagnosis. Clearly distinguish compatibility fleet signals from authoritative case evidence. If evidence is missing, partial, conflicting, stale, or not configured, say so. Never claim return-to-service authority and never claim an operational mutation occurred.",
        "input": conversation_input,
        "tools": model_tools,
        "tool_choice": "auto",
        "parallel_tool_calls": false,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "mxgenius_maintenance_advisory",
                "strict": true,
                "schema": maintenance_advisory_schema()
            }
        },
        "reasoning": {"effort": "low"},
        "max_output_tokens": 2600,
        "store": false
    });
    let mut final_payload = None;
    let mut answer = String::new();
    let mut model_tool_calls = 0usize;
    let mut client_actions = Vec::new();
    for _ in 0..4 {
        let upstream = match state
            .realtime_client
            .post(OPENAI_RESPONSES_URL)
            .bearer_auth(&api_key)
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
        let output_items = payload
            .get("output")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let function_calls = output_items
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
            .cloned()
            .collect::<Vec<_>>();
        if function_calls.is_empty() {
            answer = extract_openai_output_text(&payload);
            final_payload = Some(payload);
            break;
        }
        let next_input = request_body["input"]
            .as_array_mut()
            .expect("chat input is always an array");
        next_input.extend(output_items);
        for call in function_calls {
            model_tool_calls += 1;
            let Some(transport_name) = call.get("name").and_then(Value::as_str) else {
                continue;
            };
            let tool_name = transport_name.replace("__", ".");
            let call_id = call
                .get("call_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let arguments = call
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|value| serde_json::from_str::<Value>(value).ok())
                .unwrap_or_else(|| json!({}));
            let reads_current_highlight =
                arguments.get("read_current").and_then(Value::as_bool) == Some(true);
            let allowed = state
                .dispatcher
                .registry()
                .tool(&tool_name)
                .is_some_and(|tool| {
                    let spec = tool.spec();
                    spec.availability == "available"
                        && crate::tool::is_read_only_action(spec.action)
                });
            let output = if allowed {
                match invoke(&state.dispatcher, auth.clone(), &tool_name, arguments).await {
                    Ok(envelope) => {
                        capability_trace.push(trace_summary(&tool_name, &envelope));
                        if tool_name == "mxg.digital_twin.highlight_zone"
                            && !reads_current_highlight
                        {
                            client_actions.push(json!({
                                "type": "digital_twin.highlight",
                                "payload": envelope.get("output").cloned().unwrap_or(Value::Null)
                            }));
                        }
                        envelope
                    }
                    Err(_) => {
                        json!({"status":"failed","errors":[{"code":"CAPABILITY_FAILED","message":"Capability execution failed"}]})
                    }
                }
            } else {
                json!({"status":"failed","errors":[{"code":"CAPABILITY_NOT_CALLABLE","message":"Capability is unavailable or requires confirmation"}]})
            };
            next_input.push(json!({
                "type": "function_call_output",
                "call_id": call_id,
                "output": output.to_string()
            }));
        }
    }
    let Some(payload) = final_payload else {
        return realtime_error(
            StatusCode::BAD_GATEWAY,
            "TOOL_LOOP_EXHAUSTED",
            "OpenAI service did not complete after the allowed tool calls",
        );
    };
    if answer.is_empty() {
        return realtime_error(
            StatusCode::BAD_GATEWAY,
            "EMPTY_OPENAI_RESPONSE",
            "OpenAI service returned no answer",
        );
    }
    let advisory: Value = match serde_json::from_str(&answer) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(target: "mxgenius.openai", %error, correlation_id = %context.correlation_id, "Structured OpenAI response did not match JSON encoding");
            return realtime_error(
                StatusCode::BAD_GATEWAY,
                "INVALID_STRUCTURED_RESPONSE",
                "OpenAI service returned an invalid structured response",
            );
        }
    };
    let allowed_citations = manual_model_context
        .iter()
        .filter_map(|record| record.get("citation").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<std::collections::HashSet<_>>();
    if !advisory_citations_are_valid(&advisory, &allowed_citations) {
        return realtime_error(
            StatusCode::BAD_GATEWAY,
            "INVALID_CITATIONS",
            "OpenAI service cited evidence that was not retrieved",
        );
    }
    if let (Some(pool), Some(thread_id)) = (&persistent_pool, thread_id) {
        if let Err(error) = persist_chat_exchange(
            pool,
            &context,
            thread_id,
            message,
            &answer,
            payload.get("id").and_then(Value::as_str),
            &advisory,
        )
        .await
        {
            return persistence_error("chat.memory.persist", error);
        }
    }
    let include_references =
        advisory.get("response_kind").and_then(Value::as_str) == Some("maintenance_advisory");
    let manual_records = if include_references {
        manual_evidence
            .iter()
            .enumerate()
            .map(|(index, evidence)| manual_reference(evidence, index, 1_600))
            .collect::<Vec<_>>()
    } else {
        vec![]
    };
    let manual_record_count = manual_records.len();
    tracing::info!(
        target: "mxgenius.chat",
        correlation_id = %context.correlation_id,
        model = %model,
        latency_ms = chat_started.elapsed().as_millis(),
        model_tool_calls,
        manual_record_count,
        response_id = payload
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        terminal_status = "success",
        "chat request completed"
    );
    (
        StatusCode::OK,
        Json(json!({
            "response": {
                "advisory": advisory,
                "manual_records": manual_records,
                "retrieval": {
                    "requested": 33,
                    "returned": manual_record_count,
                    "model_context_records": manual_model_context.len(),
                    "warning": manual_warning
                },
                "model": payload.get("model"),
                "response_id": payload.get("id"),
                "thread_id": thread_id,
                "memory_persisted": persistent_pool.is_some(),
                "usage": payload.get("usage"),
                "capability_trace": capability_trace,
                "client_actions": client_actions,
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

fn realtime_session_config(model: String, voice: String, transcription_model: String) -> Value {
    json!({
        "type": "realtime",
        "model": model,
        "output_modalities": ["audio"],
        "audio": {
            "input": {
                "transcription": {
                    "model": transcription_model,
                    "language": "en"
                },
                "turn_detection": {
                    "type": "server_vad",
                    "create_response": true,
                    "interrupt_response": true
                }
            },
            "output": {
                "voice": voice
            }
        },
        "instructions": "You are the MXGenius maintenance copilot. Treat application tools as authoritative. Never claim an operational mutation succeeded without an explicit application confirmation result."
    })
}

async fn create_realtime_call(
    State(state): State<AppState>,
    headers: HeaderMap,
    offer: Bytes,
) -> Response {
    let exchange_started = Instant::now();
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
    let transcription_model = std::env::var("MXGENIUS_REALTIME_TRANSCRIPTION_MODEL")
        .unwrap_or_else(|_| "gpt-4o-mini-transcribe".into());
    let session = realtime_session_config(model.clone(), voice.clone(), transcription_model);
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
    tracing::info!(
        target: "mxgenius.realtime",
        correlation_id = %context.correlation_id,
        model = %model,
        voice = %voice,
        latency_ms = exchange_started.elapsed().as_millis(),
        terminal_status = "connected",
        "Realtime call exchange completed"
    );
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

#[cfg(test)]
mod structured_advisory_tests {
    use super::*;

    #[test]
    fn advisory_schema_is_strict_and_preserves_conversation() {
        let schema = maintenance_advisory_schema();
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(
            schema["properties"]["response_kind"]["enum"],
            json!(["maintenance_advisory", "conversation"])
        );
        let required = schema["required"].as_array().expect("required fields");
        assert!(required.contains(&json!("verify_first")));
        assert!(required.contains(&json!("leading_historical_patterns")));
        assert!(required.contains(&json!("parts_used_in_records")));
    }

    #[test]
    fn retrieval_scores_are_bounded_for_display() {
        assert_eq!(retrieval_percent(Some(0.684)), Some(68));
        assert_eq!(retrieval_percent(Some(1.4)), Some(100));
        assert_eq!(retrieval_percent(Some(-0.2)), Some(0));
        assert_eq!(retrieval_percent(None), None);
    }

    #[test]
    fn follow_up_retrieval_uses_recent_user_turns_case_discrepancy_and_ata() {
        let history = vec![
            ChatTurn {
                role: "user".into(),
                content: "Hydraulic quantity decreased after flight".into(),
            },
            ChatTurn {
                role: "assistant".into(),
                content: "Which system?".into(),
            },
            ChatTurn {
                role: "user".into(),
                content: "ATA 29, system 1".into(),
            },
        ];
        let context = json!({
            "case": {"raw_discrepancy": "HYD SYS 1 pressure low"}
        });
        let query = build_manual_search_query("What should I inspect next?", &history, &context);
        assert!(query.contains("What should I inspect next?"));
        assert!(query.contains("ATA 29, system 1"));
        assert!(query.contains("Hydraulic quantity decreased after flight"));
        assert!(query.contains("HYD SYS 1 pressure low"));
        assert_eq!(extract_ata_chapter(&query), Some("29".into()));
    }

    #[test]
    fn obvious_general_conversation_skips_manual_retrieval() {
        assert!(!should_search_manual("Hello, thanks for the help", None));
        assert!(should_search_manual(
            "What inspection applies to this hydraulic fault?",
            None
        ));
        assert!(should_search_manual(
            "What about that?",
            Some(Uuid::new_v4())
        ));
    }

    #[test]
    fn model_context_excerpt_is_bounded_on_unicode_boundaries() {
        let value = truncate_chars("bleed loop — verify connector", 12);
        assert_eq!(value, "bleed loop —...");
    }

    #[test]
    fn realtime_session_uses_current_nested_audio_contract() {
        let session = realtime_session_config(
            "gpt-realtime-2.1".into(),
            "marin".into(),
            "gpt-4o-mini-transcribe".into(),
        );
        assert_eq!(session["type"], "realtime");
        assert_eq!(session["output_modalities"], json!(["audio"]));
        assert_eq!(session["audio"]["output"]["voice"], "marin");
        assert_eq!(
            session["audio"]["input"]["transcription"]["model"],
            "gpt-4o-mini-transcribe"
        );
        assert_eq!(
            session["audio"]["input"]["turn_detection"]["interrupt_response"],
            true
        );
        assert!(session.get("modalities").is_none());
        assert!(session.get("voice").is_none());
        assert!(session.get("turn_detection").is_none());
        assert!(session.get("input_audio_transcription").is_none());
    }

    #[test]
    fn advisory_citations_must_resolve_to_retrieved_labels() {
        let allowed = ["M-01".to_string()].into_iter().collect();
        assert!(advisory_citations_are_valid(
            &json!({"verify_first":[{"text":"Inspect","citations":["M-01"]}]}),
            &allowed
        ));
        assert!(!advisory_citations_are_valid(
            &json!({"verify_first":[{"text":"Inspect","citations":["M-99"]}]}),
            &allowed
        ));
    }
}
