//! Scheduling tool handlers (5): `mxg.scheduling.*`.

use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    SchedulingConflictScanRequest, SchedulingConflictScanResponse, SchedulingPartsReadinessRequest,
    SchedulingPartsReadinessResponse, SchedulingPublishPlanRequest, SchedulingPublishPlanResponse,
    SchedulingResourceMatchRequest, SchedulingResourceMatchResponse,
    SchedulingWindowOptionsRequest, SchedulingWindowOptionsResponse,
};

use crate::handlers::{not_configured, not_configured_mutating};
use crate::registry::Registry;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry) {
    reg.register_typed_tool(wrap(not_configured::<
        SchedulingWindowOptionsRequest,
        SchedulingWindowOptionsResponse,
        _,
    >(
        "mxg.scheduling.window_options",
        "Window Options",
        "Return candidate ScheduleOption entries with start/end, constraints, readiness.",
        Action::SchedulingRead,
        |_input| SchedulingWindowOptionsResponse { options: vec![] },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        SchedulingResourceMatchRequest,
        SchedulingResourceMatchResponse,
        _,
    >(
        "mxg.scheduling.resource_match",
        "Resource Match",
        "Return matching labor roles, bays, tooling, facility capability, gaps, completeness.",
        Action::SchedulingRead,
        |_input| SchedulingResourceMatchResponse {
            entries: vec![],
            data_completeness: "unknown".into(),
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        SchedulingConflictScanRequest,
        SchedulingConflictScanResponse,
        _,
    >(
        "mxg.scheduling.conflict_scan",
        "Conflict Scan",
        "Return deterministic conflicts, severity, affected objects, and possible resolutions.",
        Action::SchedulingRead,
        |_input| SchedulingConflictScanResponse { conflicts: vec![] },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        SchedulingPartsReadinessRequest,
        SchedulingPartsReadinessResponse,
        _,
    >(
        "mxg.scheduling.parts_readiness",
        "Parts Readiness",
        "Return readiness state, blocking requirements, ETA gaps, certificate gaps.",
        Action::SchedulingRead,
        |input| SchedulingPartsReadinessResponse {
            case_id: input.case_id,
            readiness_state: "unknown".into(),
            blocking_requirements: vec![],
            eta_gaps: vec![],
            certificate_gaps: vec![],
            evidence_ids: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured_mutating::<SchedulingPublishPlanRequest, SchedulingPublishPlanResponse, _>(
        "mxg.scheduling.publish_plan",
        "Publish Plan",
        "Persist the approved planning record with versioning and audit event. Never books facilities or parts.",
        Action::SchedulingPublish,
        |input| SchedulingPublishPlanResponse {
            case_id: input.case_id,
            new_version: None,
            audit_event_id: None,
            published: false,
            note: "no live scheduling adapter; this tool does not book facilities or parts".into(),
        },
    )));
}
