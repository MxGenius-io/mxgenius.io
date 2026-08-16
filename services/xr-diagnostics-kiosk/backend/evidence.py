"""Deterministic append-only evidence envelopes for edge observations."""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any


CANONICALIZATION = "mxg-canonical-json-1"


def canonical_json_bytes(value: dict[str, Any]) -> bytes:
    """Serialize once; relays must preserve these exact UTF-8 bytes."""
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


@dataclass
class EvidenceChain:
    session_id: str
    sequence: int = 0
    previous_event_sha256: str | None = None

    def observe(
        self,
        *,
        raw_payload: bytes,
        source: dict[str, Any],
        condition_result: str,
        measurements: dict[str, Any],
        limitations: list[str],
        reported_condition_id: str | None = None,
        environment: dict[str, Any] | None = None,
        technician_annotation: str | None = None,
        witness_session_id: str | None = None,
        artifact_reference: str | None = None,
        observed_at_ms: int | None = None,
        observation_id: str | None = None,
    ) -> tuple[dict[str, Any], bytes]:
        if condition_result not in {
            "supports-reported-condition",
            "does-not-reproduce",
            "inconclusive",
            "not-evaluated",
        }:
            raise ValueError("invalid neutral condition result")
        if not limitations or any(not str(value).strip() for value in limitations):
            raise ValueError("at least one explicit limitation is required")
        self.sequence += 1
        event: dict[str, Any] = {
            "type": "evidence.observation",
            "version": 1,
            "observationId": observation_id or str(uuid.uuid4()),
            "sessionId": self.session_id,
            "sequence": self.sequence,
            "reportedConditionId": reported_condition_id,
            "observedAtMs": observed_at_ms if observed_at_ms is not None else int(time.time() * 1000),
            "source": source,
            "conditionResult": condition_result,
            "measurements": measurements,
            "environment": environment or {},
            "limitations": [str(value).strip() for value in limitations],
            "technicianAnnotation": technician_annotation,
            "witnessSessionId": witness_session_id,
            "artifactReference": artifact_reference,
            "integrity": {
                "canonicalization": CANONICALIZATION,
                "hashAlgorithm": "sha256",
                "payloadSha256": sha256_hex(raw_payload),
                "previousEventSha256": self.previous_event_sha256,
                "deviceSignature": None,
            },
        }
        canonical_without_event_hash = canonical_json_bytes(event)
        event_hash = sha256_hex(canonical_without_event_hash)
        event["integrity"]["eventSha256"] = event_hash
        canonical_event = canonical_json_bytes(event)
        self.previous_event_sha256 = event_hash
        return event, canonical_event
