//! MRO discovery tool handlers (5): `mxg.mro.*`.

use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    MroCapabilityMatchRequest, MroCapabilityMatchResponse, MroContactPackRequest,
    MroContactPackResponse, MroRankRequest, MroRankResponse, MroRouteEtaRequest,
    MroRouteEtaResponse, MroSearchRequest, MroSearchResponse,
};

use crate::handlers::not_configured;
use crate::registry::Registry;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry) {
    reg.register_typed_tool(wrap(
        not_configured::<MroSearchRequest, MroSearchResponse, _>(
            "mxg.mro.search",
            "MRO Search",
            "Return candidate MROFacility entries with source completeness.",
            Action::MroRead,
            |_input| MroSearchResponse { facilities: vec![] },
        ),
    ));
    reg.register_typed_tool(wrap(not_configured::<
        MroCapabilityMatchRequest,
        MroCapabilityMatchResponse,
        _,
    >(
        "mxg.mro.capability_match",
        "MRO Capability Match",
        "Return supported tasks, gaps, ratings evidence, and match score for a case at a facility.",
        Action::MroRead,
        |input| MroCapabilityMatchResponse {
            facility_id: input.facility_id,
            supported_tasks: vec![],
            gaps: vec![],
            ratings_evidence: vec![],
            completeness: "unknown".into(),
            match_score: None,
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<MroRankRequest, MroRankResponse, _>(
        "mxg.mro.rank",
        "Rank MRO Facilities",
        "Rank facilities using capability, distance, hours, weather, parts, performance, completeness.",
        Action::MroRead,
        |_input| MroRankResponse { ranked: vec![], advisory: true },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        MroContactPackRequest,
        MroContactPackResponse,
        _,
    >(
        "mxg.mro.contact_pack",
        "MRO Contact Pack",
        "Return facility identity, verified contacts, operating hours, escalation channels.",
        Action::MroRead,
        |input| MroContactPackResponse {
            facility_id: input.facility_id,
            facility_name: String::new(),
            contacts: vec![],
            operating_hours: None,
            escalation_channels: vec![],
            source_freshness: None,
            source_references: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        MroRouteEtaRequest,
        MroRouteEtaResponse,
        _,
    >(
        "mxg.mro.route_eta",
        "MRO Route ETA",
        "Return estimated route, distance, time, assumptions, constraints, weather links.",
        Action::MroRead,
        |_input| MroRouteEtaResponse {
            distance_nm: None,
            estimated_duration_minutes: None,
            assumptions: vec![],
            constraints: vec![],
            weather_link: None,
            uncertainty: "unknown".into(),
        },
    )));
}
