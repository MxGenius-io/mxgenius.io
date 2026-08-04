//! Tests for the Wave 1 remount: aircraft, evidence, digital_twin, and the
//! `tools/list` metadata for parts/compliance tools that remain
//! `not_configured` until the application Postgres pool is wired in.
//!
//! These tests exercise the default registry (no Postgres pool) and the
//! in-memory case service. Pool-backed parts and compliance tools keep
//! their `not_configured` availability in this mode; the four aircraft and
//! three evidence remounts are exercised end-to-end.

use mxgenius_mcp::application::case_service::InMemoryCaseService;
use mxgenius_mcp::application::evidence_service::{EvidenceRecord, EvidenceService};
use mxgenius_mcp::context::InsecureLocalProvider;
use mxgenius_mcp::registry::{default_registry, server_info};
use mxgenius_mcp::Dispatcher;
use mxgenius_shared::application::context::{ClientIdentity, ExecutionContext};
use mxgenius_shared::application::policy::Role;
use mxgenius_shared::contracts::{
    CaseStatusDto, MaintenanceCaseCreateRequest, MaintenanceCaseUpdateStatusRequest, PriorityDto,
};
use mxgenius_shared::domain::datetime::UtcDateTime;
use mxgenius_shared::domain::ids::{AircraftId, EvidenceId, OrganizationId, UserId};
use std::sync::Arc;
use time::OffsetDateTime;
use uuid::Uuid;

fn build_context(org: OrganizationId, user: UserId) -> ExecutionContext {
    ExecutionContext {
        request_id: mxgenius_shared::domain::ids::RequestId(Uuid::new_v4()),
        correlation_id: mxgenius_shared::domain::ids::CorrelationId(Uuid::new_v4()),
        organization_id: org,
        user_id: user,
        role: Role::Administrator,
        case_id: None,
        human_confirmed: true,
        approval_granted: true,
        confirmation: None,
        client: ClientIdentity {
            name: "wave1-test".into(),
            version: "1".into(),
        },
        issued_at: OffsetDateTime::now_utc(),
    }
}

fn dispatcher_with_evidence(
    case_service: Arc<InMemoryCaseService>,
    evidence: Arc<EvidenceService>,
) -> Dispatcher {
    Dispatcher::new(
        default_registry(case_service, evidence),
        Arc::new(InsecureLocalProvider::new(Role::Administrator)),
    )
}

fn rpc(method: &str, params: serde_json::Value) -> mxgenius_mcp::dispatcher::JsonRpcRequest {
    mxgenius_mcp::dispatcher::JsonRpcRequest {
        jsonrpc: "2.0".into(),
        method: method.into(),
        params,
        id: serde_json::json!(1),
    }
}

async fn dispatch(d: &Dispatcher, method: &str, params: serde_json::Value) -> serde_json::Value {
    let resp = d.dispatch(rpc(method, params)).await.expect("response");
    if let Some(err) = resp.error {
        panic!("unexpected error: {} {}", err.code, err.message);
    }
    resp.result.unwrap_or(serde_json::Value::Null)
}

#[test]
fn tools_list_reports_not_configured_for_pool_backed_parts_and_compliance() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let reg = default_registry(cs, ev);
    let info = server_info(&reg);
    assert_eq!(info.tool_count, 50);

    let names: std::collections::BTreeMap<String, String> = reg
        .list_tools()
        .into_iter()
        .map(|t| (t.name.clone(), t.availability.clone()))
        .collect();
    // Pool-backed tools in default_registry (no pool) must report
    // not_configured so the metadata agrees with the runtime envelope.
    for name in [
        "mxg.parts.resolve",
        "mxg.parts.alternates",
        "mxg.parts.inventory",
        "mxg.parts.rank_options",
        "mxg.parts.attach_certificate",
        "mxg.compliance.manual_currency",
        "mxg.compliance.record_audit",
        "mxg.compliance.return_to_service_pack",
        "mxg.digital_twin.list_models",
        "mxg.digital_twin.highlight_zone",
        "mxg.digital_twin.link_documents",
        "mxg.analytics.parts_risk",
        "mxg.scheduling.parts_readiness",
        "mxg.scheduling.publish_plan",
    ] {
        assert_eq!(
            names.get(name).map(String::as_str),
            Some("not_configured"),
            "{name} should be not_configured in default_registry"
        );
    }
    for name in [
        "mxg.aircraft.location_context",
        "mxg.aircraft.utilization_summary",
        "mxg.aircraft.related_entities",
        "mxg.aircraft.history_window",
        "mxg.analytics.fleet_health",
        "mxg.analytics.repeat_defects",
        "mxg.analytics.exec_kpis",
        "mxg.scheduling.window_options",
        "mxg.scheduling.resource_match",
        "mxg.scheduling.conflict_scan",
        "mxg.digital_twin.component_state",
        "mxg.evidence.citation_pack",
        "mxg.evidence.conflict_check",
    ] {
        assert_eq!(
            names.get(name).map(String::as_str),
            Some("limited"),
            "{name} should disclose its incomplete authoritative inputs"
        );
    }
}

#[tokio::test]
async fn aircraft_location_context_uses_case_history_when_present() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let aircraft_id = AircraftId(Uuid::new_v4()).0.to_string();
    let response = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: aircraft_id.clone(),
                raw_discrepancy: "wave 1 location context".into(),
                priority: PriorityDto::Routine,
                location: Some(mxgenius_shared::contracts::LocationDto {
                    icao: Some("KBOS".into()),
                    iata: Some("BOS".into()),
                    city: Some("Boston".into()),
                    region: None,
                    country: Some("US".into()),
                }),
                initial_component_id: None,
            },
        )
        .expect("create case");
    assert_eq!(response.0.case.aircraft_id, aircraft_id);
    let d = dispatcher_with_evidence(cs.clone(), ev.clone());
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.location_context",
            "arguments": { "aircraft_id": aircraft_id }
        }),
    )
    .await;
    assert_eq!(r["status"], "ok");
    assert_eq!(r["output"]["airport_icao"], "KBOS");
    assert_eq!(r["output"]["jurisdiction_country"], "US");
    assert_eq!(r["output"]["kind"], "known_licensed_location");
}

#[tokio::test]
async fn aircraft_location_context_returns_typed_partial_when_no_history() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.location_context",
            "arguments": { "aircraft_id": Uuid::new_v4() }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "ENTITY_NOT_FOUND");
    assert_eq!(r["output"]["kind"], "unknown");
}

#[tokio::test]
async fn aircraft_utilization_summary_reports_missing_airframe_hours() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let aircraft_id = AircraftId(Uuid::new_v4()).0.to_string();
    cs.create(
        &ctx,
        &MaintenanceCaseCreateRequest {
            aircraft_id: aircraft_id.clone(),
            raw_discrepancy: "wave 1 utilization".into(),
            priority: PriorityDto::Routine,
            location: None,
            initial_component_id: None,
        },
    )
    .expect("create case");
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.utilization_summary",
            "arguments": { "aircraft_id": aircraft_id }
        }),
    )
    .await;
    assert_eq!(r["status"], "ok");
    let missing = r["output"]["missing_fields"].as_array().unwrap();
    assert!(missing.iter().any(|v| v == "airframe_hours"));
    assert!(missing.iter().any(|v| v == "cycles"));
    assert!(
        r["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["code"] == "NOT_CONFIGURED"),
        "must surface that airframe telemetry is not in the supplied source"
    );
}

#[tokio::test]
async fn aircraft_related_entities_returns_partial_with_explicit_note() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.related_entities",
            "arguments": { "aircraft_id": Uuid::new_v4() }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert!(r["output"]["entities"].as_array().unwrap().is_empty());
    assert!(r["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w["code"] == "NOT_CONFIGURED"));
}

#[tokio::test]
async fn aircraft_history_window_rejects_inverted_window() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let d = dispatcher_with_evidence(cs, ev);
    let response = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.aircraft.history_window",
                "arguments": {
                    "aircraft_id": Uuid::new_v4(),
                    "start_date": "2026-08-01T00:00:00Z",
                    "end_date":   "2026-07-01T00:00:00Z"
                }
            }),
        ))
        .await
        .expect("response");
    let err = response.error.expect("inverted window must fail");
    assert!(err.message.contains("INVALID_INPUT"));
}

#[tokio::test]
async fn aircraft_history_window_returns_case_events() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let aircraft_id = AircraftId(Uuid::new_v4()).0.to_string();
    let created = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: aircraft_id.clone(),
                raw_discrepancy: "wave 1 history window".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    // Transition to triage so we have at least two events.
    cs.update_status(
        &ctx,
        &MaintenanceCaseUpdateStatusRequest {
            case_id: created.0.case.case_id,
            target_status: CaseStatusDto::Triage,
            expected_version: created.0.case.version,
            reason: Some("history window test".into()),
        },
    )
    .expect("update status");
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.history_window",
            "arguments": {
                "aircraft_id": aircraft_id,
                "start_date": "2020-01-01T00:00:00Z",
                "end_date":   "2030-01-01T00:00:00Z"
            }
        }),
    )
    .await;
    let events = r["output"]["events"].as_array().unwrap();
    assert!(!events.is_empty());
    assert!(events.iter().all(|e| e["kind"] == "maintenance"));
    assert_eq!(r["output"]["completeness"], "case_history_only");
}

#[tokio::test]
async fn evidence_trace_case_emits_partial_when_no_evidence() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let ctx = build_context(OrganizationId(Uuid::nil()), UserId(Uuid::nil()));
    let created = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: AircraftId(Uuid::new_v4()).0.to_string(),
                raw_discrepancy: "no evidence test".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.evidence.trace_case",
            "arguments": { "case_id": created.0.case.case_id }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "ENTITY_NOT_FOUND");
    assert!(r["output"]["nodes"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn evidence_trace_case_links_evidence_nodes() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let aircraft_id = AircraftId(Uuid::new_v4()).0.to_string();
    let created = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: aircraft_id.clone(),
                raw_discrepancy: "trace_case test".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    let case_id = created.0.case.case_id;
    let record = EvidenceRecord {
        evidence_id: EvidenceId(Uuid::new_v4()),
        source_type: "manual".into(),
        source_reference: "fixture://manual/excerpt".into(),
        kind: "manual_excerpt".into(),
        title: "Manual A".into(),
        excerpt: None,
        retrieved_at: UtcDateTime::from(OffsetDateTime::now_utc()),
        effective_at: None,
        revision: Some("rev-1".into()),
        license_scope: Some("configured_account".into()),
        content_hash: "sha256:trace-case".into(),
        content: "trace case test content".into(),
    };
    ev.append(record, org, Some(case_id));
    assert!(ev.exists_by_hash("sha256:trace-case", org));

    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.evidence.trace_case",
            "arguments": { "case_id": case_id }
        }),
    )
    .await;
    assert_eq!(r["status"], "ok");
    assert_eq!(r["output"]["nodes"].as_array().unwrap().len(), 1);
    assert_eq!(r["output"]["links"].as_array().unwrap().len(), 1);
    assert_eq!(r["output"]["links"][0]["kind"], "derived_from");
    assert_eq!(r["output"]["source_freshness"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn evidence_citation_pack_summarizes_included_and_licensing() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let created = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: AircraftId(Uuid::new_v4()).0.to_string(),
                raw_discrepancy: "citation_pack test".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    let case_id = created.0.case.case_id;
    let record = EvidenceRecord {
        evidence_id: EvidenceId(Uuid::new_v4()),
        source_type: "manual".into(),
        source_reference: "fixture://manual/excerpt".into(),
        kind: "observation".into(),
        title: "User observation".into(),
        excerpt: None,
        retrieved_at: UtcDateTime::from(OffsetDateTime::now_utc()),
        effective_at: None,
        revision: None,
        license_scope: Some("sanitized_fixture".into()),
        content_hash: "sha256:citation-pack".into(),
        content: "observation content".into(),
    };
    ev.append(record, org, Some(case_id));

    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.evidence.citation_pack",
            "arguments": { "case_id": case_id }
        }),
    )
    .await;
    assert_eq!(r["output"]["evidence_count"], 1);
    assert_eq!(
        r["output"]["included_locators"][0],
        "fixture://manual/excerpt"
    );
    assert!(r["output"]["licensing_warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w.as_str().unwrap().contains("sanitized fixture")));
    // The observation kind must be excluded from the publication citation.
    assert!(r["output"]["exclusions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e.as_str().unwrap().contains("observation")));
    assert!(r["output"]["export_reference"]
        .as_str()
        .unwrap()
        .contains(&case_id.to_string()));
}

#[tokio::test]
async fn evidence_conflict_check_detects_revisions_and_temporal_conflicts() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let created = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: AircraftId(Uuid::new_v4()).0.to_string(),
                raw_discrepancy: "conflict_check test".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    let case_id = created.0.case.case_id;
    let base = EvidenceRecord {
        evidence_id: EvidenceId(Uuid::new_v4()),
        source_type: "manual".into(),
        source_reference: "fixture://manual/dup".into(),
        kind: "manual_excerpt".into(),
        title: "Manual dup".into(),
        excerpt: None,
        retrieved_at: UtcDateTime::from(OffsetDateTime::now_utc()),
        effective_at: Some(UtcDateTime::from(
            time::Date::from_calendar_date(2026, time::Month::January, 1)
                .ok()
                .and_then(|d| d.with_hms(0, 0, 0).ok())
                .map(|dt| dt.assume_utc())
                .expect("valid date"),
        )),
        revision: Some("rev-1".into()),
        license_scope: None,
        content_hash: "sha256:dup-1".into(),
        content: "content a".into(),
    };
    let mut alt = base.clone();
    alt.evidence_id = EvidenceId(Uuid::new_v4());
    alt.revision = Some("rev-2".into());
    alt.effective_at = Some(UtcDateTime::from(
        time::Date::from_calendar_date(2026, time::Month::February, 1)
            .ok()
            .and_then(|d| d.with_hms(0, 0, 0).ok())
            .map(|dt| dt.assume_utc())
            .expect("valid date"),
    ));
    alt.content_hash = "sha256:dup-2".into();
    alt.content = "content b".into();
    ev.append(base, org, Some(case_id));
    ev.append(alt, org, Some(case_id));

    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.evidence.conflict_check",
            "arguments": { "case_id": case_id }
        }),
    )
    .await;
    assert_eq!(
        r["output"]["revision_conflicts"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        r["output"]["temporal_conflicts"].as_array().unwrap().len(),
        1
    );
    assert_eq!(r["output"]["competing_values"].as_array().unwrap().len(), 1);
    assert!(r["output"]["unresolved"] == false);
}

#[tokio::test]
async fn digital_twin_component_state_uses_case_history() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let aircraft_id = AircraftId(Uuid::new_v4()).0.to_string();
    cs.create(
        &ctx,
        &MaintenanceCaseCreateRequest {
            aircraft_id: aircraft_id.clone(),
            raw_discrepancy: "twin component state".into(),
            priority: PriorityDto::Routine,
            location: None,
            initial_component_id: Some("component:hydraulic-pump-1".into()),
        },
    )
    .expect("create case");
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.digital_twin.component_state",
            "arguments": {
                "aircraft_id": aircraft_id,
                "component_id": "component:hydraulic-pump-1"
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "ok");
    assert_eq!(r["output"]["component"]["status"], "candidate");
    assert!(!r["output"]["component"]["prior_case_ids"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn parts_resolve_invocation_behavior_agrees_with_metadata() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.parts.resolve",
            "arguments": { "part_number": "N/A" }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn parts_attach_certificate_invocation_does_not_write_in_local_mode() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let before = ev.count_for_org(OrganizationId(Uuid::nil()));
    let d = dispatcher_with_evidence(cs, ev.clone());
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.parts.attach_certificate",
            "arguments": {
                "case_id": Uuid::new_v4(),
                "part_id": Uuid::new_v4(),
                "certificate_type": "8130-3",
                "document_reference": "upload://pending"
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert!(r["output"]["certificate"].is_null());
    assert!(r["output"]["audit_event_id"].is_null());
    assert_eq!(ev.count_for_org(OrganizationId(Uuid::nil())), before);
}

#[tokio::test]
async fn compliance_return_to_service_pack_invocation_agrees_with_metadata() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let d = dispatcher_with_evidence(cs, ev);
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.compliance.return_to_service_pack",
            "arguments": { "case_id": Uuid::new_v4() }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "NOT_CONFIGURED");
    assert!(r["output"]["review_metadata"].is_null());
    assert_eq!(r["output"]["authorized"], false);
}
