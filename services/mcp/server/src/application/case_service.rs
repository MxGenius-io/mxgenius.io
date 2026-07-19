//! `MaintenanceCase` application service: state transitions, evidence,
//! events, audit, capability traces, optimistic versioning, tenant scope.
//!
//! The in-memory implementation supports explicit local mode and fault tests.
//! Production mounts `PostgresCaseService` through the same trait.

use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::RwLock;
use sha2::Digest;
use std::collections::BTreeMap;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::EnvelopeError;
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    ApprovalStateDto, CaseDto, CaseStatusDto, DigitalTwinAttachCaseMarkerRequest,
    DigitalTwinAttachCaseMarkerResponse, LocationDto, MaintenanceCaseAttachObservationRequest,
    MaintenanceCaseAttachObservationResponse, MaintenanceCaseCreateRequest,
    MaintenanceCaseCreateResponse, MaintenanceCaseGetResponse, MaintenanceCaseUpdateStatusRequest,
    MaintenanceCaseUpdateStatusResponse, NormalizedDiscrepancyDto, PriorityDto, TimelineEntry,
};
use mxgenius_shared::domain::case::{ApprovalState, CasePriority, CaseStatus, MaintenanceCase};
use mxgenius_shared::domain::datetime::UtcDateTime;
use mxgenius_shared::domain::ids::{
    CaseId, EvidenceId, MaintenanceEventId, OrganizationId, UserId,
};

use crate::application::evidence_service::EvidenceService;
use crate::application::policy_enforce::check_action;

#[derive(Debug, Error)]
pub enum CaseError {
    #[error("case not found")]
    NotFound,
    #[error("stale version: expected {expected}, found {actual}")]
    StaleVersion { expected: i64, actual: i64 },
    #[error("illegal transition from {from:?} to {to:?}")]
    IllegalTransition { from: CaseStatus, to: CaseStatus },
    #[error("tenant mismatch")]
    TenantMismatch,
    #[error("missing required trusted confirmation")]
    MissingConfirmation,
    #[error("qualified approval is required before closing the case")]
    MissingApproval,
    #[error("policy denied for role {role:?} action {action:?}")]
    PolicyDenied { role: String, action: String },
    #[error("internal error: {0}")]
    Internal(String),
}

#[async_trait]
pub trait CaseService: Send + Sync {
    async fn create(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseCreateRequest,
    ) -> Result<(MaintenanceCaseCreateResponse, Uuid), CaseError>;
    async fn get(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<MaintenanceCaseGetResponse, CaseError>;
    async fn update_status(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseUpdateStatusRequest,
    ) -> Result<(MaintenanceCaseUpdateStatusResponse, Uuid), CaseError>;
    async fn attach_observation(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseAttachObservationRequest,
    ) -> Result<(MaintenanceCaseAttachObservationResponse, Uuid), CaseError>;
    async fn attach_twin_marker(
        &self,
        ctx: &ExecutionContext,
        req: &DigitalTwinAttachCaseMarkerRequest,
    ) -> Result<(DigitalTwinAttachCaseMarkerResponse, Uuid), CaseError>;
    async fn list_for_org(&self, org: OrganizationId) -> Result<Vec<MaintenanceCase>, CaseError>;
    async fn timeline(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<Vec<TimelineEntry>, CaseError>;
}

impl From<CaseError> for EnvelopeError {
    fn from(e: CaseError) -> Self {
        let code = match &e {
            CaseError::NotFound => StableErrorCode::EntityNotFound,
            CaseError::StaleVersion { .. } => StableErrorCode::VersionConflict,
            CaseError::IllegalTransition { .. } => StableErrorCode::InvalidStateTransition,
            CaseError::TenantMismatch => StableErrorCode::TenantMismatch,
            CaseError::MissingConfirmation => StableErrorCode::HumanApprovalRequired,
            CaseError::MissingApproval => StableErrorCode::HumanApprovalRequired,
            CaseError::PolicyDenied { .. } => StableErrorCode::AccessDenied,
            CaseError::Internal(_) => StableErrorCode::InternalError,
        };
        EnvelopeError {
            code,
            severity: "error".into(),
            message: e.to_string(),
            retryable: false,
        }
    }
}

#[derive(Default)]
struct Inner {
    cases: BTreeMap<CaseId, MaintenanceCase>,
    events: Vec<mxgenius_shared::domain::case::MaintenanceEvent>,
    audit: Vec<AuditEntry>,
    observations: Vec<ObservationRecord>,
    evidence_links: Vec<CaseEvidenceLink>,
    traces: Vec<MutationTraceEntry>,
    twin_markers: Vec<TwinMarkerRecord>,
    fail_before_commit: Option<MutationWriteStage>,
}

#[derive(Debug, Clone)]
struct TwinMarkerRecord {
    #[allow(dead_code)]
    id: Uuid,
    #[allow(dead_code)]
    organization_id: OrganizationId,
    #[allow(dead_code)]
    case_id: CaseId,
    #[allow(dead_code)]
    component_id: Option<String>,
    #[allow(dead_code)]
    zone_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationWriteStage {
    Event,
    Audit,
    Trace,
}

#[derive(Debug, Clone)]
pub struct AuditEntry {
    pub id: Uuid,
    pub case_id: Option<CaseId>,
    pub organization_id: OrganizationId,
    pub actor_user_id: UserId,
    pub action: String,
    pub payload: serde_json::Value,
    pub correlation_id: Uuid,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct ObservationRecord {
    pub id: Uuid,
    pub organization_id: OrganizationId,
    pub case_id: CaseId,
    pub original_note: String,
    pub component_id: Option<String>,
    pub media_refs: Vec<String>,
    pub created_by: UserId,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct CaseEvidenceLink {
    pub organization_id: OrganizationId,
    pub case_id: CaseId,
    pub evidence_id: EvidenceId,
    pub content_hash: String,
}

#[derive(Debug, Clone)]
pub struct MutationTraceEntry {
    pub trace_id: Uuid,
    pub request_id: Uuid,
    pub correlation_id: Uuid,
    pub organization_id: OrganizationId,
    pub actor_user_id: UserId,
    pub tool_name: String,
    pub approval_required: bool,
    pub approval_result: String,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Default)]
pub struct InMemoryCaseService {
    inner: Arc<RwLock<Inner>>,
    #[allow(dead_code)]
    pub evidence: EvidenceService,
}

impl InMemoryCaseService {
    pub fn new(evidence: EvidenceService) -> Self {
        Self {
            evidence,
            ..Default::default()
        }
    }

    pub fn twin_marker_count(&self) -> usize {
        self.inner.read().twin_markers.len()
    }

    pub fn create(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseCreateRequest,
    ) -> Result<(MaintenanceCaseCreateResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::CaseCreate)?;
        if !ctx.human_confirmed {
            return Err(CaseError::MissingConfirmation);
        }
        let now_typed: UtcDateTime = UtcDateTime::from(OffsetDateTime::now_utc());
        let now = now_typed.into_inner();
        let priority = match req.priority {
            PriorityDto::Routine => CasePriority::Routine,
            PriorityDto::Deferred => CasePriority::Deferred,
            PriorityDto::Urgent => CasePriority::Urgent,
            PriorityDto::Aog => CasePriority::Aog,
        };
        let case = MaintenanceCase {
            case_id: CaseId(Uuid::new_v4()),
            organization_id: ctx.organization_id,
            aircraft_id: req.aircraft_id.clone(),
            status: CaseStatus::Open,
            priority,
            opened_at: now,
            updated_at: now,
            location: req
                .location
                .as_ref()
                .map(|l| mxgenius_shared::domain::case::Location {
                    icao: l.icao.clone(),
                    iata: l.iata.clone(),
                    city: l.city.clone(),
                    region: l.region.clone(),
                    country: l.country.clone(),
                }),
            raw_discrepancy: req.raw_discrepancy.clone(),
            normalized_discrepancy: Some(mxgenius_shared::domain::case::Discrepancy {
                id: mxgenius_shared::domain::ids::DiscrepancyId(Uuid::new_v4()),
                normalized_summary: None,
                raw: req.raw_discrepancy.clone(),
            }),
            assigned_user_ids: vec![],
            evidence_ids: vec![],
            approval_state: ApprovalState::Pending,
            version: 1,
        };
        let event = mxgenius_shared::domain::case::MaintenanceEvent {
            id: MaintenanceEventId(Uuid::new_v4()),
            case_id: case.case_id,
            from_status: None,
            to_status: CaseStatus::Open,
            actor_user_id: ctx.user_id,
            reason: Some("case created".into()),
            created_at: now,
        };
        let audit = AuditEntry {
            id: Uuid::new_v4(),
            case_id: Some(case.case_id),
            organization_id: ctx.organization_id,
            actor_user_id: ctx.user_id,
            action: "case.create".into(),
            payload: serde_json::json!({ "aircraft_id": case.aircraft_id, "priority": format!("{:?}", case.priority) }),
            correlation_id: ctx.correlation_id.0,
            created_at: now,
        };
        let trace = mutation_trace(ctx, "mxg.maintenance_case.create", now);
        let audit_id = audit.id;
        let trace_id = trace.trace_id;
        {
            let mut w = self.inner.write();
            maybe_fail_before_commit(&mut w)?;
            w.cases.insert(case.case_id, case.clone());
            w.events.push(event.clone());
            w.audit.push(audit);
            w.traces.push(trace);
        }
        Ok((
            MaintenanceCaseCreateResponse {
                case: to_dto(&case),
                created_event_ids: vec![event.id.0.to_string()],
                audit_event_id: audit_id.to_string(),
            },
            trace_id,
        ))
    }

    pub fn get(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<MaintenanceCaseGetResponse, CaseError> {
        let r = self.inner.read();
        let case = r.cases.get(&case_id).cloned().ok_or(CaseError::NotFound)?;
        if case.organization_id != org {
            return Err(CaseError::TenantMismatch);
        }
        Ok(MaintenanceCaseGetResponse {
            case: to_dto(&case),
            unresolved_conflicts: vec![],
        })
    }

    pub fn update_status(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseUpdateStatusRequest,
    ) -> Result<(MaintenanceCaseUpdateStatusResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::CaseUpdateStatus)?;
        if !ctx.human_confirmed {
            return Err(CaseError::MissingConfirmation);
        }
        let target = match req.target_status {
            CaseStatusDto::Draft => CaseStatus::Draft,
            CaseStatusDto::Open => CaseStatus::Open,
            CaseStatusDto::Triage => CaseStatus::Triage,
            CaseStatusDto::Diagnosing => CaseStatus::Diagnosing,
            CaseStatusDto::Planning => CaseStatus::Planning,
            CaseStatusDto::AwaitingParts => CaseStatus::AwaitingParts,
            CaseStatusDto::Scheduled => CaseStatus::Scheduled,
            CaseStatusDto::InWork => CaseStatus::InWork,
            CaseStatusDto::AwaitingInspection => CaseStatus::AwaitingInspection,
            CaseStatusDto::AwaitingApproval => CaseStatus::AwaitingApproval,
            CaseStatusDto::Closed => CaseStatus::Closed,
            CaseStatusDto::Cancelled => CaseStatus::Cancelled,
        };
        let mut w = self.inner.write();
        let mut case_snapshot = w
            .cases
            .get(&req.case_id)
            .cloned()
            .ok_or(CaseError::NotFound)?;
        if case_snapshot.organization_id != ctx.organization_id {
            return Err(CaseError::TenantMismatch);
        }
        if case_snapshot.version != req.expected_version {
            return Err(CaseError::StaleVersion {
                expected: req.expected_version,
                actual: case_snapshot.version,
            });
        }
        if !case_snapshot.status.can_transition_to(target) {
            return Err(CaseError::IllegalTransition {
                from: case_snapshot.status,
                to: target,
            });
        }
        if target == CaseStatus::Closed && !ctx.approval_granted {
            return Err(CaseError::MissingApproval);
        }
        let prior = case_snapshot.status;
        case_snapshot.status = target;
        if target == CaseStatus::Closed {
            case_snapshot.approval_state = ApprovalState::Approved;
        }
        case_snapshot.updated_at = UtcDateTime::from(OffsetDateTime::now_utc()).into_inner();
        case_snapshot.version += 1;
        let now = case_snapshot.updated_at;
        let event = mxgenius_shared::domain::case::MaintenanceEvent {
            id: MaintenanceEventId(Uuid::new_v4()),
            case_id: case_snapshot.case_id,
            from_status: Some(prior),
            to_status: target,
            actor_user_id: ctx.user_id,
            reason: req.reason.clone(),
            created_at: now,
        };
        let audit = AuditEntry {
            id: Uuid::new_v4(),
            case_id: Some(case_snapshot.case_id),
            organization_id: ctx.organization_id,
            actor_user_id: ctx.user_id,
            action: "case.update_status".into(),
            payload: serde_json::json!({
                "from": format!("{prior:?}"),
                "to": format!("{target:?}"),
                "new_version": case_snapshot.version,
            }),
            correlation_id: ctx.correlation_id.0,
            created_at: now,
        };
        let trace = mutation_trace(ctx, "mxg.maintenance_case.update_status", now);
        let audit_id = audit.id;
        let trace_id = trace.trace_id;
        maybe_fail_before_commit(&mut w)?;
        w.cases.insert(req.case_id, case_snapshot.clone());
        w.events.push(event.clone());
        w.audit.push(audit);
        w.traces.push(trace);
        Ok((
            MaintenanceCaseUpdateStatusResponse {
                case: to_dto(&case_snapshot),
                prior_status: status_to_dto(prior),
                new_status: status_to_dto(target),
                new_version: case_snapshot.version,
                maintenance_event_id: event.id.0.to_string(),
                audit_event_id: audit_id.to_string(),
            },
            trace_id,
        ))
    }

    pub fn attach_observation(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseAttachObservationRequest,
    ) -> Result<(MaintenanceCaseAttachObservationResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::CaseAttachObservation)?;
        if !ctx.human_confirmed {
            return Err(CaseError::MissingConfirmation);
        }
        if req.note.trim().is_empty() {
            return Err(CaseError::Internal(
                "observation note cannot be empty".into(),
            ));
        }

        let mut w = self.inner.write();
        let case_status = {
            let case = w.cases.get(&req.case_id).ok_or(CaseError::NotFound)?;
            if case.organization_id != ctx.organization_id {
                return Err(CaseError::TenantMismatch);
            }
            case.status
        };
        let now = OffsetDateTime::now_utc();
        let observation = ObservationRecord {
            id: Uuid::new_v4(),
            organization_id: ctx.organization_id,
            case_id: req.case_id,
            original_note: req.note.clone(),
            component_id: req.component_id.clone(),
            media_refs: req.media_refs.clone(),
            created_by: ctx.user_id,
            created_at: now,
        };
        let evidence_id = EvidenceId(Uuid::new_v4());
        let content_hash = hex::encode(sha2::Sha256::digest(req.note.as_bytes()));
        let link = CaseEvidenceLink {
            organization_id: ctx.organization_id,
            case_id: req.case_id,
            evidence_id,
            content_hash,
        };
        let event = mxgenius_shared::domain::case::MaintenanceEvent {
            id: MaintenanceEventId(Uuid::new_v4()),
            case_id: req.case_id,
            from_status: Some(case_status),
            to_status: case_status,
            actor_user_id: ctx.user_id,
            reason: Some("observation attached".into()),
            created_at: now,
        };
        let audit = AuditEntry {
            id: Uuid::new_v4(),
            case_id: Some(req.case_id),
            organization_id: ctx.organization_id,
            actor_user_id: ctx.user_id,
            action: "case.attach_observation".into(),
            payload: serde_json::json!({
                "observation_id": observation.id,
                "evidence_id": evidence_id.0,
                "component_id": req.component_id,
                "media_count": req.media_refs.len()
            }),
            correlation_id: ctx.correlation_id.0,
            created_at: now,
        };
        let trace = mutation_trace(ctx, "mxg.maintenance_case.attach_observation", now);
        let audit_id = audit.id;
        let trace_id = trace.trace_id;

        maybe_fail_before_commit(&mut w)?;
        {
            let case = w.cases.get_mut(&req.case_id).ok_or(CaseError::NotFound)?;
            case.evidence_ids.push(evidence_id);
            case.updated_at = now;
            case.version += 1;
        }
        w.observations.push(observation.clone());
        w.evidence_links.push(link);
        w.events.push(event.clone());
        w.audit.push(audit);
        w.traces.push(trace);

        Ok((
            MaintenanceCaseAttachObservationResponse {
                observation_id: observation.id.to_string(),
                evidence_id: evidence_id.0.to_string(),
                maintenance_event_id: event.id.0.to_string(),
                audit_event_id: audit_id.to_string(),
            },
            trace_id,
        ))
    }

    pub fn observation(&self, org: OrganizationId, id: Uuid) -> Option<ObservationRecord> {
        self.inner
            .read()
            .observations
            .iter()
            .find(|o| o.organization_id == org && o.id == id)
            .cloned()
    }

    pub fn mutation_counts(&self) -> (usize, usize, usize, usize) {
        let r = self.inner.read();
        (
            r.observations.len(),
            r.events.len(),
            r.audit.len(),
            r.traces.len(),
        )
    }

    pub fn fail_next_mutation_at(&self, stage: MutationWriteStage) {
        self.inner.write().fail_before_commit = Some(stage);
    }

    pub fn list_for_org(&self, org: OrganizationId) -> Vec<MaintenanceCase> {
        self.inner
            .read()
            .cases
            .values()
            .filter(|c| c.organization_id == org)
            .cloned()
            .collect()
    }

    pub fn timeline(&self, case_id: CaseId) -> Vec<TimelineEntry> {
        let r = self.inner.read();
        r.events
            .iter()
            .filter(|e| e.case_id == case_id)
            .map(|e| TimelineEntry {
                event_id: e.id.0.to_string(),
                event_type: "maintenance_event".into(),
                occurred_at: UtcDateTime::from(e.created_at),
                actor_user_id: e.actor_user_id.0.to_string(),
                summary: format!("status: {:?} -> {:?}", e.from_status, e.to_status),
                from_status: e.from_status.map(status_to_dto),
                to_status: Some(status_to_dto(e.to_status)),
            })
            .collect()
    }
}

#[async_trait]
impl CaseService for InMemoryCaseService {
    async fn create(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseCreateRequest,
    ) -> Result<(MaintenanceCaseCreateResponse, Uuid), CaseError> {
        InMemoryCaseService::create(self, ctx, req)
    }

    async fn get(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<MaintenanceCaseGetResponse, CaseError> {
        InMemoryCaseService::get(self, org, case_id)
    }

    async fn update_status(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseUpdateStatusRequest,
    ) -> Result<(MaintenanceCaseUpdateStatusResponse, Uuid), CaseError> {
        InMemoryCaseService::update_status(self, ctx, req)
    }

    async fn attach_observation(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseAttachObservationRequest,
    ) -> Result<(MaintenanceCaseAttachObservationResponse, Uuid), CaseError> {
        InMemoryCaseService::attach_observation(self, ctx, req)
    }

    async fn attach_twin_marker(
        &self,
        ctx: &ExecutionContext,
        req: &DigitalTwinAttachCaseMarkerRequest,
    ) -> Result<(DigitalTwinAttachCaseMarkerResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::TwinAttachMarker)?;
        if !ctx.human_confirmed {
            return Err(CaseError::MissingConfirmation);
        }
        req.validate().map_err(CaseError::Internal)?;
        let mut inner = self.inner.write();
        let case = inner.cases.get(&req.case_id).ok_or(CaseError::NotFound)?;
        if case.organization_id != ctx.organization_id {
            return Err(CaseError::TenantMismatch);
        }
        let now = OffsetDateTime::now_utc();
        let marker_id = Uuid::new_v4();
        let audit_id = Uuid::new_v4();
        inner.twin_markers.push(TwinMarkerRecord {
            id: marker_id,
            organization_id: ctx.organization_id,
            case_id: req.case_id,
            component_id: req.component_id.clone(),
            zone_id: req.zone_id.clone(),
        });
        inner.audit.push(AuditEntry {
            id: audit_id,
            case_id: Some(req.case_id),
            organization_id: ctx.organization_id,
            actor_user_id: ctx.user_id,
            action: "digital_twin.attach_case_marker".into(),
            payload: serde_json::json!({
                "marker_id": marker_id,
                "component_id": req.component_id,
                "zone_id": req.zone_id,
                "severity": req.severity
            }),
            correlation_id: ctx.correlation_id.0,
            created_at: now,
        });
        let trace = mutation_trace(ctx, "mxg.digital_twin.attach_case_marker", now);
        let trace_id = trace.trace_id;
        inner.traces.push(trace);
        Ok((
            DigitalTwinAttachCaseMarkerResponse {
                marker_id: Some(marker_id.to_string()),
                case_id: req.case_id,
                audit_event_id: Some(audit_id.to_string()),
                created_at: Some(now.into()),
            },
            trace_id,
        ))
    }

    async fn list_for_org(&self, org: OrganizationId) -> Result<Vec<MaintenanceCase>, CaseError> {
        Ok(InMemoryCaseService::list_for_org(self, org))
    }

    async fn timeline(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<Vec<TimelineEntry>, CaseError> {
        InMemoryCaseService::get(self, org, case_id)?;
        Ok(InMemoryCaseService::timeline(self, case_id))
    }
}

fn maybe_fail_before_commit(inner: &mut Inner) -> Result<(), CaseError> {
    if let Some(stage) = inner.fail_before_commit.take() {
        return Err(CaseError::Internal(format!(
            "injected {stage:?} persistence failure"
        )));
    }
    Ok(())
}

fn mutation_trace(
    ctx: &ExecutionContext,
    tool_name: &str,
    created_at: OffsetDateTime,
) -> MutationTraceEntry {
    MutationTraceEntry {
        trace_id: Uuid::new_v4(),
        request_id: ctx.request_id.0,
        correlation_id: ctx.correlation_id.0,
        organization_id: ctx.organization_id,
        actor_user_id: ctx.user_id,
        tool_name: tool_name.into(),
        approval_required: true,
        approval_result: "confirmed".into(),
        created_at,
    }
}

pub fn to_dto(c: &MaintenanceCase) -> CaseDto {
    CaseDto {
        case_id: c.case_id,
        organization_id: c.organization_id.0.to_string(),
        aircraft_id: c.aircraft_id.clone(),
        status: status_to_dto(c.status),
        priority: match c.priority {
            CasePriority::Routine => PriorityDto::Routine,
            CasePriority::Deferred => PriorityDto::Deferred,
            CasePriority::Urgent => PriorityDto::Urgent,
            CasePriority::Aog => PriorityDto::Aog,
        },
        opened_at: c.opened_at.into(),
        updated_at: c.updated_at.into(),
        location: c.location.as_ref().map(|l| LocationDto {
            icao: l.icao.clone(),
            iata: l.iata.clone(),
            city: l.city.clone(),
            region: l.region.clone(),
            country: l.country.clone(),
        }),
        raw_discrepancy: c.raw_discrepancy.clone(),
        normalized_discrepancy: c.normalized_discrepancy.as_ref().map(|n| {
            NormalizedDiscrepancyDto {
                summary: n.normalized_summary.clone(),
                raw: n.raw.clone(),
            }
        }),
        assigned_user_ids: c
            .assigned_user_ids
            .iter()
            .map(|u| u.0.to_string())
            .collect(),
        evidence_ids: c.evidence_ids.iter().map(|e| e.0.to_string()).collect(),
        approval_state: match c.approval_state {
            ApprovalState::Pending => ApprovalStateDto::Pending,
            ApprovalState::Approved => ApprovalStateDto::Approved,
            ApprovalState::Rejected => ApprovalStateDto::Rejected,
            ApprovalState::NotRequired => ApprovalStateDto::NotRequired,
        },
        version: c.version,
    }
}

pub fn status_to_dto(s: CaseStatus) -> CaseStatusDto {
    match s {
        CaseStatus::Draft => CaseStatusDto::Draft,
        CaseStatus::Open => CaseStatusDto::Open,
        CaseStatus::Triage => CaseStatusDto::Triage,
        CaseStatus::Diagnosing => CaseStatusDto::Diagnosing,
        CaseStatus::Planning => CaseStatusDto::Planning,
        CaseStatus::AwaitingParts => CaseStatusDto::AwaitingParts,
        CaseStatus::Scheduled => CaseStatusDto::Scheduled,
        CaseStatus::InWork => CaseStatusDto::InWork,
        CaseStatus::AwaitingInspection => CaseStatusDto::AwaitingInspection,
        CaseStatus::AwaitingApproval => CaseStatusDto::AwaitingApproval,
        CaseStatus::Closed => CaseStatusDto::Closed,
        CaseStatus::Cancelled => CaseStatusDto::Cancelled,
    }
}
