//! Smoke + protocol tests for the default registry. Most tests drive the
//! dispatcher so they exercise the full deserialization -> handler ->
//! envelope -> serialization roundtrip.

use mxgenius_mcp::application::case_service::InMemoryCaseService;
use mxgenius_mcp::application::evidence_service::EvidenceService;
use mxgenius_mcp::context::InsecureLocalProvider;
use mxgenius_mcp::registry::{default_registry, server_info};
use mxgenius_mcp::Dispatcher;
use mxgenius_shared::application::context::ClientIdentity;
use mxgenius_shared::application::envelope::EnvelopeStatus;
use mxgenius_shared::application::policy::Role;
use mxgenius_shared::domain::ids::{OrganizationId, UserId};
use std::sync::Arc;
use uuid::Uuid;

fn fresh_dispatcher() -> (Dispatcher, Arc<InMemoryCaseService>, Arc<EvidenceService>) {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let reg = default_registry(cs.clone(), ev.clone());
    let dispatcher = Dispatcher::new(
        reg,
        Arc::new(InsecureLocalProvider::new(Role::Administrator)),
    );
    (dispatcher, cs, ev)
}

fn dispatcher_with_trust(
    role: Role,
    human_confirmed: bool,
    approval_granted: bool,
) -> (Dispatcher, Arc<InMemoryCaseService>) {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let dispatcher = Dispatcher::new(
        default_registry(cs.clone(), ev),
        Arc::new(InsecureLocalProvider::with_trusted_state(
            role,
            human_confirmed,
            approval_granted,
        )),
    );
    (dispatcher, cs)
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
fn registry_has_50_unique_tools() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let reg = default_registry(cs, ev);
    let info = server_info(&reg);
    assert_eq!(info.tool_count, 50);
    assert_eq!(info.resource_count, 16);
    assert_eq!(info.prompt_count, 8);

    let names: std::collections::BTreeSet<String> =
        reg.list_tools().into_iter().map(|t| t.name).collect();
    assert_eq!(names.len(), 50, "tool names must be unique");
}

#[test]
fn all_50_tool_names_match_the_locked_catalog() {
    use std::collections::BTreeSet;
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let reg = default_registry(cs, ev);
    let actual: BTreeSet<String> = reg.list_tools().into_iter().map(|t| t.name).collect();
    let expected: BTreeSet<&'static str> = [
        "mxg.aircraft.lookup",
        "mxg.aircraft.profile",
        "mxg.aircraft.location_context",
        "mxg.aircraft.utilization_summary",
        "mxg.aircraft.related_entities",
        "mxg.aircraft.history_window",
        "mxg.maintenance_case.create",
        "mxg.maintenance_case.get",
        "mxg.maintenance_case.build_context",
        "mxg.maintenance_case.similar_cases",
        "mxg.maintenance_case.update_status",
        "mxg.maintenance_case.attach_observation",
        "mxg.parts.resolve",
        "mxg.parts.alternates",
        "mxg.parts.inventory",
        "mxg.parts.rank_options",
        "mxg.parts.attach_certificate",
        "mxg.mro.search",
        "mxg.mro.capability_match",
        "mxg.mro.rank",
        "mxg.mro.contact_pack",
        "mxg.mro.route_eta",
        "mxg.weather.airport_now",
        "mxg.weather.maintenance_window",
        "mxg.weather.ramp_risk",
        "mxg.weather.ferry_assessment",
        "mxg.weather.hazard_overlay",
        "mxg.compliance.applicable_ads",
        "mxg.compliance.saib_search",
        "mxg.compliance.manual_currency",
        "mxg.compliance.record_audit",
        "mxg.compliance.return_to_service_pack",
        "mxg.digital_twin.list_models",
        "mxg.digital_twin.component_state",
        "mxg.digital_twin.highlight_zone",
        "mxg.digital_twin.link_documents",
        "mxg.digital_twin.attach_case_marker",
        "mxg.scheduling.window_options",
        "mxg.scheduling.resource_match",
        "mxg.scheduling.conflict_scan",
        "mxg.scheduling.parts_readiness",
        "mxg.scheduling.publish_plan",
        "mxg.evidence.collect",
        "mxg.evidence.trace_case",
        "mxg.evidence.citation_pack",
        "mxg.evidence.conflict_check",
        "mxg.analytics.fleet_health",
        "mxg.analytics.repeat_defects",
        "mxg.analytics.parts_risk",
        "mxg.analytics.exec_kpis",
    ]
    .into_iter()
    .collect();
    assert_eq!(actual.len(), expected.len());
    for n in &expected {
        assert!(actual.contains(*n), "missing {n}");
    }
}

#[test]
fn role_action_matrix_for_all_capabilities_matches_the_locked_snapshot() {
    use mxgenius_shared::application::policy::PolicyMatrix;
    use sha2::Digest;

    let evidence = Arc::new(EvidenceService::new());
    let cases = Arc::new(InMemoryCaseService::new((*evidence).clone()));
    let registry = default_registry(cases, evidence);
    let roles = [
        Role::Viewer,
        Role::Technician,
        Role::Planner,
        Role::Controller,
        Role::Procurement,
        Role::Quality,
        Role::Manager,
        Role::Administrator,
    ];
    let mut snapshot = Vec::new();
    for tool in registry.list_tools() {
        for role in roles {
            snapshot.push(serde_json::json!({
                "tool": tool.name,
                "role": role.as_str(),
                "action": tool.action,
                "decision": format!("{:?}", PolicyMatrix::is_authorized(role, tool.action)),
                "requires_human_approval": tool.requires_human_approval,
            }));
        }
    }
    snapshot.sort_by_key(serde_json::Value::to_string);
    let actual = hex::encode(sha2::Sha256::digest(serde_json::to_vec(&snapshot).unwrap()));
    assert_eq!(
        actual, "0df096cfd349015424d50729a5a7074011808f12ab77d4a88fe617a1f0d9c65a",
        "RBAC snapshot changed: {actual}"
    );
}

#[tokio::test]
async fn not_configured_tool_emits_typed_partial_envelope() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.parts.resolve", "arguments": {}
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "NOT_CONFIGURED");
    assert!(
        r["output"]["matches"].is_array(),
        "output.matches must be a typed array, not invented facts"
    );
}

#[tokio::test]
async fn not_configured_mutations_return_no_record_shaped_fiction_or_writes() {
    let (d, service, _) = fresh_dispatcher();
    let case_id = Uuid::new_v4().to_string();
    let part_id = Uuid::new_v4().to_string();
    let schedule_id = Uuid::new_v4().to_string();
    let before = service.mutation_counts();

    let certificate = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.parts.attach_certificate",
            "arguments": {
                "case_id": case_id,
                "part_id": part_id,
                "certificate_type": "8130-3",
                "document_reference": "upload://pending"
            }
        }),
    )
    .await;
    assert_eq!(certificate["status"], "partial");
    assert!(certificate["output"]["certificate"].is_null());
    assert!(certificate["output"]["audit_event_id"].is_null());

    let schedule = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.scheduling.publish_plan",
            "arguments": {
                "case_id": case_id,
                "schedule_option_id": schedule_id,
                "expected_version": 1
            }
        }),
    )
    .await;
    assert_eq!(schedule["status"], "partial");
    assert_eq!(schedule["output"]["published"], false);
    assert!(schedule["output"]["new_version"].is_null());
    assert!(schedule["output"]["audit_event_id"].is_null());
    assert_eq!(service.mutation_counts(), before);
}

#[tokio::test]
async fn not_configured_factories_do_not_invent_scores_risk_or_generation_metadata() {
    let (dispatcher, _, _) = fresh_dispatcher();
    let case_id = Uuid::new_v4().to_string();
    let calls = [
        (
            "mxg.weather.ramp_risk",
            serde_json::json!({
                "airport_icao": "KJFK",
                "start": "2026-07-19T08:00:00Z",
                "duration_minutes": 60,
                "work_type": "inspection"
            }),
            "risk_level",
        ),
        (
            "mxg.mro.capability_match",
            serde_json::json!({"case_id": case_id, "facility_id": Uuid::new_v4()}),
            "match_score",
        ),
        (
            "mxg.compliance.return_to_service_pack",
            serde_json::json!({"case_id": case_id}),
            "review_metadata",
        ),
    ];
    for (name, arguments, nullable_field) in calls {
        let result = dispatch(
            &dispatcher,
            "tools/call",
            serde_json::json!({"name": name, "arguments": arguments}),
        )
        .await;
        assert_eq!(result["status"], "partial");
        assert_eq!(result["warnings"][0]["code"], "NOT_CONFIGURED");
        assert!(result["output"][nullable_field].is_null(), "{name}");
    }
}

#[tokio::test]
async fn tools_publish_authoritative_schemas() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(&d, "tools/list", serde_json::json!({})).await;
    let lookup = r["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "mxg.aircraft.lookup")
        .expect("lookup in list");
    let props = lookup["inputSchema"]["properties"]
        .as_object()
        .expect("properties object");
    assert!(
        props.contains_key("registration")
            || props.contains_key("serial_number")
            || props.contains_key("source_id")
    );
    let oprops = lookup["outputSchema"]["properties"]
        .as_object()
        .expect("output properties");
    assert!(
        oprops.contains_key("output"),
        "outputSchema must wrap typed output"
    );
}

#[tokio::test]
async fn no_tool_input_schema_exposes_trusted_context_controls() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(&d, "tools/list", serde_json::json!({})).await;
    let forbidden = [
        "confirm",
        "human_confirmed",
        "approval_granted",
        "tenant",
        "tenant_id",
        "organization_id",
        "user_id",
        "actor",
        "actor_user_id",
        "role",
    ];
    for tool in r["tools"].as_array().expect("tools array") {
        let serialized = tool["inputSchema"].to_string();
        for field in forbidden {
            assert!(
                !serialized.contains(&format!("\"{field}\"")),
                "{} input schema exposes trusted field {field}",
                tool["name"]
            );
        }
    }
}

#[tokio::test]
async fn tool_arguments_cannot_spoof_trusted_confirmation() {
    let (d, _) = dispatcher_with_trust(Role::Administrator, false, false);
    let resp = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.create",
                "arguments": {
                    "aircraft_id": "aircraft:fixture-001",
                    "raw_discrepancy": "spoof attempt",
                    "priority": "routine",
                    "confirm": true
                }
            }),
        ))
        .await
        .expect("response");
    let err = resp.error.expect("spoofing error");
    assert!(err.message.contains("INVALID_INPUT"));
}

#[tokio::test]
async fn global_policy_denies_viewer_case_mutation() {
    let (d, service) = dispatcher_with_trust(Role::Viewer, true, true);
    let resp = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.create",
                "arguments": {
                    "aircraft_id": "aircraft:fixture-001",
                    "raw_discrepancy": "unauthorized",
                    "priority": "routine"
                }
            }),
        ))
        .await
        .expect("response");
    let err = resp.error.expect("access denied");
    assert!(err.message.contains("ACCESS_DENIED"));
    assert_eq!(service.list_for_org(OrganizationId(Uuid::nil())).len(), 0);
}

#[tokio::test]
async fn stub_tool_rejects_when_required_field_missing() {
    let (d, _, _) = fresh_dispatcher();
    // Empty arguments object: no registration, no serial, no source_id -> INVALID_INPUT
    let resp = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.aircraft.lookup", "arguments": {}
            }),
        ))
        .await
        .expect("response");
    let err = resp.error.expect("error");
    assert_eq!(err.code, -32603, "internal: must be 500-shaped error");
    assert!(err.message.contains("INVALID_INPUT"));
}

#[tokio::test]
async fn aircraft_lookup_unambiguous_returns_single_match() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.lookup",
            "arguments": { "registration": "N100FX" }
        }),
    )
    .await;
    assert_eq!(r["status"], "ok");
    assert!(
        r["output"]["aircraft_id"].is_string(),
        "unambiguous match must include aircraft_id"
    );
    assert_eq!(r["output"]["matches"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn aircraft_lookup_unknown_returns_no_canonical_id_and_warning() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.lookup",
            "arguments": { "registration": "N0MISSING" }
        }),
    )
    .await;
    assert!(r["output"]["aircraft_id"].is_null());
    assert!(r["output"]["matches"].as_array().unwrap().is_empty());
    assert_eq!(r["warnings"][0]["code"], "ENTITY_NOT_FOUND");
}

#[tokio::test]
async fn first_wave_contracts_enforce_lengths_ranges_and_cross_field_rules() {
    let (dispatcher, _, _) = fresh_dispatcher();
    let cases = [
        serde_json::json!({
            "name": "mxg.aircraft.lookup",
            "arguments": {"registration": "   "}
        }),
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "",
                "priority": "routine"
            }
        }),
        serde_json::json!({
            "name": "mxg.maintenance_case.similar_cases",
            "arguments": {"limit": 0}
        }),
        serde_json::json!({
            "name": "mxg.evidence.collect",
            "arguments": {"raw_items": []}
        }),
    ];

    for params in cases {
        let response = dispatcher
            .dispatch(rpc("tools/call", params))
            .await
            .expect("response");
        let error = response.error.expect("invalid input must fail");
        assert!(error.message.contains("INVALID_INPUT"), "{}", error.message);
    }
}

#[tokio::test]
async fn aircraft_lookup_conflicting_identifiers_returns_ambiguous_match() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.lookup",
            "arguments": {
                "registration": "N100FX",
                "serial_number": "FX-9002"
            }
        }),
    )
    .await;
    assert!(r["output"]["aircraft_id"].is_null());
    assert_eq!(r["output"]["matches"].as_array().unwrap().len(), 2);
    assert_eq!(r["warnings"][0]["code"], "AMBIGUOUS_MATCH");
}

#[test]
fn all_50_tool_schemas_match_the_locked_snapshot() {
    use sha2::Digest;
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let registry = default_registry(cs, ev);
    let snapshot: Vec<serde_json::Value> = registry
        .list_tools()
        .into_iter()
        .map(|tool| {
            serde_json::json!({
                "name": tool.name,
                "input": tool.input_schema,
                "output": tool.output_schema,
                "input_version": tool.input_schema_version,
                "output_version": tool.output_schema_version,
                "domain_version": tool.domain_schema_version
            })
        })
        .collect();
    let encoded = serde_json::to_vec(&snapshot).unwrap();
    let actual = hex::encode(sha2::Sha256::digest(encoded));
    assert_eq!(
        actual, "707e9a61a87b93d8c683dbe0e8558aecb67694de02a3f014cd13c4c775de117c",
        "schema snapshot changed: {actual}"
    );
}

#[tokio::test]
async fn aircraft_profile_returns_typed_facts_for_known_aircraft() {
    let (d, _, _) = fresh_dispatcher();
    // First find the canonical id
    let lookup = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.lookup", "arguments": { "registration": "N100FX" }
        }),
    )
    .await;
    let aircraft_id = lookup["output"]["aircraft_id"]
        .as_str()
        .unwrap()
        .to_string();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.aircraft.profile",
            "arguments": { "aircraft_id": aircraft_id }
        }),
    )
    .await;
    assert!(matches!(r["status"].as_str(), Some("ok") | Some("partial")));
    let ov = &r["output"];
    assert!(ov["aircraft_id"].is_string());
    assert!(ov["make"].is_string() || ov["make"].is_null());
    assert!(ov["source_freshness"].is_null());
    assert_eq!(
        r["evidence"][0]["source_reference"],
        "fixture://jetnet/profile"
    );
    assert_ne!(
        r["evidence"][0]["content_hash"],
        "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    );
    assert!(!r["evidence"][0]["content"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn case_context_marks_fixture_currency_unverified_and_cites_real_content() {
    let (dispatcher, _, _) = fresh_dispatcher();
    let created = dispatch(
        &dispatcher,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "fixture provenance test",
                "priority": "routine"
            }
        }),
    )
    .await;
    let case_id = created["output"]["case"]["case_id"].as_str().unwrap();
    let context = dispatch(
        &dispatcher,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.build_context",
            "arguments": {
                "case_id": case_id,
                "include": {
                    "documents": true,
                    "compliance": false,
                    "weather": false,
                    "parts": false,
                    "facilities": false,
                    "timeline": true
                }
            }
        }),
    )
    .await;
    for document in context["output"]["documents"].as_array().unwrap() {
        assert_eq!(document["currency_state"], "fixture_unverified");
    }
    for evidence in context["evidence"].as_array().unwrap() {
        assert!(evidence["source_reference"]
            .as_str()
            .unwrap()
            .starts_with("fixture://manual_corpus/"));
        assert!(!evidence["content"].as_str().unwrap().is_empty());
    }
    let envelope_ids: std::collections::BTreeSet<&str> = context["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|evidence| evidence["evidence_id"].as_str())
        .collect();
    for link in context["output"]["evidence_map"].as_array().unwrap() {
        assert!(envelope_ids.contains(link["evidence_id"].as_str().unwrap()));
    }
}

#[tokio::test]
async fn first_vertical_slice_case_create_get_reopen() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "Hydraulic leak observed during preflight",
                "priority": "aog"
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "ok");
    let case_id = r["output"]["case"]["case_id"].as_str().unwrap().to_string();
    let r2 = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.get", "arguments": { "case_id": case_id }
        }),
    )
    .await;
    assert_eq!(r2["status"], "ok");
    assert_eq!(r2["output"]["case"]["priority"], "aog");
    assert_eq!(r2["output"]["case"]["status"], "open");
    assert_eq!(r2["output"]["case"]["version"], 1);
}

#[tokio::test]
async fn attach_observation_persists_original_text_event_audit_and_trace() {
    let (d, service, _) = fresh_dispatcher();
    let created = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "Hydraulic leak",
                "priority": "aog"
            }
        }),
    )
    .await;
    let case_id = created["output"]["case"]["case_id"].as_str().unwrap();
    let original = "Observed blue hydraulic fluid below the left gear bay.";
    let attached = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.attach_observation",
            "arguments": {
                "case_id": case_id,
                "note": original,
                "component_id": "zone:left-gear-bay",
                "media_refs": ["media://fixture/leak-001"]
            }
        }),
    )
    .await;
    assert_eq!(attached["status"], "ok");
    let observation_id =
        Uuid::parse_str(attached["output"]["observation_id"].as_str().unwrap()).unwrap();
    let stored = service
        .observation(OrganizationId(Uuid::nil()), observation_id)
        .expect("persisted observation");
    assert_eq!(stored.original_note, original);
    assert_eq!(stored.media_refs, vec!["media://fixture/leak-001"]);
    assert_eq!(service.mutation_counts(), (1, 2, 2, 2));
}

#[tokio::test]
async fn mutation_rolls_back_when_event_audit_or_trace_persistence_fails() {
    use mxgenius_mcp::application::case_service::MutationWriteStage;

    for stage in [
        MutationWriteStage::Event,
        MutationWriteStage::Audit,
        MutationWriteStage::Trace,
    ] {
        let (d, service, _) = fresh_dispatcher();
        let created = dispatch(
            &d,
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.create",
                "arguments": {
                    "aircraft_id": "aircraft:fixture-001",
                    "raw_discrepancy": "atomic rollback test",
                    "priority": "routine"
                }
            }),
        )
        .await;
        let case_id: mxgenius_shared::domain::ids::CaseId = created["output"]["case"]["case_id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        let before_counts = service.mutation_counts();
        let before_case = service
            .get(OrganizationId(Uuid::nil()), case_id)
            .unwrap()
            .case;

        service.fail_next_mutation_at(stage);
        let response = d
            .dispatch(rpc(
                "tools/call",
                serde_json::json!({
                    "name": "mxg.maintenance_case.attach_observation",
                    "arguments": {
                        "case_id": case_id,
                        "note": "must roll back",
                        "media_refs": []
                    }
                }),
            ))
            .await
            .expect("response");
        assert!(response.error.is_some(), "{stage:?} failure must surface");
        assert_eq!(service.mutation_counts(), before_counts);
        let after_case = service
            .get(OrganizationId(Uuid::nil()), case_id)
            .unwrap()
            .case;
        assert_eq!(after_case.version, before_case.version);
        assert_eq!(after_case.evidence_ids, before_case.evidence_ids);
    }
}

#[tokio::test]
async fn illegal_state_transition_rejected() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "test",
                "priority": "routine"
            }
        }),
    )
    .await;
    let case_id = r["output"]["case"]["case_id"].as_str().unwrap().to_string();
    // open -> closed is illegal (must traverse triage/diagnosing/...)
    let resp = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.update_status",
                "arguments": {
                    "case_id": case_id,
                    "target_status": "closed",
                    "expected_version": 1
                }
            }),
        ))
        .await
        .expect("response");
    let err = resp.error.expect("illegal transition error");
    assert!(
        err.message.contains("INVALID_STATE_TRANSITION"),
        "expected INVALID_STATE_TRANSITION, got: {}",
        err.message
    );
}

#[tokio::test]
async fn stale_version_rejected() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "test",
                "priority": "routine"
            }
        }),
    )
    .await;
    let case_id = r["output"]["case"]["case_id"].as_str().unwrap().to_string();
    let resp = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.update_status",
                "arguments": {
                    "case_id": case_id,
                    "target_status": "triage",
                    "expected_version": 99
                }
            }),
        ))
        .await
        .expect("response");
    let err = resp.error.expect("stale version error");
    assert!(
        err.message.contains("VERSION_CONFLICT"),
        "expected stale version error, got: {}",
        err.message
    );
}

#[tokio::test]
async fn closing_case_requires_trusted_qualified_approval() {
    let (d, _) = dispatcher_with_trust(Role::Administrator, true, false);
    let created = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "approval rail test",
                "priority": "routine"
            }
        }),
    )
    .await;
    let case_id = created["output"]["case"]["case_id"].as_str().unwrap();
    let path = [
        "triage",
        "diagnosing",
        "planning",
        "scheduled",
        "in_work",
        "awaiting_inspection",
        "awaiting_approval",
    ];
    let mut version = 1;
    for target in path {
        let updated = dispatch(
            &d,
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.update_status",
                "arguments": {
                    "case_id": case_id,
                    "target_status": target,
                    "expected_version": version
                }
            }),
        )
        .await;
        version = updated["output"]["new_version"].as_i64().unwrap();
    }
    let resp = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.update_status",
                "arguments": {
                    "case_id": case_id,
                    "target_status": "closed",
                    "expected_version": version
                }
            }),
        ))
        .await
        .expect("response");
    let err = resp.error.expect("approval precondition");
    assert!(err.message.contains("HUMAN_APPROVAL_REQUIRED"));
}

#[tokio::test]
async fn missing_confirmation_rejected() {
    let (d, _) = dispatcher_with_trust(Role::Administrator, false, false);
    let resp = d
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.create",
                "arguments": {
                    "aircraft_id": "aircraft:fixture-001",
                    "raw_discrepancy": "test",
                    "priority": "routine"
                }
            }),
        ))
        .await
        .expect("response");
    let err = resp.error.expect("missing confirmation error");
    assert!(
        err.message.contains("HUMAN_APPROVAL_REQUIRED"),
        "expected HUMAN_APPROVAL_REQUIRED, got: {}",
        err.message
    );
}

#[tokio::test]
async fn trusted_confirmation_is_bound_to_tool_object_version_and_expiry() {
    use mxgenius_shared::application::context::TrustedConfirmation;

    let evidence = Arc::new(EvidenceService::new());
    let cases = Arc::new(InMemoryCaseService::new((*evidence).clone()));
    let grant = TrustedConfirmation {
        grant_id: Uuid::new_v4(),
        tool_name: "mxg.maintenance_case.create".into(),
        object_id: "aircraft:fixture-001".into(),
        object_version: None,
        expires_at: time::OffsetDateTime::now_utc() + time::Duration::minutes(5),
        qualified_approval: false,
    };
    let dispatcher = Dispatcher::new(
        default_registry(cases, evidence),
        Arc::new(InsecureLocalProvider::with_trusted_confirmation(
            Role::Administrator,
            grant,
        )),
    );

    let mismatched = dispatcher
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.maintenance_case.create",
                "arguments": {
                    "aircraft_id": "aircraft:other",
                    "raw_discrepancy": "must not consume another object's grant",
                    "priority": "routine"
                }
            }),
        ))
        .await
        .unwrap();
    assert!(mismatched
        .error
        .unwrap()
        .message
        .contains("HUMAN_APPROVAL_REQUIRED"));

    let matched = dispatch(
        &dispatcher,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "bound confirmation succeeds",
                "priority": "routine"
            }
        }),
    )
    .await;
    assert_eq!(matched["status"], "ok");
}

#[tokio::test]
async fn evidence_collect_dedup_by_content_hash() {
    let (d, _, _) = fresh_dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.evidence.collect",
            "arguments": {
                "raw_items": [
                    {
                        "source_type": "manual",
                        "source_reference": "fixture://manual/excerpt",
                        "kind": "manual_excerpt",
                        "title": "test",
                        "excerpt": "hello world",
                        "content": "duplicate content"
                    },
                    {
                        "source_type": "manual",
                        "source_reference": "fixture://manual/excerpt",
                        "kind": "manual_excerpt",
                        "title": "test",
                        "excerpt": "hello world",
                        "content": "duplicate content"
                    }
                ]
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "ok");
    assert_eq!(r["output"]["deduplicated_count"], 1);
    assert_eq!(r["output"]["evidence"].as_array().unwrap().len(), 1);
}

#[test]
fn evidence_hash_deduplication_is_tenant_scoped() {
    use mxgenius_mcp::application::evidence_service::EvidenceRecord;
    use mxgenius_shared::domain::datetime::UtcDateTime;
    use mxgenius_shared::domain::ids::EvidenceId;
    let service = EvidenceService::new();
    let org_a = OrganizationId(Uuid::new_v4());
    let org_b = OrganizationId(Uuid::new_v4());
    let record = EvidenceRecord {
        evidence_id: EvidenceId(Uuid::new_v4()),
        source_type: "manual".into(),
        source_reference: "fixture://manual/same".into(),
        kind: "manual_excerpt".into(),
        title: "Same licensed content".into(),
        excerpt: None,
        retrieved_at: UtcDateTime::from(time::OffsetDateTime::now_utc()),
        effective_at: None,
        revision: None,
        license_scope: Some("tenant".into()),
        content_hash: "sha256:same".into(),
        content: "same licensed content".into(),
    };
    service.append(record.clone(), org_a, None);
    assert!(service.exists_by_hash("sha256:same", org_a));
    assert!(!service.exists_by_hash("sha256:same", org_b));
    let mut second = record;
    second.evidence_id = EvidenceId(Uuid::new_v4());
    service.append(second, org_b, None);
    assert_eq!(service.count_for_org(org_a), 1);
    assert_eq!(service.count_for_org(org_b), 1);
}

#[tokio::test]
async fn notification_does_not_return_response() {
    use mxgenius_mcp::context::OidcProvider;
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let reg = default_registry(cs, ev);
    let d = Dispatcher::new(
        reg,
        Arc::new(InsecureLocalProvider::new(Role::Administrator)),
    );
    // ID null -> notification -> no response
    let req = mxgenius_mcp::dispatcher::JsonRpcRequest {
        jsonrpc: "2.0".into(),
        method: "tools/list".into(),
        params: serde_json::json!({}),
        id: serde_json::Value::Null,
    };
    let resp = d.dispatch(req).await;
    assert!(resp.is_none(), "notification must not produce a response");
    // With Oidc, an auth-required request also returns no response on a notification.
    let d2 = Dispatcher::new(
        default_registry(
            Arc::new(InMemoryCaseService::new(EvidenceService::new())),
            Arc::new(EvidenceService::new()),
        ),
        Arc::new(OidcProvider::unconfigured()),
    );
    let req2 = mxgenius_mcp::dispatcher::JsonRpcRequest {
        jsonrpc: "2.0".into(),
        method: "tools/list".into(),
        params: serde_json::json!({}),
        id: serde_json::Value::Null,
    };
    let resp2 = d2.dispatch(req2).await;
    assert!(
        resp2.is_none(),
        "auth-required notification must not produce a response"
    );
}

#[tokio::test]
async fn jsonrpc_id_is_preserved() {
    let (d, _, _) = fresh_dispatcher();
    let req = mxgenius_mcp::dispatcher::JsonRpcRequest {
        jsonrpc: "2.0".into(),
        method: "initialize".into(),
        params: serde_json::json!({}),
        id: serde_json::json!(42),
    };
    let resp = d.dispatch(req).await.expect("response");
    assert_eq!(resp.id, serde_json::json!(42));
}

#[tokio::test]
async fn http_stdio_dispatch_yields_identical_results() {
    // HTTP path
    let (d1, _, _) = fresh_dispatcher();
    let http_resp = d1
        .dispatch(rpc("initialize", serde_json::json!({})))
        .await
        .expect("http resp");
    let http_result = http_resp.result.clone().unwrap();

    // Stdio path uses the same dispatcher
    let (d2, _, _) = fresh_dispatcher();
    let stdio_resp = d2
        .dispatch(rpc("initialize", serde_json::json!({})))
        .await
        .expect("stdio resp");
    let stdio_result = stdio_resp.result.clone().unwrap();

    assert_eq!(
        http_result["protocolVersion"],
        stdio_result["protocolVersion"]
    );
    assert_eq!(http_result["serverInfo"], stdio_result["serverInfo"]);
}

#[tokio::test]
async fn streamable_http_returns_json_and_notification_202_without_body() {
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt;

    let (dispatcher, _, _) = fresh_dispatcher();
    let app = mxgenius_mcp::transport::http::router(dispatcher);
    let initialize = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .body(Body::from(
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": "init-1",
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"}
                }
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(initialize).await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-type"], "application/json");
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["id"], "init-1");
    assert_eq!(json["result"]["protocolVersion"], "2025-11-25");

    let notification = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2025-11-25")
        .body(Body::from(
            serde_json::json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.oneshot(notification).await.unwrap();
    assert_eq!(response.status(), 202);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(body.is_empty());
}

#[tokio::test]
async fn authenticated_application_orchestration_runs_the_first_case_slice() {
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt;

    let (dispatcher, _, _) = fresh_dispatcher();
    let request = Request::builder()
        .method("POST")
        .uri("/orchestration/cases/first-slice")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({
                "registration": "N100FX",
                "discrepancy": "Hydraulic pressure low during gear retraction",
                "priority": "urgent"
            })
            .to_string(),
        ))
        .unwrap();
    let response = mxgenius_mcp::transport::http::router(dispatcher)
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(value["case_id"].is_string());
    assert!(value["aircraft"]["aircraft_id"].is_string());
    assert_eq!(value["aircraft"]["matches"][0]["registration"], "N100FX");
    assert_eq!(
        value["case"]["raw_discrepancy"],
        "Hydraulic pressure low during gear retraction"
    );
    assert_eq!(value["case"]["priority"], "urgent");
    assert!(value["context"]["timeline"].is_array());
    assert_eq!(value["trace"].as_array().unwrap().len(), 4);
    assert_eq!(value["trace"][0]["tool"], "mxg.aircraft.lookup");
    assert_eq!(
        value["trace"][3]["tool"],
        "mxg.maintenance_case.build_context"
    );
}

#[tokio::test]
async fn realtime_call_boundary_rejects_invalid_origin_content_type_and_sdp() {
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    let (dispatcher, _, _) = fresh_dispatcher();
    let invalid_origin = Request::builder()
        .method("POST")
        .uri("/realtime/calls")
        .header("content-type", "application/sdp")
        .header("origin", "https://attacker.invalid")
        .body(Body::from("v=0\r\n"))
        .unwrap();
    assert_eq!(
        mxgenius_mcp::transport::http::router(dispatcher)
            .oneshot(invalid_origin)
            .await
            .unwrap()
            .status(),
        403
    );

    let (dispatcher, _, _) = fresh_dispatcher();
    let invalid_content_type = Request::builder()
        .method("POST")
        .uri("/realtime/calls")
        .header("content-type", "application/json")
        .body(Body::from("v=0\r\n"))
        .unwrap();
    assert_eq!(
        mxgenius_mcp::transport::http::router(dispatcher)
            .oneshot(invalid_content_type)
            .await
            .unwrap()
            .status(),
        415
    );

    let (dispatcher, _, _) = fresh_dispatcher();
    let invalid_sdp = Request::builder()
        .method("POST")
        .uri("/realtime/calls")
        .header("content-type", "application/sdp")
        .body(Body::from("not-sdp"))
        .unwrap();
    assert_eq!(
        mxgenius_mcp::transport::http::router(dispatcher)
            .oneshot(invalid_sdp)
            .await
            .unwrap()
            .status(),
        400
    );
}

#[tokio::test]
async fn confirmation_issuance_fails_closed_without_production_grant_storage() {
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt;

    let (dispatcher, _, _) = fresh_dispatcher();
    let request = Request::builder()
        .method("POST")
        .uri("/confirmations")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({
                "tool_name": "mxg.maintenance_case.update_status",
                "arguments": {
                    "case_id": Uuid::new_v4(),
                    "target_status": "open",
                    "expected_version": 1
                }
            })
            .to_string(),
        ))
        .unwrap();
    let response = mxgenius_mcp::transport::http::router(dispatcher)
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), 503);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["error"]["code"], "CONFIRMATIONS_NOT_CONFIGURED");
}

#[tokio::test]
async fn confirmed_digital_twin_marker_is_persisted_for_a_canonical_case_target() {
    let (dispatcher, cases, _) = fresh_dispatcher();
    let created = dispatch(
        &dispatcher,
        "tools/call",
        serde_json::json!({
            "name": "mxg.maintenance_case.create",
            "arguments": {
                "aircraft_id": "aircraft:fixture-001",
                "raw_discrepancy": "marker persistence test",
                "priority": "routine"
            }
        }),
    )
    .await;
    let case_id = created["output"]["case"]["case_id"].as_str().unwrap();
    let marker = dispatch(
        &dispatcher,
        "tools/call",
        serde_json::json!({
            "name": "mxg.digital_twin.attach_case_marker",
            "arguments": {
                "case_id": case_id,
                "component_id": "component:hydraulic-pump-1",
                "severity": "high"
            }
        }),
    )
    .await;
    assert_eq!(marker["status"], "ok");
    assert!(marker["output"]["marker_id"].is_string());
    assert!(marker["output"]["audit_event_id"].is_string());
    assert!(marker["output"]["created_at"].is_string());
    assert_eq!(cases.twin_marker_count(), 1);
}

#[tokio::test]
async fn digital_twin_marker_rejects_unmapped_target_shape() {
    let (dispatcher, _, _) = fresh_dispatcher();
    let response = dispatcher
        .dispatch(rpc(
            "tools/call",
            serde_json::json!({
                "name": "mxg.digital_twin.attach_case_marker",
                "arguments": {
                    "case_id": Uuid::new_v4(),
                    "severity": "info"
                }
            }),
        ))
        .await
        .unwrap();
    assert!(response.error.is_some());
    assert!(response
        .error
        .unwrap()
        .message
        .contains("component_id or zone_id is required"));
}

#[tokio::test]
async fn streamable_http_enforces_accept_origin_version_and_get_behavior() {
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    let request_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    })
    .to_string();

    let (d1, _, _) = fresh_dispatcher();
    let missing_accept = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("content-type", "application/json")
        .body(Body::from(request_body.clone()))
        .unwrap();
    assert_eq!(
        mxgenius_mcp::transport::http::router(d1)
            .oneshot(missing_accept)
            .await
            .unwrap()
            .status(),
        406
    );

    let (d2, _, _) = fresh_dispatcher();
    let bad_origin = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("origin", "https://attacker.invalid")
        .body(Body::from(request_body.clone()))
        .unwrap();
    assert_eq!(
        mxgenius_mcp::transport::http::router(d2)
            .oneshot(bad_origin)
            .await
            .unwrap()
            .status(),
        403
    );

    let (d3, _, _) = fresh_dispatcher();
    let bad_version = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2024-11-05")
        .body(Body::from(request_body))
        .unwrap();
    assert_eq!(
        mxgenius_mcp::transport::http::router(d3)
            .oneshot(bad_version)
            .await
            .unwrap()
            .status(),
        400
    );

    let (d4, _, _) = fresh_dispatcher();
    let get = Request::builder()
        .method("GET")
        .uri("/mcp")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        mxgenius_mcp::transport::http::router(d4)
            .oneshot(get)
            .await
            .unwrap()
            .status(),
        405
    );
}

#[tokio::test]
async fn health_readiness_and_adapter_endpoints_are_distinct() {
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt;

    let (dispatcher, _, _) = fresh_dispatcher();
    let app = mxgenius_mcp::transport::http::router(dispatcher);
    let health = app
        .clone()
        .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(health.status(), 200);
    assert_eq!(
        to_bytes(health.into_body(), usize::MAX).await.unwrap(),
        "ok"
    );

    let ready = app
        .clone()
        .oneshot(Request::get("/readyz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(ready.status(), 200);
    let ready: serde_json::Value =
        serde_json::from_slice(&to_bytes(ready.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(ready["ready"], true);
    assert_eq!(ready["mode"], "local");

    let adapters = app
        .oneshot(Request::get("/adapterz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(adapters.status(), 200);
    let adapters: serde_json::Value =
        serde_json::from_slice(&to_bytes(adapters.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(adapters["core"]["persistence"], "in_memory");
    assert_eq!(adapters["adapters"]["weather"], "not_configured");
}

#[tokio::test]
async fn streamable_http_handles_malformed_content_auth_resources_and_prompts() {
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use mxgenius_mcp::context::OidcProvider;
    use tower::ServiceExt;

    fn post(body: impl Into<Body>) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/mcp")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2025-11-25")
            .body(body.into())
            .unwrap()
    }

    let (dispatcher, _, _) = fresh_dispatcher();
    let app = mxgenius_mcp::transport::http::router(dispatcher);
    let malformed = app
        .clone()
        .oneshot(post(Body::from("{broken")))
        .await
        .unwrap();
    assert_eq!(malformed.status(), 400);

    let wrong_content_type = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("content-type", "text/plain")
        .header("accept", "application/json, text/event-stream")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(wrong_content_type)
            .await
            .unwrap()
            .status(),
        415
    );

    for (method, collection, expected_len) in [
        ("resources/list", "resources", 16_u64),
        ("prompts/list", "prompts", 8_u64),
    ] {
        let response = app
            .clone()
            .oneshot(post(Body::from(
                serde_json::json!({
                    "jsonrpc": "2.0", "id": method, "method": method, "params": {}
                })
                .to_string(),
            )))
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            json["result"][collection].as_array().unwrap().len() as u64,
            expected_len
        );
    }

    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let unauthenticated = Dispatcher::new(
        default_registry(cs, ev),
        Arc::new(OidcProvider::unconfigured()),
    );
    let response = mxgenius_mcp::transport::http::router(unauthenticated)
        .oneshot(post(Body::from(
            serde_json::json!({
                "jsonrpc": "2.0", "id": "auth", "method": "tools/list", "params": {}
            })
            .to_string(),
        )))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["code"], -32001);
    assert_eq!(json["error"]["data"]["stable_code"], "AUTH_REQUIRED");
}

#[tokio::test]
async fn stdio_transport_emits_no_line_for_notifications_and_preserves_id() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (dispatcher, _, _) = fresh_dispatcher();
    let (mut input_client, input_server) = tokio::io::duplex(4096);
    let (output_server, mut output_client) = tokio::io::duplex(4096);
    let task = tokio::spawn(mxgenius_mcp::transport::stdio::run_io(
        input_server,
        output_server,
        dispatcher,
    ));
    let payload = format!(
        "{}\n{}\n",
        serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }),
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": "stdio-42",
            "method": "initialize",
            "params": {"protocolVersion": "2025-11-25"}
        })
    );
    input_client.write_all(payload.as_bytes()).await.unwrap();
    input_client.shutdown().await.unwrap();
    let mut output = Vec::new();
    output_client.read_to_end(&mut output).await.unwrap();
    task.await.unwrap().unwrap();
    let lines: Vec<&str> = std::str::from_utf8(&output).unwrap().lines().collect();
    assert_eq!(lines.len(), 1, "notification must not emit a null line");
    let response: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(response["id"], "stdio-42");
    assert_eq!(response["result"]["protocolVersion"], "2025-11-25");
}

// Lint satisfaction
#[allow(dead_code)]
fn _refs(_: EnvelopeStatus, _: ClientIdentity, _: OrganizationId, _: UserId, _: Uuid) {}
