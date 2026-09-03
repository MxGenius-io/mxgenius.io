//! Tenant-scoped Remote Witness room state and invitation lifecycle.
//!
//! This service carries bounded consent, presence, target/case projection, and
//! WebRTC signaling metadata. It never accepts or stores continuous media.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::broadcast;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::policy::Role;

const SOCKET_PATH: &str = "/api/xr/witness/ws";
const MAX_ROOMS: usize = 128;
const MAX_COMMENTS: usize = 32;
const MAX_SIGNAL_BYTES: usize = 64 * 1024;
const MAX_SDP_BYTES: usize = 56 * 1024;
const MAX_ICE_CANDIDATE_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone)]
pub struct RemoteWitnessConfig {
    pub invite_ttl: Duration,
    pub session_ttl: Duration,
    pub maximum_viewers: usize,
    pub join_base_url: String,
    pub ice_servers: Vec<Value>,
}

impl Default for RemoteWitnessConfig {
    fn default() -> Self {
        Self {
            invite_ttl: Duration::from_secs(5 * 60),
            session_ttl: Duration::from_secs(60 * 60),
            maximum_viewers: 1,
            join_base_url: "https://mxgenius.io/witness.html".into(),
            ice_servers: vec![],
        }
    }
}

impl RemoteWitnessConfig {
    pub fn from_env() -> Self {
        let defaults = Self::default();
        let join_base_url = std::env::var("MXGENIUS_WITNESS_JOIN_URL")
            .ok()
            .filter(|value| value.starts_with("https://") && value.len() <= 512)
            .unwrap_or(defaults.join_base_url);
        let ice_servers = std::env::var("MXGENIUS_WITNESS_ICE_SERVERS_JSON")
            .ok()
            .and_then(|value| serde_json::from_str::<Vec<Value>>(&value).ok())
            .filter(|servers| valid_ice_servers(servers))
            .unwrap_or_default();
        Self {
            invite_ttl: Duration::from_secs(env_u64(
                "MXGENIUS_WITNESS_INVITE_TTL_SECONDS",
                defaults.invite_ttl.as_secs(),
                60,
                15 * 60,
            )),
            session_ttl: Duration::from_secs(env_u64(
                "MXGENIUS_WITNESS_SESSION_TTL_SECONDS",
                defaults.session_ttl.as_secs(),
                5 * 60,
                4 * 60 * 60,
            )),
            maximum_viewers: env_u64("MXGENIUS_WITNESS_MAX_VIEWERS", 1, 1, 4) as usize,
            join_base_url,
            ice_servers,
        }
    }
}

fn valid_ice_servers(servers: &[Value]) -> bool {
    servers.len() <= 4
        && servers.iter().all(|server| {
            let Some(server) = server.as_object() else {
                return false;
            };
            if server.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "urls" | "username" | "credential" | "credentialType"
                )
            }) {
                return false;
            }
            let urls_valid = match server.get("urls") {
                Some(Value::String(url)) => valid_ice_url(url),
                Some(Value::Array(urls)) => {
                    !urls.is_empty()
                        && urls.len() <= 4
                        && urls
                            .iter()
                            .all(|url| url.as_str().is_some_and(valid_ice_url))
                }
                _ => false,
            };
            urls_valid
                && ["username", "credential"].iter().all(|key| {
                    server.get(*key).map_or(true, |value| {
                        value.as_str().is_some_and(|value| value.len() <= 256)
                    })
                })
                && server
                    .get("credentialType")
                    .map_or(true, |value| value.as_str() == Some("password"))
        })
}

fn valid_ice_url(url: &str) -> bool {
    url.len() <= 1024
        && ["stun:", "stuns:", "turn:", "turns:"].iter().any(|prefix| {
            url.strip_prefix(prefix)
                .is_some_and(|value| !value.is_empty())
        })
}

fn env_u64(name: &str, fallback: u64, minimum: u64, maximum: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(fallback)
        .clamp(minimum, maximum)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWitnessInvitation {
    pub xr_session_id: String,
    #[serde(default)]
    pub case_id: Option<String>,
    pub audience: String,
    #[serde(default)]
    pub layers: WitnessLayers,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExchangeWitnessInvitation {
    #[serde(default)]
    pub invitation: Option<String>,
    #[serde(default)]
    pub manual_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WitnessControlInput {
    pub action: String,
    #[serde(default)]
    pub layers: Option<WitnessLayers>,
    #[serde(default)]
    pub consent: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WitnessLayers {
    #[serde(default = "yes")]
    pub pov: bool,
    #[serde(default)]
    pub thermal: bool,
    #[serde(default = "yes")]
    pub target: bool,
    #[serde(default = "yes")]
    pub case_summary: bool,
    #[serde(default)]
    pub case_media: bool,
    #[serde(default)]
    pub microphone: bool,
}

fn yes() -> bool {
    true
}

impl Default for WitnessLayers {
    fn default() -> Self {
        Self {
            pov: true,
            thermal: false,
            target: true,
            case_summary: true,
            case_media: false,
            microphone: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WitnessInvitationResponse {
    pub room_id: Uuid,
    pub invitation: String,
    pub join_url: String,
    pub manual_code: String,
    pub producer_credential: String,
    pub socket_path: &'static str,
    pub invite_expires_at_ms: u64,
    pub session_expires_at_ms: u64,
    pub state: WitnessRoomSummary,
    pub ice_servers: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WitnessViewerSession {
    pub room_id: Uuid,
    pub participant_id: Uuid,
    pub credential: String,
    pub socket_path: &'static str,
    pub expires_at_ms: u64,
    pub state: WitnessRoomSummary,
    pub ice_servers: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WitnessRecordingState {
    pub state: String,
    pub wearer_consented: bool,
    pub viewer_consented: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedWitnessObservation {
    pub observation_id: Uuid,
    pub participant_id: Uuid,
    pub source: String,
    pub text: String,
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WitnessRoomSummary {
    pub room_id: Uuid,
    pub audience: String,
    pub status: String,
    pub approved: bool,
    pub layers: WitnessLayers,
    pub viewer_count: usize,
    pub recording: WitnessRecordingState,
    pub expires_at_ms: u64,
    pub proposed_observations: Vec<ProposedWitnessObservation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WitnessSocketRole {
    Producer,
    Viewer,
}

impl WitnessSocketRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Producer => "producer",
            Self::Viewer => "customer-viewer",
        }
    }
}

#[derive(Debug, Clone)]
pub struct WitnessSocketIdentity {
    pub room_id: Uuid,
    pub participant_id: Uuid,
    pub role: WitnessSocketRole,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WitnessCaseMediaAccess {
    pub organization_id: Uuid,
    pub case_id: String,
}

#[derive(Debug)]
pub struct WitnessSocketAdmission {
    pub identity: WitnessSocketIdentity,
    pub events: broadcast::Receiver<Value>,
    pub initial_event: Value,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum RemoteWitnessError {
    #[error("remote witness request is invalid")]
    Invalid,
    #[error("remote witness room was not found")]
    NotFound,
    #[error("remote witness invitation expired")]
    InviteExpired,
    #[error("remote witness invitation was already used")]
    InviteConsumed,
    #[error("remote witness session expired")]
    SessionExpired,
    #[error("remote witness session was revoked")]
    Revoked,
    #[error("remote witness access denied")]
    AccessDenied,
    #[error("remote witness viewer limit reached")]
    ViewerLimit,
    #[error("remote witness producer is already connected")]
    ProducerAlreadyConnected,
    #[error("wearer approval is required")]
    ApprovalRequired,
    #[error("recording requires separate consent from wearer and viewer")]
    RecordingConsentRequired,
}

#[derive(Debug, Clone)]
struct CredentialRecord {
    room_id: Uuid,
    participant_id: Uuid,
    role: WitnessSocketRole,
    expires_at_ms: u64,
}

struct WitnessRoom {
    room_id: Uuid,
    organization_id: Uuid,
    owner_user_id: Uuid,
    case_id: Option<String>,
    audience: String,
    invite_hash: [u8; 32],
    manual_code: String,
    invite_expires_at_ms: u64,
    invite_consumed: bool,
    expires_at_ms: u64,
    approved: bool,
    paused: bool,
    revoked: bool,
    headset_connected: bool,
    layers: WitnessLayers,
    viewer_connections: HashMap<Uuid, usize>,
    wearer_recording_consent: bool,
    viewer_recording_consent: bool,
    proposed_observations: Vec<ProposedWitnessObservation>,
    events: broadcast::Sender<Value>,
}

#[derive(Default)]
struct RemoteWitnessState {
    rooms: HashMap<Uuid, WitnessRoom>,
    invitations: HashMap<[u8; 32], Uuid>,
    manual_codes: HashMap<String, Uuid>,
    credentials: HashMap<[u8; 32], CredentialRecord>,
}

#[derive(Clone)]
pub struct RemoteWitnessService {
    config: RemoteWitnessConfig,
    state: Arc<Mutex<RemoteWitnessState>>,
    now_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl RemoteWitnessService {
    pub fn from_env() -> Self {
        Self::new(RemoteWitnessConfig::from_env())
    }

    pub fn new(config: RemoteWitnessConfig) -> Self {
        Self::with_clock(config, Arc::new(epoch_ms))
    }

    fn with_clock(config: RemoteWitnessConfig, now_ms: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self {
            config,
            state: Arc::new(Mutex::new(RemoteWitnessState::default())),
            now_ms,
        }
    }

    pub fn create_invitation(
        &self,
        context: &ExecutionContext,
        input: CreateWitnessInvitation,
    ) -> Result<WitnessInvitationResponse, RemoteWitnessError> {
        ensure_wearer_role(context.role)?;
        let _xr_session_id = bounded_token(&input.xr_session_id, 128)?;
        let audience = bounded_text(&input.audience, 80)?;
        let case_id = input
            .case_id
            .as_deref()
            .map(|value| bounded_token(value, 128))
            .transpose()?;
        let now = (self.now_ms)();
        let invitation = opaque_token();
        let invitation_hash = token_hash(&invitation);
        let producer_credential = opaque_token();
        let producer_hash = token_hash(&producer_credential);
        let room_id = Uuid::new_v4();
        let producer_id = Uuid::new_v4();
        // Twelve hexadecimal characters keep the fallback code typeable while
        // retaining 48 bits of entropy for a short-lived public exchange route.
        let manual_code = invitation[..12].to_ascii_uppercase();
        let invite_expires_at_ms = now + self.config.invite_ttl.as_millis() as u64;
        let session_expires_at_ms = now + self.config.session_ttl.as_millis() as u64;
        let (events, _) = broadcast::channel(64);
        let room = WitnessRoom {
            room_id,
            organization_id: context.organization_id.0,
            owner_user_id: context.user_id.0,
            case_id,
            audience,
            invite_hash: invitation_hash,
            manual_code: manual_code.clone(),
            invite_expires_at_ms,
            invite_consumed: false,
            expires_at_ms: session_expires_at_ms,
            approved: false,
            paused: false,
            revoked: false,
            headset_connected: false,
            layers: input.layers,
            viewer_connections: HashMap::new(),
            wearer_recording_consent: false,
            viewer_recording_consent: false,
            proposed_observations: vec![],
            events,
        };
        let summary = room_summary(&room, now);
        let mut state = self.state.lock();
        self.cleanup_locked(&mut state, now);
        while state.rooms.len() >= MAX_ROOMS {
            let Some(oldest) = state
                .rooms
                .values()
                .min_by_key(|candidate| candidate.expires_at_ms)
                .map(|candidate| candidate.room_id)
            else {
                break;
            };
            remove_room(&mut state, oldest);
        }
        state.invitations.insert(invitation_hash, room_id);
        state.manual_codes.insert(manual_code.clone(), room_id);
        state.credentials.insert(
            producer_hash,
            CredentialRecord {
                room_id,
                participant_id: producer_id,
                role: WitnessSocketRole::Producer,
                expires_at_ms: session_expires_at_ms,
            },
        );
        state.rooms.insert(room_id, room);
        let join_url = format!("{}?invite={invitation}", self.config.join_base_url);
        Ok(WitnessInvitationResponse {
            room_id,
            invitation,
            join_url,
            manual_code,
            producer_credential,
            socket_path: SOCKET_PATH,
            invite_expires_at_ms,
            session_expires_at_ms,
            state: summary,
            ice_servers: self.config.ice_servers.clone(),
        })
    }

    pub fn exchange_invitation(
        &self,
        input: ExchangeWitnessInvitation,
    ) -> Result<WitnessViewerSession, RemoteWitnessError> {
        let now = (self.now_ms)();
        let mut state = self.state.lock();
        self.cleanup_locked(&mut state, now);
        let room_id = if let Some(invitation) = input.invitation.as_deref() {
            let invitation = bounded_token(invitation, 128)?;
            state
                .invitations
                .get(&token_hash(&invitation))
                .copied()
                .ok_or(RemoteWitnessError::NotFound)?
        } else if let Some(code) = input.manual_code.as_deref() {
            let code = code.trim().to_ascii_uppercase();
            if code.len() != 12 || !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(RemoteWitnessError::Invalid);
            }
            state
                .manual_codes
                .get(&code)
                .copied()
                .ok_or(RemoteWitnessError::NotFound)?
        } else {
            return Err(RemoteWitnessError::Invalid);
        };
        let participant_id = Uuid::new_v4();
        let credential = opaque_token();
        let credential_hash = token_hash(&credential);
        let (expires_at_ms, summary, events) = {
            let room = state
                .rooms
                .get_mut(&room_id)
                .ok_or(RemoteWitnessError::NotFound)?;
            if room.revoked {
                return Err(RemoteWitnessError::Revoked);
            }
            if now >= room.invite_expires_at_ms {
                return Err(RemoteWitnessError::InviteExpired);
            }
            if room.invite_consumed {
                return Err(RemoteWitnessError::InviteConsumed);
            }
            if room.viewer_connections.len() >= self.config.maximum_viewers {
                return Err(RemoteWitnessError::ViewerLimit);
            }
            room.invite_consumed = true;
            (
                room.expires_at_ms,
                room_summary(room, now),
                room.events.clone(),
            )
        };
        // Retain the hash indexes until room expiry so a replay is explicitly
        // reported as consumed. The raw invitation is never stored.
        state.credentials.insert(
            credential_hash,
            CredentialRecord {
                room_id,
                participant_id,
                role: WitnessSocketRole::Viewer,
                expires_at_ms,
            },
        );
        let _ = events.send(room_event("viewer-invitation-exchanged", &summary));
        Ok(WitnessViewerSession {
            room_id,
            participant_id,
            credential,
            socket_path: SOCKET_PATH,
            expires_at_ms,
            state: summary,
            ice_servers: self.config.ice_servers.clone(),
        })
    }

    pub fn summary(
        &self,
        context: &ExecutionContext,
        room_id: Uuid,
    ) -> Result<WitnessRoomSummary, RemoteWitnessError> {
        let now = (self.now_ms)();
        let mut state = self.state.lock();
        self.cleanup_locked(&mut state, now);
        let room = owned_room(&state, context, room_id)?;
        Ok(room_summary(room, now))
    }

    pub fn control(
        &self,
        context: &ExecutionContext,
        room_id: Uuid,
        input: WitnessControlInput,
    ) -> Result<WitnessRoomSummary, RemoteWitnessError> {
        let now = (self.now_ms)();
        let mut state = self.state.lock();
        self.cleanup_locked(&mut state, now);
        let room = state
            .rooms
            .get_mut(&room_id)
            .ok_or(RemoteWitnessError::NotFound)?;
        ensure_owner(room, context)?;
        ensure_wearer_role(context.role)?;
        if room.revoked {
            return Err(RemoteWitnessError::Revoked);
        }
        let summary = apply_control(room, input, now)?;
        let _ = room.events.send(room_event("room-state", &summary));
        Ok(summary)
    }

    pub fn connect(&self, credential: &str) -> Result<WitnessSocketAdmission, RemoteWitnessError> {
        let credential = bounded_token(credential, 128)?;
        let now = (self.now_ms)();
        let mut state = self.state.lock();
        self.cleanup_locked(&mut state, now);
        let record = state
            .credentials
            .get(&token_hash(&credential))
            .cloned()
            .ok_or(RemoteWitnessError::AccessDenied)?;
        if now >= record.expires_at_ms {
            return Err(RemoteWitnessError::SessionExpired);
        }
        let room = state
            .rooms
            .get_mut(&record.room_id)
            .ok_or(RemoteWitnessError::NotFound)?;
        if room.revoked {
            return Err(RemoteWitnessError::Revoked);
        }
        if record.role == WitnessSocketRole::Viewer {
            room.viewer_connections
                .entry(record.participant_id)
                .and_modify(|count| *count += 1)
                .or_insert(1);
        } else if room.headset_connected {
            return Err(RemoteWitnessError::ProducerAlreadyConnected);
        } else {
            room.headset_connected = true;
        }
        let summary = room_summary(room, now);
        let events = room.events.subscribe();
        let _ = room.events.send(room_event("presence", &summary));
        Ok(WitnessSocketAdmission {
            identity: WitnessSocketIdentity {
                room_id: record.room_id,
                participant_id: record.participant_id,
                role: record.role,
            },
            events,
            initial_event: room_event("room-state", &summary),
        })
    }

    pub fn disconnect(&self, identity: &WitnessSocketIdentity) {
        let now = (self.now_ms)();
        let mut state = self.state.lock();
        let Some(room) = state.rooms.get_mut(&identity.room_id) else {
            return;
        };
        if identity.role == WitnessSocketRole::Viewer {
            if let Some(count) = room.viewer_connections.get_mut(&identity.participant_id) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    room.viewer_connections.remove(&identity.participant_id);
                }
            }
        } else {
            room.headset_connected = false;
            room.paused = true;
        }
        let summary = room_summary(room, now);
        let _ = room.events.send(room_event("presence", &summary));
    }

    pub fn handle_socket_message(
        &self,
        identity: &WitnessSocketIdentity,
        message: Value,
    ) -> Result<Option<Value>, RemoteWitnessError> {
        if serde_json::to_vec(&message)
            .map_err(|_| RemoteWitnessError::Invalid)?
            .len()
            > MAX_SIGNAL_BYTES
        {
            return Err(RemoteWitnessError::Invalid);
        }
        let message_type = message
            .get("type")
            .and_then(Value::as_str)
            .ok_or(RemoteWitnessError::Invalid)?;
        let now = (self.now_ms)();
        let mut state = self.state.lock();
        self.cleanup_locked(&mut state, now);
        let room = state
            .rooms
            .get_mut(&identity.room_id)
            .ok_or(RemoteWitnessError::NotFound)?;
        if room.revoked {
            return Err(RemoteWitnessError::Revoked);
        }
        match (identity.role, message_type) {
            (_, "witness.ping") => {
                exact_keys(&message, &["type"])?;
                Ok(Some(json!({"type": "witness.pong", "atMs": now})))
            }
            (_, "witness.signal") => {
                exact_keys(&message, &["type", "signal"])?;
                let signal = validated_signal(identity.role, message.get("signal"))?;
                if identity.role == WitnessSocketRole::Producer
                    && (!room.approved || room.paused || !room.layers.pov)
                {
                    return Err(RemoteWitnessError::ApprovalRequired);
                }
                let _ = room.events.send(json!({
                    "type": "witness.signal",
                    "roomId": room.room_id,
                    "from": identity.role.as_str(),
                    "participantId": identity.participant_id,
                    "signal": signal
                }));
                Ok(None)
            }
            (WitnessSocketRole::Producer, "witness.control") => {
                exact_keys(&message, &["type", "action", "layers", "consent"])?;
                let input = socket_control_input(&message)?;
                let summary = apply_control(room, input, now)?;
                let _ = room.events.send(room_event("room-state", &summary));
                Ok(None)
            }
            (WitnessSocketRole::Producer, "witness.state.publish") => {
                exact_keys(&message, &["type", "state"])?;
                if !room.approved {
                    return Err(RemoteWitnessError::ApprovalRequired);
                }
                let projection = projected_state(message.get("state"), &room.layers)?;
                let _ = room.events.send(json!({
                    "type": "witness.state",
                    "roomId": room.room_id,
                    "state": projection
                }));
                Ok(None)
            }
            (WitnessSocketRole::Viewer, "witness.comment") => {
                exact_keys(&message, &["type", "text"])?;
                let text = bounded_text(
                    message
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    500,
                )?;
                let observation = ProposedWitnessObservation {
                    observation_id: Uuid::new_v4(),
                    participant_id: identity.participant_id,
                    source: "remote-witness-customer".into(),
                    text,
                    observed_at_ms: now,
                };
                room.proposed_observations.push(observation.clone());
                if room.proposed_observations.len() > MAX_COMMENTS {
                    room.proposed_observations.remove(0);
                }
                let _ = room.events.send(json!({
                    "type": "witness.proposed-observation",
                    "roomId": room.room_id,
                    "observation": observation
                }));
                Ok(None)
            }
            (WitnessSocketRole::Viewer, "witness.recording-consent") => {
                exact_keys(&message, &["type", "consent"])?;
                room.viewer_recording_consent = message
                    .get("consent")
                    .and_then(Value::as_bool)
                    .ok_or(RemoteWitnessError::Invalid)?;
                let summary = room_summary(room, now);
                let _ = room.events.send(room_event("room-state", &summary));
                Ok(None)
            }
            (WitnessSocketRole::Viewer, _) => Err(RemoteWitnessError::AccessDenied),
            (WitnessSocketRole::Producer, _) => Err(RemoteWitnessError::Invalid),
        }
    }

    pub fn socket_summary(
        &self,
        identity: &WitnessSocketIdentity,
    ) -> Result<Value, RemoteWitnessError> {
        let now = (self.now_ms)();
        let state = self.state.lock();
        let room = state
            .rooms
            .get(&identity.room_id)
            .ok_or(RemoteWitnessError::NotFound)?;
        Ok(room_event("room-state", &room_summary(room, now)))
    }

    pub fn authorize_case_media(
        &self,
        credential: &str,
    ) -> Result<WitnessCaseMediaAccess, RemoteWitnessError> {
        let credential = bounded_token(credential, 128)?;
        let now = (self.now_ms)();
        let mut state = self.state.lock();
        self.cleanup_locked(&mut state, now);
        let record = state
            .credentials
            .get(&token_hash(&credential))
            .ok_or(RemoteWitnessError::AccessDenied)?;
        if record.role != WitnessSocketRole::Viewer {
            return Err(RemoteWitnessError::AccessDenied);
        }
        let room = state
            .rooms
            .get(&record.room_id)
            .ok_or(RemoteWitnessError::NotFound)?;
        if room.revoked {
            return Err(RemoteWitnessError::Revoked);
        }
        if !room.approved || room.paused || !room.layers.case_media {
            return Err(RemoteWitnessError::ApprovalRequired);
        }
        Ok(WitnessCaseMediaAccess {
            organization_id: room.organization_id,
            case_id: room.case_id.clone().ok_or(RemoteWitnessError::NotFound)?,
        })
    }

    fn cleanup_locked(&self, state: &mut RemoteWitnessState, now: u64) {
        let expired = state
            .rooms
            .values()
            .filter(|room| now >= room.expires_at_ms)
            .map(|room| room.room_id)
            .collect::<Vec<_>>();
        for room_id in expired {
            remove_room(state, room_id);
        }
    }
}

fn apply_control(
    room: &mut WitnessRoom,
    input: WitnessControlInput,
    now: u64,
) -> Result<WitnessRoomSummary, RemoteWitnessError> {
    match input.action.as_str() {
        "approve" => {
            room.approved = true;
            room.paused = false;
        }
        "pause" => room.paused = true,
        "resume" => {
            if !room.approved {
                return Err(RemoteWitnessError::ApprovalRequired);
            }
            room.paused = false;
        }
        "revoke" => {
            room.revoked = true;
            room.paused = true;
            room.wearer_recording_consent = false;
            room.viewer_recording_consent = false;
        }
        "set-layers" => {
            room.layers = input.layers.ok_or(RemoteWitnessError::Invalid)?;
            if !room.layers.pov {
                room.paused = true;
            }
        }
        "recording-consent" => {
            room.wearer_recording_consent = input.consent.ok_or(RemoteWitnessError::Invalid)?;
        }
        "stop-recording" => room.wearer_recording_consent = false,
        _ => return Err(RemoteWitnessError::Invalid),
    }
    Ok(room_summary(room, now))
}

fn projected_state(
    state: Option<&Value>,
    layers: &WitnessLayers,
) -> Result<Value, RemoteWitnessError> {
    let source = state
        .and_then(Value::as_object)
        .ok_or(RemoteWitnessError::Invalid)?;
    if source
        .keys()
        .any(|key| !matches!(key.as_str(), "target" | "caseSummary" | "caseMedia"))
    {
        return Err(RemoteWitnessError::Invalid);
    }
    let mut projected = serde_json::Map::new();
    if layers.target {
        if let Some(value) = source.get("target") {
            projected.insert("target".into(), value.clone());
        }
    }
    if layers.case_summary {
        if let Some(value) = source.get("caseSummary") {
            projected.insert("caseSummary".into(), value.clone());
        }
    }
    if layers.case_media {
        if let Some(value) = source.get("caseMedia") {
            projected.insert("caseMedia".into(), value.clone());
        }
    }
    let result = Value::Object(projected);
    if serde_json::to_vec(&result)
        .map_err(|_| RemoteWitnessError::Invalid)?
        .len()
        > MAX_SIGNAL_BYTES
    {
        return Err(RemoteWitnessError::Invalid);
    }
    Ok(result)
}

fn owned_room<'a>(
    state: &'a RemoteWitnessState,
    context: &ExecutionContext,
    room_id: Uuid,
) -> Result<&'a WitnessRoom, RemoteWitnessError> {
    let room = state
        .rooms
        .get(&room_id)
        .ok_or(RemoteWitnessError::NotFound)?;
    ensure_owner(room, context)?;
    Ok(room)
}

fn ensure_owner(room: &WitnessRoom, context: &ExecutionContext) -> Result<(), RemoteWitnessError> {
    if room.organization_id != context.organization_id.0 || room.owner_user_id != context.user_id.0
    {
        return Err(RemoteWitnessError::AccessDenied);
    }
    Ok(())
}

fn ensure_wearer_role(role: Role) -> Result<(), RemoteWitnessError> {
    if matches!(
        role,
        Role::Technician | Role::Controller | Role::Quality | Role::Manager | Role::Administrator
    ) {
        Ok(())
    } else {
        Err(RemoteWitnessError::AccessDenied)
    }
}

fn room_summary(room: &WitnessRoom, now: u64) -> WitnessRoomSummary {
    let viewer_count = room.viewer_connections.len();
    let status = if now >= room.expires_at_ms {
        "expired"
    } else if room.revoked {
        "revoked"
    } else if !room.headset_connected {
        "headset-offline"
    } else if room.paused || !room.layers.pov {
        "paused"
    } else if !room.approved {
        "awaiting-approval"
    } else if viewer_count == 0 {
        "awaiting-viewer"
    } else {
        "live"
    };
    let recording_ready =
        status == "live" && room.wearer_recording_consent && room.viewer_recording_consent;
    WitnessRoomSummary {
        room_id: room.room_id,
        audience: room.audience.clone(),
        status: status.into(),
        approved: room.approved,
        layers: room.layers.clone(),
        viewer_count,
        recording: WitnessRecordingState {
            // Consent does not claim that a recorder is already running.
            state: if recording_ready { "consented" } else { "off" }.into(),
            wearer_consented: room.wearer_recording_consent,
            viewer_consented: room.viewer_recording_consent,
        },
        expires_at_ms: room.expires_at_ms,
        proposed_observations: room.proposed_observations.clone(),
    }
}

fn room_event(event: &str, summary: &WitnessRoomSummary) -> Value {
    json!({"type": format!("witness.{event}"), "room": summary})
}

fn remove_room(state: &mut RemoteWitnessState, room_id: Uuid) {
    if let Some(room) = state.rooms.remove(&room_id) {
        state.invitations.remove(&room.invite_hash);
        state.manual_codes.remove(&room.manual_code);
        state
            .credentials
            .retain(|_, credential| credential.room_id != room_id);
        let _ = room
            .events
            .send(json!({"type": "witness.room-ended", "roomId": room_id}));
    }
}

fn exact_keys(message: &Value, allowed: &[&str]) -> Result<(), RemoteWitnessError> {
    let object = message.as_object().ok_or(RemoteWitnessError::Invalid)?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(RemoteWitnessError::Invalid);
    }
    Ok(())
}

fn socket_control_input(message: &Value) -> Result<WitnessControlInput, RemoteWitnessError> {
    let action = message
        .get("action")
        .and_then(Value::as_str)
        .ok_or(RemoteWitnessError::Invalid)?
        .to_owned();
    let layers = message
        .get("layers")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| RemoteWitnessError::Invalid)?;
    let consent = message
        .get("consent")
        .map(|value| value.as_bool().ok_or(RemoteWitnessError::Invalid))
        .transpose()?;
    match action.as_str() {
        "set-layers" if layers.is_some() && consent.is_none() => {}
        "recording-consent" if consent.is_some() && layers.is_none() => {}
        "approve" | "pause" | "resume" | "revoke" | "stop-recording"
            if layers.is_none() && consent.is_none() => {}
        _ => return Err(RemoteWitnessError::Invalid),
    }
    Ok(WitnessControlInput {
        action,
        layers,
        consent,
    })
}

fn validated_signal(
    role: WitnessSocketRole,
    signal: Option<&Value>,
) -> Result<Value, RemoteWitnessError> {
    let signal = signal
        .and_then(Value::as_object)
        .ok_or(RemoteWitnessError::Invalid)?;
    if signal
        .keys()
        .any(|key| !matches!(key.as_str(), "kind" | "to" | "description" | "candidate"))
    {
        return Err(RemoteWitnessError::Invalid);
    }
    let kind = signal
        .get("kind")
        .and_then(Value::as_str)
        .ok_or(RemoteWitnessError::Invalid)?;
    let to = signal.get("to");
    if let Some(to) = to {
        let value = to.as_str().ok_or(RemoteWitnessError::Invalid)?;
        Uuid::parse_str(value).map_err(|_| RemoteWitnessError::Invalid)?;
    }
    match (role, kind) {
        (WitnessSocketRole::Viewer, "viewer-ready") if signal.len() == 1 => {}
        (WitnessSocketRole::Producer, "offer") if to.is_some() => {
            validate_description(signal.get("description"), "offer")?;
        }
        (WitnessSocketRole::Viewer, "answer") if to.is_none() => {
            validate_description(signal.get("description"), "answer")?;
        }
        (WitnessSocketRole::Producer, "ice") if to.is_some() => {
            validate_ice_candidate(signal.get("candidate"))?;
        }
        (WitnessSocketRole::Viewer, "ice") if to.is_none() => {
            validate_ice_candidate(signal.get("candidate"))?;
        }
        _ => return Err(RemoteWitnessError::AccessDenied),
    }
    Ok(Value::Object(signal.clone()))
}

fn validate_description(value: Option<&Value>, expected: &str) -> Result<(), RemoteWitnessError> {
    let description = value
        .and_then(Value::as_object)
        .ok_or(RemoteWitnessError::Invalid)?;
    if description.len() != 2 || description.get("type").and_then(Value::as_str) != Some(expected) {
        return Err(RemoteWitnessError::Invalid);
    }
    let sdp = description
        .get("sdp")
        .and_then(Value::as_str)
        .ok_or(RemoteWitnessError::Invalid)?;
    if sdp.is_empty() || sdp.len() > MAX_SDP_BYTES {
        return Err(RemoteWitnessError::Invalid);
    }
    Ok(())
}

fn validate_ice_candidate(value: Option<&Value>) -> Result<(), RemoteWitnessError> {
    let candidate = value
        .and_then(Value::as_object)
        .ok_or(RemoteWitnessError::Invalid)?;
    if candidate.keys().any(|key| {
        !matches!(
            key.as_str(),
            "candidate" | "sdpMid" | "sdpMLineIndex" | "usernameFragment"
        )
    }) {
        return Err(RemoteWitnessError::Invalid);
    }
    let line = candidate
        .get("candidate")
        .and_then(Value::as_str)
        .ok_or(RemoteWitnessError::Invalid)?;
    if line.is_empty() || line.len() > MAX_ICE_CANDIDATE_BYTES {
        return Err(RemoteWitnessError::Invalid);
    }
    if let Some(value) = candidate.get("sdpMid") {
        if !value.is_null() && value.as_str().map_or(true, |value| value.len() > 256) {
            return Err(RemoteWitnessError::Invalid);
        }
    }
    if let Some(value) = candidate.get("sdpMLineIndex") {
        if !value.is_null() && value.as_u64().map_or(true, |value| value > u16::MAX as u64) {
            return Err(RemoteWitnessError::Invalid);
        }
    }
    if let Some(value) = candidate.get("usernameFragment") {
        if !value.is_null() && value.as_str().map_or(true, |value| value.len() > 256) {
            return Err(RemoteWitnessError::Invalid);
        }
    }
    Ok(())
}

fn bounded_token(value: &str, maximum: usize) -> Result<String, RemoteWitnessError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > maximum
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(RemoteWitnessError::Invalid);
    }
    Ok(value.into())
}

fn bounded_text(value: &str, maximum: usize) -> Result<String, RemoteWitnessError> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.chars().count() > maximum {
        return Err(RemoteWitnessError::Invalid);
    }
    Ok(value)
}

fn opaque_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn token_hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
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
    use std::sync::atomic::{AtomicU64, Ordering};

    use mxgenius_shared::application::context::{ClientIdentity, ExecutionContext};
    use mxgenius_shared::application::policy::Role;
    use mxgenius_shared::domain::ids::{OrganizationId, UserId};

    fn context(organization_id: Uuid, user_id: Uuid) -> ExecutionContext {
        ExecutionContext::new(
            OrganizationId(organization_id),
            UserId(user_id),
            Role::Technician,
            ClientIdentity {
                name: "witness-test".into(),
                version: "1".into(),
            },
        )
    }

    fn input() -> CreateWitnessInvitation {
        CreateWitnessInvitation {
            xr_session_id: "xr-session-1".into(),
            case_id: Some("case-1".into()),
            audience: "Aircraft owner".into(),
            layers: WitnessLayers::default(),
        }
    }

    fn service(now: Arc<AtomicU64>) -> RemoteWitnessService {
        RemoteWitnessService::with_clock(
            RemoteWitnessConfig::default(),
            Arc::new(move || now.load(Ordering::SeqCst)),
        )
    }

    #[test]
    fn ice_servers_are_bounded_and_strict() {
        assert!(valid_ice_servers(&[json!({
            "urls": ["stun:stun.example.net:3478", "turns:turn.example.net:5349"],
            "username": "temporary-user",
            "credential": "temporary-password",
            "credentialType": "password"
        })]));
        assert!(!valid_ice_servers(&[json!({
            "urls": "https://not-ice.example",
        })]));
        assert!(!valid_ice_servers(&[json!({
            "urls": "stun:stun.example.net:3478",
            "unexpected": true,
        })]));
        assert!(!valid_ice_servers(&[json!({
            "urls": "turn:turn.example.net:3478",
            "credentialType": "oauth",
        })]));
    }

    #[test]
    fn canonical_witness_fixtures_match_the_core_signal_and_control_contract() {
        let offer: Value = serde_json::from_str(include_str!(
            "../../../../xr-diagnostics-kiosk/fixtures/witness-signal-offer.json"
        ))
        .unwrap();
        let control: Value = serde_json::from_str(include_str!(
            "../../../../xr-diagnostics-kiosk/fixtures/witness-control-pause.json"
        ))
        .unwrap();
        assert!(validated_signal(WitnessSocketRole::Producer, offer.get("signal")).is_ok());
        let input = socket_control_input(&control).unwrap();
        assert_eq!(input.action, "pause");
    }

    #[test]
    fn invitation_is_opaque_single_use_and_qr_contains_no_context() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let context = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&context, input()).unwrap();
        assert!(invitation
            .join_url
            .ends_with(&format!("?invite={}", invitation.invitation)));
        for forbidden in [
            "case-1",
            "xr-session-1",
            "Aircraft",
            "Bearer",
            "organization",
        ] {
            assert!(!invitation.join_url.contains(forbidden));
        }
        assert_eq!(invitation.invitation.len(), 64);
        assert_eq!(invitation.manual_code.len(), 12);
        service
            .exchange_invitation(ExchangeWitnessInvitation {
                invitation: Some(invitation.invitation.clone()),
                manual_code: None,
            })
            .unwrap();
        assert_eq!(
            service
                .exchange_invitation(ExchangeWitnessInvitation {
                    invitation: Some(invitation.invitation),
                    manual_code: None,
                })
                .unwrap_err(),
            RemoteWitnessError::InviteConsumed
        );
    }

    #[test]
    fn viewer_role_cannot_create_a_wearer_invitation() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let context = ExecutionContext::new(
            OrganizationId(Uuid::new_v4()),
            UserId(Uuid::new_v4()),
            Role::Viewer,
            ClientIdentity {
                name: "witness-test".into(),
                version: "1".into(),
            },
        );
        assert_eq!(
            service.create_invitation(&context, input()).unwrap_err(),
            RemoteWitnessError::AccessDenied
        );
    }

    #[test]
    fn tenant_and_owner_boundaries_fail_closed() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let organization = Uuid::new_v4();
        let owner = context(organization, Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        assert_eq!(
            service
                .summary(
                    &context(Uuid::new_v4(), owner.user_id.0),
                    invitation.room_id
                )
                .unwrap_err(),
            RemoteWitnessError::AccessDenied
        );
        assert_eq!(
            service
                .summary(&context(organization, Uuid::new_v4()), invitation.room_id)
                .unwrap_err(),
            RemoteWitnessError::AccessDenied
        );
    }

    #[test]
    fn viewer_credential_reconnects_without_reusing_invitation_or_double_counting() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let owner = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        let producer = service.connect(&invitation.producer_credential).unwrap();
        let viewer = service
            .exchange_invitation(ExchangeWitnessInvitation {
                invitation: Some(invitation.invitation),
                manual_code: None,
            })
            .unwrap();
        let first = service.connect(&viewer.credential).unwrap();
        let second = service.connect(&viewer.credential).unwrap();
        assert_eq!(
            service
                .summary(&owner, invitation.room_id)
                .unwrap()
                .viewer_count,
            1
        );
        service.disconnect(&first.identity);
        assert_eq!(
            service
                .summary(&owner, invitation.room_id)
                .unwrap()
                .viewer_count,
            1
        );
        service.disconnect(&second.identity);
        assert_eq!(
            service
                .summary(&owner, invitation.room_id)
                .unwrap()
                .viewer_count,
            0
        );
        service.disconnect(&producer.identity);
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap().status,
            "headset-offline"
        );
    }

    #[test]
    fn room_allows_exactly_one_active_producer_socket() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let owner = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        let first = service.connect(&invitation.producer_credential).unwrap();
        assert_eq!(
            service
                .connect(&invitation.producer_credential)
                .unwrap_err(),
            RemoteWitnessError::ProducerAlreadyConnected
        );
        service.disconnect(&first.identity);
        let replacement = service.connect(&invitation.producer_credential).unwrap();
        assert_eq!(replacement.identity.role, WitnessSocketRole::Producer);
    }

    #[test]
    fn producer_credential_controls_only_its_witness_room() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let owner = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        let producer = service.connect(&invitation.producer_credential).unwrap();
        let viewer = service
            .exchange_invitation(ExchangeWitnessInvitation {
                invitation: Some(invitation.invitation),
                manual_code: None,
            })
            .unwrap();
        let viewer_socket = service.connect(&viewer.credential).unwrap();

        service
            .handle_socket_message(
                &producer.identity,
                json!({"type": "witness.control", "action": "approve"}),
            )
            .unwrap();
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap().status,
            "live"
        );
        assert_eq!(
            service
                .handle_socket_message(
                    &viewer_socket.identity,
                    json!({"type": "witness.control", "action": "pause"}),
                )
                .unwrap_err(),
            RemoteWitnessError::AccessDenied
        );
        assert_eq!(
            service
                .handle_socket_message(
                    &producer.identity,
                    json!({"type": "witness.control", "action": "pause", "caseId": "escape"}),
                )
                .unwrap_err(),
            RemoteWitnessError::Invalid
        );
        service
            .handle_socket_message(
                &producer.identity,
                json!({"type": "witness.control", "action": "pause"}),
            )
            .unwrap();
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap().status,
            "paused"
        );
    }

    #[test]
    fn signaling_is_role_directed_strict_and_bounded() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let owner = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        let producer = service.connect(&invitation.producer_credential).unwrap();
        let viewer = service
            .exchange_invitation(ExchangeWitnessInvitation {
                invitation: Some(invitation.invitation),
                manual_code: None,
            })
            .unwrap();
        let viewer_socket = service.connect(&viewer.credential).unwrap();
        service
            .handle_socket_message(
                &producer.identity,
                json!({"type": "witness.control", "action": "approve"}),
            )
            .unwrap();

        service
            .handle_socket_message(
                &viewer_socket.identity,
                json!({"type": "witness.signal", "signal": {"kind": "viewer-ready"}}),
            )
            .unwrap();
        service
            .handle_socket_message(
                &producer.identity,
                json!({
                    "type": "witness.signal",
                    "signal": {
                        "kind": "offer",
                        "to": viewer_socket.identity.participant_id,
                        "description": {"type": "offer", "sdp": "v=0\r\n"}
                    }
                }),
            )
            .unwrap();
        assert_eq!(
            service
                .handle_socket_message(
                    &viewer_socket.identity,
                    json!({
                        "type": "witness.signal",
                        "signal": {"kind": "offer", "description": {"type": "offer", "sdp": "v=0\r\n"}}
                    }),
                )
                .unwrap_err(),
            RemoteWitnessError::AccessDenied
        );
        assert_eq!(
            service
                .handle_socket_message(
                    &producer.identity,
                    json!({
                        "type": "witness.signal",
                        "signal": {
                            "kind": "ice",
                            "to": viewer_socket.identity.participant_id,
                            "candidate": {"candidate": "candidate:1 1 UDP 1 192.0.2.1 5000 typ host", "secret": true}
                        }
                    }),
                )
                .unwrap_err(),
            RemoteWitnessError::Invalid
        );
    }

    #[test]
    fn approval_layers_revocation_and_recording_require_explicit_consent() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let owner = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        let producer = service.connect(&invitation.producer_credential).unwrap();
        let viewer = service
            .exchange_invitation(ExchangeWitnessInvitation {
                invitation: Some(invitation.invitation),
                manual_code: None,
            })
            .unwrap();
        let viewer_socket = service.connect(&viewer.credential).unwrap();
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap().status,
            "awaiting-approval"
        );
        assert_eq!(
            service
                .handle_socket_message(
                    &producer.identity,
                    json!({"type": "witness.state.publish", "state": {"caseSummary": {"status": "open"}}})
                )
                .unwrap_err(),
            RemoteWitnessError::ApprovalRequired
        );
        assert_eq!(
            service
                .authorize_case_media(&viewer.credential)
                .unwrap_err(),
            RemoteWitnessError::ApprovalRequired
        );
        service
            .control(
                &owner,
                invitation.room_id,
                WitnessControlInput {
                    action: "approve".into(),
                    layers: None,
                    consent: None,
                },
            )
            .unwrap();
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap().status,
            "live"
        );
        service
            .control(
                &owner,
                invitation.room_id,
                WitnessControlInput {
                    action: "recording-consent".into(),
                    layers: None,
                    consent: Some(true),
                },
            )
            .unwrap();
        assert_eq!(
            service
                .summary(&owner, invitation.room_id)
                .unwrap()
                .recording
                .state,
            "off"
        );
        service
            .handle_socket_message(
                &viewer_socket.identity,
                json!({"type": "witness.recording-consent", "consent": true}),
            )
            .unwrap();
        assert_eq!(
            service
                .summary(&owner, invitation.room_id)
                .unwrap()
                .recording
                .state,
            "consented"
        );
        let layers = WitnessLayers {
            thermal: true,
            case_summary: false,
            case_media: true,
            ..WitnessLayers::default()
        };
        service
            .control(
                &owner,
                invitation.room_id,
                WitnessControlInput {
                    action: "set-layers".into(),
                    layers: Some(layers.clone()),
                    consent: None,
                },
            )
            .unwrap();
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap().layers,
            layers
        );
        assert_eq!(
            service.authorize_case_media(&viewer.credential).unwrap(),
            WitnessCaseMediaAccess {
                organization_id: owner.organization_id.0,
                case_id: "case-1".into()
            }
        );
        service
            .control(
                &owner,
                invitation.room_id,
                WitnessControlInput {
                    action: "revoke".into(),
                    layers: None,
                    consent: None,
                },
            )
            .unwrap();
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap().status,
            "revoked"
        );
        assert_eq!(
            service.connect(&viewer.credential).unwrap_err(),
            RemoteWitnessError::Revoked
        );
        service.disconnect(&producer.identity);
    }

    #[test]
    fn viewer_can_only_signal_consent_and_propose_sourced_comments() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now);
        let owner = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        let viewer = service
            .exchange_invitation(ExchangeWitnessInvitation {
                invitation: Some(invitation.invitation),
                manual_code: None,
            })
            .unwrap();
        let socket = service.connect(&viewer.credential).unwrap();
        service
            .handle_socket_message(
                &socket.identity,
                json!({"type": "witness.comment", "text": "Please show that panel again."}),
            )
            .unwrap();
        let summary = service.summary(&owner, invitation.room_id).unwrap();
        assert_eq!(summary.proposed_observations.len(), 1);
        assert_eq!(
            summary.proposed_observations[0].source,
            "remote-witness-customer"
        );
        assert_eq!(
            service
                .handle_socket_message(
                    &socket.identity,
                    json!({"type": "witness.control", "action": "thermal"})
                )
                .unwrap_err(),
            RemoteWitnessError::AccessDenied
        );
    }

    #[test]
    fn expiry_removes_every_credential_and_invitation() {
        let now = Arc::new(AtomicU64::new(1_000));
        let service = service(now.clone());
        let owner = context(Uuid::new_v4(), Uuid::new_v4());
        let invitation = service.create_invitation(&owner, input()).unwrap();
        now.store(invitation.session_expires_at_ms + 1, Ordering::SeqCst);
        assert_eq!(
            service
                .connect(&invitation.producer_credential)
                .unwrap_err(),
            RemoteWitnessError::AccessDenied
        );
        assert_eq!(
            service.summary(&owner, invitation.room_id).unwrap_err(),
            RemoteWitnessError::NotFound
        );
    }
}
