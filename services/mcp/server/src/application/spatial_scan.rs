//! Bounded, provider-neutral still-frame analysis for deliberate XR scans.
//!
//! Scan images exist only for the duration of one provider request. The service
//! caches a tenant-scoped SHA-256 hash and the bounded candidate result, never
//! image bytes or data URLs.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const SOURCE: &str = "mxgenius-spatial-model";
const MINUTE_MS: u64 = 60_000;
const DAY_MS: u64 = 86_400_000;

#[derive(Debug, Clone)]
pub struct SpatialScanConfig {
    pub enabled: bool,
    pub maximum_long_edge: u32,
    pub maximum_image_bytes: usize,
    pub maximum_candidates: usize,
    pub display_threshold: f64,
    pub timeout: Duration,
    pub cooldown: Duration,
    pub rate_per_minute: usize,
    pub daily_limit: usize,
    pub cache_entries: usize,
    pub cache_ttl: Duration,
}

impl Default for SpatialScanConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            maximum_long_edge: 1_280,
            maximum_image_bytes: 1024 * 1024,
            maximum_candidates: 5,
            display_threshold: 0.85,
            timeout: Duration::from_secs(8),
            cooldown: Duration::from_secs(2),
            rate_per_minute: 12,
            daily_limit: 100,
            cache_entries: 32,
            cache_ttl: Duration::from_secs(60),
        }
    }
}

impl SpatialScanConfig {
    pub fn from_env() -> Self {
        let defaults = Self::default();
        Self {
            enabled: env_bool("MXGENIUS_SPATIAL_SCAN_ENABLED", defaults.enabled),
            maximum_long_edge: env_u64(
                "MXGENIUS_SPATIAL_SCAN_MAX_EDGE",
                defaults.maximum_long_edge as u64,
                320,
                1_280,
            ) as u32,
            maximum_image_bytes: env_u64(
                "MXGENIUS_SPATIAL_SCAN_MAX_BYTES",
                defaults.maximum_image_bytes as u64,
                32 * 1024,
                1024 * 1024,
            ) as usize,
            maximum_candidates: 5,
            display_threshold: 0.85,
            timeout: Duration::from_millis(env_u64(
                "MXGENIUS_SPATIAL_SCAN_TIMEOUT_MS",
                defaults.timeout.as_millis() as u64,
                1_000,
                8_000,
            )),
            cooldown: Duration::from_millis(env_u64(
                "MXGENIUS_SPATIAL_SCAN_COOLDOWN_MS",
                defaults.cooldown.as_millis() as u64,
                250,
                10_000,
            )),
            rate_per_minute: env_u64(
                "MXGENIUS_SPATIAL_SCAN_RATE_PER_MINUTE",
                defaults.rate_per_minute as u64,
                1,
                60,
            ) as usize,
            daily_limit: env_u64(
                "MXGENIUS_SPATIAL_SCAN_DAILY_LIMIT",
                defaults.daily_limit as u64,
                1,
                10_000,
            ) as usize,
            cache_entries: env_u64(
                "MXGENIUS_SPATIAL_SCAN_CACHE_ENTRIES",
                defaults.cache_entries as u64,
                1,
                32,
            ) as usize,
            cache_ttl: Duration::from_secs(env_u64(
                "MXGENIUS_SPATIAL_SCAN_CACHE_TTL_SECONDS",
                defaults.cache_ttl.as_secs(),
                1,
                60,
            )),
        }
    }
}

fn env_bool(name: &str, fallback: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(fallback)
}

fn env_u64(name: &str, fallback: u64, minimum: u64, maximum: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(fallback)
        .clamp(minimum, maximum)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialScanWireRequest {
    pub session_id: String,
    pub scan_id: String,
    #[serde(default)]
    pub request_id: Option<String>,
    pub image: SpatialScanWireImage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialScanWireImage {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub captured_at_ms: u64,
}

#[derive(Debug)]
pub struct SpatialScanRequest {
    pub session_id: String,
    pub scan_id: String,
    pub request_id: Option<String>,
    pub image_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub captured_at_ms: u64,
}

impl SpatialScanWireRequest {
    pub fn decode(self, config: &SpatialScanConfig) -> Result<SpatialScanRequest, &'static str> {
        if !valid_token(&self.session_id, 128) {
            return Err("sessionId is invalid");
        }
        if !valid_token(&self.scan_id, 80) {
            return Err("scanId is invalid");
        }
        if self
            .request_id
            .as_deref()
            .is_some_and(|value| !valid_token(value, 80))
        {
            return Err("requestId is invalid");
        }
        if self.image.width == 0
            || self.image.height == 0
            || self.image.width > config.maximum_long_edge
            || self.image.height > config.maximum_long_edge
        {
            return Err("scan image must fit within the configured long-edge limit");
        }
        let encoded = self
            .image
            .data_url
            .strip_prefix("data:image/jpeg;base64,")
            .or_else(|| self.image.data_url.strip_prefix("data:image/jpg;base64,"))
            .ok_or("scan image must be a JPEG data URL")?;
        if encoded.is_empty() || encoded.len() > ((config.maximum_image_bytes * 4) / 3) + 8 {
            return Err("scan image is empty or exceeds the encoded size limit");
        }
        let image_bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "scan image base64 is invalid")?;
        if image_bytes.is_empty()
            || image_bytes.len() > config.maximum_image_bytes
            || !image_bytes.starts_with(&[0xff, 0xd8])
        {
            return Err("scan image is not a valid bounded JPEG");
        }
        let (actual_width, actual_height) =
            jpeg_dimensions(&image_bytes).ok_or("scan image dimensions could not be verified")?;
        if actual_width != self.image.width || actual_height != self.image.height {
            return Err("scan image dimensions do not match its metadata");
        }
        Ok(SpatialScanRequest {
            session_id: self.session_id,
            scan_id: self.scan_id,
            request_id: self.request_id,
            image_bytes,
            width: self.image.width,
            height: self.image.height,
            captured_at_ms: self.image.captured_at_ms,
        })
    }
}

fn valid_token(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut index = 2usize;
    while index + 3 < bytes.len() {
        while index < bytes.len() && bytes[index] != 0xff {
            index += 1;
        }
        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }
        let marker = *bytes.get(index)?;
        index += 1;
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let segment_length =
            u16::from_be_bytes([*bytes.get(index)?, *bytes.get(index + 1)?]) as usize;
        if segment_length < 2 || index + segment_length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            if segment_length < 7 {
                return None;
            }
            let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            return (width > 0 && height > 0).then_some((width, height));
        }
        index += segment_length;
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpatialBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpatialCandidate {
    pub provider_id: String,
    pub label: String,
    pub kind: String,
    pub confidence: f64,
    pub bounds: SpatialBounds,
}

#[derive(Debug, Clone)]
pub struct SpatialProviderRequest {
    pub scan_id: String,
    pub correlation_id: String,
    pub safety_identifier: String,
    pub image_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum SpatialProviderError {
    #[error("provider unavailable")]
    Unavailable,
    #[error("provider rate limited")]
    RateLimited,
    #[error("provider returned an invalid result")]
    InvalidResponse,
}

#[async_trait]
pub trait SpatialScanProvider: Send + Sync {
    async fn analyze(
        &self,
        request: SpatialProviderRequest,
    ) -> Result<Vec<SpatialCandidate>, SpatialProviderError>;
}

pub struct OpenAiSpatialScanProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
    endpoint: String,
}

impl OpenAiSpatialScanProvider {
    pub fn from_env(client: reqwest::Client) -> Option<Self> {
        let api_key = std::env::var("OPENAI_API_KEY").ok()?;
        if api_key.trim().is_empty() {
            return None;
        }
        let model = std::env::var("MXGENIUS_SPATIAL_SCAN_MODEL")
            .or_else(|_| std::env::var("MXGENIUS_OPENAI_TEXT_MODEL"))
            .unwrap_or_else(|_| "gpt-5.4-mini".into());
        let endpoint = std::env::var("MXGENIUS_OPENAI_RESPONSES_URL")
            .unwrap_or_else(|_| OPENAI_RESPONSES_URL.into());
        Some(Self {
            client,
            api_key,
            model,
            endpoint,
        })
    }
}

#[async_trait]
impl SpatialScanProvider for OpenAiSpatialScanProvider {
    async fn analyze(
        &self,
        request: SpatialProviderRequest,
    ) -> Result<Vec<SpatialCandidate>, SpatialProviderError> {
        let encoded = base64::engine::general_purpose::STANDARD.encode(&request.image_bytes);
        let body = json!({
            "model": self.model,
            "instructions": "Locate only clearly visible physical objects useful for spatial interaction in an aviation maintenance scene. Return no prose. Do not perform OCR, identify people, read labels, diagnose faults, infer airworthiness, or make maintenance claims. Use short generic labels. Coordinates are normalized to the complete image: x and y are the top-left corner; width and height are positive. Include no more than five candidates and omit uncertain objects.",
            "input": [{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "Return high-confidence object locations only."},
                    {
                        "type": "input_image",
                        "image_url": format!("data:image/jpeg;base64,{encoded}"),
                        "detail": "low"
                    }
                ]
            }],
            "text": {"format": {
                "type": "json_schema",
                "name": "mxgenius_spatial_candidates_v1",
                "strict": true,
                "schema": spatial_provider_schema()
            }},
            "reasoning": {"effort": "low"},
            "max_output_tokens": 700,
            "store": false,
            "metadata": {
                "purpose": "spatial-scan",
                "scan_id": request.scan_id,
                "width": request.width.to_string(),
                "height": request.height.to_string()
            }
        });
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .header("OpenAI-Safety-Identifier", request.safety_identifier)
            .header("x-client-request-id", request.correlation_id)
            .json(&body)
            .send()
            .await
            .map_err(|_| SpatialProviderError::Unavailable)?;
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(SpatialProviderError::RateLimited);
        }
        if !response.status().is_success() {
            return Err(SpatialProviderError::Unavailable);
        }
        let payload = response
            .json::<Value>()
            .await
            .map_err(|_| SpatialProviderError::InvalidResponse)?;
        let output = openai_output_text(&payload).ok_or(SpatialProviderError::InvalidResponse)?;
        parse_provider_candidates(output)
    }
}

fn spatial_provider_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["candidates"],
        "properties": {
            "candidates": {
                "type": "array",
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["providerId", "label", "kind", "confidence", "bounds"],
                    "properties": {
                        "providerId": {"type": "string", "minLength": 1, "maxLength": 120, "pattern": "^[A-Za-z0-9._:-]+$"},
                        "label": {"type": "string", "minLength": 1, "maxLength": 180},
                        "kind": {"enum": ["aircraft", "component", "sensor", "observed-object"]},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "bounds": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["x", "y", "width", "height"],
                            "properties": {
                                "x": {"type": "number", "minimum": 0, "exclusiveMaximum": 1},
                                "y": {"type": "number", "minimum": 0, "exclusiveMaximum": 1},
                                "width": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
                                "height": {"type": "number", "exclusiveMinimum": 0, "maximum": 1}
                            }
                        }
                    }
                }
            }
        }
    })
}

fn openai_output_text(payload: &Value) -> Option<&str> {
    payload.get("output")?.as_array()?.iter().find_map(|item| {
        item.get("content")?.as_array()?.iter().find_map(|content| {
            matches!(
                content.get("type").and_then(Value::as_str),
                Some("output_text") | Some("text")
            )
            .then(|| content.get("text").and_then(Value::as_str))
            .flatten()
        })
    })
}

fn parse_provider_candidates(output: &str) -> Result<Vec<SpatialCandidate>, SpatialProviderError> {
    #[derive(Deserialize)]
    struct Output {
        candidates: Vec<SpatialCandidate>,
    }
    let parsed: Output =
        serde_json::from_str(output).map_err(|_| SpatialProviderError::InvalidResponse)?;
    if parsed.candidates.len() > 5
        || parsed.candidates.iter().any(|candidate| {
            !valid_token(&candidate.provider_id, 120)
                || candidate.label.trim().is_empty()
                || candidate.label.chars().count() > 180
                || !matches!(
                    candidate.kind.as_str(),
                    "aircraft" | "component" | "sensor" | "observed-object"
                )
                || !candidate.confidence.is_finite()
                || !(0.0..=1.0).contains(&candidate.confidence)
                || !valid_bounds(&candidate.bounds)
        })
    {
        return Err(SpatialProviderError::InvalidResponse);
    }
    Ok(parsed.candidates)
}

fn valid_bounds(bounds: &SpatialBounds) -> bool {
    [bounds.x, bounds.y, bounds.width, bounds.height]
        .into_iter()
        .all(f64::is_finite)
        && bounds.x >= 0.0
        && bounds.y >= 0.0
        && bounds.width > 0.0
        && bounds.height > 0.0
        && bounds.x + bounds.width <= 1.0
        && bounds.y + bounds.height <= 1.0
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialScanResponse {
    pub status: String,
    pub scan_id: String,
    pub request_id: Option<String>,
    pub source: String,
    pub observed_at_ms: u64,
    pub cached: bool,
    pub candidates: Vec<SpatialCandidate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    pub limits: SpatialScanLimits,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialScanLimits {
    pub maximum_candidates: usize,
    pub display_threshold: f64,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    organization_id: Uuid,
    hash: [u8; 32],
    stored_at_ms: u64,
    candidates: Vec<SpatialCandidate>,
}

#[derive(Debug, Default)]
struct OrganizationUsage {
    day: u64,
    daily_attempts: usize,
    minute_attempts: VecDeque<u64>,
}

#[derive(Debug, Default)]
struct SpatialScanState {
    cache: VecDeque<CacheEntry>,
    in_flight: HashSet<(Uuid, String)>,
    last_started: HashMap<(Uuid, String), u64>,
    usage: HashMap<Uuid, OrganizationUsage>,
}

#[derive(Debug, Default)]
struct SpatialScanTelemetry {
    requests_total: AtomicU64,
    provider_attempts_total: AtomicU64,
    cache_hits_total: AtomicU64,
    throttled_total: AtomicU64,
    budget_exhausted_total: AtomicU64,
    timeouts_total: AtomicU64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpatialScanTelemetrySnapshot {
    pub requests_total: u64,
    pub provider_attempts_total: u64,
    pub cache_hits_total: u64,
    pub throttled_total: u64,
    pub budget_exhausted_total: u64,
    pub timeouts_total: u64,
}

#[derive(Clone)]
pub struct SpatialScanService {
    config: SpatialScanConfig,
    provider: Option<Arc<dyn SpatialScanProvider>>,
    state: Arc<Mutex<SpatialScanState>>,
    telemetry: Arc<SpatialScanTelemetry>,
    now_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl SpatialScanService {
    pub fn from_env(client: reqwest::Client) -> Self {
        let config = SpatialScanConfig::from_env();
        let provider = OpenAiSpatialScanProvider::from_env(client)
            .map(|value| Arc::new(value) as Arc<dyn SpatialScanProvider>);
        Self::new(config, provider)
    }

    pub fn new(config: SpatialScanConfig, provider: Option<Arc<dyn SpatialScanProvider>>) -> Self {
        Self::with_clock(config, provider, Arc::new(epoch_ms))
    }

    fn with_clock(
        config: SpatialScanConfig,
        provider: Option<Arc<dyn SpatialScanProvider>>,
        now_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
    ) -> Self {
        Self {
            config,
            provider,
            state: Arc::new(Mutex::new(SpatialScanState::default())),
            telemetry: Arc::new(SpatialScanTelemetry::default()),
            now_ms,
        }
    }

    pub fn config(&self) -> &SpatialScanConfig {
        &self.config
    }

    pub fn availability(&self) -> &'static str {
        if !self.config.enabled {
            "disabled"
        } else if self.provider.is_none() {
            "not_configured"
        } else {
            "ready"
        }
    }

    pub fn telemetry(&self) -> SpatialScanTelemetrySnapshot {
        SpatialScanTelemetrySnapshot {
            requests_total: self.telemetry.requests_total.load(Ordering::Relaxed),
            provider_attempts_total: self
                .telemetry
                .provider_attempts_total
                .load(Ordering::Relaxed),
            cache_hits_total: self.telemetry.cache_hits_total.load(Ordering::Relaxed),
            throttled_total: self.telemetry.throttled_total.load(Ordering::Relaxed),
            budget_exhausted_total: self
                .telemetry
                .budget_exhausted_total
                .load(Ordering::Relaxed),
            timeouts_total: self.telemetry.timeouts_total.load(Ordering::Relaxed),
        }
    }

    pub async fn analyze(
        &self,
        context: &ExecutionContext,
        request: SpatialScanRequest,
        safety_identifier: String,
    ) -> SpatialScanResponse {
        self.telemetry
            .requests_total
            .fetch_add(1, Ordering::Relaxed);
        let now = (self.now_ms)();
        if !self.config.enabled {
            return self.response(
                &request,
                now,
                "unavailable",
                false,
                vec![],
                Some("Spatial scan analysis is disabled"),
                None,
            );
        }
        let Some(provider) = self.provider.clone() else {
            return self.response(
                &request,
                now,
                "unavailable",
                false,
                vec![],
                Some("Spatial scan analysis is not configured"),
                None,
            );
        };
        let organization_id = context.organization_id.0;
        let session_key = (organization_id, request.session_id.clone());
        let hash: [u8; 32] = Sha256::digest(&request.image_bytes).into();

        {
            let mut state = self.state.lock();
            let ttl_ms = self.config.cache_ttl.as_millis() as u64;
            state
                .cache
                .retain(|entry| now.saturating_sub(entry.stored_at_ms) <= ttl_ms);
            if let Some(entry) = state
                .cache
                .iter()
                .find(|entry| entry.organization_id == organization_id && entry.hash == hash)
            {
                self.telemetry
                    .cache_hits_total
                    .fetch_add(1, Ordering::Relaxed);
                let candidates = entry.candidates.clone();
                let status = if candidates.is_empty() {
                    "empty"
                } else {
                    "ready"
                };
                return self.response(&request, now, status, true, candidates, None, None);
            }
            if state.in_flight.contains(&session_key) {
                self.telemetry
                    .throttled_total
                    .fetch_add(1, Ordering::Relaxed);
                return self.response(
                    &request,
                    now,
                    "unavailable",
                    false,
                    vec![],
                    Some("A scan is already in progress for this session"),
                    Some(250),
                );
            }
            let cooldown_ms = self.config.cooldown.as_millis() as u64;
            if let Some(last) = state.last_started.get(&session_key) {
                let elapsed = now.saturating_sub(*last);
                if elapsed < cooldown_ms {
                    self.telemetry
                        .throttled_total
                        .fetch_add(1, Ordering::Relaxed);
                    return self.response(
                        &request,
                        now,
                        "rate-limited",
                        false,
                        vec![],
                        Some("Scan cooldown is active"),
                        Some(cooldown_ms - elapsed),
                    );
                }
            }
            let usage = state.usage.entry(organization_id).or_default();
            let day = now / DAY_MS;
            if usage.day != day {
                usage.day = day;
                usage.daily_attempts = 0;
                usage.minute_attempts.clear();
            }
            while usage
                .minute_attempts
                .front()
                .is_some_and(|started| now.saturating_sub(*started) >= MINUTE_MS)
            {
                usage.minute_attempts.pop_front();
            }
            if usage.daily_attempts >= self.config.daily_limit {
                self.telemetry
                    .budget_exhausted_total
                    .fetch_add(1, Ordering::Relaxed);
                return self.response(
                    &request,
                    now,
                    "budget-exhausted",
                    false,
                    vec![],
                    Some("Organization scan budget is exhausted for today"),
                    None,
                );
            }
            if usage.minute_attempts.len() >= self.config.rate_per_minute {
                self.telemetry
                    .throttled_total
                    .fetch_add(1, Ordering::Relaxed);
                let retry_after = usage
                    .minute_attempts
                    .front()
                    .map(|started| MINUTE_MS.saturating_sub(now.saturating_sub(*started)))
                    .unwrap_or(MINUTE_MS);
                return self.response(
                    &request,
                    now,
                    "rate-limited",
                    false,
                    vec![],
                    Some("Organization scan rate limit is active"),
                    Some(retry_after),
                );
            }
            usage.daily_attempts += 1;
            usage.minute_attempts.push_back(now);
            state.last_started.insert(session_key.clone(), now);
            state.in_flight.insert(session_key.clone());
        }

        let provider_request = SpatialProviderRequest {
            scan_id: request.scan_id.clone(),
            correlation_id: context.correlation_id.to_string(),
            safety_identifier,
            image_bytes: request.image_bytes.clone(),
            width: request.width,
            height: request.height,
        };
        self.telemetry
            .provider_attempts_total
            .fetch_add(1, Ordering::Relaxed);
        let started = std::time::Instant::now();
        let provider_result =
            tokio::time::timeout(self.config.timeout, provider.analyze(provider_request)).await;
        self.state.lock().in_flight.remove(&session_key);
        let latency_ms = started.elapsed().as_millis();

        let (provider_status, response) = match provider_result {
            Ok(Ok(mut candidates)) => {
                candidates.truncate(self.config.maximum_candidates);
                let status = if candidates.is_empty() {
                    "empty"
                } else {
                    "ready"
                };
                let observed = (self.now_ms)();
                let mut state = self.state.lock();
                state.cache.push_back(CacheEntry {
                    organization_id,
                    hash,
                    stored_at_ms: observed,
                    candidates: candidates.clone(),
                });
                while state.cache.len() > self.config.cache_entries {
                    state.cache.pop_front();
                }
                (
                    status,
                    self.response(&request, observed, status, false, candidates, None, None),
                )
            }
            Ok(Err(SpatialProviderError::RateLimited)) => (
                "rate-limited",
                self.response(
                    &request,
                    (self.now_ms)(),
                    "rate-limited",
                    false,
                    vec![],
                    Some("Spatial analysis provider is rate limited"),
                    Some(2_000),
                ),
            ),
            Ok(Err(SpatialProviderError::InvalidResponse)) => (
                "invalid-response",
                self.response(
                    &request,
                    (self.now_ms)(),
                    "unavailable",
                    false,
                    vec![],
                    Some("Spatial analysis returned an invalid result"),
                    None,
                ),
            ),
            Ok(Err(SpatialProviderError::Unavailable)) => (
                "unavailable",
                self.response(
                    &request,
                    (self.now_ms)(),
                    "unavailable",
                    false,
                    vec![],
                    Some("Spatial analysis provider is unavailable"),
                    None,
                ),
            ),
            Err(_) => ("timeout", {
                self.telemetry
                    .timeouts_total
                    .fetch_add(1, Ordering::Relaxed);
                self.response(
                    &request,
                    (self.now_ms)(),
                    "unavailable",
                    false,
                    vec![],
                    Some("Spatial analysis timed out"),
                    None,
                )
            }),
        };
        tracing::info!(
            target: "mxgenius.spatial_scan",
            correlation_id = %context.correlation_id,
            organization_id = %context.organization_id,
            provider_status,
            latency_ms,
            width = request.width,
            height = request.height,
            result_count = response.candidates.len(),
            cached = response.cached,
            "bounded spatial scan completed"
        );
        response
    }

    pub fn invalid_image_response(
        &self,
        scan_id: String,
        request_id: Option<String>,
        reason: &'static str,
    ) -> SpatialScanResponse {
        let request = SpatialScanRequest {
            session_id: String::new(),
            scan_id,
            request_id,
            image_bytes: vec![],
            width: 0,
            height: 0,
            captured_at_ms: 0,
        };
        self.response(
            &request,
            (self.now_ms)(),
            "invalid-image",
            false,
            vec![],
            Some(reason),
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn response(
        &self,
        request: &SpatialScanRequest,
        observed_at_ms: u64,
        status: &str,
        cached: bool,
        candidates: Vec<SpatialCandidate>,
        reason: Option<&str>,
        retry_after_ms: Option<u64>,
    ) -> SpatialScanResponse {
        SpatialScanResponse {
            status: status.into(),
            scan_id: request.scan_id.clone(),
            request_id: request.request_id.clone(),
            source: SOURCE.into(),
            observed_at_ms,
            cached,
            candidates,
            reason: reason.map(str::to_owned),
            retry_after_ms,
            limits: SpatialScanLimits {
                maximum_candidates: self.config.maximum_candidates,
                display_threshold: self.config.display_threshold,
            },
        }
    }
}

fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use tokio::sync::Notify;

    use mxgenius_shared::application::context::{ClientIdentity, ExecutionContext};
    use mxgenius_shared::application::policy::Role;
    use mxgenius_shared::domain::ids::{OrganizationId, UserId};

    struct MockProvider {
        calls: AtomicUsize,
        result: Result<Vec<SpatialCandidate>, SpatialProviderError>,
        block: Option<Arc<Notify>>,
    }

    #[async_trait]
    impl SpatialScanProvider for MockProvider {
        async fn analyze(
            &self,
            _request: SpatialProviderRequest,
        ) -> Result<Vec<SpatialCandidate>, SpatialProviderError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(block) = &self.block {
                block.notified().await;
            }
            self.result.clone()
        }
    }

    fn context() -> ExecutionContext {
        ExecutionContext::new(
            OrganizationId(Uuid::new_v4()),
            UserId(Uuid::new_v4()),
            Role::Technician,
            ClientIdentity {
                name: "spatial-test".into(),
                version: "1".into(),
            },
        )
    }

    fn candidate() -> SpatialCandidate {
        SpatialCandidate {
            provider_id: "panel-1".into(),
            label: "Access panel".into(),
            kind: "component".into(),
            confidence: 0.93,
            bounds: SpatialBounds {
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.4,
            },
        }
    }

    fn request_for_session(session_id: &str, scan_id: &str, byte: u8) -> SpatialScanRequest {
        SpatialScanRequest {
            session_id: session_id.into(),
            scan_id: scan_id.into(),
            request_id: Some(format!("request-{scan_id}")),
            image_bytes: vec![0xff, 0xd8, byte, 0xff, 0xd9],
            width: 640,
            height: 480,
            captured_at_ms: 1,
        }
    }

    fn request(scan_id: &str, byte: u8) -> SpatialScanRequest {
        request_for_session("session-1", scan_id, byte)
    }

    fn jpeg(width: u16, height: u16) -> Vec<u8> {
        vec![
            0xff,
            0xd8,
            0xff,
            0xc0,
            0x00,
            0x11,
            0x08,
            (height >> 8) as u8,
            height as u8,
            (width >> 8) as u8,
            width as u8,
            0x03,
            0x01,
            0x11,
            0x00,
            0x02,
            0x11,
            0x00,
            0x03,
            0x11,
            0x00,
            0xff,
            0xd9,
        ]
    }

    fn service(
        mut config: SpatialScanConfig,
        provider: Arc<MockProvider>,
        now: Arc<AtomicU64>,
    ) -> SpatialScanService {
        config.enabled = true;
        let clock = Arc::new(move || now.load(Ordering::SeqCst));
        SpatialScanService::with_clock(config, Some(provider), clock)
    }

    #[test]
    fn wire_validation_enforces_jpeg_size_and_dimensions() {
        let jpeg = base64::engine::general_purpose::STANDARD.encode(jpeg(1_280, 720));
        let valid = SpatialScanWireRequest {
            session_id: "session-1".into(),
            scan_id: "scan-12345678".into(),
            request_id: None,
            image: SpatialScanWireImage {
                data_url: format!("data:image/jpeg;base64,{jpeg}"),
                width: 1_280,
                height: 720,
                captured_at_ms: 1,
            },
        };
        assert!(valid.decode(&SpatialScanConfig::default()).is_ok());
        let oversized = SpatialScanWireRequest {
            session_id: "session-1".into(),
            scan_id: "scan-12345678".into(),
            request_id: None,
            image: SpatialScanWireImage {
                data_url: format!("data:image/jpeg;base64,{jpeg}"),
                width: 1_281,
                height: 720,
                captured_at_ms: 1,
            },
        };
        assert_eq!(
            oversized.decode(&SpatialScanConfig::default()).unwrap_err(),
            "scan image must fit within the configured long-edge limit"
        );
    }

    #[tokio::test]
    async fn identical_frame_after_session_replacement_uses_cache_without_a_second_charge() {
        let provider = Arc::new(MockProvider {
            calls: AtomicUsize::new(0),
            result: Ok(vec![candidate()]),
            block: None,
        });
        let now = Arc::new(AtomicU64::new(100_000));
        let service = service(SpatialScanConfig::default(), provider.clone(), now.clone());
        let context = context();
        let first = service
            .analyze(&context, request("scan-1", 1), "safe".into())
            .await;
        assert_eq!(first.status, "ready");
        now.store(101_000, Ordering::SeqCst);
        let cached = service
            .analyze(
                &context,
                request_for_session("session-2", "scan-2", 1),
                "safe".into(),
            )
            .await;
        assert!(cached.cached);
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            service.telemetry(),
            SpatialScanTelemetrySnapshot {
                requests_total: 2,
                provider_attempts_total: 1,
                cache_hits_total: 1,
                throttled_total: 0,
                budget_exhausted_total: 0,
                timeouts_total: 0,
            }
        );
    }

    #[tokio::test]
    async fn cooldown_rate_and_daily_budgets_are_typed_before_provider_work() {
        let provider = Arc::new(MockProvider {
            calls: AtomicUsize::new(0),
            result: Ok(vec![]),
            block: None,
        });
        let now = Arc::new(AtomicU64::new(100_000));
        let config = SpatialScanConfig {
            rate_per_minute: 2,
            daily_limit: 2,
            ..SpatialScanConfig::default()
        };
        let service = service(config, provider.clone(), now.clone());
        let context = context();
        assert_eq!(
            service
                .analyze(&context, request("scan-1", 1), "safe".into())
                .await
                .status,
            "empty"
        );
        now.store(100_500, Ordering::SeqCst);
        assert_eq!(
            service
                .analyze(&context, request("scan-2", 2), "safe".into())
                .await
                .status,
            "rate-limited"
        );
        now.store(103_000, Ordering::SeqCst);
        assert_eq!(
            service
                .analyze(&context, request("scan-3", 3), "safe".into())
                .await
                .status,
            "empty"
        );
        now.store(106_000, Ordering::SeqCst);
        assert_eq!(
            service
                .analyze(&context, request("scan-4", 4), "safe".into())
                .await
                .status,
            "budget-exhausted"
        );
        assert_eq!(provider.calls.load(Ordering::SeqCst), 2);
        let telemetry = service.telemetry();
        assert_eq!(telemetry.provider_attempts_total, 2);
        assert_eq!(telemetry.throttled_total, 1);
        assert_eq!(telemetry.budget_exhausted_total, 1);
    }

    #[tokio::test]
    async fn concurrent_session_scan_is_refused_and_provider_is_attempted_once() {
        let release = Arc::new(Notify::new());
        let provider = Arc::new(MockProvider {
            calls: AtomicUsize::new(0),
            result: Ok(vec![candidate()]),
            block: Some(release.clone()),
        });
        let now = Arc::new(AtomicU64::new(100_000));
        let service = service(SpatialScanConfig::default(), provider.clone(), now);
        let context = context();
        let first_service = service.clone();
        let first_context = context.clone();
        let first = tokio::spawn(async move {
            first_service
                .analyze(&first_context, request("scan-1", 1), "safe".into())
                .await
        });
        for _ in 0..100 {
            if provider.calls.load(Ordering::SeqCst) == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        let blocked = service
            .analyze(&context, request("scan-2", 2), "safe".into())
            .await;
        assert_eq!(blocked.status, "unavailable");
        release.notify_one();
        assert_eq!(first.await.unwrap().status, "ready");
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn provider_timeout_is_typed_and_never_retried() {
        let provider = Arc::new(MockProvider {
            calls: AtomicUsize::new(0),
            result: Ok(vec![candidate()]),
            block: Some(Arc::new(Notify::new())),
        });
        let now = Arc::new(AtomicU64::new(100_000));
        let config = SpatialScanConfig {
            timeout: Duration::from_millis(5),
            ..SpatialScanConfig::default()
        };
        let service = service(config, provider.clone(), now);
        let result = service
            .analyze(&context(), request("scan-timeout", 1), "safe".into())
            .await;
        assert_eq!(result.status, "unavailable");
        assert_eq!(result.reason.as_deref(), Some("Spatial analysis timed out"));
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        assert_eq!(service.telemetry().timeouts_total, 1);
    }

    #[test]
    fn provider_schema_and_parser_keep_output_bounded_and_location_only() {
        assert_eq!(
            spatial_provider_schema().pointer("/properties/candidates/maxItems"),
            Some(&json!(5))
        );
        let parsed =
            parse_provider_candidates(&json!({"candidates": [candidate()]}).to_string()).unwrap();
        assert_eq!(parsed, vec![candidate()]);
        assert!(!serde_json::to_string(&parsed).unwrap().contains("image"));
    }
}
