# OpenAI Realtime WebRTC Mount

## Boundary

OpenAI Realtime is the low-latency media and conversational plane. The MXGenius MCP remains the authoritative typed capability plane.

The deployable Rust core is deliberately hybrid: it also owns authenticated OpenAI Responses text chat and application orchestration. Existing `mxg-api` compatibility/JetNet traffic remains separate until those adapters are deliberately migrated; the dashboard routes only chat, Realtime, orchestration, and MCP traffic to the new core.

```text
browser microphone/audio
  -> WebRTC peer connection to OpenAI Realtime
  -> Realtime data-channel events and function requests
  -> authenticated MXGenius application orchestrator
  -> locked MCP tools
  -> evidence-backed result
  -> Realtime response + dashboard case state
```

Realtime must not become a second source of domain truth, a bypass around RBAC, or a second set of maintenance schemas.

## Existing socket asset

The legacy iOS application already contains `TokenStreamServer.swift`, a native `NWListener` WebSocket bound to a random localhost port. It streams on-device llama tokens from `CapacitorLlamaPlugin` to the Capacitor JavaScript UI, with the Capacitor event bridge as fallback.

Preserve that asset for the native/offline inference path. It is not the OpenAI WebRTC connection, a cloud signaling service, or an authenticated application event bus. The mounted transport responsibilities are:

```text
iOS localhost WebSocket -> on-device token fallback
OpenAI WebRTC            -> low-latency audio/media + Realtime events
MXGenius application API -> authenticated orchestration and MCP calls
MCP Streamable HTTP      -> typed capability protocol
```

If a general application WebSocket is recovered from another deployment artifact, mount it behind the same authenticated application-event abstraction; do not couple dashboard state directly to the iOS localhost server.

## Connection design

1. The authenticated dashboard creates an `RTCPeerConnection`, audio element, microphone track, and Realtime data channel.
2. The browser sends its SDP offer and optional active `case_id` to an authenticated MXGenius backend route.
3. The backend derives organization, user, role, and case access from the application session.
4. The backend calls OpenAI `POST /v1/realtime/calls` with the server-held `OPENAI_API_KEY`, a bounded Realtime session configuration, and the SDP offer.
5. The backend returns only the SDP answer and safe call metadata to the browser. The standard API key is never returned to client code.
6. The browser applies the remote description and consumes audio plus structured server events through the data channel.

The existing usable server-side OpenAI key is the selected credential source. Its Realtime entitlement and model access will be capability-probed without displaying or moving the secret.

## Tool and case integration

- Realtime tools use the same locked names and JSON Schemas as the MCP registry; do not create parallel voice-only contracts.
- Read-only requests may be routed through the application orchestrator to MCP after normal authentication and authorization.
- A Realtime model can draft a mutation request, but cannot confirm it.
- Any case, observation, marker, certificate, schedule, approval, or status mutation pauses for an explicit dashboard confirmation surface.
- Only the backend may add trusted confirmation, actor, role, organization, and approval context.
- Tool output returned to Realtime retains evidence, confidence, warnings, partial state, and trace ID.
- The active case ID is an application selection validated against the authenticated tenant, never a model-selected tenant scope.

## Voice UX

- visible states: disconnected, connecting, listening, user speaking, thinking/tool use, assistant speaking, interrupted, degraded, and failed;
- barge-in and output cancellation;
- text transcript synchronized with streamed audio;
- source/evidence drawer for claims returned from MCP;
- visible tool activity and partial/`NOT_CONFIGURED` states;
- mutation confirmation card with exact proposed action and affected case/version;
- keyboard/text fallback when microphone, WebRTC, or Realtime is unavailable;
- reconnect that does not silently duplicate an operational mutation.

## Data handling

- Raw microphone audio is not persisted by MXGenius by default.
- A transcript is conversational state, not a maintenance record.
- Only an explicit attach-observation action persists selected original text/media references to a case.
- Log safe event metadata, latency, interruption, errors, tool names, trace IDs, and token/audio usage where available; never log API keys or raw authorization headers.
- Apply retention, consent, and jurisdiction policy before enabling production recording or transcript retention.

## Acceptance gates

- API key is server-only and absent from shipped JavaScript, HTML, logs, and network responses.
- Authenticated SDP exchange succeeds with an approved Realtime model.
- Incoming and outgoing audio stream over WebRTC.
- Data-channel lifecycle, transcript, error, and function events are handled deterministically.
- Read-only case lookup works through the application/MCP boundary.
- A voice-requested mutation cannot execute until the user confirms in the dashboard.
- Tenant, actor, role, case, and confirmation spoofing tests pass.
- Disconnect/reconnect cannot replay a completed mutation.
- Browser denial, missing device, OpenAI error, quota/rate limit, and network loss produce honest UI states.
- Realtime latency, tool latency, failures, and trace correlation reach observability.

## UI reconciliation impact

The final dashboard audit must account for the voice control, connection state, live transcript, tool activity, evidence/source rendering, interruption control, and mutation confirmation surfaces. Any legacy voice control that does not use this path is removed or explicitly labeled unavailable.
