# Known not-configured sources (contract-complete)

The following adapters are present as `NotConfigured*` defaults in this
build. They return deterministic `NOT_CONFIGURED` envelopes with the
typed response shape. The application-plane model replaces each one
when the live source is mounted.

| Adapter | Tool(s) | Status |
| --- | --- | --- |
| `JetNetAdapter` | `mxg.aircraft.lookup`, `mxg.aircraft.profile`, `mxg.aircraft.location_context`, `mxg.aircraft.utilization_summary`, `mxg.aircraft.related_entities`, `mxg.aircraft.history_window` | Production HTTP adapter and tenant-scoped canonical Postgres catalog are mounted when JetNet credentials are configured. Sanitized lookup/profile fixtures exist only in explicit insecure-local mode; the remaining four aircraft capabilities are still `NOT_CONFIGURED`. |
| `ManualCorpusAdapter` | `mxg.maintenance_case.build_context`, `mxg.digital_twin.link_documents`, `mxg.evidence.collect`, `mxg.evidence.citation_pack` | Azure adapter is available in production when Search, authoritative filter, and embeddings settings are present. Otherwise `NOT_CONFIGURED`; sanitized fixtures exist only in explicit insecure-local mode. |
| `FaaAdAdapter` | `mxg.compliance.applicable_ads` | Official DRS data-pull adapter is mounted when an issued API key is configured. Final Rules (`ADFRAWD`) and Emergency ADs (`ADFREAD`) are returned as candidates only; missing canonical make/model or missing credentials fail closed. |
| `FaaDrsAdapter` | future general DRS discovery | Production data-pull implementation exists, but no general-search MCP tool is exposed in v1. |
| `SaibAdapter` | `mxg.compliance.saib_search` | Official DRS `SAIB` metadata adapter is mounted when an issued API key is configured; otherwise `NOT_CONFIGURED`. |
| `AviationWeatherAdapter` | `mxg.weather.airport_now`, `mxg.weather.maintenance_window`, `mxg.weather.ramp_risk`, `mxg.weather.ferry_assessment`, `mxg.weather.hazard_overlay` | NOT_CONFIGURED. `build_context` returns a typed `WeatherSlice` with `not_configured: true`. |
| `PartsInventoryAdapter` | `mxg.parts.inventory`, `mxg.parts.rank_options` | NOT_CONFIGURED |
| `SupplierAdapter` | `mxg.parts.inventory`, `mxg.parts.rank_options`, `mxg.analytics.parts_risk` | NOT_CONFIGURED |
| `MroDirectoryAdapter` | `mxg.mro.search`, `mxg.mro.capability_match`, `mxg.mro.rank`, `mxg.mro.contact_pack`, `mxg.mro.route_eta` | NOT_CONFIGURED. Company/contact data must remain candidate, never confirmed capability. |
| `SchedulingAdapter` | `mxg.scheduling.resource_match`, `mxg.scheduling.window_options`, `mxg.scheduling.publish_plan` | NOT_CONFIGURED |
| `DigitalTwinCatalogAdapter` | `mxg.digital_twin.list_models`, `mxg.digital_twin.component_state`, `mxg.digital_twin.highlight_zone`, `mxg.digital_twin.link_documents` | NOT_CONFIGURED — 3D catalog path not provided |
| `DigitalTwinMarkerRepository` | `mxg.digital_twin.attach_case_marker` | CONFIGURED — local mode uses in-memory persistence; production uses a tenant-scoped Postgres transaction with audit and trace. Catalog/component mapping remains separately gated. |
| `CaseRepository` (Postgres) | case and marker mutations | CONFIGURED in production mode; isolated-database migration verification remains an external gate. |
| `OidcProvider` | every authenticated call | CONFIGURED in production mode with OIDC discovery/JWKS validation and server-side membership resolution. |
| `BlobDocumentAdapter` | `mxg.compliance.manual_currency`, document upload flows | NOT_CONFIGURED — Blob storage not wired to the MCP build |

The Azure manual adapter and official FAA DRS AD/SAIB adapters have been exercised
against their configured non-browser sources. JetNet production composition is
implemented but still requires its deployment credentials and live release smoke
gate. Local fixtures in `fixtures/` are fictional and sanitized; production mode
fails closed when identity, Postgres, or required source configuration is absent.
