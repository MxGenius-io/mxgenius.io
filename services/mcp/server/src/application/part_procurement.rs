//! Procurement: the part request queue and the orders placed against it.
//!
//! The overdue rule is not restated here. Both the queue query and the
//! response stamping resolve through `mxgenius_shared::domain::part_request`,
//! so the SQL surface and the in-memory surface cannot drift apart.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::domain::part_request::{
    days_overdue, is_missing_need_by, is_overdue, PartOrderKind, PartOrderStatus,
    PartRequestPriority, PartRequestStatus, TypeOfBuy, OVERDUE_SQL_PREDICATE,
};

use crate::application::parts_inventory::PartsInventoryError;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestQueueQuery {
    pub status: Option<String>,
    pub priority: Option<String>,
    /// Resolves through the published overdue predicate so clicking a
    /// dashboard tile lands on exactly the rows the tile counted.
    pub overdue_only: Option<bool>,
    pub missing_need_by_only: Option<bool>,
}

#[derive(Debug, FromRow)]
struct PartRequestRow {
    id: Uuid,
    case_id: Uuid,
    aircraft_id: String,
    part_id: Uuid,
    part_number: String,
    description: String,
    quantity: i32,
    quantity_fulfilled: i32,
    status: String,
    priority: String,
    required_by: Option<OffsetDateTime>,
    notes: Option<String>,
    requested_by_name: Option<String>,
    acceptable_conditions: Value,
    open_order_count: i64,
    version: i64,
    updated_at: OffsetDateTime,
}

/// A queued request with the overdue verdict already stamped on it. The
/// verdict is computed once per response against a single clock reading, so
/// every row in one payload is judged against the same instant.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartRequestDto {
    pub id: Uuid,
    pub case_id: Uuid,
    pub aircraft_id: String,
    pub part_id: Uuid,
    pub part_number: String,
    pub description: String,
    pub quantity: i32,
    pub quantity_fulfilled: i32,
    pub status: String,
    pub priority: String,
    pub required_by: Option<OffsetDateTime>,
    pub notes: Option<String>,
    pub requested_by_name: Option<String>,
    pub acceptable_conditions: Value,
    pub open_order_count: i64,
    pub version: i64,
    pub updated_at: OffsetDateTime,
    pub is_overdue: bool,
    pub days_overdue: Option<i64>,
    pub missing_need_by: bool,
}

impl PartRequestRow {
    fn stamp(self, as_of: OffsetDateTime) -> PartRequestDto {
        PartRequestDto {
            is_overdue: is_overdue(self.required_by, &self.status, as_of),
            days_overdue: days_overdue(self.required_by, &self.status, as_of),
            missing_need_by: is_missing_need_by(self.required_by, &self.status),
            id: self.id,
            case_id: self.case_id,
            aircraft_id: self.aircraft_id,
            part_id: self.part_id,
            part_number: self.part_number,
            description: self.description,
            quantity: self.quantity,
            quantity_fulfilled: self.quantity_fulfilled,
            status: self.status,
            priority: self.priority,
            required_by: self.required_by,
            notes: self.notes,
            requested_by_name: self.requested_by_name,
            acceptable_conditions: self.acceptable_conditions,
            open_order_count: self.open_order_count,
            version: self.version,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PartOrderDto {
    pub id: Uuid,
    pub part_requirement_id: Uuid,
    pub order_kind: String,
    pub type_of_buy: String,
    pub type_of_buy_raw: Option<String>,
    pub order_number: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub supplier_name: Option<String>,
    pub ordered_at: Option<OffsetDateTime>,
    pub buyer_name: Option<String>,
    pub backordered: bool,
    pub backorder_eta: Option<OffsetDateTime>,
    pub purchase_cost_usd: Option<f64>,
    pub account_used: Option<String>,
    pub status: String,
    pub invoice_number: Option<String>,
    pub invoice_amount_usd: Option<f64>,
    pub repair_vs_rental: Option<String>,
    pub quote_approved_at: Option<OffsetDateTime>,
    pub repair_pricing_usd: Option<f64>,
    pub savings_usd: Option<f64>,
    pub notes: Option<String>,
    pub version: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderInput {
    pub part_requirement_id: Uuid,
    pub order_kind: String,
    pub type_of_buy: String,
    pub type_of_buy_raw: Option<String>,
    pub order_number: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub supplier_name: Option<String>,
    pub buyer_name: Option<String>,
    pub purchase_cost_usd: Option<f64>,
    pub account_used: Option<String>,
    pub repair_vs_rental: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderStatusInput {
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RequestChangeDto {
    pub id: Uuid,
    pub field_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub actor_user_id: Uuid,
    pub created_at: OffsetDateTime,
}

pub struct PartProcurementRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> PartProcurementRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// The request queue, ordered AOG first then by the date the part is
    /// needed. Overdue is resolved through the published predicate.
    pub async fn list_requests(
        &self,
        context: &ExecutionContext,
        query: &RequestQueueQuery,
    ) -> Result<Vec<PartRequestDto>, PartsInventoryError> {
        if let Some(status) = query.status.as_deref() {
            if PartRequestStatus::parse(status).is_none() {
                return Err(PartsInventoryError::Invalid(format!(
                    "status must be one of requested, sourced, ordered, received, installed, cancelled; received {status}"
                )));
            }
        }
        if let Some(priority) = query.priority.as_deref() {
            if PartRequestPriority::parse(priority).is_none() {
                return Err(PartsInventoryError::Invalid(format!(
                    "priority must be one of aog, scheduled_mx, stock; received {priority}"
                )));
            }
        }

        let sql = format!(
            r#"SELECT pr.id, pr.case_id, mc.aircraft_id, pr.part_id,
                      p.part_number, p.description,
                      pr.quantity, pr.quantity_fulfilled, pr.status, pr.priority,
                      pr.required_by, pr.notes, pr.requested_by_name,
                      pr.acceptable_conditions,
                      COALESCE((
                          SELECT count(*) FROM part_orders po
                          WHERE po.organization_id = pr.organization_id
                            AND po.part_requirement_id = pr.id
                            AND po.status <> 'cancelled'
                            AND po.archived_at IS NULL
                      ), 0) AS open_order_count,
                      pr.version, pr.updated_at
               FROM part_requirements pr
               JOIN maintenance_cases mc ON mc.case_id = pr.case_id
               JOIN parts p ON p.id = pr.part_id
               WHERE pr.organization_id = $1
                 AND ($2::text IS NULL OR pr.status = $2)
                 AND ($3::text IS NULL OR pr.priority = $3)
                 AND (NOT $4 OR {overdue})
                 AND (NOT $5 OR {missing})
               ORDER BY CASE pr.priority
                            WHEN 'aog' THEN 0
                            WHEN 'scheduled_mx' THEN 1
                            ELSE 2
                        END,
                        pr.required_by NULLS LAST,
                        pr.id
               LIMIT 250"#,
            overdue = OVERDUE_SQL_PREDICATE,
            missing = mxgenius_shared::domain::part_request::MISSING_NEED_BY_SQL_PREDICATE,
        );

        let rows = sqlx::query_as::<_, PartRequestRow>(&sql)
            .bind(context.organization_id.0)
            .bind(query.status.as_deref())
            .bind(query.priority.as_deref())
            .bind(query.overdue_only.unwrap_or(false))
            .bind(query.missing_need_by_only.unwrap_or(false))
            .fetch_all(self.pool)
            .await?;

        // One clock reading for the whole response.
        let as_of = OffsetDateTime::now_utc();
        Ok(rows.into_iter().map(|row| row.stamp(as_of)).collect())
    }

    pub async fn list_orders(
        &self,
        context: &ExecutionContext,
        requirement_id: Uuid,
    ) -> Result<Vec<PartOrderDto>, PartsInventoryError> {
        sqlx::query_as::<_, PartOrderDto>(
            r#"SELECT id, part_requirement_id, order_kind, type_of_buy, type_of_buy_raw,
                      order_number, supplier_id, supplier_name, ordered_at, buyer_name,
                      backordered, backorder_eta,
                      purchase_cost_usd::double precision AS purchase_cost_usd,
                      account_used, status, invoice_number,
                      invoice_amount_usd::double precision AS invoice_amount_usd,
                      repair_vs_rental, quote_approved_at,
                      repair_pricing_usd::double precision AS repair_pricing_usd,
                      savings_usd::double precision AS savings_usd,
                      notes, version, created_at, updated_at
               FROM part_orders
               WHERE organization_id=$1 AND part_requirement_id=$2 AND archived_at IS NULL
               ORDER BY created_at DESC, id"#,
        )
        .bind(context.organization_id.0)
        .bind(requirement_id)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn create_order(
        &self,
        context: &ExecutionContext,
        input: &CreateOrderInput,
    ) -> Result<PartOrderDto, PartsInventoryError> {
        let kind = PartOrderKind::parse(&input.order_kind).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "orderKind must be po or so; received {}",
                input.order_kind
            ))
        })?;
        let buy = TypeOfBuy::parse(&input.type_of_buy).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "typeOfBuy must be one of outright, exchange, repair, loan; received {}",
                input.type_of_buy
            ))
        })?;
        if let Some(economics) = input.repair_vs_rental.as_deref() {
            if !matches!(economics, "repair" | "rental") {
                return Err(PartsInventoryError::Invalid(
                    "repairVsRental must be repair or rental".into(),
                ));
            }
            if !matches!(buy, TypeOfBuy::Repair | TypeOfBuy::Exchange) {
                return Err(PartsInventoryError::Invalid(
                    "repairVsRental only applies to a repair or exchange order".into(),
                ));
            }
        }

        // A request that is finished or abandoned cannot take a new order.
        let request_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM part_requirements WHERE organization_id=$1 AND id=$2",
        )
        .bind(context.organization_id.0)
        .bind(input.part_requirement_id)
        .fetch_optional(self.pool)
        .await?;
        let Some(request_status) = request_status else {
            return Err(PartsInventoryError::NotFound);
        };
        if matches!(request_status.as_str(), "cancelled" | "installed") {
            return Err(PartsInventoryError::Conflict(format!(
                "a request that is {request_status} cannot take a new order"
            )));
        }

        sqlx::query_as::<_, PartOrderDto>(
            r#"INSERT INTO part_orders
               (id,organization_id,part_requirement_id,order_kind,type_of_buy,type_of_buy_raw,
                order_number,supplier_id,supplier_name,buyer_name,purchase_cost_usd,
                account_used,repair_vs_rental,notes,status,created_by,created_at,updated_at,version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,now(),now(),1)
               RETURNING id, part_requirement_id, order_kind, type_of_buy, type_of_buy_raw,
                         order_number, supplier_id, supplier_name, ordered_at, buyer_name,
                         backordered, backorder_eta,
                         purchase_cost_usd::double precision AS purchase_cost_usd,
                         account_used, status, invoice_number,
                         invoice_amount_usd::double precision AS invoice_amount_usd,
                         repair_vs_rental, quote_approved_at,
                         repair_pricing_usd::double precision AS repair_pricing_usd,
                         savings_usd::double precision AS savings_usd,
                         notes, version, created_at, updated_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(input.part_requirement_id)
        .bind(kind.as_str())
        .bind(buy.as_str())
        .bind(trimmed(input.type_of_buy_raw.as_deref()))
        .bind(trimmed(input.order_number.as_deref()))
        .bind(input.supplier_id)
        .bind(trimmed(input.supplier_name.as_deref()))
        .bind(trimmed(input.buyer_name.as_deref()))
        .bind(input.purchase_cost_usd)
        .bind(trimmed(input.account_used.as_deref()))
        .bind(input.repair_vs_rental.as_deref())
        .bind(trimmed(input.notes.as_deref()))
        .bind(context.user_id.0)
        .fetch_one(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Moves an order through its lifecycle. Placing an order fast-forwards a
    /// still-open request to `ordered`; that projection is monotonic and is
    /// never reverted if the order is later cancelled, because the part was
    /// genuinely ordered at some point and the journal records both facts.
    pub async fn set_order_status(
        &self,
        context: &ExecutionContext,
        order_id: Uuid,
        expected_version: i64,
        input: &OrderStatusInput,
    ) -> Result<PartOrderDto, PartsInventoryError> {
        let target = PartOrderStatus::parse(&input.status).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "status must be one of draft, placed, confirmed, cancelled; received {}",
                input.status
            ))
        })?;

        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64, Uuid)> = sqlx::query_as(
            r#"SELECT status, version, part_requirement_id FROM part_orders
               WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(order_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((status, version, requirement_id)) = current else {
            return Err(PartsInventoryError::NotFound);
        };
        if version != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {version}"
            )));
        }
        let source = PartOrderStatus::parse(&status).ok_or_else(|| {
            PartsInventoryError::Conflict(format!("order holds unknown status {status}"))
        })?;
        if !source.can_transition_to(target) {
            return Err(PartsInventoryError::Conflict(format!(
                "an order that is {} cannot move to {}",
                source.as_str(),
                target.as_str()
            )));
        }

        sqlx::query(
            r#"UPDATE part_orders
               SET status=$3,
                   ordered_at=CASE WHEN $3='placed' AND ordered_at IS NULL THEN now() ELSE ordered_at END,
                   notes=COALESCE($4, notes),
                   version=version+1,
                   updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(order_id)
        .bind(target.as_str())
        .bind(trimmed(input.notes.as_deref()))
        .execute(&mut *tx)
        .await?;

        if target == PartOrderStatus::Placed {
            let request_status: Option<String> = sqlx::query_scalar(
                "SELECT status FROM part_requirements WHERE organization_id=$1 AND id=$2 FOR UPDATE",
            )
            .bind(context.organization_id.0)
            .bind(requirement_id)
            .fetch_optional(&mut *tx)
            .await?;
            let advance = request_status
                .as_deref()
                .and_then(PartRequestStatus::parse)
                .is_some_and(PartRequestStatus::is_open_to_ordering);
            if advance {
                sqlx::query(
                    r#"UPDATE part_requirements
                       SET status='ordered', version=version+1, updated_at=now()
                       WHERE organization_id=$1 AND id=$2"#,
                )
                .bind(context.organization_id.0)
                .bind(requirement_id)
                .execute(&mut *tx)
                .await?;
                journal(
                    &mut tx,
                    context,
                    requirement_id,
                    "status",
                    request_status.as_deref(),
                    Some("ordered"),
                )
                .await?;
            }
        }

        journal(
            &mut tx,
            context,
            requirement_id,
            &format!("order#{order_id}.status"),
            Some(source.as_str()),
            Some(target.as_str()),
        )
        .await?;

        tx.commit().await?;
        self.get_order(context, order_id).await
    }

    pub async fn get_order(
        &self,
        context: &ExecutionContext,
        order_id: Uuid,
    ) -> Result<PartOrderDto, PartsInventoryError> {
        sqlx::query_as::<_, PartOrderDto>(
            r#"SELECT id, part_requirement_id, order_kind, type_of_buy, type_of_buy_raw,
                      order_number, supplier_id, supplier_name, ordered_at, buyer_name,
                      backordered, backorder_eta,
                      purchase_cost_usd::double precision AS purchase_cost_usd,
                      account_used, status, invoice_number,
                      invoice_amount_usd::double precision AS invoice_amount_usd,
                      repair_vs_rental, quote_approved_at,
                      repair_pricing_usd::double precision AS repair_pricing_usd,
                      savings_usd::double precision AS savings_usd,
                      notes, version, created_at, updated_at
               FROM part_orders
               WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL"#,
        )
        .bind(context.organization_id.0)
        .bind(order_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    pub async fn list_request_changes(
        &self,
        context: &ExecutionContext,
        requirement_id: Uuid,
    ) -> Result<Vec<RequestChangeDto>, PartsInventoryError> {
        sqlx::query_as::<_, RequestChangeDto>(
            r#"SELECT id, field_name, old_value, new_value, actor_user_id, created_at
               FROM part_request_changes
               WHERE organization_id=$1 AND part_requirement_id=$2
               ORDER BY created_at, id"#,
        )
        .bind(context.organization_id.0)
        .bind(requirement_id)
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

/// Writes one journal row. A no-op edit writes nothing, so the history shows
/// only what actually changed.
async fn journal(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    context: &ExecutionContext,
    requirement_id: Uuid,
    field: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
) -> Result<(), PartsInventoryError> {
    if old_value == new_value {
        return Ok(());
    }
    sqlx::query(
        r#"INSERT INTO part_request_changes
           (id,organization_id,part_requirement_id,field_name,old_value,new_value,
            actor_user_id,correlation_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())"#,
    )
    .bind(Uuid::new_v4())
    .bind(context.organization_id.0)
    .bind(requirement_id)
    .bind(field)
    .bind(old_value)
    .bind(new_value)
    .bind(context.user_id.0)
    .bind(context.correlation_id.0)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
