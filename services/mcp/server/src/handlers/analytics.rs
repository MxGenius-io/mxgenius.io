//! Analytics tool handlers (4): `mxg.analytics.*`.

use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    AnalyticsExecKpisRequest, AnalyticsExecKpisResponse, AnalyticsFleetHealthRequest,
    AnalyticsFleetHealthResponse, AnalyticsPartsRiskRequest, AnalyticsPartsRiskResponse,
    AnalyticsRepeatDefectsRequest, AnalyticsRepeatDefectsResponse,
};

use crate::handlers::not_configured;
use crate::registry::Registry;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry) {
    reg.register_typed_tool(wrap(not_configured::<
        AnalyticsFleetHealthRequest,
        AnalyticsFleetHealthResponse,
        _,
    >(
        "mxg.analytics.fleet_health",
        "Fleet Health",
        "Return defined fleet-health metrics, segments, freshness, drill-through IDs, limitations.",
        Action::AnalyticsRead,
        |_input| AnalyticsFleetHealthResponse {
            metrics: vec![],
            segments: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<AnalyticsRepeatDefectsRequest, AnalyticsRepeatDefectsResponse, _>(
        "mxg.analytics.repeat_defects",
        "Repeat Defects",
        "Return recurring normalized defects, counts, intervals, outcomes, sample sizes, drill-through cases.",
        Action::AnalyticsRead,
        |_input| AnalyticsRepeatDefectsResponse { defects: vec![] },
    )));
    reg.register_typed_tool(wrap(not_configured::<AnalyticsPartsRiskRequest, AnalyticsPartsRiskResponse, _>(
        "mxg.analytics.parts_risk",
        "Parts Risk",
        "Return shortage/lead-time/certificate/supplier risks with supporting history and uncertainty.",
        Action::AnalyticsRead,
        |_input| AnalyticsPartsRiskResponse { risks: vec![] },
    )));
    reg.register_typed_tool(wrap(not_configured::<AnalyticsExecKpisRequest, AnalyticsExecKpisResponse, _>(
        "mxg.analytics.exec_kpis",
        "Executive KPIs",
        "Return defined KPIs (downtime, TAT, AOG count, open cases, blockers, approval latency) with drill-through.",
        Action::AnalyticsRead,
        |_input| AnalyticsExecKpisResponse { kpis: vec![] },
    )));
}
