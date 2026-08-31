//! Cannibalization records: the approval chain, and the gate that decides
//! whether a completion describes a real rob.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::paging::{Page, PageRequest};
use mxgenius_shared::domain::cannibalization::{
    completion_problem, life_transfer_missing, proposal_problem, violates_separation_of_duties,
    CannibalizationStatus, CompletionFacts,
};

use crate::application::parts_inventory::PartsInventoryError;

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CannibalizationDto {
    pub id: Uuid,
    pub rotable_unit_id: Option<Uuid>,
    pub donor_removal_event_id: Option<Uuid>,
    pub receiver_install_event_id: Option<Uuid>,
    pub donor_aircraft_id: Option<String>,
    pub receiver_aircraft_id: Option<String>,
    pub part_number: Option<String>,
    pub serial_number: Option<String>,
    pub is_life_limited: bool,
    pub transferred_hours: Option<f64>,
    pub transferred_cycles: Option<i32>,
    pub backfill_order_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub cannibalized_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expected_rts_without: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expected_rts_with: Option<OffsetDateTime>,
    pub rts_impact_rationale: Option<String>,
    pub status: String,
    pub proposed_by: Uuid,
    pub approved_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub decided_at: Option<OffsetDateTime>,
    pub notes: Option<String>,
    pub version: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CannibalizationQuery {
    pub status: Option<String>,
    pub aircraft_id: Option<String>,
    #[serde(default, deserialize_with = "mxgenius_shared::application::paging::lenient_page_number")]
    pub page: Option<i64>,
    #[serde(default, deserialize_with = "mxgenius_shared::application::paging::lenient_page_number")]
    pub page_size: Option<i64>,
}

impl CannibalizationQuery {
    fn page_request(&self) -> PageRequest {
        PageRequest::clamped(self.page, self.page_size)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeCannibalizationInput {
    pub rotable_unit_id: Option<Uuid>,
    pub donor_removal_event_id: Option<Uuid>,
    pub receiver_install_event_id: Option<Uuid>,
    pub donor_aircraft_id: Option<String>,
    pub receiver_aircraft_id: Option<String>,
    pub part_number: Option<String>,
    pub serial_number: Option<String>,
    pub is_life_limited: Option<bool>,
    pub transferred_hours: Option<f64>,
    pub transferred_cycles: Option<i32>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub expected_rts_without: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub expected_rts_with: Option<OffsetDateTime>,
    pub rts_impact_rationale: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideCannibalizationInput {
    pub status: String,
    /// Supplied at approval when the proposal did not already carry them.
    pub transferred_hours: Option<f64>,
    pub transferred_cycles: Option<i32>,
    pub donor_removal_event_id: Option<Uuid>,
    pub receiver_install_event_id: Option<Uuid>,
    pub notes: Option<String>,
}

/// What the event ledger says about the two events a completion names.
#[derive(Debug, FromRow)]
struct EventFactsRow {
    event_kind: String,
    removal_reason: Option<String>,
    aircraft_id: Option<String>,
    stock_unit_id: Option<Uuid>,
}

pub struct CannibalizationRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> CannibalizationRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(
        &self,
        context: &ExecutionContext,
        query: &CannibalizationQuery,
    ) -> Result<Page<CannibalizationDto>, PartsInventoryError> {
        if let Some(status) = query.status.as_deref() {
            if CannibalizationStatus::parse(status).is_none() {
                return Err(PartsInventoryError::Invalid(format!(
                    "status must be one of proposed, approved, rejected, completed, cancelled; received {status}"
                )));
            }
        }
        let paging = query.page_request();
        const FILTER: &str = "FROM cannibalizations
               WHERE organization_id=$1
                 AND ($2::text IS NULL OR status=$2)
                 AND ($3::text IS NULL OR donor_aircraft_id=$3 OR receiver_aircraft_id=$3)";

        let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) {FILTER}"))
            .bind(context.organization_id.0)
            .bind(query.status.as_deref())
            .bind(query.aircraft_id.as_deref())
            .fetch_one(self.pool)
            .await?;

        // `created_at` alone is not unique, so without the `id` tiebreaker two
        // rows sharing a timestamp could straddle a page boundary and be
        // returned twice or skipped entirely.
        let rows = sqlx::query_as::<_, CannibalizationDto>(&format!(
            r#"SELECT id, rotable_unit_id, donor_removal_event_id, receiver_install_event_id,
                      donor_aircraft_id, receiver_aircraft_id, part_number, serial_number,
                      is_life_limited,
                      transferred_hours::double precision AS transferred_hours,
                      transferred_cycles, backfill_order_id, cannibalized_at,
                      expected_rts_without, expected_rts_with, rts_impact_rationale,
                      status, proposed_by, approved_by, decided_at, notes, version, created_at
               {FILTER}
               ORDER BY CASE status
                            WHEN 'proposed' THEN 0
                            WHEN 'approved' THEN 1
                            ELSE 2
                        END,
                        created_at DESC,
                        id
               LIMIT $4 OFFSET $5"#
        ))
        .bind(context.organization_id.0)
        .bind(query.status.as_deref())
        .bind(query.aircraft_id.as_deref())
        .bind(paging.limit())
        .bind(paging.offset())
        .fetch_all(self.pool)
        .await?;
        Ok(Page::new(rows, paging, total))
    }

    pub async fn get(
        &self,
        context: &ExecutionContext,
        id: Uuid,
    ) -> Result<CannibalizationDto, PartsInventoryError> {
        sqlx::query_as::<_, CannibalizationDto>(
            r#"SELECT id, rotable_unit_id, donor_removal_event_id, receiver_install_event_id,
                      donor_aircraft_id, receiver_aircraft_id, part_number, serial_number,
                      is_life_limited,
                      transferred_hours::double precision AS transferred_hours,
                      transferred_cycles, backfill_order_id, cannibalized_at,
                      expected_rts_without, expected_rts_with, rts_impact_rationale,
                      status, proposed_by, approved_by, decided_at, notes, version, created_at
               FROM cannibalizations WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    /// Records a proposal. Every referenced row is checked before the insert,
    /// so a mistyped id is a clear rejection rather than a foreign-key error
    /// surfacing as a server fault.
    pub async fn propose(
        &self,
        context: &ExecutionContext,
        input: &ProposeCannibalizationInput,
    ) -> Result<CannibalizationDto, PartsInventoryError> {
        if let Some(problem) = proposal_problem(
            input.rotable_unit_id.is_some(),
            input.serial_number.as_deref(),
            input.donor_aircraft_id.as_deref(),
            input.donor_removal_event_id.is_some(),
            input.receiver_aircraft_id.as_deref(),
        ) {
            return Err(PartsInventoryError::Invalid(problem.message().into()));
        }

        if let Some(rotable) = input.rotable_unit_id {
            self.require_exists("rotable_units", context, rotable, "rotableUnitId")
                .await?;
        }
        if let Some(event) = input.donor_removal_event_id {
            self.require_exists("part_events", context, event, "donorRemovalEventId")
                .await?;
        }
        if let Some(event) = input.receiver_install_event_id {
            self.require_exists("part_events", context, event, "receiverInstallEventId")
                .await?;
        }

        sqlx::query_as::<_, CannibalizationDto>(
            r#"INSERT INTO cannibalizations
               (id,organization_id,rotable_unit_id,donor_removal_event_id,
                receiver_install_event_id,donor_aircraft_id,receiver_aircraft_id,
                part_number,serial_number,is_life_limited,transferred_hours,
                transferred_cycles,expected_rts_without,expected_rts_with,
                rts_impact_rationale,notes,status,proposed_by,cannibalized_at,
                created_at,updated_at,version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                       'proposed',$17,now(),now(),now(),1)
               RETURNING id, rotable_unit_id, donor_removal_event_id, receiver_install_event_id,
                         donor_aircraft_id, receiver_aircraft_id, part_number, serial_number,
                         is_life_limited,
                         transferred_hours::double precision AS transferred_hours,
                         transferred_cycles, backfill_order_id, cannibalized_at,
                         expected_rts_without, expected_rts_with, rts_impact_rationale,
                         status, proposed_by, approved_by, decided_at, notes, version, created_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(input.rotable_unit_id)
        .bind(input.donor_removal_event_id)
        .bind(input.receiver_install_event_id)
        .bind(trimmed(input.donor_aircraft_id.as_deref()))
        .bind(trimmed(input.receiver_aircraft_id.as_deref()))
        .bind(trimmed(input.part_number.as_deref()))
        .bind(trimmed(input.serial_number.as_deref()))
        .bind(input.is_life_limited.unwrap_or(false))
        .bind(input.transferred_hours)
        .bind(input.transferred_cycles)
        .bind(input.expected_rts_without)
        .bind(input.expected_rts_with)
        .bind(trimmed(input.rts_impact_rationale.as_deref()))
        .bind(trimmed(input.notes.as_deref()))
        .bind(context.user_id.0)
        .fetch_one(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Moves a rob along its chain. Approval, rejection, cancellation, and
    /// completion all arrive here so the separation-of-duties and completion
    /// gates cannot be reached by a path that skips them.
    pub async fn decide(
        &self,
        context: &ExecutionContext,
        id: Uuid,
        expected_version: i64,
        input: &DecideCannibalizationInput,
    ) -> Result<CannibalizationDto, PartsInventoryError> {
        let target = CannibalizationStatus::parse(&input.status).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "status must be one of approved, rejected, completed, cancelled; received {}",
                input.status
            ))
        })?;

        let mut tx = self.pool.begin().await?;
        let current: Option<CurrentRow> = sqlx::query_as(
            r#"SELECT status, version, proposed_by, is_life_limited,
                      transferred_hours::double precision, transferred_cycles,
                      donor_removal_event_id, receiver_install_event_id,
                      donor_aircraft_id, receiver_aircraft_id, rotable_unit_id
               FROM cannibalizations
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = current else {
            return Err(PartsInventoryError::NotFound);
        };
        if row.1 != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {}",
                row.1
            )));
        }
        let source = CannibalizationStatus::parse(&row.0).ok_or_else(|| {
            PartsInventoryError::Conflict(format!("record holds unknown status {}", row.0))
        })?;
        if !source.can_transition_to(target) {
            return Err(PartsInventoryError::Conflict(format!(
                "a cannibalization that is {} cannot move to {}",
                source.as_str(),
                target.as_str()
            )));
        }

        let deciding = context.user_id.0;
        let proposer = row.2;
        let decides = matches!(
            target,
            CannibalizationStatus::Approved | CannibalizationStatus::Rejected
        );
        // Separation of duties covers rejection too: one person deciding both
        // sides of their own proposal is the control failing either way.
        if decides && violates_separation_of_duties(&proposer.to_string(), &deciding.to_string()) {
            return Err(PartsInventoryError::Forbidden(
                "the person who proposed a cannibalization cannot decide it".into(),
            ));
        }

        let hours = input.transferred_hours.or(row.4);
        let cycles = input.transferred_cycles.or(row.5);
        let donor_event = input.donor_removal_event_id.or(row.6);
        let receiver_event = input.receiver_install_event_id.or(row.7);

        if matches!(
            target,
            CannibalizationStatus::Approved | CannibalizationStatus::Completed
        ) && life_transfer_missing(row.3, hours, cycles)
        {
            return Err(PartsInventoryError::Invalid(
                "this is a life-limited part; record the hours or cycles crossing to the receiving aircraft before approving"
                    .into(),
            ));
        }

        if target == CannibalizationStatus::Completed {
            self.assert_completion_describes_a_real_rob(
                &mut tx,
                context,
                id,
                donor_event,
                receiver_event,
                row.8.as_deref(),
                row.9.as_deref(),
            )
            .await?;
        }

        let approver = if decides || target == CannibalizationStatus::Completed {
            Some(deciding)
        } else {
            None
        };

        sqlx::query(
            r#"UPDATE cannibalizations
               SET status=$3,
                   approved_by=CASE WHEN $3 IN ('approved','completed') THEN COALESCE(approved_by, $4) ELSE approved_by END,
                   decided_at=CASE WHEN $3 IN ('approved','rejected','completed') THEN now() ELSE decided_at END,
                   transferred_hours=$5,
                   transferred_cycles=$6,
                   donor_removal_event_id=$7,
                   receiver_install_event_id=$8,
                   notes=COALESCE($9, notes),
                   version=version+1,
                   updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(id)
        .bind(target.as_str())
        .bind(approver)
        .bind(hours)
        .bind(cycles)
        .bind(donor_event)
        .bind(receiver_event)
        .bind(trimmed(input.notes.as_deref()))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get(context, id).await
    }

    /// Reads the two events out of the ledger and puts the completion through
    /// every gate. Nothing here trusts the cannibalization record's own copy
    /// of the facts.
    #[allow(clippy::too_many_arguments)]
    async fn assert_completion_describes_a_real_rob(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        context: &ExecutionContext,
        id: Uuid,
        donor_event: Option<Uuid>,
        receiver_event: Option<Uuid>,
        claimed_donor_aircraft: Option<&str>,
        claimed_receiver_aircraft: Option<&str>,
    ) -> Result<(), PartsInventoryError> {
        let donor = self.load_event(tx, context, donor_event).await?;
        let receiver = self.load_event(tx, context, receiver_event).await?;

        let donor_used = match donor_event {
            Some(event) => {
                self.event_completes_another(tx, context, id, event, true)
                    .await?
            }
            None => false,
        };
        let receiver_used = match receiver_event {
            Some(event) => {
                self.event_completes_another(tx, context, id, event, false)
                    .await?
            }
            None => false,
        };

        let facts = CompletionFacts {
            donor_event_exists: donor.is_some(),
            receiver_event_exists: receiver.is_some(),
            donor_kind: donor.as_ref().map(|e| e.event_kind.as_str()),
            receiver_kind: receiver.as_ref().map(|e| e.event_kind.as_str()),
            donor_removal_reason: donor.as_ref().and_then(|e| e.removal_reason.as_deref()),
            donor_rotable: donor.as_ref().and_then(|e| e.stock_unit_id),
            receiver_rotable: receiver.as_ref().and_then(|e| e.stock_unit_id),
            donor_event_aircraft: donor.as_ref().and_then(|e| e.aircraft_id.as_deref()),
            receiver_event_aircraft: receiver.as_ref().and_then(|e| e.aircraft_id.as_deref()),
            claimed_donor_aircraft,
            claimed_receiver_aircraft,
            donor_event_already_completed: donor_used,
            receiver_event_already_completed: receiver_used,
        };

        match completion_problem(&facts) {
            Some(problem) => Err(PartsInventoryError::Invalid(problem.message().into())),
            None => Ok(()),
        }
    }

    async fn load_event(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        context: &ExecutionContext,
        event_id: Option<Uuid>,
    ) -> Result<Option<EventFactsRow>, PartsInventoryError> {
        let Some(event_id) = event_id else {
            return Ok(None);
        };
        sqlx::query_as::<_, EventFactsRow>(
            r#"SELECT event_kind, removal_reason, aircraft_id, stock_unit_id
               FROM part_events
               WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL"#,
        )
        .bind(context.organization_id.0)
        .bind(event_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(Into::into)
    }

    async fn event_completes_another(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        context: &ExecutionContext,
        self_id: Uuid,
        event_id: Uuid,
        donor_side: bool,
    ) -> Result<bool, PartsInventoryError> {
        let column = if donor_side {
            "donor_removal_event_id"
        } else {
            "receiver_install_event_id"
        };
        let sql = format!(
            r#"SELECT EXISTS(
                 SELECT 1 FROM cannibalizations
                 WHERE organization_id=$1 AND id <> $2
                   AND status='completed' AND {column}=$3)"#
        );
        sqlx::query_scalar::<_, bool>(&sql)
            .bind(context.organization_id.0)
            .bind(self_id)
            .bind(event_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(Into::into)
    }

    async fn require_exists(
        &self,
        table: &str,
        context: &ExecutionContext,
        id: Uuid,
        field: &str,
    ) -> Result<(), PartsInventoryError> {
        let sql =
            format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE organization_id=$1 AND id=$2)");
        let exists: bool = sqlx::query_scalar(&sql)
            .bind(context.organization_id.0)
            .bind(id)
            .fetch_one(self.pool)
            .await?;
        if exists {
            Ok(())
        } else {
            Err(PartsInventoryError::Invalid(format!(
                "{field} does not name a record in this organization"
            )))
        }
    }
}

/// `(status, version, proposed_by, is_life_limited, hours, cycles,
/// donor_event, receiver_event, donor_aircraft, receiver_aircraft, rotable)`
type CurrentRow = (
    String,
    i64,
    Uuid,
    bool,
    Option<f64>,
    Option<i32>,
    Option<Uuid>,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    Option<Uuid>,
);

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
