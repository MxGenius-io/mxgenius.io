# Production UI reconciliation

The dashboard is a maintenance-case workspace. Fleet data, globe, chat, and 3D are supporting views of that state; none of them establishes maintenance due status or operational authority on its own.

The former left-side service/work-order drawer is retired. `Maintenance Case` is a top-level central workspace because it is the operational spine; service/work-order artifacts are downstream case outputs, not a second authoring model.

## Visible surface ledger

| Surface | State | Source of truth | Production disposition |
|---|---|---|---|
| Active maintenance case | Live | Canonical `MaintenanceCase` and case context | Primary dashboard focus; opens the central Case workspace |
| Case intake and result | Live | Authenticated first-slice orchestration | Keep; mutations use the shared confirmation boundary |
| Evidence, sources, confidence, trace | Contract live; production sources partial | MCP evidence envelopes and orchestration trace | Keep adjacent to the decision; replace fixture/manual fallbacks with mounted adapters |
| Text copilot | Live | Hybrid `/chat`, authoritative case refetch, OpenAI Responses | Keep case-aware; compatibility fleet context is labeled |
| Realtime voice | Live pending final device test | Authenticated WebRTC exchange and MCP tool catalog | Keep; voice mutations pause for dashboard approval |
| Confirmation card | Live | Registry approval metadata and single-use grant issuer | Keep exact tool/object/version/arguments visible |
| Fleet context drawer | Live supporting view | Compatibility aircraft source | Collapsed by default; never presented as case authority |
| Globe | Live supporting view | Compatibility aircraft/base coordinates plus active case | Keep inside fleet context; colors describe source attributes only |
| Aircraft triage/search/cards | Live supporting view | Compatibility aircraft source | Keep AOG only when reported; AFTT is descriptive, not due status |
| Aircraft detail | Live supporting view | Compatibility aircraft bundle | Keep; case creation and evidence retrieval remain canonical actions |
| Operator and facility directory | Live compatibility primitive | Company/contact compatibility endpoints | Keep collapsed and honestly named; not typed MRO facilities yet |
| Fleet charts | Live compatibility analytics | Compatibility bulk export | Keep secondary; no predictive-maintenance claims |
| 3D inspection | Live renderer/selection boundary | Viewer catalog plus canonical component/zone/marker capabilities | Keep lazy-loaded; operational markers require an active case and approval |
| Appearance and cache settings | Live local preference | Browser-local state/cache | Keep small and non-operational |
| Connection indicator | Live | Compatibility session health | Keep; label must distinguish compatibility source health from MCP health |
| Technical library tab | Removed | Evidence retrieval remains behind case/chat | Do not expose as a parallel browser corpus; mount Azure Search and currency controls behind MCP |
| File attachment control | Removed | No upload/evidence-ingestion contract mounted | Reintroduce only with typed ingestion, provenance, scanning, and retention |
| Auto-speak setting | Removed | No production preference consumer | Reintroduce only as a real Realtime audio preference |
| Token/API console | Removed | OIDC/session and server-held provider credentials | Never expose token management or API payload logging in the dashboard |
| Hidden footer/POC overlays | Removed | None | Do not restore |

## UX rules

1. The active case and next safe action come first.
2. Evidence, provenance, confidence, approval, and trace live beside the work they qualify.
3. Fleet context stays available but collapses when it is not needed.
4. AFTT, lifecycle, and sale state are source attributes—not inspection status, airworthiness, or predictions.
5. Unsupported controls are removed instead of silently failing.
6. Operational mutations always expose exact arguments and require qualified human confirmation.
7. Loading, empty, unavailable, degraded, and failure states must explain what remains usable.
8. Color supports a written label; it never carries status alone.

## Final verification still required

- Keyboard order, focus containment, escape/close behavior, and screen-reader labels.
- Desktop, narrow desktop, tablet, and mobile layouts.
- Compatibility source unavailable, MCP unavailable, OpenAI unavailable, and empty-case recovery.
- Live OIDC session, text chat, microphone permission, Realtime audio, interruption, and confirmation flow.
- Deployed dashboard checks through the production gateway and custom domain.
- Azure AI Search/manual corpus plus FAA AD, DRS, and SAIB adapter health and provenance.
