# MXGenius aviation demo field guide

This guide lets a software developer explain and demonstrate MXGenius in credible aviation-maintenance language. It separates what is live, what is mounted but blocked, and what is a typed contract awaiting a data source.

Status snapshot: **2026-07-19**. Re-run the preflight checks before every external demo because source configuration can change independently of the static site.

## The 30-second explanation

> MXGenius is an evidence-backed maintenance operations workspace. An observed aircraft discrepancy becomes a persistent Maintenance Case. The case gathers aircraft identity, technical documents, regulatory candidates, weather, parts, facility options, schedule constraints, observations, approvals, and a complete evidence trail. Chat, voice, the globe, and the 3D viewer are interfaces to that same case state. MXGenius helps qualified people find and organize the evidence; it does not diagnose by itself or authorize return to service.

The product flow is:

```text
Aircraft
-> observed discrepancy
-> Maintenance Case
-> documents and regulatory candidates
-> weather, parts, MRO, and schedule
-> actions, evidence, and approvals
-> closure by an authorized person
```

## What the major pieces are

| Piece | Plain-English meaning | Aviation job | Credential or dependency | Current demonstrated state |
| --- | --- | --- | --- | --- |
| JetNet | Licensed business-aircraft fleet data | Aircraft identity, make/model, serial, base, operator/owner, engines, pictures, and other licensed fields | Server-held JetNet credentials | **Live in the fleet compatibility service.** Globe, aircraft cards, details, engines, and image galleries use it. The MCP canonical-aircraft path currently reaches its database upsert but the pilot organization record blocks completion. |
| FAA DRS | FAA Dynamic Regulatory System | Official regulatory-document metadata and links | `MXGENIUS_DRS_API_KEY`, stored only as a deployment secret | **Live for SAIB search in the deployed MCP.** A `Bombardier fuel` smoke request returned FAA document `NM-09-03` with evidence and an official DRS link. AD discovery is implemented but needs a canonical aircraft record before an end-to-end applicability demo. |
| AD | Airworthiness Directive | Legally enforceable FAA requirement when it applies to the aircraft/product | DRS adapter plus canonical make/model; final effectivity review by a qualified person | Returns **candidate ADs**, never a final applicability determination. |
| SAIB | Special Airworthiness Information Bulletin | FAA advisory information; generally not the same legal status as an AD | DRS adapter | Live metadata search; results remain advisory candidates. |
| Authoritative manual corpus | Indexed maintenance-manual text and linked figures | Evidence retrieval for the case brief | Azure AI Search, embeddings, authoritative filter, controlled Blob assets | Adapter and versioned index are built and were live-smoked. Deployment health is not currently exposed accurately enough to claim it in a live demo without a preflight query. Revision, currency, and applicability remain unknown when the source cannot prove them. |
| Maintenance Case | The operational record joining the whole job | Discrepancy, timeline, observations, evidence, status, approvals, and closure | Postgres plus the MCP case service | Postgres core is ready. The full aircraft-to-case slice is presently blocked by the pilot organization/canonical-aircraft join. |
| MCP | Model Context Protocol capability service | Gives UI and AI the same 50 typed operations and safety rules | Rust service, Postgres, trusted application context | **Live and discoverable:** exactly 50 tools. A tool being listed does not mean its external adapter is configured. |
| Evidence envelope | Standard result wrapper | Carries source, hash, time, confidence, warnings, partial state, and trace ID with every capability result | Built into every MCP tool | Live contract behavior. Unavailable sources return `partial` / `NOT_CONFIGURED`, not invented records. |
| Weather adapter | Aviation weather normalized for maintenance planning | METAR, TAF, ramp risk, outdoor work windows, ferry constraints, and globe hazards | Operational aviation-weather source | Contract complete; **not configured**. A live `KATL` request correctly returns `partial` with `NOT_CONFIGURED`. |
| Parts adapters | Typed parts and supplier information | Resolve part numbers, alternates/supersessions, stock, ETA, condition, and certificate presence | Inventory and supplier sources | Contract complete; not configured. |
| MRO directory | Typed Maintenance, Repair, and Overhaul facility model | Find candidate facilities, check documented capability, rank options, contacts, and route ETA | Authoritative facility/capability sources | Contract complete; not configured. A company/contact record is not automatically proof of repair-station capability. |
| Scheduling adapter | Maintenance planning data | Windows, labor, bays, tooling, conflicts, parts readiness, and approved plan record | Scheduling/resource sources | Contract complete; not configured. Publishing a plan never books a facility or part. |
| 3D/WebXR | Three.js aircraft/component visualization | Inspect, raycast-select, highlight a zone, attach a case marker, and view linked material | Browser WebXR; Quest uses its native browser for immersive VR | Viewer, raycasting, XR globe interaction, image panels, and 3D compatibility surfaces are live. Canonical component/zone mappings and digital-twin catalog adapter are not configured. Visual geometry alone is not configuration evidence. |
| OpenAI text chat | Conversational interface over case and fleet context | Ask for a brief and invoke typed tools | Server-held `OPENAI_API_KEY` | **Live-smoked** against `gpt-5.6-sol` on 2026-07-19. |
| OpenAI Realtime | Low-latency voice media plane over WebRTC | Spoken case questions and tool requests | Server-held OpenAI key, browser microphone, WebRTC entitlement | Implemented and surfaced. Treat live device/audio as a pre-demo check; mutations still stop for dashboard confirmation. |
| Postgres | Durable operational storage | Cases, events, evidence, approvals, audit, trace, aircraft catalog, and markers | `DATABASE_URL` | Deployed readiness endpoint reports `database: ready`. |
| OIDC, tenancy, RBAC | Identity and authorization controls | Ensures records and actions belong to the correct organization and role | OIDC discovery/audience and membership records | Production implementation exists. The current public pilot deliberately uses an insecure pilot context and must not be described as the final authentication configuration. |

Never display, paste, log, or commit any provider key. The DRS and OpenAI keys belong in the Azure deployment secret store; the browser receives results, not credentials.

## Aviation vocabulary for a developer

| Term | What it means | Safe demo wording |
| --- | --- | --- |
| A&P | FAA-certificated Airframe and Powerplant mechanic | “The system supports the A&P; it does not replace their determination.” |
| IA | Inspection Authorization held by an eligible mechanic | “Required approvals stay with appropriately authorized personnel.” |
| MRO | Maintenance, Repair, and Overhaul organization/facility | “These are candidate MRO options until capability and ratings evidence is verified.” |
| AOG | Aircraft on Ground; an aircraft unable to operate, usually time-critical | “This record is reported as AOG by the source.” Do not infer AOG from a red color or open case. |
| Discrepancy | The observed unsatisfactory condition | “We record the observed condition before proposing a diagnosis.” |
| Corrective action | What was actually done to resolve a discrepancy | “The action becomes part of the case timeline and evidence record.” |
| RTS | Return to Service | “MXGenius assembles a review pack; an authorized human performs the approval.” |
| AD | Airworthiness Directive | “The FAA result is a candidate until effectivity and serial applicability are reviewed.” |
| SAIB | Special Airworthiness Information Bulletin | “This is advisory FAA information, not an automatic maintenance mandate.” |
| DRS | Dynamic Regulatory System | “This is the FAA system supplying official document metadata and links.” |
| METAR | Current coded airport weather observation | “Airport Now returns the observation and decoded fields when the weather source is mounted.” |
| TAF | Coded airport forecast | “We use it as an input to a maintenance window, not as a dispatch authorization.” |
| ICAO code | Four-letter airport identifier, such as `KATL` | “The operational tools use ICAO airport identity.” |
| AFTT | Airframe Total Time | “A source-reported utilization value—not proof that maintenance is due.” |
| Cycles | Usually takeoff/landing or pressurization cycles, depending on the tracked item | “Hours and cycles carry their source timestamps and definitions.” |
| TBO | Time Between Overhaul | “A reference interval whose applicability must be established from the correct program and source.” |
| Part alternate | Another part approved for the same context | “An alternate is not interchangeable merely because a supplier says so; applicability evidence is required.” |
| Supersession | A newer part or document replaces an earlier one | “The system preserves the chain instead of silently replacing history.” |
| Traceability | Ability to follow a claim or installed part back to its records | “We retain sources, hashes, timestamps, decisions, and links.” |
| ATA chapter | Industry-standard system numbering used to organize aircraft technical material | “ATA context helps route a discrepancy to the relevant system and documents.” |
| Effectivity | The exact models, serials, configurations, or dates to which an instruction applies | “Search narrows candidates; effectivity still has to be verified.” |
| Ferry flight | A flight conducted under defined conditions to reposition an aircraft that may not meet normal airworthiness requirements | “The tool only assesses information and constraints; it does not issue a permit or dispatch the flight.” |

## The complete 50-capability catalog

The public Operations workspace discovers this catalog directly from the deployed MCP. Names are frozen; UI, chat, and voice are expected to call these exact contracts.

### Aircraft — 6

1. `mxg.aircraft.lookup` — resolve registration, serial number, or licensed source ID to a canonical aircraft identity.
2. `mxg.aircraft.profile` — return identity, make, model, year, reported status, base, and freshness.
3. `mxg.aircraft.location_context` — return a known base or licensed location; never imply live tracking without a source that supports it.
4. `mxg.aircraft.utilization_summary` — return source-reported airframe hours, cycles, age, trends, and timestamps.
5. `mxg.aircraft.related_entities` — return owner, operator, company, and contact references.
6. `mxg.aircraft.history_window` — return licensed history events within an explicit date window.

### Maintenance Case — 6

7. `mxg.maintenance_case.create` — open a persistent case with aircraft, raw discrepancy, and priority.
8. `mxg.maintenance_case.get` — retrieve the tenant-scoped case aggregate.
9. `mxg.maintenance_case.build_context` — assemble aircraft, documents, compliance, weather, parts, and timeline context.
10. `mxg.maintenance_case.similar_cases` — find prior tenant-scoped cases with match factors and outcomes.
11. `mxg.maintenance_case.update_status` — make a version-checked state transition and record event/audit data.
12. `mxg.maintenance_case.attach_observation` — append an immutable observation with optional media references.

### Parts — 5

13. `mxg.parts.resolve` — normalize a part number or description to a canonical part.
14. `mxg.parts.alternates` — return evidence-backed alternates and supersessions with applicability.
15. `mxg.parts.inventory` — return candidate stock and supplier options for a destination.
16. `mxg.parts.rank_options` — compare ETA, location, condition, certificate, and confidence.
17. `mxg.parts.attach_certificate` — record that a certificate file exists separately from whether it has been validated.

### MRO discovery — 5

18. `mxg.mro.search` — return candidate facilities with source completeness.
19. `mxg.mro.capability_match` — compare a case’s required work with documented facility capabilities and gaps.
20. `mxg.mro.rank` — rank candidates using capability, distance, hours, weather, parts, performance, and completeness.
21. `mxg.mro.contact_pack` — return verified contact and escalation information.
22. `mxg.mro.route_eta` — estimate route distance/time with assumptions, constraints, and weather links.

### Weather — 5

23. `mxg.weather.airport_now` — return METAR, TAF, flight category, and decoded airport weather.
24. `mxg.weather.maintenance_window` — identify candidate outdoor-work windows and their drivers.
25. `mxg.weather.ramp_risk` — summarize wind, precipitation, lightning, temperature, icing, and visibility risk.
26. `mxg.weather.ferry_assessment` — identify weather constraints, hazards, missing data, and an advisory feasibility state.
27. `mxg.weather.hazard_overlay` — return geospatial weather objects for the globe.

### Compliance — 5

28. `mxg.compliance.applicable_ads` — return evidence-backed AD candidates for qualified applicability review.
29. `mxg.compliance.saib_search` — search official DRS SAIB metadata by aircraft, component, or terms.
30. `mxg.compliance.manual_currency` — report known revision, effective date, supersession state, and warnings.
31. `mxg.compliance.record_audit` — identify missing fields, evidence, approvals, and completeness issues.
32. `mxg.compliance.return_to_service_pack` — assemble a review pack; it never performs the approval.

### Digital twin / 3D — 5

33. `mxg.digital_twin.list_models` — list versioned visual models and their stated applicability.
34. `mxg.digital_twin.component_state` — retrieve the canonical component, installation, observations, cases, and evidence.
35. `mxg.digital_twin.highlight_zone` — resolve a zone to model/mesh IDs, camera position, and annotations.
36. `mxg.digital_twin.link_documents` — retrieve document sections, diagrams, and mapping confidence for a component/model.
37. `mxg.digital_twin.attach_case_marker` — persist a confirmed case marker for a canonical component or zone.

### Scheduling — 5

38. `mxg.scheduling.window_options` — return candidate start/end windows, constraints, and readiness.
39. `mxg.scheduling.resource_match` — compare required labor, bays, tooling, and facility capabilities.
40. `mxg.scheduling.conflict_scan` — identify deterministic conflicts, affected records, and possible resolutions.
41. `mxg.scheduling.parts_readiness` — summarize blockers, ETA gaps, and certificate gaps.
42. `mxg.scheduling.publish_plan` — persist an approved, versioned plan; never book a facility or purchase a part.

### Evidence — 4

43. `mxg.evidence.collect` — normalize, hash, and de-duplicate evidence from typed sources.
44. `mxg.evidence.trace_case` — return the evidence graph, derivations, supersessions, conflicts, and decisions.
45. `mxg.evidence.citation_pack` — package references, locators, exclusions, and license warnings.
46. `mxg.evidence.conflict_check` — expose contradictory values, revisions, and unresolved conflicts.

### Analytics — 4

47. `mxg.analytics.fleet_health` — return defined fleet-health metrics with freshness, limitations, and drill-through IDs.
48. `mxg.analytics.repeat_defects` — return recurring normalized discrepancies with counts, intervals, outcomes, and sample size.
49. `mxg.analytics.parts_risk` — report shortage, lead-time, certificate, and supplier risks with uncertainty.
50. `mxg.analytics.exec_kpis` — return defined downtime, turnaround-time, AOG, open-case, blocker, and approval-latency KPIs.

## A credible 8-minute demo

### Before the audience arrives

1. Open `https://mxgenius.io/dashboard.html` in a clean desktop browser and allow the initial fleet load to finish once.
2. Confirm the globe shows aircraft clusters and that one aircraft detail opens with text and images.
3. Confirm the Operations tab reports **50 available operations**.
4. Run **Search SAIBs** with query `Bombardier fuel`; expect FAA item `NM-09-03` and an official DRS link.
5. Run **Current airport weather** with ICAO `KATL`; until the adapter is mounted, expect an honest unavailable/partial result. This is a useful truth-safety demonstration, not a weather demo.
6. Confirm text chat answers. Treat voice as optional until the microphone/WebRTC device check passes in that browser.
7. For Quest VR, open the public site in the Quest’s native browser. Do not use PC Link as a browser proxy for the immersive session.
8. Do not attempt the aircraft-to-case vertical slice in an external demo until the pilot organization/canonical-aircraft foreign-key issue is cleared.

### Demo sequence and exact words

**1. Start with the globe.**

Action: open Dashboard, expand Fleet Context, rotate the globe, select a cluster, and open an aircraft.

Say:

> “This is licensed fleet context, not a live air-traffic tracker. I can move from geography to a specific aircraft record, its reported identity and base, engines, owner/operator context, and source images.”

**2. Establish the Maintenance Case spine.**

Action: open the Case tab and point out aircraft registration, priority, and observed discrepancy.

Say:

> “The case begins with what was observed—not with an AI diagnosis. From here, every document, regulatory candidate, observation, part decision, schedule action, approval, and 3D marker belongs to one versioned timeline.”

Until the current pilot join is fixed, explain the surface without claiming a successful persisted case.

**3. Show the capability plane.**

Action: open Operations and show the job-oriented groups rather than raw JSON.

Say:

> “These are not 50 unrelated buttons. They are one typed operating vocabulary shared by the UI, chat, and voice. Each result has a status, evidence, confidence, warnings, and a trace ID.”

**4. Prove an authoritative regulatory source.**

Action: choose **Search SAIBs**, enter `Bombardier fuel`, and run it. Open the returned FAA link if appropriate.

Say:

> “This result came through the FAA DRS adapter. It includes an official source link and a content hash. A SAIB is advisory information. For an AD, MXGenius returns candidates; a qualified person still verifies model, serial, configuration, and effectivity.”

**5. Demonstrate honest degradation.**

Action: choose **Current airport weather**, enter `KATL`, and run it.

Say:

> “The typed operation exists, but the live weather source is not mounted. Instead of generating weather, the service returns a partial result with `NOT_CONFIGURED`. That fail-closed behavior matters in maintenance operations.”

**6. Show 3D as a case interface.**

Action: open the 3D Viewer, select a mesh, show highlighting and linked controls; optionally show the XR globe in Quest’s native browser.

Say:

> “The viewer is an inspection and navigation surface. Raycasting identifies visual geometry; only a versioned mapping can turn that mesh into a canonical component or aircraft zone. A confirmed marker can then join the same Maintenance Case and evidence trail.”

**7. Close with the boundary.**

Say:

> “MXGenius accelerates retrieval, coordination, and traceability. It does not autonomously diagnose, approve an alternate part, determine final AD applicability, dispatch a ferry flight, or sign a return-to-service record. Those decisions remain visible and human-controlled.”

## How to answer likely aviation questions

**“Is this predicting failures?”**

> “No production predictive-maintenance claim is being made. Current analytics summarize defined source data and expose sample size, freshness, uncertainty, and drill-through.”

**“Does it tell me whether an AD applies?”**

> “It discovers evidence-backed candidates from FAA DRS. Final effectivity and serial/configuration applicability require qualified review.”

**“Can it release the airplane?”**

> “No. It assembles the evidence and review pack. Return-to-service authority remains with the appropriately authorized person.”

**“Is the globe live tracking?”**

> “No. It shows licensed source location/base context unless a source explicitly supports and timestamps a live position.”

**“Is that 3D model the exact aircraft configuration?”**

> “Only if the model, revision, applicability, and component mapping have been validated. Otherwise it is clearly labeled demonstration or unmapped geometry.”

**“Can it order this part or book this shop?”**

> “It can compare and persist a proposed plan after the relevant sources are mounted. It does not silently place an order or book a facility.”

**“Why MCP?”**

> “MCP gives every interface the same typed tools and envelopes. The model cannot invent a second schema or bypass the evidence, tenant, role, version, and confirmation boundaries.”

## Current live truth table

| Check | Result on 2026-07-19 |
| --- | --- |
| Rust core health | `200 OK` |
| Rust readiness | Production mode, Postgres ready |
| MCP catalog | 50 tools returned from deployed `tools/list` |
| Fleet proxy | Healthy; JetNet-backed dashboard/globe path live |
| OpenAI text chat | `200 OK`, model `gpt-5.6-sol` |
| FAA DRS SAIB query | `ok`, evidence-backed result returned |
| Weather query | `partial`, `NOT_CONFIGURED` as designed |
| Canonical aircraft lookup | Currently fails while writing against the placeholder pilot organization; do not demo the first case slice yet |
| 3D/XR frontend | Live compatibility interaction; canonical digital-twin adapter not configured |
| Realtime voice | Implemented; browser/device smoke required immediately before demo |

The deployed `/adapterz` response currently reports all external adapters as `not_configured` based only on runtime mode, so it is not a trustworthy per-adapter health inventory. The successful DRS query proves that discrepancy. Use actual bounded source probes until adapter health becomes dynamic.

## Claim discipline

Use these verbs deliberately:

- **live** — the deployed path was successfully exercised;
- **mounted** — implementation and configuration are present, but the whole user path may not be accepted;
- **contract complete** — typed request/response and fail-closed behavior exist;
- **candidate** — search narrowed the records, but a qualified applicability/capability decision remains;
- **unavailable** — the source is missing or failed and no substitute was fabricated;
- **demonstration geometry** — a visual asset without validated aircraft/component applicability.

Avoid saying “the AI determined,” “FAA approved,” “this part is interchangeable,” “this facility is qualified,” “the aircraft is airworthy,” or “return to service is complete” unless an authoritative record and authorized human action actually support that exact statement.

## Maintainer references

- MCP catalog and runtime: `services/mcp/README.md`
- Live/unavailable adapter behavior: `services/mcp/docs/known-not-configured.md`
- Application mount: `services/mcp/docs/integration-guide.md`
- Production status ledger: `docs/PRODUCTION_MOUNT_TASKLIST.md`
- Manual and figure provenance: `docs/AUTHORITATIVE_CORPUS_MOUNT.md`
- 3D safety/mapping boundary: `docs/THREE_D_OPERATIONAL_SLICE.md`
- Voice boundary: `docs/REALTIME_WEBRTC_MOUNT.md`
- Frontend truth ledger: `docs/UI_RECONCILIATION.md`
