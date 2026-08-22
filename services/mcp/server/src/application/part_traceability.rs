//! Traceability: shipment legs, and the atomic install/removal events that
//! record when a part went on or came off an aircraft.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::domain::part_trace::{
    PartEventKind, RemovalReason, ShipmentPurpose, ShipmentStatus, TraceType,
};

use crate::application::parts_inventory::PartsInventoryError;

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PartShipmentDto {
    pub id: Uuid,
    pub part_requirement_id: Uuid,
    pub part_order_id: Option<Uuid>,
    pub purpose: String,
    pub leg_sequence: i32,
    pub serial_number: Option<String>,
    pub origin: Option<String>,
    pub destination: Option<String>,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub status: String,
    pub shipped_at: Option<OffsetDateTime>,
    pub received_at: Option<OffsetDateTime>,
    pub received_by: Option<String>,
    pub certificate_number: Option<String>,
    pub certificate_type: Option<String>,
    pub notes: Option<String>,
    pub version: i64,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShipmentInput {
    pub part_requirement_id: Uuid,
    pub part_order_id: Option<Uuid>,
    pub purpose: Option<String>,
    pub leg_sequence: Option<i32>,
    pub serial_number: Option<String>,
    pub origin: Option<String>,
    pub destination: Option<String>,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub certificate_number: Option<String>,
    pub certificate_type: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipmentStatusInput {
    pub status: String,
    pub received_by: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PartEventDto {
    pub id: Uuid,
    pub part_requirement_id: Option<Uuid>,
    pub stock_unit_id: Option<Uuid>,
    pub event_kind: String,
    pub aircraft_id: Option<String>,
    pub case_id: Option<Uuid>,
    pub part_number: String,
    pub part_serial: Option<String>,
    pub position_reference: Option<String>,
    pub event_at: OffsetDateTime,
    pub performed_by: Option<String>,
    pub removal_reason: Option<String>,
    pub notes: Option<String>,
    pub version: i64,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventInput {
    pub event_kind: String,
    pub part_requirement_id: Option<Uuid>,
    pub stock_unit_id: Option<Uuid>,
    pub aircraft_id: Option<String>,
    pub case_id: Option<Uuid>,
    pub part_number: String,
    pub part_serial: Option<String>,
    pub position_reference: Option<String>,
    pub event_at: Option<OffsetDateTime>,
    pub performed_by: Option<String>,
    pub removal_reason: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventQuery {
    pub aircraft_id: Option<String>,
    pub part_number: Option<String>,
    pub part_serial: Option<String>,
    pub stock_unit_id: Option<Uuid>,
}

pub struct PartTraceabilityRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> PartTraceabilityRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_shipments(
        &self,
        context: &ExecutionContext,
        requirement_id: Uuid,
    ) -> Result<Vec<PartShipmentDto>, PartsInventoryError> {
        sqlx::query_as::<_, PartShipmentDto>(
            r#"SELECT id, part_requirement_id, part_order_id, purpose, leg_sequence,
                      serial_number, origin, destination, carrier, tracking_number,
                      status, shipped_at, received_at, received_by,
                      certificate_number, certificate_type, notes, version, created_at
               FROM part_shipments
               WHERE organization_id=$1 AND part_requirement_id=$2 AND archived_at IS NULL
               ORDER BY leg_sequence, created_at, id"#,
        )
        .bind(context.organization_id.0)
        .bind(requirement_id)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn create_shipment(
        &self,
        context: &ExecutionContext,
        input: &CreateShipmentInput,
    ) -> Result<PartShipmentDto, PartsInventoryError> {
        let purpose = match input.purpose.as_deref() {
            None => ShipmentPurpose::Procurement,
            Some(value) => ShipmentPurpose::parse(value).ok_or_else(|| {
                PartsInventoryError::Invalid(format!(
                    "purpose must be one of procurement, repair_out, repair_return, transfer, return; received {value}"
                ))
            })?,
        };
        if let Some(certificate) = input.certificate_type.as_deref() {
            if TraceType::parse(certificate).is_none() {
                return Err(PartsInventoryError::Invalid(format!(
                    "certificateType is not a recognized document: {certificate}"
                )));
            }
        }
        let leg = input.leg_sequence.unwrap_or(1);
        if leg < 1 {
            return Err(PartsInventoryError::Invalid(
                "legSequence starts at 1".into(),
            ));
        }

        sqlx::query_as::<_, PartShipmentDto>(
            r#"INSERT INTO part_shipments
               (id,organization_id,part_requirement_id,part_order_id,purpose,leg_sequence,
                serial_number,origin,destination,carrier,tracking_number,
                certificate_number,certificate_type,notes,status,created_by,
                created_at,updated_at,version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,now(),now(),1)
               RETURNING id, part_requirement_id, part_order_id, purpose, leg_sequence,
                         serial_number, origin, destination, carrier, tracking_number,
                         status, shipped_at, received_at, received_by,
                         certificate_number, certificate_type, notes, version, created_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(input.part_requirement_id)
        .bind(input.part_order_id)
        .bind(purpose.as_str())
        .bind(leg)
        .bind(trimmed(input.serial_number.as_deref()))
        .bind(trimmed(input.origin.as_deref()))
        .bind(trimmed(input.destination.as_deref()))
        .bind(trimmed(input.carrier.as_deref()))
        .bind(trimmed(input.tracking_number.as_deref()))
        .bind(trimmed(input.certificate_number.as_deref()))
        .bind(input.certificate_type.as_deref())
        .bind(trimmed(input.notes.as_deref()))
        .bind(context.user_id.0)
        .fetch_one(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Moves a leg along. Marking it delivered stamps the arrival time, which
    /// the schema also requires, so a delivered leg can always answer when it
    /// landed.
    pub async fn set_shipment_status(
        &self,
        context: &ExecutionContext,
        shipment_id: Uuid,
        expected_version: i64,
        input: &ShipmentStatusInput,
    ) -> Result<PartShipmentDto, PartsInventoryError> {
        let target = ShipmentStatus::parse(&input.status).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "status must be one of pending, in_transit, delivered, exception; received {}",
                input.status
            ))
        })?;

        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64)> = sqlx::query_as(
            r#"SELECT status, version FROM part_shipments
               WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(shipment_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((status, version)) = current else {
            return Err(PartsInventoryError::NotFound);
        };
        if version != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {version}"
            )));
        }
        let source = ShipmentStatus::parse(&status).ok_or_else(|| {
            PartsInventoryError::Conflict(format!("shipment holds unknown status {status}"))
        })?;
        if !source.can_transition_to(target) {
            return Err(PartsInventoryError::Conflict(format!(
                "a leg that is {} cannot move to {}",
                source.as_str(),
                target.as_str()
            )));
        }

        sqlx::query(
            r#"UPDATE part_shipments
               SET status=$3,
                   shipped_at=CASE WHEN $3='in_transit' AND shipped_at IS NULL THEN now() ELSE shipped_at END,
                   received_at=CASE WHEN $3='delivered' THEN COALESCE(received_at, now()) ELSE received_at END,
                   received_by=COALESCE($4, received_by),
                   notes=COALESCE($5, notes),
                   version=version+1,
                   updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(shipment_id)
        .bind(target.as_str())
        .bind(trimmed(input.received_by.as_deref()))
        .bind(trimmed(input.notes.as_deref()))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        sqlx::query_as::<_, PartShipmentDto>(
            r#"SELECT id, part_requirement_id, part_order_id, purpose, leg_sequence,
                      serial_number, origin, destination, carrier, tracking_number,
                      status, shipped_at, received_at, received_by,
                      certificate_number, certificate_type, notes, version, created_at
               FROM part_shipments WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(shipment_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    /// Records one install or one removal. A swap is two calls; there is no
    /// combined form, because the atomicity is what lets a later
    /// cannibalization correlate two existing events rather than restate them.
    pub async fn create_event(
        &self,
        context: &ExecutionContext,
        input: &CreateEventInput,
    ) -> Result<PartEventDto, PartsInventoryError> {
        let kind = PartEventKind::parse(&input.event_kind).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "eventKind must be install or removal; a swap is recorded as two events, received {}",
                input.event_kind
            ))
        })?;

        let reason = match input.removal_reason.as_deref() {
            None => None,
            Some(value) => {
                let parsed = RemovalReason::parse(value).ok_or_else(|| {
                    PartsInventoryError::Invalid(format!(
                        "removalReason must be one of scheduled, unscheduled, cannibalized, repair; received {value}"
                    ))
                })?;
                if !kind.accepts_removal_reason() {
                    return Err(PartsInventoryError::Invalid(
                        "an install does not carry a removal reason".into(),
                    ));
                }
                Some(parsed)
            }
        };

        let part_number = input.part_number.trim();
        if part_number.is_empty() {
            return Err(PartsInventoryError::Invalid(
                "partNumber is required to identify what moved".into(),
            ));
        }
        let aircraft = trimmed(input.aircraft_id.as_deref());
        if aircraft.is_none() && input.case_id.is_none() {
            return Err(PartsInventoryError::Invalid(
                "an event must name the aircraft it happened on, the case it belongs to, or both"
                    .into(),
            ));
        }

        sqlx::query_as::<_, PartEventDto>(
            r#"INSERT INTO part_events
               (id,organization_id,part_requirement_id,stock_unit_id,event_kind,
                aircraft_id,case_id,part_number,part_serial,position_reference,
                event_at,performed_by,removal_reason,notes,created_by,
                created_at,updated_at,version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, now()),$12,$13,$14,$15,now(),now(),1)
               RETURNING id, part_requirement_id, stock_unit_id, event_kind, aircraft_id,
                         case_id, part_number, part_serial, position_reference, event_at,
                         performed_by, removal_reason, notes, version, created_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(input.part_requirement_id)
        .bind(input.stock_unit_id)
        .bind(kind.as_str())
        .bind(aircraft)
        .bind(input.case_id)
        .bind(part_number)
        .bind(trimmed(input.part_serial.as_deref()))
        .bind(trimmed(input.position_reference.as_deref()))
        .bind(input.event_at)
        .bind(trimmed(input.performed_by.as_deref()))
        .bind(reason.map(RemovalReason::as_str))
        .bind(trimmed(input.notes.as_deref()))
        .bind(context.user_id.0)
        .fetch_one(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Serial lineage: every time a part went on or came off anything, newest
    /// first. Filterable by aircraft, part number, serial, or stock unit.
    pub async fn list_events(
        &self,
        context: &ExecutionContext,
        query: &EventQuery,
    ) -> Result<Vec<PartEventDto>, PartsInventoryError> {
        sqlx::query_as::<_, PartEventDto>(
            r#"SELECT id, part_requirement_id, stock_unit_id, event_kind, aircraft_id,
                      case_id, part_number, part_serial, position_reference, event_at,
                      performed_by, removal_reason, notes, version, created_at
               FROM part_events
               WHERE organization_id=$1
                 AND archived_at IS NULL
                 AND ($2::text IS NULL OR aircraft_id = $2)
                 AND ($3::text IS NULL OR part_number = $3)
                 AND ($4::text IS NULL OR part_serial = $4)
                 AND ($5::uuid IS NULL OR stock_unit_id = $5)
               ORDER BY event_at DESC, id
               LIMIT 250"#,
        )
        .bind(context.organization_id.0)
        .bind(query.aircraft_id.as_deref())
        .bind(query.part_number.as_deref())
        .bind(query.part_serial.as_deref())
        .bind(query.stock_unit_id)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
