//! The serialized rotable register, and the core obligations attached to it.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::domain::rotable::{
    edit_touches_pairing, retirement_note, status_aircraft_contradiction, RetirementBlocker,
    RotableStatus, MAX_RETIREMENT_REASON, OPEN_CANNIBALIZATION_STATUSES, OPEN_CORE_STATUSES,
    OPEN_WARRANTY_STATUSES,
};

use crate::application::parts_inventory::PartsInventoryError;

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RotableUnitDto {
    pub id: Uuid,
    pub part_id: Option<Uuid>,
    pub part_number: String,
    pub serial_number: String,
    pub nomenclature: Option<String>,
    pub current_status: String,
    pub current_aircraft_id: Option<String>,
    pub stock_unit_id: Option<Uuid>,
    pub last_part_event_id: Option<Uuid>,
    pub times_repaired: i32,
    pub notes: Option<String>,
    pub version: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RotableQuery {
    pub status: Option<String>,
    pub aircraft_id: Option<String>,
    pub part_number: Option<String>,
    pub include_retired: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRotableInput {
    pub part_id: Option<Uuid>,
    pub part_number: String,
    pub serial_number: String,
    pub nomenclature: Option<String>,
    pub current_status: Option<String>,
    pub current_aircraft_id: Option<String>,
    pub stock_unit_id: Option<Uuid>,
    pub notes: Option<String>,
}

/// A partial edit. Every field is optional, and `None` means "leave it
/// alone" rather than "clear it", which is what lets a notes-only edit avoid
/// the coherence check entirely.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRotableInput {
    pub nomenclature: Option<String>,
    pub current_status: Option<String>,
    pub current_aircraft_id: Option<String>,
    pub times_repaired: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetireRotableInput {
    pub reason: String,
}

pub struct RotableRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> RotableRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(
        &self,
        context: &ExecutionContext,
        query: &RotableQuery,
    ) -> Result<Vec<RotableUnitDto>, PartsInventoryError> {
        if let Some(status) = query.status.as_deref() {
            if RotableStatus::parse(status).is_none() {
                return Err(PartsInventoryError::Invalid(format!(
                    "status must be one of in_stock, installed, in_repair, in_transit, on_loan, scrapped; received {status}"
                )));
            }
        }
        sqlx::query_as::<_, RotableUnitDto>(
            r#"SELECT id, part_id, part_number, serial_number, nomenclature,
                      current_status, current_aircraft_id, stock_unit_id,
                      last_part_event_id, times_repaired, notes, version,
                      created_at, updated_at
               FROM rotable_units
               WHERE organization_id=$1
                 AND ($2 OR retired_at IS NULL)
                 AND ($3::text IS NULL OR current_status=$3)
                 AND ($4::text IS NULL OR current_aircraft_id=$4)
                 AND ($5::text IS NULL OR part_number=$5)
               ORDER BY part_number, serial_number
               LIMIT 250"#,
        )
        .bind(context.organization_id.0)
        .bind(query.include_retired.unwrap_or(false))
        .bind(query.status.as_deref())
        .bind(query.aircraft_id.as_deref())
        .bind(query.part_number.as_deref())
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
    ) -> Result<RotableUnitDto, PartsInventoryError> {
        sqlx::query_as::<_, RotableUnitDto>(
            r#"SELECT id, part_id, part_number, serial_number, nomenclature,
                      current_status, current_aircraft_id, stock_unit_id,
                      last_part_event_id, times_repaired, notes, version,
                      created_at, updated_at
               FROM rotable_units WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    pub async fn create(
        &self,
        context: &ExecutionContext,
        input: &CreateRotableInput,
    ) -> Result<RotableUnitDto, PartsInventoryError> {
        let part_number = input.part_number.trim();
        let serial_number = input.serial_number.trim();
        if part_number.is_empty() || serial_number.is_empty() {
            return Err(PartsInventoryError::Invalid(
                "a rotable is identified by its part number and serial number; both are required"
                    .into(),
            ));
        }
        let status = match input.current_status.as_deref() {
            None => RotableStatus::InStock,
            Some(value) => RotableStatus::parse(value).ok_or_else(|| {
                PartsInventoryError::Invalid(format!("unknown rotable status {value}"))
            })?,
        };
        let aircraft = trimmed(input.current_aircraft_id.as_deref());
        // A new record is always judged: there is no legacy to protect.
        if let Some(problem) = status_aircraft_contradiction(status, aircraft.as_deref()) {
            return Err(PartsInventoryError::Invalid(problem.into()));
        }

        let duplicate: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1 FROM rotable_units
                 WHERE organization_id=$1 AND part_number=$2
                   AND lower(serial_number)=lower($3) AND retired_at IS NULL)"#,
        )
        .bind(context.organization_id.0)
        .bind(part_number)
        .bind(serial_number)
        .fetch_one(self.pool)
        .await?;
        if duplicate {
            return Err(PartsInventoryError::Conflict(format!(
                "{part_number} serial {serial_number} is already on the register"
            )));
        }

        sqlx::query_as::<_, RotableUnitDto>(
            r#"INSERT INTO rotable_units
               (id,organization_id,part_id,part_number,serial_number,nomenclature,
                current_status,current_aircraft_id,stock_unit_id,notes,created_by,
                created_at,updated_at,version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now(),1)
               RETURNING id, part_id, part_number, serial_number, nomenclature,
                         current_status, current_aircraft_id, stock_unit_id,
                         last_part_event_id, times_repaired, notes, version,
                         created_at, updated_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(input.part_id)
        .bind(part_number)
        .bind(serial_number)
        .bind(trimmed(input.nomenclature.as_deref()))
        .bind(status.as_str())
        .bind(aircraft)
        .bind(input.stock_unit_id)
        .bind(trimmed(input.notes.as_deref()))
        .bind(context.user_id.0)
        .fetch_one(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Applies a partial edit. Coherence is judged against the *merged* state,
    /// and only when the caller actually touched the status or the aircraft.
    /// An edit that changes only the notes on a legacy contradictory row
    /// succeeds, because rejecting it would block the user on data they never
    /// entered and cannot see.
    pub async fn update(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
        expected_version: i64,
        input: &UpdateRotableInput,
    ) -> Result<RotableUnitDto, PartsInventoryError> {
        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64, Option<String>, Option<OffsetDateTime>)> =
            sqlx::query_as(
                r#"SELECT current_status, version, current_aircraft_id, retired_at
                   FROM rotable_units
                   WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
            )
            .bind(context.organization_id.0)
            .bind(unit_id)
            .fetch_optional(&mut *tx)
            .await?;
        let Some((status, version, aircraft, retired_at)) = current else {
            return Err(PartsInventoryError::NotFound);
        };
        if retired_at.is_some() {
            return Err(PartsInventoryError::Conflict(
                "a retired unit can no longer be edited".into(),
            ));
        }
        if version != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {version}"
            )));
        }

        let next_status = match input.current_status.as_deref() {
            None => RotableStatus::parse(&status).ok_or_else(|| {
                PartsInventoryError::Conflict(format!("unit holds unknown status {status}"))
            })?,
            Some(value) => RotableStatus::parse(value).ok_or_else(|| {
                PartsInventoryError::Invalid(format!("unknown rotable status {value}"))
            })?,
        };
        let next_aircraft = match input.current_aircraft_id.as_deref() {
            None => aircraft.clone(),
            Some(value) => trimmed(Some(value)),
        };

        if edit_touches_pairing(
            input.current_status.is_some(),
            input.current_aircraft_id.is_some(),
        ) {
            if let Some(problem) =
                status_aircraft_contradiction(next_status, next_aircraft.as_deref())
            {
                return Err(PartsInventoryError::Invalid(problem.into()));
            }
        }
        if let Some(count) = input.times_repaired {
            if count < 0 {
                return Err(PartsInventoryError::Invalid(
                    "timesRepaired cannot be negative".into(),
                ));
            }
        }

        sqlx::query(
            r#"UPDATE rotable_units
               SET nomenclature=COALESCE($3, nomenclature),
                   current_status=$4,
                   current_aircraft_id=$5,
                   times_repaired=COALESCE($6, times_repaired),
                   notes=COALESCE($7, notes),
                   version=version+1,
                   updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(trimmed(input.nomenclature.as_deref()))
        .bind(next_status.as_str())
        .bind(next_aircraft)
        .bind(input.times_repaired)
        .bind(trimmed(input.notes.as_deref()))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get(context, unit_id).await
    }

    /// Retires a unit, refusing while anything is still owed on it.
    ///
    /// Runs at SERIALIZABLE. Under a weaker level an obligation created
    /// between the check and the write commits fine — the unit row still
    /// exists — and leaves a live core or claim pointing at a retired unit,
    /// which is the exact inconsistency the guard exists to prevent. The
    /// range locks the obligation queries take block that insert instead.
    /// Retirements are rare, so the cost does not matter.
    pub async fn retire(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
        expected_version: i64,
        input: &RetireRotableInput,
    ) -> Result<RotableUnitDto, PartsInventoryError> {
        let reason = input.reason.trim();
        if reason.is_empty() {
            return Err(PartsInventoryError::Invalid(
                "retiring a unit is a disposition; record why".into(),
            ));
        }
        if reason.chars().count() > MAX_RETIREMENT_REASON {
            return Err(PartsInventoryError::Invalid(format!(
                "reason must be {MAX_RETIREMENT_REASON} characters or fewer"
            )));
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *tx)
            .await?;

        let current: Option<(i64, Option<String>, Option<OffsetDateTime>)> = sqlx::query_as(
            r#"SELECT version, notes, retired_at FROM rotable_units
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((version, notes, retired_at)) = current else {
            return Err(PartsInventoryError::NotFound);
        };
        if retired_at.is_some() {
            return Err(PartsInventoryError::Conflict(
                "this unit is already retired".into(),
            ));
        }
        if version != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {version}"
            )));
        }

        // Each of these takes a range lock under SERIALIZABLE, so a concurrent
        // insert of a new obligation conflicts rather than slipping past.
        let core_due: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM core_exchanges
               WHERE organization_id=$1 AND rotable_unit_id=$2
                 AND status = ANY($3) AND archived_at IS NULL"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(&OPEN_CORE_STATUSES[..])
        .fetch_one(&mut *tx)
        .await?;
        let warranty_open: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM warranty_claims
               WHERE organization_id=$1 AND rotable_unit_id=$2
                 AND status = ANY($3) AND archived_at IS NULL"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(&OPEN_WARRANTY_STATUSES[..])
        .fetch_one(&mut *tx)
        .await?;
        let cannibalization_open: i64 = if table_exists(&mut tx, "cannibalizations").await? {
            sqlx::query_scalar(
                r#"SELECT count(*) FROM cannibalizations
                   WHERE organization_id=$1 AND rotable_unit_id=$2 AND status = ANY($3)"#,
            )
            .bind(context.organization_id.0)
            .bind(unit_id)
            .bind(&OPEN_CANNIBALIZATION_STATUSES[..])
            .fetch_one(&mut *tx)
            .await?
        } else {
            0
        };

        let mut blockers = Vec::new();
        if core_due > 0 {
            blockers.push(RetirementBlocker::CoreDue.message());
        }
        if cannibalization_open > 0 {
            blockers.push(RetirementBlocker::OpenCannibalization.message());
        }
        if warranty_open > 0 {
            blockers.push(RetirementBlocker::OpenWarrantyClaim.message());
        }
        if !blockers.is_empty() {
            return Err(PartsInventoryError::Conflict(format!(
                "this unit cannot be retired: {}",
                blockers.join("; ")
            )));
        }

        let actor = context.user_id.0.to_string();
        let stamped_at = OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "unknown time".into());
        let note = retirement_note(reason, &actor, &stamped_at, notes.as_deref());

        sqlx::query(
            r#"UPDATE rotable_units
               SET retired_at=now(), notes=$3, version=version+1, updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(note)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get(context, unit_id).await
    }
}

/// The cannibalization table arrives in a later migration. Until it does, the
/// retirement guard must not fail on a missing relation.
async fn table_exists(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
) -> Result<bool, PartsInventoryError> {
    let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
        .bind(name)
        .fetch_one(&mut **tx)
        .await?;
    Ok(exists)
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
