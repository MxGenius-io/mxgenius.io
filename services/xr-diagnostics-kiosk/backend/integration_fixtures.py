"""Synthetic normalized provider envelopes for offline UI and orchestration work."""

from __future__ import annotations

import time
from typing import Any


def simulated_integrations() -> dict[str, Any]:
    """Return deterministic, non-provider payloads shaped for MXG consumers."""

    return {
        "type": "integration.fixtures",
        "version": 1,
        "generatedAtMs": int(time.time() * 1000),
        "notice": "Synthetic MxGenius envelopes; not live provider responses or operational evidence.",
        "integrations": [
            {
                "provider": "aviationweather",
                "label": "AviationWeather METAR / TAF",
                "mode": "public-adapter",
                "auth": "none",
                "description": "Public weather observations normalized for the aircraft context lane.",
                "contract": "mxg.weather.observation.v1",
                "sample": {
                    "type": "weather.observation",
                    "status": "fixture",
                    "airport": {"icao": "KATL"},
                    "metar": {
                        "observedAt": "2026-08-15T12:00:00Z",
                        "rawText": "KATL 151200Z 26006KT 10SM FEW040 27/19 A3004 (SIMULATED)",
                        "wind": {"directionDegrees": 260, "speedKnots": 6},
                        "visibilityStatuteMiles": 10,
                        "temperatureC": 27,
                    },
                    "taf": {"validFrom": "2026-08-15T12:00:00Z", "validTo": "2026-08-16T18:00:00Z", "rawText": "SIMULATED TAF SHAPE"},
                    "source": {"provider": "AviationWeather.gov", "reference": "fixture://aviationweather/KATL"},
                    "operationalConclusion": None,
                },
            },
            {
                "provider": "partsbase",
                "label": "PartsBase market search",
                "mode": "fixture",
                "auth": "pending",
                "description": "Candidate supplier offers behind the server-only provider authentication boundary.",
                "contract": "mxg.parts.market-snapshot.v1",
                "sample": {
                    "type": "part.market.snapshot",
                    "status": "fixture",
                    "query": {"partNumber": "PN-EXAMPLE-001", "quantity": 1},
                    "offers": [
                        {"supplierId": "fixture-supplier-a", "condition": "NE", "availableQuantity": 2, "leadTimeDays": 1, "currency": "USD", "unitPrice": None},
                        {"supplierId": "fixture-supplier-b", "condition": "SV", "availableQuantity": 1, "leadTimeDays": 3, "currency": "USD", "unitPrice": None},
                    ],
                    "source": {"provider": "PartsBase", "reference": "fixture://partsbase/PN-EXAMPLE-001"},
                    "verified": False,
                    "operationalConclusion": None,
                },
            },
            {
                "provider": "honeywell-forge",
                "label": "Honeywell Forge health",
                "mode": "contract-fixture",
                "auth": "pending",
                "description": "Equipment-health shape for future authorized aircraft and component telemetry.",
                "contract": "mxg.equipment.health-snapshot.v1",
                "sample": {
                    "type": "equipment.health.snapshot",
                    "status": "fixture",
                    "asset": {"registration": "N350MX", "component": "APU", "serialNumber": "REDACTED-FIXTURE"},
                    "metrics": [
                        {"name": "startDuration", "value": 31.4, "unit": "seconds", "quality": "simulated"},
                        {"name": "exhaustGasTemperature", "value": 612, "unit": "celsius", "quality": "simulated"},
                    ],
                    "alerts": [{"code": "FIXTURE-TREND", "severity": "advisory", "active": True}],
                    "source": {"provider": "Honeywell Forge", "reference": "fixture://honeywell-forge/N350MX/APU"},
                    "verified": False,
                    "operationalConclusion": None,
                },
            },
        ],
    }
