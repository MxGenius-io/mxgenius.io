//! Tests for Wave 2 derived operations: analytics and scheduling.
//!
//! These exercise the default registry (no Postgres pool). The scheduling
//! `publish_plan` mutation returns a typed `not_configured` partial in
//! this mode and never mutates `schedule_options`; the rest of the
//! scheduling and analytics tools are derived from the in-memory case
//! service.

use mxgenius_mcp::application::case_service::InMemoryCaseService;
use mxgenius_mcp::application::evidence_service::EvidenceService;
use mxgenius_mcp::context::InsecureLocalProvider;
use mxgenius_mcp::registry::default_registry;
use mxgenius_mcp::Dispatcher;
use mxgenius_shared::application::context::{ClientIdentity, ExecutionContext};
use mxgenius_shared::application::policy::Role;
use mxgenius_shared::contracts::{LocationDto, MaintenanceCaseCreateRequest, PriorityDto};
use mxgenius_shared::domain::ids::{OrganizationId, UserId};
use std::sync::Arc;
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
            name: "wave2-test".into(),
            version: "1".into(),
        },
        issued_at: time::OffsetDateTime::now_utc(),
    }
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

fn dispatcher() -> (Dispatcher, Arc<InMemoryCaseService>) {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let dispatcher = Dispatcher::new(
        default_registry(cs.clone(), ev),
        Arc::new(InsecureLocalProvider::new(Role::Administrator)),
    );
    (dispatcher, cs)
}

#[tokio::test]
async fn analytics_fleet_health_reports_open_and_aog() {
    let (d, cs) = dispatcher();
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let aircraft_id = Uuid::new_v4().to_string();
    cs.create(
        &ctx,
        &MaintenanceCaseCreateRequest {
            aircraft_id: aircraft_id.clone(),
            raw_discrepancy: "wave2 analytics fleet".into(),
            priority: PriorityDto::Aog,
            location: Some(LocationDto {
                icao: Some("KBOS".into()),
                iata: None,
                city: None,
                region: None,
                country: Some("US".into()),
            }),
            initial_component_id: None,
        },
    )
    .expect("create case");
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({"name": "mxg.analytics.fleet_health", "arguments": {}}),
    )
    .await;
    let names: Vec<String> = r["output"]["metrics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap().to_string())
        .collect();
    assert!(names.contains(&"open_cases".to_string()));
    assert!(names.contains(&"aog_count".to_string()));
    assert_eq!(r["output"]["segments"][0], "priority");
}

#[tokio::test]
async fn analytics_repeat_defects_flags_repeated_buckets() {
    let (d, cs) = dispatcher();
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    for _ in 0..3 {
        cs.create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: Uuid::new_v4().to_string(),
                raw_discrepancy: "hydraulic pressure low during retraction".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    }
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({"name": "mxg.analytics.repeat_defects", "arguments": {}}),
    )
    .await;
    let defects = r["output"]["defects"].as_array().unwrap();
    assert!(!defects.is_empty());
    assert!(defects[0]["count"].as_u64().unwrap() >= 2);
    assert!(defects[0]["sample_size"].as_u64().unwrap() >= 2);
}

#[tokio::test]
async fn analytics_parts_risk_returns_partial_when_no_pool() {
    let (d, _) = dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({"name": "mxg.analytics.parts_risk", "arguments": {}}),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert!(r["output"]["risks"].as_array().unwrap().is_empty());
    assert!(r["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w["code"] == "NOT_CONFIGURED"));
}

#[tokio::test]
async fn analytics_exec_kpis_reports_known_metrics() {
    let (d, cs) = dispatcher();
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    cs.create(
        &ctx,
        &MaintenanceCaseCreateRequest {
            aircraft_id: Uuid::new_v4().to_string(),
            raw_discrepancy: "exec_kpis fixture".into(),
            priority: PriorityDto::Urgent,
            location: None,
            initial_component_id: None,
        },
    )
    .expect("create case");
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.analytics.exec_kpis",
            "arguments": {
                "period_start": "2020-01-01",
                "period_end":   "2030-12-31"
            }
        }),
    )
    .await;
    let names: Vec<String> = r["output"]["kpis"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k["name"].as_str().unwrap().to_string())
        .collect();
    assert!(names.contains(&"open_cases".to_string()));
    assert!(names.contains(&"aog_count".to_string()));
    assert!(names.contains(&"estimated_downtime_hours".to_string()));
    assert!(names.contains(&"average_approval_latency_hours".to_string()));
}

#[tokio::test]
async fn scheduling_window_options_emits_two_candidates() {
    let (d, cs) = dispatcher();
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let created = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: Uuid::new_v4().to_string(),
                raw_discrepancy: "scheduling window fixture".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.scheduling.window_options",
            "arguments": {
                "case_id": created.0.case.case_id,
                "horizon_start": "2026-09-01T08:00:00Z",
                "horizon_end":   "2026-09-30T17:00:00Z"
            }
        }),
    )
    .await;
    assert_eq!(r["output"]["options"].as_array().unwrap().len(), 2);
    assert_eq!(r["output"]["options"][0]["readiness"], "advisory");
    assert!(r["output"]["options"][0]["assumptions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a.as_str().unwrap().contains("labor/bay/calendar")));
}

#[tokio::test]
async fn scheduling_resource_match_marks_resources_unknown() {
    let (d, cs) = dispatcher();
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let created = cs
        .create(
            &ctx,
            &MaintenanceCaseCreateRequest {
                aircraft_id: Uuid::new_v4().to_string(),
                raw_discrepancy: "resource match fixture".into(),
                priority: PriorityDto::Routine,
                location: None,
                initial_component_id: None,
            },
        )
        .expect("create case");
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.scheduling.resource_match",
            "arguments": { "case_id": created.0.case.case_id }
        }),
    )
    .await;
    let kinds: Vec<String> = r["output"]["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["resource_kind"].as_str().unwrap().to_string())
        .collect();
    assert!(kinds.contains(&"labor".to_string()));
    assert!(kinds.contains(&"bay".to_string()));
    assert!(kinds.contains(&"tooling".to_string()));
    assert!(kinds.contains(&"facility_capability".to_string()));
    assert_eq!(r["output"]["data_completeness"], "unknown");
}

#[tokio::test]
async fn scheduling_conflict_scan_detects_aircraft_contention() {
    let (d, cs) = dispatcher();
    let org = OrganizationId(Uuid::nil());
    let user = UserId(Uuid::nil());
    let ctx = build_context(org, user);
    let aircraft_id = Uuid::new_v4().to_string();
    cs.create(
        &ctx,
        &MaintenanceCaseCreateRequest {
            aircraft_id: aircraft_id.clone(),
            raw_discrepancy: "conflict a".into(),
            priority: PriorityDto::Aog,
            location: None,
            initial_component_id: None,
        },
    )
    .expect("create case a");
    cs.create(
        &ctx,
        &MaintenanceCaseCreateRequest {
            aircraft_id: aircraft_id.clone(),
            raw_discrepancy: "conflict b".into(),
            priority: PriorityDto::Routine,
            location: None,
            initial_component_id: None,
        },
    )
    .expect("create case b");
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.scheduling.conflict_scan",
            "arguments": {"case_ids": []}
        }),
    )
    .await;
    let conflicts = r["output"]["conflicts"].as_array().unwrap();
    assert!(!conflicts.is_empty());
    let kinds: Vec<String> = conflicts
        .iter()
        .map(|c| c["kind"].as_str().unwrap().to_string())
        .collect();
    assert!(kinds.contains(&"aircraft_contention".to_string()));
    assert!(kinds.contains(&"priority_mismatch".to_string()));
}

#[tokio::test]
async fn scheduling_parts_readiness_returns_partial_when_no_pool() {
    let (d, _) = dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.scheduling.parts_readiness",
            "arguments": {
                "case_id": Uuid::new_v4(),
                "target_start": "2026-09-01T00:00:00Z"
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["output"]["readiness_state"], "unknown");
    assert!(r["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w["code"] == "NOT_CONFIGURED"));
}

#[tokio::test]
async fn scheduling_publish_plan_returns_partial_when_no_pool() {
    let (d, cs) = dispatcher();
    let before = cs.mutation_counts();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.scheduling.publish_plan",
            "arguments": {
                "case_id": Uuid::new_v4(),
                "schedule_option_id": Uuid::new_v4(),
                "expected_version": 1
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["output"]["published"], false);
    assert!(r["output"]["new_version"].is_null());
    assert!(r["output"]["audit_event_id"].is_null());
    assert!(r["output"]["note"]
        .as_str()
        .unwrap()
        .contains("does not book facilities"));
    assert_eq!(cs.mutation_counts(), before);
}

#[tokio::test]
async fn scheduling_publish_plan_requires_trusted_confirmation() {
    use mxgenius_mcp::context::InsecureLocalProvider;
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let dispatcher = Dispatcher::new(
        default_registry(cs, ev),
        Arc::new(InsecureLocalProvider::with_trusted_state(
            Role::Administrator,
            false,
            false,
        )),
    );
    let response = dispatcher
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.scheduling.publish_plan",
                "arguments": {
                    "case_id": Uuid::new_v4(),
                    "schedule_option_id": Uuid::new_v4(),
                    "expected_version": 1
                }
            }),
        ))
        .await
        .expect("response");
    let err = response.error.expect("missing confirmation");
    assert!(err.message.contains("HUMAN_APPROVAL_REQUIRED"));
}
