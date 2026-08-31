//! Scheduling tool handlers (5): `mxg.scheduling.*`.
//!
//! All five tools are remounted on the case spine, the Parts inventory
//! repository (when the application Postgres pool is configured), and the
//! `schedule_options` table. The `publish_plan` mutation requires
//! trusted human confirmation and writes through to the
//! `schedule_options` table; it never books facilities or parts.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError, EnvelopeStatus};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::CaseStatusDto;
use mxgenius_shared::contracts::{
    ScheduleOptionDto, SchedulingConflict, SchedulingConflictScanRequest,
    SchedulingConflictScanResponse, SchedulingPartsReadinessRequest,
    SchedulingPartsReadinessResponse, SchedulingPublishPlanRequest, SchedulingPublishPlanResponse,
    SchedulingResourceMatchRequest, SchedulingResourceMatchResponse,
    SchedulingWindowOptionsRequest, SchedulingWindowOptionsResponse,
};
use mxgenius_shared::domain::case::CaseStatus;
use mxgenius_shared::domain::datetime::UtcDateTime;
use mxgenius_shared::domain::evidence::ConfidenceBasis;
use mxgenius_shared::domain::ids::ScheduleOptionId;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::case_service::CaseService;
use crate::application::parts_inventory::{PartsInventoryRepository, SearchPartsQuery};
use crate::handlers::{limited_spec, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    pool: Option<sqlx::PgPool>,
    case_service: Arc<dyn CaseService>,
) {
    let pool_arc = pool.clone().map(Arc::new);
    reg.register_typed_tool(wrap(Arc::new(SchedulingWindowOptionsTool {
        case_service: case_service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(SchedulingResourceMatchTool {
        case_service: case_service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(SchedulingConflictScanTool { case_service })));
    reg.register_typed_tool(wrap(Arc::new(SchedulingPartsReadinessTool {
        pool: pool_arc,
    })));
    reg.register_typed_tool(wrap(Arc::new(SchedulingPublishPlanTool {
        pool: pool.map(Arc::new),
    })));
}

// 38. window_options -------------------------------------------------------

pub struct SchedulingWindowOptionsTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for SchedulingWindowOptionsTool {
    type Request = SchedulingWindowOptionsRequest;
    type Response = SchedulingWindowOptionsResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.scheduling.window_options",
            "Window Options",
            "Return candidate ScheduleOption entries with start/end, constraints, readiness.",
            Action::SchedulingRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: SchedulingWindowOptionsRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        if input.horizon_end < input.horizon_start {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "horizon_end must be on or after horizon_start".into(),
                retryable: false,
            });
        }
        let case_resp = self
            .case_service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: e.to_string(),
                retryable: false,
            })?;
        let case = case_resp.case;
        let start = input.horizon_start.into_inner();
        let end = input.horizon_end.into_inner();
        // Synthesize two candidate windows: a "soonest feasible" and a
        // "deferred but stable" — without a labor/bay/facility calendar we
        // cannot produce a true optimization, so we report what we know.
        let span = (end - start).whole_seconds();
        let half = span / 2;
        let soonest_end = start + std::time::Duration::from_secs(half.max(0) as u64);
        let deferred_start = start + std::time::Duration::from_secs(half.max(0) as u64);
        let mut constraints: Vec<String> = Vec::new();
        let readiness = match case.status {
            CaseStatusDto::AwaitingParts => {
                constraints.push("parts_readiness_unresolved".into());
                "blocked"
            }
            CaseStatusDto::Closed | CaseStatusDto::Cancelled => {
                constraints.push("case_in_terminal_state".into());
                "not_eligible"
            }
            _ => "advisory",
        };
        let evidence_ids = case.evidence_ids.clone();
        let options = vec![
            ScheduleOptionDto {
                id: ScheduleOptionId(Uuid::new_v5(
                    &Uuid::from_u128(0x3a4c5b6c_2c7e_4f47_9a3e_2a2a2a2a2a2a),
                    format!("{}:soonest", case.case_id.0).as_bytes(),
                )),
                start: UtcDateTime::from(start),
                end: UtcDateTime::from(soonest_end),
                facility_id: input.site_facility_id,
                constraints: constraints.clone(),
                readiness: readiness.to_string(),
                assumptions: vec![
                    "no labor/bay/calendar source is provided by the supplied build".into(),
                ],
                evidence_ids: evidence_ids.clone(),
            },
            ScheduleOptionDto {
                id: ScheduleOptionId(Uuid::new_v5(
                    &Uuid::from_u128(0x3a4c5b6c_2c7e_4f47_9a3e_2a2a2a2a2a2a),
                    format!("{}:deferred", case.case_id.0).as_bytes(),
                )),
                start: UtcDateTime::from(deferred_start),
                end: UtcDateTime::from(end),
                facility_id: input.site_facility_id,
                constraints,
                readiness: readiness.to_string(),
                assumptions: vec![
                    "no labor/bay/calendar source is provided by the supplied build".into(),
                ],
                evidence_ids,
            },
        ];
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            SchedulingWindowOptionsResponse { options },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message: "labor/bay/tooling/facility calendar sources are not provided by the supplied build; window options are advisory"
                .into(),
            retryable: false,
        });
        if readiness == "blocked" {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "warn".into(),
                message: "case is awaiting parts; readiness remains blocked until parts_readiness resolves".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

// 39. resource_match -------------------------------------------------------

pub struct SchedulingResourceMatchTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for SchedulingResourceMatchTool {
    type Request = SchedulingResourceMatchRequest;
    type Response = SchedulingResourceMatchResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.scheduling.resource_match",
            "Resource Match",
            "Return matching labor roles, bays, tooling, facility capability, gaps, completeness.",
            Action::SchedulingRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: SchedulingResourceMatchRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let case_resp = self
            .case_service
            .get(ctx.organization_id, input.case_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: e.to_string(),
                retryable: false,
            })?;
        let case = case_resp.case;
        // The supplied source has no labor/bay/tooling/facility_capability
        // rows; we report each resource kind as "unknown" with a not_configured
        // gap reason. The case status drives the matched flag.
        let in_target_window = match (input.target_window_start, input.target_window_end) {
            (Some(s), Some(e)) => {
                let s = s.into_inner();
                let e = e.into_inner();
                case.updated_at.inner() >= s && case.updated_at.inner() <= e
            }
            _ => true,
        };
        let entries =
            [
                ("labor", "primary_technician"),
                ("bay", "tenant_default_bay"),
                ("tooling", "tenant_default_tooling"),
                ("facility_capability", "tenant_default_facility"),
            ]
            .iter()
            .map(|(kind, name)| {
                mxgenius_shared::contracts::ResourceMatchEntry {
            resource_kind: kind.to_string(),
            name: name.to_string(),
            matched: in_target_window && !is_terminal_status(case.status),
            gap_reason: Some(
                "no labor/bay/tooling/facility_capability source is provided by the supplied build"
                    .into(),
            ),
            source_reference: Some(format!("case://{}", case.case_id.0)),
        }
            })
            .collect();
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            SchedulingResourceMatchResponse {
                entries,
                data_completeness: "unknown".into(),
            },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "warn".into(),
            message: "labor, bay, tooling, and facility_capability sources are not provided by the supplied build".into(),
            retryable: false,
        });
        Ok(env)
    }
}

fn is_terminal_status(status: CaseStatusDto) -> bool {
    matches!(status, CaseStatusDto::Closed | CaseStatusDto::Cancelled)
}

fn is_terminal_domain_status(status: CaseStatus) -> bool {
    matches!(status, CaseStatus::Closed | CaseStatus::Cancelled)
}

// 40. conflict_scan -------------------------------------------------------

pub struct SchedulingConflictScanTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for SchedulingConflictScanTool {
    type Request = SchedulingConflictScanRequest;
    type Response = SchedulingConflictScanResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.scheduling.conflict_scan",
            "Conflict Scan",
            "Return deterministic conflicts, severity, affected objects, and possible resolutions.",
            Action::SchedulingRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: SchedulingConflictScanRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let cases = self
            .case_service
            .list_for_org(ctx.organization_id)
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        let focused: Vec<&_> = if input.case_ids.is_empty() {
            cases
                .iter()
                .filter(|c| !is_terminal_domain_status(c.status))
                .collect()
        } else {
            cases
                .iter()
                .filter(|c| input.case_ids.iter().any(|id| id.0 == c.case_id.0))
                .collect()
        };
        // Group by aircraft_id; if more than one non-terminal case touches
        // the same aircraft, that's an "aircraft contention" conflict.
        let mut by_aircraft: BTreeMap<String, Vec<&_>> = BTreeMap::new();
        for case in &focused {
            by_aircraft
                .entry(case.aircraft_id.clone())
                .or_default()
                .push(case);
        }
        let mut conflicts: Vec<SchedulingConflict> = Vec::new();
        for (aircraft, group) in by_aircraft {
            if group.len() < 2 {
                continue;
            }
            // Priority mismatch: any AOG alongside a deferred/routine case.
            let aog: Vec<&&_> = group
                .iter()
                .filter(|c| matches!(c.priority, mxgenius_shared::domain::case::CasePriority::Aog))
                .collect();
            if !aog.is_empty() {
                let non_aog: Vec<&&_> = group
                    .iter()
                    .filter(|c| {
                        !matches!(c.priority, mxgenius_shared::domain::case::CasePriority::Aog)
                    })
                    .collect();
                if !non_aog.is_empty() {
                    conflicts.push(SchedulingConflict {
                        id: format!("aircraft:{aircraft}:priority"),
                        kind: "priority_mismatch".into(),
                        severity: mxgenius_shared::contracts::common::Severity::High,
                        description: format!(
                            "aircraft {aircraft} has AOG cases alongside non-AOG cases"
                        ),
                        affected_objects: group.iter().map(|c| c.case_id.0.to_string()).collect(),
                        possible_resolutions: vec![
                            "re-prioritize non-AOG cases".into(),
                            "split concurrent work across bays".into(),
                        ],
                    });
                }
            }
            // Stage contention: multiple non-terminal cases for the same aircraft.
            conflicts.push(SchedulingConflict {
                id: format!("aircraft:{aircraft}:contention"),
                kind: "aircraft_contention".into(),
                severity: mxgenius_shared::contracts::common::Severity::Medium,
                description: format!("aircraft {aircraft} has {} non-terminal cases", group.len()),
                affected_objects: group.iter().map(|c| c.case_id.0.to_string()).collect(),
                possible_resolutions: vec![
                    "sequence cases by priority and required parts".into(),
                    "defer lower-priority cases until AOG resolves".into(),
                ],
            });
        }
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            SchedulingConflictScanResponse { conflicts },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        if env.output.conflicts.is_empty() {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "info".into(),
                message: "no deterministic aircraft or priority conflicts detected".into(),
                retryable: false,
            });
        }
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message:
                "calendar/labor/tooling conflict detection is not provided by the supplied build"
                    .into(),
            retryable: false,
        });
        Ok(env)
    }
}

// 41. parts_readiness -----------------------------------------------------

pub struct SchedulingPartsReadinessTool {
    pool: Option<Arc<sqlx::PgPool>>,
}

#[async_trait]
impl Tool for SchedulingPartsReadinessTool {
    type Request = SchedulingPartsReadinessRequest;
    type Response = SchedulingPartsReadinessResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        let mut tool_spec = limited_spec::<Self::Request, Self::Response>(
            "mxg.scheduling.parts_readiness",
            "Parts Readiness",
            "Return readiness state, blocking requirements, ETA gaps, certificate gaps.",
            Action::SchedulingRead,
            false,
        );
        if self.pool.is_none() {
            tool_spec.availability = "not_configured".into();
        }
        tool_spec
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: SchedulingPartsReadinessRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let pool = self.pool.clone();
        let Some(pool) = pool else {
            let mut env = CapabilityEnvelope::new(
                ctx.request_id.0,
                SchedulingPartsReadinessResponse {
                    case_id: input.case_id,
                    readiness_state: "unknown".into(),
                    blocking_requirements: vec![],
                    eta_gaps: vec![],
                    certificate_gaps: vec![],
                    evidence_ids: vec![],
                },
            );
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "warn".into(),
                message: "parts_readiness requires a mounted database".into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
            return Ok(env);
        };
        let case_exists: Option<Uuid> = sqlx::query_scalar(
            "SELECT case_id FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2",
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_optional(pool.as_ref())
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("maintenance_cases lookup failed: {e}"),
            retryable: true,
        })?;
        if case_exists.is_none() {
            return Err(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: "case is not present in this tenant".into(),
                retryable: false,
            });
        }
        // Pull part_requirements for the verified tenant case.
        let part_ids: Vec<Uuid> = sqlx::query_scalar(
            r#"SELECT part_id FROM part_requirements
               WHERE case_id=$1"#,
        )
        .bind(input.case_id.0)
        .fetch_all(pool.as_ref())
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("part_requirements query failed: {e}"),
            retryable: true,
        })?;
        let repository = PartsInventoryRepository::new(pool.as_ref());
        let mut blocking: Vec<String> = Vec::new();
        let mut certificate_gaps: Vec<String> = Vec::new();
        for part_id in &part_ids {
            // Unwindowed: `retain` below filters by part in Rust, so a page
            // could report "no available stock" for a part that has some.
            let mut units = repository
                .search_all(
                    ctx,
                    &SearchPartsQuery {
                        query: None,
                        status: Some("available".into()),
                        location: None,
                        page: None,
                        page_size: None,
                    },
                )
                .await
                .map_err(|e| EnvelopeError {
                    code: StableErrorCode::InternalError,
                    severity: "error".into(),
                    message: e.to_string(),
                    retryable: true,
                })?;
            units.retain(|u| u.part_id == *part_id);
            if units.is_empty() {
                blocking.push(format!("part {part_id} has no available stock units"));
            } else {
                let missing_cert = units
                    .iter()
                    .filter(|u| u.certificate_number.is_none())
                    .count();
                if missing_cert == units.len() {
                    certificate_gaps.push(format!(
                        "all available stock units for part {part_id} lack a certificate"
                    ));
                }
            }
        }
        // Certificate rows linked to the case:
        let case_certificate_gaps: Vec<String> = sqlx::query_scalar(
            r#"SELECT certificate_type FROM certificate_records
               WHERE case_id=$1 AND validated=false"#,
        )
        .bind(input.case_id.0)
        .fetch_all(pool.as_ref())
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("certificate_records query failed: {e}"),
            retryable: true,
        })?;
        certificate_gaps.extend(case_certificate_gaps);
        let readiness_state = if blocking.is_empty() && certificate_gaps.is_empty() {
            "ready"
        } else if !blocking.is_empty() {
            "blocked"
        } else {
            "partially_ready"
        };
        let eta_gaps: Vec<String> =
            vec!["supplier ETA is not provided by the supplied source".into()];
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            SchedulingPartsReadinessResponse {
                case_id: input.case_id,
                readiness_state: readiness_state.to_string(),
                blocking_requirements: blocking,
                eta_gaps,
                certificate_gaps,
                evidence_ids: vec![],
            },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.confidence.explanation =
            "tenant-scoped part_requirements + stock_units; supplier ETA is not provided".into();
        if readiness_state != "ready" {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "info".into(),
                message: "supplier ETA and quoting are not provided by the supplied build".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

// 42. publish_plan -------------------------------------------------------

pub struct SchedulingPublishPlanTool {
    pool: Option<Arc<sqlx::PgPool>>,
}

#[async_trait]
impl Tool for SchedulingPublishPlanTool {
    type Request = SchedulingPublishPlanRequest;
    type Response = SchedulingPublishPlanResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        let mut tool_spec = spec::<Self::Request, Self::Response>(
            "mxg.scheduling.publish_plan",
            "Publish Plan",
            "Persist the approved planning record with versioning and audit event. Never books facilities or parts.",
            Action::SchedulingPublish,
            true,
        );
        if self.pool.is_none() {
            tool_spec.availability = "not_configured".into();
        }
        tool_spec
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: SchedulingPublishPlanRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        if !ctx.human_confirmed {
            return Err(EnvelopeError {
                code: StableErrorCode::HumanApprovalRequired,
                severity: "error".into(),
                message: "trusted human confirmation is required for mxg.scheduling.publish_plan"
                    .into(),
                retryable: false,
            });
        }
        if input.expected_version < 1 {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "expected_version must be at least 1".into(),
                retryable: false,
            });
        }
        let Some(pool) = self.pool.clone() else {
            let mut env = CapabilityEnvelope::new(
                ctx.request_id.0,
                SchedulingPublishPlanResponse {
                    case_id: input.case_id,
                    new_version: None,
                    audit_event_id: None,
                    published: false,
                    note: "no application pool; schedule_options persistence requires a mounted database, and this tool does not book facilities or parts".into(),
                },
            );
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "warn".into(),
                message: "no application pool; this tool does not book facilities or parts".into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
            return Ok(env);
        };
        // Look up the case to verify the version and derive a publish window.
        let case_row: Option<(i64, OffsetDateTime, Option<OffsetDateTime>, String)> =
            sqlx::query_as(
                r#"SELECT version, opened_at, updated_at, status FROM maintenance_cases
                   WHERE organization_id=$1 AND case_id=$2 FOR UPDATE"#,
            )
            .bind(ctx.organization_id.0)
            .bind(input.case_id.0)
            .fetch_optional(pool.as_ref())
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: format!("case lookup failed: {e}"),
                retryable: true,
            })?;
        let (case_version, opened_at, _updated_at, status) = match case_row {
            Some(row) => row,
            None => {
                return Err(EnvelopeError {
                    code: StableErrorCode::EntityNotFound,
                    severity: "error".into(),
                    message: "case is not present in this tenant's maintenance_cases".into(),
                    retryable: false,
                });
            }
        };
        if case_version != input.expected_version {
            return Err(EnvelopeError {
                code: StableErrorCode::VersionConflict,
                severity: "error".into(),
                message: format!(
                    "Stale version: expected {}, found {}",
                    input.expected_version, case_version
                ),
                retryable: false,
            });
        }
        if matches!(status.as_str(), "closed" | "cancelled") {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidStateTransition,
                severity: "error".into(),
                message: "case is in a terminal state; publish is not allowed".into(),
                retryable: false,
            });
        }
        let now = OffsetDateTime::now_utc();
        let start_at = now;
        let end_at = now + time::Duration::hours(8);
        let mut tx = pool.begin().await.map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: e.to_string(),
            retryable: true,
        })?;
        // Upsert by schedule_option_id: if it already exists, refresh; otherwise insert.
        let schedule_write = sqlx::query(
            r#"INSERT INTO schedule_options (id, case_id, start_at, end_at, notes)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE SET
                 start_at=EXCLUDED.start_at,
                 end_at=EXCLUDED.end_at,
                 notes=EXCLUDED.notes
               WHERE schedule_options.case_id=EXCLUDED.case_id"#,
        )
        .bind(input.schedule_option_id.0)
        .bind(input.case_id.0)
        .bind(start_at)
        .bind(end_at)
        .bind(format!(
            "published from case {} opened at {}",
            input.case_id.0, opened_at
        ))
        .execute(&mut *tx)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("schedule_options upsert failed: {e}"),
            retryable: true,
        })?;
        if schedule_write.rows_affected() != 1 {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "schedule_option_id is already bound to another case".into(),
                retryable: false,
            });
        }
        let audit_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO audit_events
               (id, case_id, actor_user_id, organization_id, action, payload, correlation_id, created_at)
               VALUES ($1, $2, $3, $4, 'scheduling.publish_plan', $5, $6, now())"#,
        )
        .bind(audit_id)
        .bind(input.case_id.0)
        .bind(ctx.user_id.0)
        .bind(ctx.organization_id.0)
        .bind(serde_json::json!({
            "schedule_option_id": input.schedule_option_id.0,
            "expected_version": input.expected_version,
            "start_at": start_at,
            "end_at": end_at,
        }))
        .bind(ctx.correlation_id.0)
        .execute(&mut *tx)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("audit_events insert failed: {e}"),
            retryable: true,
        })?;
        tx.commit().await.map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: e.to_string(),
            retryable: true,
        })?;
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            SchedulingPublishPlanResponse {
                case_id: input.case_id,
                new_version: Some(case_version),
                audit_event_id: Some(audit_id.to_string()),
                published: true,
                note: "schedule_options row persisted; this tool does not book facilities or parts"
                    .into(),
            },
        );
        env.confidence.basis = ConfidenceBasis::HumanConfirmed;
        env.confidence.explanation =
            "human-confirmed persistence of a schedule_options row; case version is unchanged"
                .into();
        Ok(env)
    }
}
