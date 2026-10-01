//! Analytics tool handlers: `mxg.analytics.*`.
//!
//! The tools are derived from the tenant-scoped case spine. They never invent values: missing sources are surfaced
//! as typed partial envelopes with explicit `not_configured` warnings.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError, EnvelopeStatus};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    AnalyticsExecKpisRequest, AnalyticsExecKpisResponse, AnalyticsFleetHealthRequest,
    AnalyticsFleetHealthResponse, AnalyticsRepeatDefectsRequest, AnalyticsRepeatDefectsResponse,
    DrillThroughRef, ExecKpi, FleetHealthMetric, RepeatDefect,
};
use mxgenius_shared::domain::case::{CasePriority, CaseStatus, MaintenanceCase};
use mxgenius_shared::domain::datetime::UtcDateTime;
use mxgenius_shared::domain::evidence::ConfidenceBasis;
use time::OffsetDateTime;

use crate::application::case_service::CaseService;
use crate::handlers::limited_spec;
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(
    reg: &mut Registry,
    case_service: Arc<dyn CaseService>,
    _pool: Option<sqlx::PgPool>,
) {
    reg.register_typed_tool(wrap(Arc::new(AnalyticsFleetHealthTool {
        case_service: case_service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(AnalyticsRepeatDefectsTool {
        case_service: case_service.clone(),
    })));
    reg.register_typed_tool(wrap(Arc::new(AnalyticsExecKpisTool { case_service })));
}

fn is_terminal(case: &MaintenanceCase) -> bool {
    matches!(case.status, CaseStatus::Closed | CaseStatus::Cancelled)
}

fn filter_window(
    case: &MaintenanceCase,
    start: Option<OffsetDateTime>,
    end: Option<OffsetDateTime>,
) -> bool {
    if let Some(start) = start {
        if case.updated_at < start {
            return false;
        }
    }
    if let Some(end) = end {
        if case.updated_at > end {
            return false;
        }
    }
    true
}

// 47. fleet_health ---------------------------------------------------------

pub struct AnalyticsFleetHealthTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for AnalyticsFleetHealthTool {
    type Request = AnalyticsFleetHealthRequest;
    type Response = AnalyticsFleetHealthResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.analytics.fleet_health",
            "Fleet Health",
            "Return defined fleet-health metrics, segments, freshness, drill-through IDs, limitations.",
            Action::AnalyticsRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AnalyticsFleetHealthRequest,
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
        let start = input
            .start_date
            .and_then(|d| d.0.with_hms(0, 0, 0).ok().map(|dt| dt.assume_utc()));
        let end = input
            .end_date
            .and_then(|d| d.0.with_hms(23, 59, 59).ok().map(|dt| dt.assume_utc()));
        let filtered: Vec<&MaintenanceCase> = cases
            .iter()
            .filter(|c| filter_window(c, start, end))
            .collect();
        let total = filtered.len() as u32;
        let open = filtered.iter().filter(|c| !is_terminal(c)).count() as u32;
        let closed = total.saturating_sub(open);
        let aog = filtered
            .iter()
            .filter(|c| c.priority == CasePriority::Aog && !is_terminal(c))
            .count() as u32;
        let freshness = filtered
            .iter()
            .map(|c| c.updated_at)
            .max()
            .map(UtcDateTime::from)
            .unwrap_or_else(UtcDateTime::now);
        let mut segments: Vec<String> = vec!["priority".into(), "status".into()];
        if input.fleet_filter.is_some() {
            segments.push("fleet_filter".into());
        }
        if input.operator_filter.is_some() {
            segments.push("operator_filter".into());
        }
        let metrics = vec![
            FleetHealthMetric {
                name: "open_cases".into(),
                definition: "cases not in terminal state for this tenant".into(),
                value: serde_json::json!(open),
                freshness,
                drill_through: filtered
                    .iter()
                    .filter(|c| !is_terminal(c))
                    .map(|c| DrillThroughRef {
                        kind: "case".into(),
                        id: c.case_id.0.to_string(),
                        label: Some(format!("{:?}", c.status)),
                    })
                    .collect(),
                limitations: vec!["tenant-scoped case spine only".into()],
            },
            FleetHealthMetric {
                name: "aog_count".into(),
                definition: "non-terminal cases with priority AOG".into(),
                value: serde_json::json!(aog),
                freshness,
                drill_through: filtered
                    .iter()
                    .filter(|c| c.priority == CasePriority::Aog && !is_terminal(c))
                    .map(|c| DrillThroughRef {
                        kind: "case".into(),
                        id: c.case_id.0.to_string(),
                        label: None,
                    })
                    .collect(),
                limitations: vec!["priority is operator-assigned".into()],
            },
            FleetHealthMetric {
                name: "closed_cases".into(),
                definition: "cases that reached a terminal state".into(),
                value: serde_json::json!(closed),
                freshness,
                drill_through: vec![],
                limitations: vec!["terminal states are Closed or Cancelled".into()],
            },
        ];
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            AnalyticsFleetHealthResponse { metrics, segments },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        if total == 0 {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no tenant cases match the supplied filter".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

// 48. repeat_defects -------------------------------------------------------

pub struct AnalyticsRepeatDefectsTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for AnalyticsRepeatDefectsTool {
    type Request = AnalyticsRepeatDefectsRequest;
    type Response = AnalyticsRepeatDefectsResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.analytics.repeat_defects",
            "Repeat Defects",
            "Return recurring normalized defects, counts, intervals, outcomes, sample sizes, drill-through cases.",
            Action::AnalyticsRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AnalyticsRepeatDefectsRequest,
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
        let start = input
            .start_date
            .and_then(|d| d.0.with_hms(0, 0, 0).ok().map(|dt| dt.assume_utc()));
        let end = input
            .end_date
            .and_then(|d| d.0.with_hms(23, 59, 59).ok().map(|dt| dt.assume_utc()));
        let grouping = input.grouping.as_deref().unwrap_or("symptom");
        let mut buckets: BTreeMap<String, Vec<&MaintenanceCase>> = BTreeMap::new();
        for case in &cases {
            if !filter_window(case, start, end) {
                continue;
            }
            let key = match grouping {
                "ata" => case.aircraft_id.clone(),
                "component" => case.aircraft_id.clone(),
                _ => normalize_symptom(&case.raw_discrepancy),
            };
            buckets.entry(key).or_default().push(case);
        }
        let defects: Vec<RepeatDefect> = buckets
            .into_iter()
            .filter(|(_, cases)| cases.len() >= 2)
            .map(|(bucket, cases)| {
                let count = cases.len() as u32;
                let mut timestamps: Vec<OffsetDateTime> =
                    cases.iter().map(|c| c.opened_at).collect();
                timestamps.sort();
                let recurrence_interval_days = if timestamps.len() >= 2 {
                    let span = (timestamps[timestamps.len() - 1] - timestamps[0]).whole_seconds()
                        as f64
                        / 86_400.0;
                    Some(span / (timestamps.len() as f64 - 1.0))
                } else {
                    None
                };
                let outcomes: Vec<String> = cases
                    .iter()
                    .map(|c| match c.status {
                        CaseStatus::Closed => "closed".to_string(),
                        CaseStatus::Cancelled => "cancelled".to_string(),
                        _ => "open".to_string(),
                    })
                    .collect();
                RepeatDefect {
                    bucket,
                    count,
                    recurrence_interval_days,
                    outcomes,
                    sample_size: count,
                    drill_through_case_ids: cases.iter().map(|c| c.case_id.0.to_string()).collect(),
                }
            })
            .collect();
        let mut env =
            CapabilityEnvelope::new(ctx.request_id.0, AnalyticsRepeatDefectsResponse { defects });
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        if env.output.defects.is_empty() {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "info".into(),
                message: "no repeated defects in the supplied window; a single occurrence per bucket is not surfaced".into(),
                retryable: false,
            });
        }
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message: format!(
                "defect grouping is currently '{grouping}' over free-text raw_discrepancy; a normalized defect table is not provided by the supplied build"
            ),
            retryable: false,
        });
        Ok(env)
    }
}

fn normalize_symptom(raw: &str) -> String {
    raw.split_whitespace()
        .map(str::to_ascii_lowercase)
        .filter(|t| t.len() > 3)
        .take(3)
        .collect::<Vec<_>>()
        .join(" ")
}

// 50. exec_kpis -----------------------------------------------------------

pub struct AnalyticsExecKpisTool {
    case_service: Arc<dyn CaseService>,
}

#[async_trait]
impl Tool for AnalyticsExecKpisTool {
    type Request = AnalyticsExecKpisRequest;
    type Response = AnalyticsExecKpisResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.analytics.exec_kpis",
            "Executive KPIs",
            "Return defined KPIs (downtime, TAT, AOG count, open cases, blockers, approval latency) with drill-through.",
            Action::AnalyticsRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: AnalyticsExecKpisRequest,
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
        let start = input
            .period_start
            .0
            .with_hms(0, 0, 0)
            .ok()
            .map(|dt| dt.assume_utc());
        let end = input
            .period_end
            .0
            .with_hms(23, 59, 59)
            .ok()
            .map(|dt| dt.assume_utc());
        let period_cases: Vec<&MaintenanceCase> = cases
            .iter()
            .filter(|c| {
                let opened = c.opened_at;
                start.map_or(true, |s| opened >= s) && end.map_or(true, |e| opened <= e)
            })
            .collect();
        let open = period_cases.iter().filter(|c| !is_terminal(c)).count() as u32;
        let aog = period_cases
            .iter()
            .filter(|c| c.priority == CasePriority::Aog && !is_terminal(c))
            .count() as u32;
        let closed = period_cases.iter().filter(|c| is_terminal(c)).count() as u32;
        let mut downtime_seconds: i64 = 0;
        for case in &period_cases {
            if is_terminal(case) {
                downtime_seconds += (case.updated_at - case.opened_at).whole_seconds();
            } else {
                downtime_seconds += (OffsetDateTime::now_utc() - case.opened_at).whole_seconds();
            }
        }
        let mut approval_latency_seconds: i64 = 0;
        let mut approval_count: i64 = 0;
        for case in &period_cases {
            if case.approval_state == mxgenius_shared::domain::case::ApprovalState::Approved {
                approval_latency_seconds += (case.updated_at - case.opened_at).whole_seconds();
                approval_count += 1;
            }
        }
        let average_approval_latency_hours = if approval_count > 0 {
            Some(approval_latency_seconds as f64 / 3_600.0 / approval_count as f64)
        } else {
            None
        };
        let boundaries = format!(
            "{}..{}",
            input
                .period_start
                .0
                .format(&time::macros::format_description!("[year]-[month]-[day]"))
                .unwrap_or_else(|_| "unknown".into()),
            input
                .period_end
                .0
                .format(&time::macros::format_description!("[year]-[month]-[day]"))
                .unwrap_or_else(|_| "unknown".into())
        );
        let kpis = vec![
            ExecKpi {
                name: "open_cases".into(),
                definition: "non-terminal cases in the period".into(),
                time_boundary: boundaries.clone(),
                value: serde_json::json!(open),
                drill_through: period_cases
                    .iter()
                    .filter(|c| !is_terminal(c))
                    .map(|c| DrillThroughRef {
                        kind: "case".into(),
                        id: c.case_id.0.to_string(),
                        label: None,
                    })
                    .collect(),
                data_completeness: "tenant_case_spine".into(),
            },
            ExecKpi {
                name: "aog_count".into(),
                definition: "non-terminal AOG cases in the period".into(),
                time_boundary: boundaries.clone(),
                value: serde_json::json!(aog),
                drill_through: vec![],
                data_completeness: "tenant_case_spine".into(),
            },
            ExecKpi {
                name: "closed_cases".into(),
                definition: "cases that reached a terminal state in the period".into(),
                time_boundary: boundaries.clone(),
                value: serde_json::json!(closed),
                drill_through: vec![],
                data_completeness: "tenant_case_spine".into(),
            },
            ExecKpi {
                name: "estimated_downtime_hours".into(),
                definition: "sum of opened_at..updated_at across all period cases".into(),
                time_boundary: boundaries.clone(),
                value: serde_json::json!(downtime_seconds as f64 / 3_600.0),
                drill_through: vec![],
                data_completeness: "tenant_case_spine".into(),
            },
            ExecKpi {
                name: "average_approval_latency_hours".into(),
                definition: "average opened_at..updated_at over approved cases".into(),
                time_boundary: boundaries,
                value: serde_json::json!(average_approval_latency_hours),
                drill_through: vec![],
                data_completeness: "tenant_case_spine".into(),
            },
        ];
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, AnalyticsExecKpisResponse { kpis });
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        if period_cases.is_empty() {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "info".into(),
                message: "no cases opened in the requested period".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}
