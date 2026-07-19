# Pre-MCP Surface Inventory

This file protects the working POC while the application is prepared to receive the shared capability plane.

## Classification

| Area | State | Pre-MCP action | Post-contract destination |
|---|---|---|---|
| Landing, Trust Center, waitlist | Live | Preserve | Public/Governance |
| Dashboard charts and filters | Live | Characterize | Command |
| Globe and drill-down | Live | Characterize | Shared Command/Aircraft/AOG/Network/Weather view |
| Aircraft direct search/detail | Live | Move source calls behind compatibility client | Aircraft |
| Fleet triage | Live source attributes | Keep as collapsed compatibility context | Case-aware aircraft discovery |
| Operator and facility directory | Live source primitive | Keep behind compatibility client | Network inputs, not typed facilities by default |
| AI Copilot | Live free-form shell | Move chat call behind compatibility client | Case-aware orchestration/rendering |
| Maintenance Case panel | Live canonical workspace | Preserve | Maintenance Case intake/brief |
| Settings/cache | Live local preferences | Preserve | User preferences |
| 3D viewer | Live renderer | Preserve | Digital Twin consumer |
| Technical Library | Removed from visible UI; assets absent | Keep evidence retrieval behind case/chat | Reintroduce only after controlled source mount |
| FAA static dataset | Referenced, absent | Keep failure explicit | Compliance adapter |
| Prospecting mock loader | Removed | Keep absent | Replace only through a typed case-aware capability |
| Service-base mock loader | Removed | Keep absent | Network adapter replacement |
| Compliance mock loader | Removed | Keep absent | Compliance adapter replacement |
| Marketplace mock loader | Removed | Keep absent | Deferred |
| Token marketplace overlay | Removed | Keep absent | Deferred |
| Local/on-device inference path | Dormant/unsupported | Do not promote | Future evaluation only |
| Token/API console | Removed | Keep absent | Server-side diagnostics only |

## Known missing deploy assets

```text
display_index/catalog.json
faa_data/faa_ads_slim.json
rag_image_map.json
```

Their absence must produce a visible unavailable/partial state. Do not replace them with fake production data.

## Preservation rule

Before deleting or rewriting a POC path, the replacement must have a characterization test and a named canonical consumer. Existing JetNet, cache, globe, chat, voice, work-order drafting, and 3D behavior must remain operational throughout the mount.
