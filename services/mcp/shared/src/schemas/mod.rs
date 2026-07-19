//! Canonical JSON Schema fragments shared by MCP discovery and contract
//! documentation. Tool-specific output schemas inject their typed `output`
//! into this single universal envelope definition.

use serde_json::{json, Value};

pub fn envelope_schema() -> Value {
    envelope_schema_with_output(json!({"type": "object"}))
}

pub fn envelope_schema_with_output(output: Value) -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "CapabilityEnvelope",
        "type": "object",
        "additionalProperties": false,
        "required": [
            "request_id", "status", "output", "evidence", "confidence",
            "warnings", "errors", "trace_id", "requires_human_approval",
            "promotion_state", "completed_at"
        ],
        "properties": {
            "request_id": {"type": "string", "format": "uuid"},
            "status": {"type": "string", "enum": ["ok", "partial", "error"]},
            "output": output,
            "evidence": {
                "type": "array",
                "items": evidence_schema()
            },
            "confidence": {
                "type": "object",
                "additionalProperties": false,
                "required": ["score", "basis", "explanation"],
                "properties": {
                    "score": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                    "basis": {
                        "type": "string",
                        "enum": [
                            "deterministic_lookup", "rule_match",
                            "retrieval_supported_inference", "model_only",
                            "human_confirmed"
                        ]
                    },
                    "explanation": {"type": "string"}
                }
            },
            "warnings": {"type": "array", "items": error_schema()},
            "errors": {"type": "array", "items": error_schema()},
            "trace_id": {"type": "string", "format": "uuid"},
            "requires_human_approval": {"type": "boolean"},
            "promotion_state": {"type": "string", "enum": ["shadow", "test", "approved"]},
            "completed_at": {"type": "string", "format": "date-time"}
        }
    })
}

pub fn case_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "MaintenanceCase",
        "type": "object",
        "required": [
            "case_id", "organization_id", "aircraft_id", "status", "priority",
            "opened_at", "updated_at", "raw_discrepancy", "approval_state", "version"
        ],
        "properties": {
            "case_id": {"type": "string", "format": "uuid"},
            "organization_id": {"type": "string", "format": "uuid"},
            "aircraft_id": {"type": "string", "minLength": 1},
            "status": {"type": "string", "enum": ["draft", "open", "triage", "diagnosing", "planning", "awaiting_parts", "scheduled", "in_work", "awaiting_inspection", "awaiting_approval", "closed", "cancelled"]},
            "priority": {"type": "string", "enum": ["routine", "deferred", "urgent", "aog"]},
            "opened_at": {"type": "string", "format": "date-time"},
            "updated_at": {"type": "string", "format": "date-time"},
            "raw_discrepancy": {"type": "string", "minLength": 1},
            "approval_state": {"type": "string", "enum": ["pending", "approved", "rejected", "not_required"]},
            "version": {"type": "integer", "minimum": 1}
        }
    })
}

pub fn evidence_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "evidence_id", "source_type", "source_reference", "kind", "title",
            "retrieved_at", "content_hash", "content"
        ],
        "properties": {
            "evidence_id": {"type": "string", "format": "uuid"},
            "source_type": {"type": "string"},
            "source_reference": {"type": "string", "minLength": 1},
            "kind": {"type": "string"},
            "title": {"type": "string", "minLength": 1},
            "excerpt": {"type": ["string", "null"]},
            "retrieved_at": {"type": "string", "format": "date-time"},
            "effective_at": {"type": ["string", "null"], "format": "date-time"},
            "revision": {"type": ["string", "null"]},
            "license_scope": {"type": ["string", "null"]},
            "content_hash": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
            "content": {"type": "string"}
        }
    })
}

fn error_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["code", "severity", "message", "retryable"],
        "properties": {
            "code": {"type": "string"},
            "severity": {"type": "string", "enum": ["info", "warn", "error", "fatal"]},
            "message": {"type": "string"},
            "retryable": {"type": "boolean"}
        }
    })
}
