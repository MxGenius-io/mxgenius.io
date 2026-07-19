//! Transactional Postgres implementation of the MaintenanceCase spine.

use async_trait::async_trait;
use sha2::Digest;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    CaseStatusDto, DigitalTwinAttachCaseMarkerRequest, DigitalTwinAttachCaseMarkerResponse,
    LocationDto, MaintenanceCaseAttachObservationRequest, MaintenanceCaseAttachObservationResponse,
    MaintenanceCaseCreateRequest, MaintenanceCaseCreateResponse, MaintenanceCaseGetResponse,
    MaintenanceCaseUpdateStatusRequest, MaintenanceCaseUpdateStatusResponse,
    NormalizedDiscrepancyDto, PriorityDto, TimelineEntry,
};
use mxgenius_shared::domain::case::{
    ApprovalState, CasePriority, CaseStatus, Discrepancy, Location, MaintenanceCase,
};
use mxgenius_shared::domain::ids::{CaseId, DiscrepancyId, EvidenceId, OrganizationId, UserId};

use super::case_service::{status_to_dto, to_dto, CaseError, CaseService};
use crate::application::policy_enforce::check_action;

#[derive(Clone)]
pub struct PostgresCaseService {
    pool: PgPool,
}

impl PostgresCaseService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(FromRow)]
struct CaseRow {
    case_id: Uuid,
    organization_id: Uuid,
    aircraft_id: String,
    status: String,
    priority: String,
    opened_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    location: Option<serde_json::Value>,
    raw_discrepancy: String,
    normalized_discrepancy: Option<serde_json::Value>,
    assigned_user_ids: Vec<Uuid>,
    evidence_ids: Vec<Uuid>,
    approval_state: String,
    version: i64,
}

#[async_trait]
impl CaseService for PostgresCaseService {
    async fn create(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseCreateRequest,
    ) -> Result<(MaintenanceCaseCreateResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::CaseCreate)?;
        require_confirmation(ctx)?;
        let now = OffsetDateTime::now_utc();
        let case_id = Uuid::new_v4();
        let discrepancy_id = Uuid::new_v4();
        let event_id = Uuid::new_v4();
        let audit_id = Uuid::new_v4();
        let trace_id = Uuid::new_v4();
        let location = req
            .location
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(db_error)?;
        let normalized = serde_json::to_value(NormalizedDiscrepancyDto {
            summary: None,
            raw: req.raw_discrepancy.clone(),
        })
        .map_err(db_error)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        sqlx::query(
            r#"INSERT INTO maintenance_cases
               (case_id, organization_id, aircraft_id, status, priority, opened_at, updated_at,
                location, raw_discrepancy, normalized_discrepancy, approval_state, version)
               VALUES ($1,$2,$3,'open',$4,$5,$5,$6,$7,$8,'pending',1)"#,
        )
        .bind(case_id)
        .bind(ctx.organization_id.0)
        .bind(&req.aircraft_id)
        .bind(priority_db(req.priority))
        .bind(now)
        .bind(location)
        .bind(&req.raw_discrepancy)
        .bind(normalized)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            r#"INSERT INTO discrepancies
               (id, organization_id, case_id, normalized_summary, raw, created_at)
               VALUES ($1,$2,$3,NULL,$4,$5)"#,
        )
        .bind(discrepancy_id)
        .bind(ctx.organization_id.0)
        .bind(case_id)
        .bind(&req.raw_discrepancy)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        insert_event(
            &mut tx,
            ctx,
            EventWrite {
                id: event_id,
                case_id,
                from_status: None,
                to_status: "open",
                reason: Some("case created"),
                created_at: now,
            },
        )
        .await?;
        insert_audit(
            &mut tx,
            audit_id,
            ctx,
            case_id,
            "case.create",
            serde_json::json!({"aircraft_id": req.aircraft_id, "priority": priority_db(req.priority)}),
            now,
        )
        .await?;
        insert_trace(
            &mut tx,
            trace_id,
            ctx,
            case_id,
            "mxg.maintenance_case.create",
            now,
        )
        .await?;
        tx.commit().await.map_err(db_error)?;
        let case = self.get(ctx.organization_id, CaseId(case_id)).await?.case;
        Ok((
            MaintenanceCaseCreateResponse {
                case,
                created_event_ids: vec![event_id.to_string()],
                audit_event_id: audit_id.to_string(),
            },
            trace_id,
        ))
    }

    async fn get(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<MaintenanceCaseGetResponse, CaseError> {
        let row = fetch_case(&self.pool, org, case_id).await?;
        Ok(MaintenanceCaseGetResponse {
            case: to_dto(&row_to_domain(row)?),
            unresolved_conflicts: vec![],
        })
    }

    async fn update_status(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseUpdateStatusRequest,
    ) -> Result<(MaintenanceCaseUpdateStatusResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::CaseUpdateStatus)?;
        require_confirmation(ctx)?;
        let target = status_from_dto(req.target_status);
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let row: Option<CaseRow> = sqlx::query_as(
            r#"SELECT case_id, organization_id, aircraft_id, status, priority, opened_at,
                      updated_at, location, raw_discrepancy, normalized_discrepancy,
                      assigned_user_ids, evidence_ids, approval_state, version
               FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2 FOR UPDATE"#,
        )
        .bind(ctx.organization_id.0)
        .bind(req.case_id.0)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        let mut case = row_to_domain(row.ok_or(CaseError::NotFound)?)?;
        if case.version != req.expected_version {
            return Err(CaseError::StaleVersion {
                expected: req.expected_version,
                actual: case.version,
            });
        }
        if !case.status.can_transition_to(target) {
            return Err(CaseError::IllegalTransition {
                from: case.status,
                to: target,
            });
        }
        if target == CaseStatus::Closed && !ctx.approval_granted {
            return Err(CaseError::MissingApproval);
        }
        let prior = case.status;
        let now = OffsetDateTime::now_utc();
        let event_id = Uuid::new_v4();
        let audit_id = Uuid::new_v4();
        let trace_id = Uuid::new_v4();
        let approval_state = if target == CaseStatus::Closed {
            sqlx::query(
                r#"INSERT INTO approvals
                   (id, organization_id, case_id, action, required_role, granted_by,
                    granted_at, decision)
                   VALUES ($1,$2,$3,'case.close','quality',$4,$5,'approved')"#,
            )
            .bind(Uuid::new_v4())
            .bind(ctx.organization_id.0)
            .bind(req.case_id.0)
            .bind(ctx.user_id.0)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            "approved"
        } else {
            approval_db(case.approval_state)
        };
        let result = sqlx::query(
            r#"UPDATE maintenance_cases
               SET status=$1, approval_state=$2, updated_at=$3, version=version+1
               WHERE organization_id=$4 AND case_id=$5 AND version=$6"#,
        )
        .bind(status_db(target))
        .bind(approval_state)
        .bind(now)
        .bind(ctx.organization_id.0)
        .bind(req.case_id.0)
        .bind(req.expected_version)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        if result.rows_affected() != 1 {
            return Err(CaseError::StaleVersion {
                expected: req.expected_version,
                actual: req.expected_version + 1,
            });
        }
        insert_event(
            &mut tx,
            ctx,
            EventWrite {
                id: event_id,
                case_id: req.case_id.0,
                from_status: Some(status_db(prior)),
                to_status: status_db(target),
                reason: req.reason.as_deref(),
                created_at: now,
            },
        )
        .await?;
        insert_audit(
            &mut tx,
            audit_id,
            ctx,
            req.case_id.0,
            "case.update_status",
            serde_json::json!({"from": status_db(prior), "to": status_db(target), "new_version": req.expected_version + 1}),
            now,
        )
        .await?;
        insert_trace(
            &mut tx,
            trace_id,
            ctx,
            req.case_id.0,
            "mxg.maintenance_case.update_status",
            now,
        )
        .await?;
        tx.commit().await.map_err(db_error)?;
        case = row_to_domain(fetch_case(&self.pool, ctx.organization_id, req.case_id).await?)?;
        Ok((
            MaintenanceCaseUpdateStatusResponse {
                case: to_dto(&case),
                prior_status: status_to_dto(prior),
                new_status: status_to_dto(target),
                new_version: case.version,
                maintenance_event_id: event_id.to_string(),
                audit_event_id: audit_id.to_string(),
            },
            trace_id,
        ))
    }

    async fn attach_observation(
        &self,
        ctx: &ExecutionContext,
        req: &MaintenanceCaseAttachObservationRequest,
    ) -> Result<(MaintenanceCaseAttachObservationResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::CaseAttachObservation)?;
        require_confirmation(ctx)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2 FOR UPDATE",
        )
        .bind(ctx.organization_id.0)
        .bind(req.case_id.0)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        let status = status.ok_or(CaseError::NotFound)?;
        let now = OffsetDateTime::now_utc();
        let observation_id = Uuid::new_v4();
        let evidence_id = Uuid::new_v4();
        let event_id = Uuid::new_v4();
        let audit_id = Uuid::new_v4();
        let trace_id = Uuid::new_v4();
        let content_hash = format!(
            "sha256:{}",
            hex::encode(sha2::Sha256::digest(req.note.as_bytes()))
        );
        sqlx::query(
            r#"INSERT INTO observations
               (id, organization_id, case_id, note, component_id, author_user_id, media_refs, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"#,
        )
        .bind(observation_id)
        .bind(ctx.organization_id.0)
        .bind(req.case_id.0)
        .bind(&req.note)
        .bind(&req.component_id)
        .bind(ctx.user_id.0)
        .bind(serde_json::to_value(&req.media_refs).map_err(db_error)?)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            r#"INSERT INTO evidence
               (id, organization_id, source_type, source_reference, kind, title,
                retrieved_at, content_hash, content)
               VALUES ($1,$2,'user_observation',$3,'observation','Maintenance case observation',$4,$5,$6)"#,
        )
        .bind(evidence_id)
        .bind(ctx.organization_id.0)
        .bind(format!("observation:{observation_id}"))
        .bind(now)
        .bind(&content_hash)
        .bind(&req.note)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            "INSERT INTO evidence_links (organization_id,evidence_id,case_id) VALUES ($1,$2,$3)",
        )
        .bind(ctx.organization_id.0)
        .bind(evidence_id)
        .bind(req.case_id.0)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            r#"UPDATE maintenance_cases SET evidence_ids=array_append(evidence_ids,$1),
               updated_at=$2, version=version+1 WHERE organization_id=$3 AND case_id=$4"#,
        )
        .bind(evidence_id)
        .bind(now)
        .bind(ctx.organization_id.0)
        .bind(req.case_id.0)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        insert_event(
            &mut tx,
            ctx,
            EventWrite {
                id: event_id,
                case_id: req.case_id.0,
                from_status: Some(&status),
                to_status: &status,
                reason: Some("observation attached"),
                created_at: now,
            },
        )
        .await?;
        insert_audit(
            &mut tx,
            audit_id,
            ctx,
            req.case_id.0,
            "case.attach_observation",
            serde_json::json!({"observation_id": observation_id, "evidence_id": evidence_id, "component_id": req.component_id, "media_count": req.media_refs.len()}),
            now,
        )
        .await?;
        insert_trace(
            &mut tx,
            trace_id,
            ctx,
            req.case_id.0,
            "mxg.maintenance_case.attach_observation",
            now,
        )
        .await?;
        tx.commit().await.map_err(db_error)?;
        Ok((
            MaintenanceCaseAttachObservationResponse {
                observation_id: observation_id.to_string(),
                evidence_id: evidence_id.to_string(),
                maintenance_event_id: event_id.to_string(),
                audit_event_id: audit_id.to_string(),
            },
            trace_id,
        ))
    }

    async fn attach_twin_marker(
        &self,
        ctx: &ExecutionContext,
        req: &DigitalTwinAttachCaseMarkerRequest,
    ) -> Result<(DigitalTwinAttachCaseMarkerResponse, Uuid), CaseError> {
        check_action(ctx.role, Action::TwinAttachMarker)?;
        require_confirmation(ctx)?;
        req.validate().map_err(CaseError::Internal)?;
        let now = OffsetDateTime::now_utc();
        let marker_id = Uuid::new_v4();
        let audit_id = Uuid::new_v4();
        let trace_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let exists = sqlx::query_scalar::<_, Uuid>(
            "SELECT case_id FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2 FOR UPDATE",
        )
        .bind(ctx.organization_id.0)
        .bind(req.case_id.0)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        if exists.is_none() {
            return Err(CaseError::NotFound);
        }
        sqlx::query(
            r#"INSERT INTO digital_twin_markers
               (id,organization_id,case_id,component_id,zone_id,severity,observation_id,created_by,created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"#,
        )
        .bind(marker_id)
        .bind(ctx.organization_id.0)
        .bind(req.case_id.0)
        .bind(&req.component_id)
        .bind(&req.zone_id)
        .bind(format!("{:?}", req.severity).to_ascii_lowercase())
        .bind(req.observation_id.as_deref().map(Uuid::parse_str).transpose().map_err(db_error)?)
        .bind(ctx.user_id.0)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        insert_audit(
            &mut tx,
            audit_id,
            ctx,
            req.case_id.0,
            "digital_twin.attach_case_marker",
            serde_json::json!({
                "marker_id": marker_id,
                "component_id": req.component_id,
                "zone_id": req.zone_id,
                "severity": req.severity
            }),
            now,
        )
        .await?;
        insert_trace(
            &mut tx,
            trace_id,
            ctx,
            req.case_id.0,
            "mxg.digital_twin.attach_case_marker",
            now,
        )
        .await?;
        tx.commit().await.map_err(db_error)?;
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
        let rows: Vec<CaseRow> = sqlx::query_as(
            r#"SELECT case_id, organization_id, aircraft_id, status, priority, opened_at,
                      updated_at, location, raw_discrepancy, normalized_discrepancy,
                      assigned_user_ids, evidence_ids, approval_state, version
               FROM maintenance_cases WHERE organization_id=$1 ORDER BY updated_at DESC"#,
        )
        .bind(org.0)
        .fetch_all(&self.pool)
        .await
        .map_err(db_error)?;
        rows.into_iter().map(row_to_domain).collect()
    }

    async fn timeline(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<Vec<TimelineEntry>, CaseError> {
        let rows: Vec<(
            Uuid,
            Option<String>,
            String,
            Uuid,
            Option<String>,
            OffsetDateTime,
        )> = sqlx::query_as(
            r#"SELECT id, from_status, to_status, actor_user_id, reason, created_at
                   FROM maintenance_events WHERE organization_id=$1 AND case_id=$2
                   ORDER BY created_at, id"#,
        )
        .bind(org.0)
        .bind(case_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(db_error)?;
        Ok(rows
            .into_iter()
            .map(|(id, from, to, actor, reason, created_at)| TimelineEntry {
                event_id: id.to_string(),
                event_type: "maintenance_event".into(),
                occurred_at: created_at.into(),
                actor_user_id: actor.to_string(),
                summary: reason.unwrap_or_else(|| "case status changed".into()),
                from_status: from
                    .as_deref()
                    .map(parse_status)
                    .transpose()
                    .ok()
                    .flatten()
                    .map(status_to_dto),
                to_status: parse_status(&to).ok().map(status_to_dto),
            })
            .collect())
    }
}

async fn fetch_case(
    pool: &PgPool,
    org: OrganizationId,
    case_id: CaseId,
) -> Result<CaseRow, CaseError> {
    sqlx::query_as(
        r#"SELECT case_id, organization_id, aircraft_id, status, priority, opened_at,
                  updated_at, location, raw_discrepancy, normalized_discrepancy,
                  assigned_user_ids, evidence_ids, approval_state, version
           FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2"#,
    )
    .bind(org.0)
    .bind(case_id.0)
    .fetch_optional(pool)
    .await
    .map_err(db_error)?
    .ok_or(CaseError::NotFound)
}

fn row_to_domain(row: CaseRow) -> Result<MaintenanceCase, CaseError> {
    let location = row
        .location
        .map(serde_json::from_value::<LocationDto>)
        .transpose()
        .map_err(db_error)?
        .map(|location| Location {
            icao: location.icao,
            iata: location.iata,
            city: location.city,
            region: location.region,
            country: location.country,
        });
    let normalized_discrepancy = row
        .normalized_discrepancy
        .map(serde_json::from_value::<NormalizedDiscrepancyDto>)
        .transpose()
        .map_err(db_error)?
        .map(|value| Discrepancy {
            id: DiscrepancyId(Uuid::nil()),
            normalized_summary: value.summary,
            raw: value.raw,
        });
    Ok(MaintenanceCase {
        case_id: CaseId(row.case_id),
        organization_id: OrganizationId(row.organization_id),
        aircraft_id: row.aircraft_id,
        status: parse_status(&row.status)?,
        priority: parse_priority(&row.priority)?,
        opened_at: row.opened_at,
        updated_at: row.updated_at,
        location,
        raw_discrepancy: row.raw_discrepancy,
        normalized_discrepancy,
        assigned_user_ids: row.assigned_user_ids.into_iter().map(UserId).collect(),
        evidence_ids: row.evidence_ids.into_iter().map(EvidenceId).collect(),
        approval_state: parse_approval(&row.approval_state)?,
        version: row.version,
    })
}

fn require_confirmation(ctx: &ExecutionContext) -> Result<(), CaseError> {
    if ctx.human_confirmed {
        Ok(())
    } else {
        Err(CaseError::MissingConfirmation)
    }
}

fn status_from_dto(status: CaseStatusDto) -> CaseStatus {
    match status {
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
    }
}

fn status_db(status: CaseStatus) -> &'static str {
    match status {
        CaseStatus::Draft => "draft",
        CaseStatus::Open => "open",
        CaseStatus::Triage => "triage",
        CaseStatus::Diagnosing => "diagnosing",
        CaseStatus::Planning => "planning",
        CaseStatus::AwaitingParts => "awaiting_parts",
        CaseStatus::Scheduled => "scheduled",
        CaseStatus::InWork => "in_work",
        CaseStatus::AwaitingInspection => "awaiting_inspection",
        CaseStatus::AwaitingApproval => "awaiting_approval",
        CaseStatus::Closed => "closed",
        CaseStatus::Cancelled => "cancelled",
    }
}

fn parse_status(value: &str) -> Result<CaseStatus, CaseError> {
    match value {
        "draft" => Ok(CaseStatus::Draft),
        "open" => Ok(CaseStatus::Open),
        "triage" => Ok(CaseStatus::Triage),
        "diagnosing" => Ok(CaseStatus::Diagnosing),
        "planning" => Ok(CaseStatus::Planning),
        "awaiting_parts" => Ok(CaseStatus::AwaitingParts),
        "scheduled" => Ok(CaseStatus::Scheduled),
        "in_work" => Ok(CaseStatus::InWork),
        "awaiting_inspection" => Ok(CaseStatus::AwaitingInspection),
        "awaiting_approval" => Ok(CaseStatus::AwaitingApproval),
        "closed" => Ok(CaseStatus::Closed),
        "cancelled" => Ok(CaseStatus::Cancelled),
        _ => Err(CaseError::Internal(
            "database contains an unknown case status".into(),
        )),
    }
}

fn priority_db(priority: PriorityDto) -> &'static str {
    match priority {
        PriorityDto::Routine => "routine",
        PriorityDto::Deferred => "deferred",
        PriorityDto::Urgent => "urgent",
        PriorityDto::Aog => "aog",
    }
}

fn parse_priority(value: &str) -> Result<CasePriority, CaseError> {
    match value {
        "routine" => Ok(CasePriority::Routine),
        "deferred" => Ok(CasePriority::Deferred),
        "urgent" => Ok(CasePriority::Urgent),
        "aog" => Ok(CasePriority::Aog),
        _ => Err(CaseError::Internal(
            "database contains an unknown priority".into(),
        )),
    }
}

fn approval_db(value: ApprovalState) -> &'static str {
    match value {
        ApprovalState::Pending => "pending",
        ApprovalState::Approved => "approved",
        ApprovalState::Rejected => "rejected",
        ApprovalState::NotRequired => "not_required",
    }
}

fn parse_approval(value: &str) -> Result<ApprovalState, CaseError> {
    match value {
        "pending" => Ok(ApprovalState::Pending),
        "approved" => Ok(ApprovalState::Approved),
        "rejected" => Ok(ApprovalState::Rejected),
        "not_required" => Ok(ApprovalState::NotRequired),
        _ => Err(CaseError::Internal(
            "database contains an unknown approval state".into(),
        )),
    }
}

struct EventWrite<'a> {
    id: Uuid,
    case_id: Uuid,
    from_status: Option<&'a str>,
    to_status: &'a str,
    reason: Option<&'a str>,
    created_at: OffsetDateTime,
}

async fn insert_event(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ExecutionContext,
    event: EventWrite<'_>,
) -> Result<(), CaseError> {
    sqlx::query(
        r#"INSERT INTO maintenance_events
           (id,organization_id,case_id,from_status,to_status,actor_user_id,reason,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"#,
    )
    .bind(event.id)
    .bind(ctx.organization_id.0)
    .bind(event.case_id)
    .bind(event.from_status)
    .bind(event.to_status)
    .bind(ctx.user_id.0)
    .bind(event.reason)
    .bind(event.created_at)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn insert_audit(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    ctx: &ExecutionContext,
    case_id: Uuid,
    action: &str,
    payload: serde_json::Value,
    now: OffsetDateTime,
) -> Result<(), CaseError> {
    sqlx::query(
        r#"INSERT INTO audit_events
           (id,case_id,actor_user_id,organization_id,action,payload,correlation_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"#,
    )
    .bind(id)
    .bind(case_id)
    .bind(ctx.user_id.0)
    .bind(ctx.organization_id.0)
    .bind(action)
    .bind(payload)
    .bind(ctx.correlation_id.0)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn insert_trace(
    tx: &mut Transaction<'_, Postgres>,
    trace_id: Uuid,
    ctx: &ExecutionContext,
    case_id: Uuid,
    tool_name: &str,
    now: OffsetDateTime,
) -> Result<(), CaseError> {
    sqlx::query(
        r#"INSERT INTO capability_traces
           (id,trace_id,request_id,correlation_id,tool_name,tool_version,input_schema_version,
            output_schema_version,domain_schema_version,organization_id,user_id,role,case_id,
            started_at,completed_at,latency_ms,status,approval_required,approval_result)
           VALUES ($1,$1,$2,$3,$4,$5,'1.0.0','1.0.0','1.0.0',$6,$7,$8,$9,$10,$10,0,
                   'ok',true,'confirmed')"#,
    )
    .bind(trace_id)
    .bind(ctx.request_id.0)
    .bind(ctx.correlation_id.0)
    .bind(tool_name)
    .bind(mxgenius_shared::PACKAGE_VERSION)
    .bind(ctx.organization_id.0)
    .bind(ctx.user_id.0)
    .bind(ctx.role.as_str())
    .bind(case_id)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

fn db_error(error: impl std::fmt::Display) -> CaseError {
    CaseError::Internal(error.to_string())
}
