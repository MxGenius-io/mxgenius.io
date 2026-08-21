//! Wave 3 limit tests: weather tools remain typed but `not_configured`,
//! and every weather tool returns a `partial` envelope carrying a
//! `NOT_CONFIGURED` warning rather than inventing an observation.
//!
//! In default_registry (no Postgres pool) the weather family is
//! `not_configured`, so tools/list metadata and runtime behavior must agree.

use mxgenius_mcp::application::case_service::InMemoryCaseService;
use mxgenius_mcp::application::evidence_service::EvidenceService;
use mxgenius_mcp::context::InsecureLocalProvider;
use mxgenius_mcp::registry::{default_registry, server_info};
use mxgenius_mcp::Dispatcher;
use mxgenius_shared::application::policy::Role;
use std::sync::Arc;

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

fn dispatcher() -> Dispatcher {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    Dispatcher::new(
        default_registry(cs, ev),
        Arc::new(InsecureLocalProvider::new(Role::Administrator)),
    )
}

#[test]
fn all_five_weather_tools_remain_not_configured_in_default_registry() {
    let ev = Arc::new(EvidenceService::new());
    let cs = Arc::new(InMemoryCaseService::new((*ev).clone()));
    let reg = default_registry(cs, ev);
    let info = server_info(&reg);
    assert_eq!(info.tool_count, 45);
    let availability: std::collections::BTreeMap<String, String> = reg
        .list_tools()
        .into_iter()
        .map(|t| (t.name.clone(), t.availability.clone()))
        .collect();
    for name in [
        "mxg.weather.airport_now",
        "mxg.weather.maintenance_window",
        "mxg.weather.ramp_risk",
        "mxg.weather.ferry_assessment",
        "mxg.weather.hazard_overlay",
    ] {
        assert_eq!(
            availability.get(name).map(String::as_str),
            Some("not_configured"),
            "{name} must be not_configured"
        );
    }
}

#[tokio::test]
async fn weather_ramp_risk_emits_typed_partial_with_null_score() {
    let d = dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.weather.ramp_risk",
            "arguments": {
                "airport_icao": "KJFK",
                "start": "2026-07-19T08:00:00Z",
                "duration_minutes": 60,
                "work_type": "inspection"
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "NOT_CONFIGURED");
    assert!(r["output"]["risk_level"].is_null());
    assert_eq!(r["output"]["advisory_only"], true);
}

#[tokio::test]
async fn weather_airport_now_returns_typed_partial_without_invented_metar() {
    let d = dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.weather.airport_now",
            "arguments": { "airport_icao": "KBOS" }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "NOT_CONFIGURED");
    assert!(r["output"]["metar"].is_null());
    assert!(r["output"]["taf"].is_null());
    assert!(r["output"]["flight_category"].is_null());
    assert_eq!(r["output"]["source"], "not_configured");
}

#[tokio::test]
async fn weather_ferry_assessment_returns_typed_partial_advisory() {
    let d = dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.weather.ferry_assessment",
            "arguments": {
                "origin": "KBOS",
                "destination": "KJFK",
                "departure_window_start": "2026-07-19T08:00:00Z",
                "departure_window_end": "2026-07-19T17:00:00Z"
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["output"]["advisory_only"], true);
    assert!(r["output"]["constraints"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn weather_hazard_overlay_returns_typed_partial() {
    let d = dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.weather.hazard_overlay",
            "arguments": {
                "bounding_box": {
                    "min_lat": 40.0, "min_lon": -75.0,
                    "max_lat": 45.0, "max_lon": -70.0
                },
                "time": "2026-07-19T08:00:00Z",
                "kinds": ["convective"]
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "NOT_CONFIGURED");
    assert!(r["output"]["hazards"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn weather_maintenance_window_returns_typed_partial() {
    let d = dispatcher();
    let r = dispatch(
        &d,
        "tools/call",
        serde_json::json!({
            "name": "mxg.weather.maintenance_window",
            "arguments": {
                "airport_icao": "KBOS",
                "start": "2026-07-19T08:00:00Z",
                "end": "2026-07-19T17:00:00Z",
                "work_type": "inspection"
            }
        }),
    )
    .await;
    assert_eq!(r["status"], "partial");
    assert_eq!(r["warnings"][0]["code"], "NOT_CONFIGURED");
    assert!(r["output"]["windows"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn tools_list_continues_to_agree_with_invocation_for_weather() {
    // tools/list metadata and runtime behavior must agree. We verify this by
    // checking that every `not_configured` tool produces a `partial` envelope
    // with a `NOT_CONFIGURED` warning.
    let d = dispatcher();
    let cases = vec![
        (
            "mxg.weather.airport_now",
            serde_json::json!({"airport_icao": "KBOS"}),
        ),
        (
            "mxg.weather.maintenance_window",
            serde_json::json!({
                "airport_icao": "KBOS", "start": "2026-07-19T08:00:00Z",
                "end": "2026-07-19T17:00:00Z", "work_type": "inspection"
            }),
        ),
        (
            "mxg.weather.ramp_risk",
            serde_json::json!({
                "airport_icao": "KBOS", "start": "2026-07-19T08:00:00Z",
                "duration_minutes": 60, "work_type": "inspection"
            }),
        ),
        (
            "mxg.weather.ferry_assessment",
            serde_json::json!({
                "origin": "KBOS", "destination": "KJFK",
                "departure_window_start": "2026-07-19T08:00:00Z",
                "departure_window_end": "2026-07-19T17:00:00Z"
            }),
        ),
        (
            "mxg.weather.hazard_overlay",
            serde_json::json!({
                "bounding_box": {"min_lat": 40.0, "min_lon": -75.0, "max_lat": 45.0, "max_lon": -70.0},
                "time": "2026-07-19T08:00:00Z", "kinds": ["convective"]
            }),
        ),
    ];
    for (tool, arguments) in cases {
        let result = dispatch(
            &d,
            "tools/call",
            serde_json::json!({"name": tool, "arguments": arguments}),
        )
        .await;
        assert_eq!(result["status"], "partial", "{tool}");
        assert_eq!(result["warnings"][0]["code"], "NOT_CONFIGURED", "{tool}");
    }
}
