//! Historical research and reporting over the parts journals.
//!
//! Every read here is derived. Nothing in this module writes, and nothing owns
//! state: the append-only journals (`inventory_events`, `part_events`,
//! `part_request_changes`) are the record, and these queries are views onto
//! them. That is deliberate — a report that stored its own totals would be a
//! second version of the truth that could drift from the ledger it summarizes.
//!
//! Two shapes live here. The timeline reads answer "what happened, in order"
//! and are keyset-paginated because a research sweep over a busy period is
//! larger than one response. The rollups answer "how much, grouped by what"
//! and are bounded by their grouping, so they return whole.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, Time, UtcOffset};
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::domain::part_import::csv_escape;

use crate::application::parts_inventory::PartsInventoryError;

/// Rows per page when the caller does not say. Large enough that a month of
/// ordinary shop activity is one request, small enough to stay a cheap read.
const DEFAULT_PAGE: i64 = 100;
const MAX_PAGE: i64 = 500;
/// Rollups group before they return, so their ceiling bounds distinct groups
/// rather than underlying rows.
const MAX_GROUPS: i64 = 500;

// ---------------------------------------------------------------------------
// Range and paging
// ---------------------------------------------------------------------------

/// A closed date range plus a keyset cursor.
///
/// `from` and `to` arrive as text because the callers are a query string and a
/// date picker, and neither speaks RFC 3339 natively. Both spellings are
/// accepted: a bare `YYYY-MM-DD`, or a full timestamp.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReportQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i64>,
    /// Opaque to the caller; `<rfc3339>|<uuid>` underneath. Echo back the
    /// `nextCursor` of the previous page to continue.
    pub cursor: Option<String>,
    // Timeline filters. Each is independent; an absent one does not narrow.
    pub event_type: Option<String>,
    pub event_kind: Option<String>,
    pub part_number: Option<String>,
    pub part_serial: Option<String>,
    pub aircraft_id: Option<String>,
    pub location_code: Option<String>,
    pub removal_reason: Option<String>,
    pub supplier: Option<String>,
    /// `csv` renders the report as a download. Anything else, including
    /// absent, returns JSON.
    pub format: Option<String>,
}

/// The parsed, validated form. Building one is the only way to reach a query,
/// so no unparsed caller text arrives at the SQL layer.
#[derive(Debug)]
pub struct ResolvedRange {
    pub from: Option<OffsetDateTime>,
    pub to: Option<OffsetDateTime>,
}

#[derive(Debug)]
struct Cursor {
    at: OffsetDateTime,
    id: Uuid,
}

/// A page of rows plus the cursor that continues it. `next_cursor` is `None`
/// when the page came back short, which is the only honest end-of-data signal
/// a keyset scan has.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub rows: Vec<T>,
    pub next_cursor: Option<String>,
}

impl ReportQuery {
    pub fn range(&self) -> Result<ResolvedRange, PartsInventoryError> {
        // A bare date means the whole day on the `to` side. Reading
        // `to=2026-08-23` as midnight would silently drop that day's work,
        // which is the kind of quiet wrongness a report must not have.
        let from = parse_boundary(self.from.as_deref(), false, "from")?;
        let to = parse_boundary(self.to.as_deref(), true, "to")?;
        if let (Some(from), Some(to)) = (from, to) {
            if from > to {
                return Err(PartsInventoryError::Invalid(
                    "range start is after its end".into(),
                ));
            }
        }
        Ok(ResolvedRange { from, to })
    }

    /// A CSV export renders exactly the page the same query would return as
    /// JSON — same filters, same limit, same cursor — so the two can never
    /// disagree about what the report says.
    pub fn wants_csv(&self) -> bool {
        self.format
            .as_deref()
            .map(|value| value.trim().eq_ignore_ascii_case("csv"))
            .unwrap_or(false)
    }

    fn page_size(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE)
    }

    fn cursor(&self) -> Result<Option<Cursor>, PartsInventoryError> {
        let Some(raw) = self.cursor.as_deref().map(str::trim).filter(|v| !v.is_empty()) else {
            return Ok(None);
        };
        let (at, id) = raw
            .split_once('|')
            .ok_or_else(|| PartsInventoryError::Invalid("malformed page cursor".into()))?;
        Ok(Some(Cursor {
            at: OffsetDateTime::parse(at, &Rfc3339)
                .map_err(|_| PartsInventoryError::Invalid("malformed page cursor".into()))?,
            id: Uuid::parse_str(id)
                .map_err(|_| PartsInventoryError::Invalid("malformed page cursor".into()))?,
        }))
    }
}

/// Accepts `YYYY-MM-DD` or RFC 3339. A bare date resolves to the start of that
/// day in UTC, or to the last instant of it when it is closing a range.
fn parse_boundary(
    value: Option<&str>,
    end_of_day: bool,
    field: &str,
) -> Result<Option<OffsetDateTime>, PartsInventoryError> {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if let Ok(parsed) = OffsetDateTime::parse(value, &Rfc3339) {
        return Ok(Some(parsed));
    }
    let format = time::macros::format_description!("[year]-[month]-[day]");
    let date = Date::parse(value, format).map_err(|_| {
        PartsInventoryError::Invalid(format!(
            "{field} must be YYYY-MM-DD or an RFC 3339 timestamp"
        ))
    })?;
    let time = if end_of_day {
        Time::from_hms_nano(23, 59, 59, 999_999_999).expect("literal time is valid")
    } else {
        Time::MIDNIGHT
    };
    Ok(Some(date.with_time(time).assume_offset(UtcOffset::UTC)))
}

fn encode_cursor(at: OffsetDateTime, id: Uuid) -> Option<String> {
    at.format(&Rfc3339).ok().map(|at| format!("{at}|{id}"))
}

/// Trims a filter to `None` when it is blank, so an empty form field does not
/// become a literal empty-string match.
fn filter(value: Option<&String>) -> Option<&str> {
    value.map(|v| v.trim()).filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/// One stock movement, resolved to the names a person reads rather than the
/// ids the ledger stores.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMovementDto {
    pub id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub event_type: String,
    pub quantity_delta: f64,
    pub part_number: Option<String>,
    pub description: Option<String>,
    pub serial_number: Option<String>,
    pub stock_unit_id: Uuid,
    pub from_location: Option<String>,
    pub to_location: Option<String>,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    pub actor: Option<String>,
    pub correlation_id: Uuid,
    pub notes: Option<String>,
}

/// One install or removal.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PartEventHistoryDto {
    pub id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub event_at: OffsetDateTime,
    pub event_kind: String,
    pub part_number: String,
    pub part_serial: Option<String>,
    pub aircraft_id: Option<String>,
    pub case_id: Option<Uuid>,
    pub position_reference: Option<String>,
    pub removal_reason: Option<String>,
    pub performed_by: Option<String>,
    pub notes: Option<String>,
}

/// Movement totals for one event type over the range.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MovementSummaryDto {
    pub event_type: String,
    pub event_count: i64,
    pub quantity_in: f64,
    pub quantity_out: f64,
    pub net_quantity: f64,
    pub distinct_parts: i64,
    #[serde(with = "time::serde::rfc3339::option")]
    pub first_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_at: Option<OffsetDateTime>,
}

/// Spend and delivery performance for one supplier over the range.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SupplierPerformanceDto {
    pub supplier: String,
    pub order_count: i64,
    pub total_spend_usd: Option<f64>,
    pub average_order_usd: Option<f64>,
    /// Placed-to-delivered, in days. `None` when nothing this supplier sent in
    /// the range has been received yet — an unmeasured lead time, not a zero.
    pub average_lead_time_days: Option<f64>,
    pub delivered_orders: i64,
    pub backordered_orders: i64,
    pub cancelled_orders: i64,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_ordered_at: Option<OffsetDateTime>,
}

/// What happened to one part number over the range, across every journal.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PartActivityDto {
    pub part_number: String,
    pub description: Option<String>,
    pub received_count: i64,
    pub issued_count: i64,
    pub scrapped_count: i64,
    pub net_quantity: f64,
    pub install_count: i64,
    pub removal_count: i64,
    pub cannibalized_count: i64,
    pub distinct_aircraft: i64,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_activity_at: Option<OffsetDateTime>,
}

pub struct PartReportingRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> PartReportingRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    // -- timelines --------------------------------------------------------

    /// Org-wide stock movement, newest first.
    ///
    /// The joins are all outer: a ledger row survives its stock unit being
    /// archived and its location being renamed, and a report that inner-joined
    /// would quietly drop exactly the history most worth researching.
    pub async fn list_inventory_movements(
        &self,
        context: &ExecutionContext,
        query: &ReportQuery,
    ) -> Result<Page<InventoryMovementDto>, PartsInventoryError> {
        let range = query.range()?;
        let cursor = query.cursor()?;
        let limit = query.page_size();

        let rows = sqlx::query_as::<_, InventoryMovementDto>(
            r#"SELECT ie.id,
                      ie.created_at,
                      ie.event_type,
                      ie.quantity_delta::double precision AS quantity_delta,
                      p.part_number,
                      p.description,
                      su.serial_number,
                      ie.stock_unit_id,
                      fl.code AS from_location,
                      tl.code AS to_location,
                      ie.reference_type,
                      ie.reference_id,
                      COALESCE(NULLIF(btrim(u.display_name), ''), u.email) AS actor,
                      ie.correlation_id,
                      ie.notes
               FROM inventory_events ie
               LEFT JOIN stock_units su
                      ON su.organization_id = ie.organization_id AND su.id = ie.stock_unit_id
               LEFT JOIN parts p ON p.id = su.part_id
               LEFT JOIN inventory_locations fl
                      ON fl.organization_id = ie.organization_id AND fl.id = ie.from_location_id
               LEFT JOIN inventory_locations tl
                      ON tl.organization_id = ie.organization_id AND tl.id = ie.to_location_id
               LEFT JOIN users u ON u.id = ie.actor_user_id
               WHERE ie.organization_id = $1
                 AND ($2::timestamptz IS NULL OR ie.created_at >= $2)
                 AND ($3::timestamptz IS NULL OR ie.created_at <= $3)
                 AND ($4::text IS NULL OR ie.event_type = $4)
                 AND ($5::text IS NULL OR lower(p.part_number) = lower($5))
                 AND ($6::text IS NULL OR lower(fl.code) = lower($6) OR lower(tl.code) = lower($6))
                 AND ($7::timestamptz IS NULL OR (ie.created_at, ie.id) < ($7, $8::uuid))
               ORDER BY ie.created_at DESC, ie.id DESC
               LIMIT $9"#,
        )
        .bind(context.organization_id.0)
        .bind(range.from)
        .bind(range.to)
        .bind(filter(query.event_type.as_ref()))
        .bind(filter(query.part_number.as_ref()))
        .bind(filter(query.location_code.as_ref()))
        .bind(cursor.as_ref().map(|c| c.at))
        .bind(cursor.as_ref().map(|c| c.id))
        .bind(limit)
        .fetch_all(self.pool)
        .await?;

        Ok(paginate(rows, limit, |row| {
            encode_cursor(row.created_at, row.id)
        }))
    }

    /// Org-wide install and removal history, newest first. This is the serial
    /// lineage read: filter to a part number and serial and the result is
    /// everywhere that unit has been.
    pub async fn list_part_events(
        &self,
        context: &ExecutionContext,
        query: &ReportQuery,
    ) -> Result<Page<PartEventHistoryDto>, PartsInventoryError> {
        let range = query.range()?;
        let cursor = query.cursor()?;
        let limit = query.page_size();

        let rows = sqlx::query_as::<_, PartEventHistoryDto>(
            r#"SELECT id, event_at, event_kind, part_number, part_serial, aircraft_id,
                      case_id, position_reference, removal_reason, performed_by, notes
               FROM part_events
               WHERE organization_id = $1
                 AND archived_at IS NULL
                 AND ($2::timestamptz IS NULL OR event_at >= $2)
                 AND ($3::timestamptz IS NULL OR event_at <= $3)
                 AND ($4::text IS NULL OR event_kind = $4)
                 AND ($5::text IS NULL OR lower(part_number) = lower($5))
                 AND ($6::text IS NULL OR lower(part_serial) = lower($6))
                 AND ($7::text IS NULL OR lower(aircraft_id) = lower($7))
                 AND ($8::text IS NULL OR removal_reason = $8)
                 AND ($9::timestamptz IS NULL OR (event_at, id) < ($9, $10::uuid))
               ORDER BY event_at DESC, id DESC
               LIMIT $11"#,
        )
        .bind(context.organization_id.0)
        .bind(range.from)
        .bind(range.to)
        .bind(filter(query.event_kind.as_ref()))
        .bind(filter(query.part_number.as_ref()))
        .bind(filter(query.part_serial.as_ref()))
        .bind(filter(query.aircraft_id.as_ref()))
        .bind(filter(query.removal_reason.as_ref()))
        .bind(cursor.as_ref().map(|c| c.at))
        .bind(cursor.as_ref().map(|c| c.id))
        .bind(limit)
        .fetch_all(self.pool)
        .await?;

        Ok(paginate(rows, limit, |row| {
            encode_cursor(row.event_at, row.id)
        }))
    }

    // -- rollups ----------------------------------------------------------

    /// Movement totals by event type.
    ///
    /// In and out are split rather than netted, because a period that received
    /// 400 and issued 400 is not the same shop as one that did nothing, and a
    /// net of zero cannot tell them apart.
    pub async fn movement_summary(
        &self,
        context: &ExecutionContext,
        query: &ReportQuery,
    ) -> Result<Vec<MovementSummaryDto>, PartsInventoryError> {
        let range = query.range()?;
        sqlx::query_as::<_, MovementSummaryDto>(
            r#"SELECT ie.event_type,
                      count(*) AS event_count,
                      COALESCE(sum(ie.quantity_delta) FILTER (WHERE ie.quantity_delta > 0), 0)::double precision AS quantity_in,
                      COALESCE(-sum(ie.quantity_delta) FILTER (WHERE ie.quantity_delta < 0), 0)::double precision AS quantity_out,
                      COALESCE(sum(ie.quantity_delta), 0)::double precision AS net_quantity,
                      count(DISTINCT su.part_id) AS distinct_parts,
                      min(ie.created_at) AS first_at,
                      max(ie.created_at) AS last_at
               FROM inventory_events ie
               LEFT JOIN stock_units su
                      ON su.organization_id = ie.organization_id AND su.id = ie.stock_unit_id
               WHERE ie.organization_id = $1
                 AND ($2::timestamptz IS NULL OR ie.created_at >= $2)
                 AND ($3::timestamptz IS NULL OR ie.created_at <= $3)
               GROUP BY ie.event_type
               ORDER BY event_count DESC, ie.event_type"#,
        )
        .bind(context.organization_id.0)
        .bind(range.from)
        .bind(range.to)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Spend and lead time by supplier.
    ///
    /// Suppliers group by name, not id: `part_orders.supplier_id` is nullable
    /// by design because external feeds supply names the identity pass has not
    /// resolved yet, and grouping by id would drop every unresolved order from
    /// the spend total. Orders never placed (`ordered_at IS NULL`) are drafts
    /// and are excluded — they are not spend.
    ///
    /// Lead time closes against the order's delivered shipment leg, since
    /// `part_orders` records when an order went out but not when it landed.
    pub async fn supplier_performance(
        &self,
        context: &ExecutionContext,
        query: &ReportQuery,
    ) -> Result<Vec<SupplierPerformanceDto>, PartsInventoryError> {
        let range = query.range()?;
        sqlx::query_as::<_, SupplierPerformanceDto>(
            r#"WITH delivered AS (
                   SELECT part_order_id, min(received_at) AS received_at
                   FROM part_shipments
                   WHERE organization_id = $1
                     AND status = 'delivered'
                     AND archived_at IS NULL
                     AND part_order_id IS NOT NULL
                   GROUP BY part_order_id
               )
               SELECT COALESCE(NULLIF(btrim(po.supplier_name), ''), s.name, 'Unattributed') AS supplier,
                      count(*) AS order_count,
                      sum(po.purchase_cost_usd)::double precision AS total_spend_usd,
                      avg(po.purchase_cost_usd)::double precision AS average_order_usd,
                      avg(EXTRACT(EPOCH FROM (d.received_at - po.ordered_at)) / 86400.0)::double precision
                          AS average_lead_time_days,
                      count(d.received_at) AS delivered_orders,
                      count(*) FILTER (WHERE po.backordered) AS backordered_orders,
                      count(*) FILTER (WHERE po.status = 'cancelled') AS cancelled_orders,
                      max(po.ordered_at) AS last_ordered_at
               FROM part_orders po
               LEFT JOIN suppliers s ON s.id = po.supplier_id
               LEFT JOIN delivered d ON d.part_order_id = po.id
               WHERE po.organization_id = $1
                 AND po.archived_at IS NULL
                 AND po.ordered_at IS NOT NULL
                 AND ($2::timestamptz IS NULL OR po.ordered_at >= $2)
                 AND ($3::timestamptz IS NULL OR po.ordered_at <= $3)
                 AND ($4::text IS NULL
                      OR lower(COALESCE(NULLIF(btrim(po.supplier_name), ''), s.name, '')) LIKE '%' || lower($4) || '%')
               GROUP BY supplier
               ORDER BY total_spend_usd DESC NULLS LAST, order_count DESC
               LIMIT $5"#,
        )
        .bind(context.organization_id.0)
        .bind(range.from)
        .bind(range.to)
        .bind(filter(query.supplier.as_ref()))
        .bind(MAX_GROUPS)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Per-part activity across the stock ledger, the install/removal journal,
    /// and the cannibalization record.
    ///
    /// The three journals are aggregated separately and then joined on part
    /// number. Aggregating them in one pass would multiply each journal's rows
    /// by the others' and inflate every count.
    pub async fn part_activity(
        &self,
        context: &ExecutionContext,
        query: &ReportQuery,
    ) -> Result<Vec<PartActivityDto>, PartsInventoryError> {
        let range = query.range()?;
        sqlx::query_as::<_, PartActivityDto>(
            r#"WITH movements AS (
                   SELECT p.part_number,
                          max(p.description) AS description,
                          count(*) FILTER (WHERE ie.event_type = 'receive') AS received_count,
                          count(*) FILTER (WHERE ie.event_type = 'issue') AS issued_count,
                          count(*) FILTER (WHERE ie.event_type = 'scrap') AS scrapped_count,
                          COALESCE(sum(ie.quantity_delta), 0)::double precision AS net_quantity,
                          max(ie.created_at) AS last_at
                   FROM inventory_events ie
                   JOIN stock_units su
                     ON su.organization_id = ie.organization_id AND su.id = ie.stock_unit_id
                   JOIN parts p ON p.id = su.part_id
                   WHERE ie.organization_id = $1
                     AND ($2::timestamptz IS NULL OR ie.created_at >= $2)
                     AND ($3::timestamptz IS NULL OR ie.created_at <= $3)
                   GROUP BY p.part_number
               ),
               fitments AS (
                   SELECT part_number,
                          count(*) FILTER (WHERE event_kind = 'install') AS install_count,
                          count(*) FILTER (WHERE event_kind = 'removal') AS removal_count,
                          count(*) FILTER (WHERE removal_reason = 'cannibalized') AS cannibalized_events,
                          count(DISTINCT aircraft_id) AS distinct_aircraft,
                          max(event_at) AS last_at
                   FROM part_events
                   WHERE organization_id = $1
                     AND archived_at IS NULL
                     AND ($2::timestamptz IS NULL OR event_at >= $2)
                     AND ($3::timestamptz IS NULL OR event_at <= $3)
                   GROUP BY part_number
               ),
               keys AS (
                   SELECT part_number FROM movements
                   UNION
                   SELECT part_number FROM fitments
               )
               SELECT k.part_number,
                      m.description,
                      COALESCE(m.received_count, 0) AS received_count,
                      COALESCE(m.issued_count, 0) AS issued_count,
                      COALESCE(m.scrapped_count, 0) AS scrapped_count,
                      COALESCE(m.net_quantity, 0)::double precision AS net_quantity,
                      COALESCE(f.install_count, 0) AS install_count,
                      COALESCE(f.removal_count, 0) AS removal_count,
                      COALESCE(f.cannibalized_events, 0) AS cannibalized_count,
                      COALESCE(f.distinct_aircraft, 0) AS distinct_aircraft,
                      greatest(m.last_at, f.last_at) AS last_activity_at
               FROM keys k
               LEFT JOIN movements m ON m.part_number = k.part_number
               LEFT JOIN fitments f ON f.part_number = k.part_number
               WHERE ($4::text IS NULL OR lower(k.part_number) LIKE '%' || lower($4) || '%')
               ORDER BY last_activity_at DESC NULLS LAST, k.part_number
               LIMIT $5"#,
        )
        .bind(context.organization_id.0)
        .bind(range.from)
        .bind(range.to)
        .bind(filter(query.part_number.as_ref()))
        .bind(MAX_GROUPS)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }
}

/// Splits a fetched page into rows and the cursor that continues it.
///
/// A page that came back short is the last page. A full page may or may not
/// be, so it always carries a cursor: one wasted empty request beats silently
/// truncating a research result.
fn paginate<T>(rows: Vec<T>, limit: i64, cursor_of: impl Fn(&T) -> Option<String>) -> Page<T> {
    let next_cursor = if rows.len() as i64 == limit {
        rows.last().and_then(cursor_of)
    } else {
        None
    };
    Page { rows, next_cursor }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
//
// Reports leave for spreadsheets and auditors, so every report renders to CSV
// with the same columns and the same order as its JSON. A caller comparing the
// two should never have to reconcile them.

fn csv_row(cells: &[String]) -> String {
    let mut line = cells
        .iter()
        .map(|cell| csv_escape(cell))
        .collect::<Vec<_>>()
        .join(",");
    line.push('\n');
    line
}

fn stamp(value: OffsetDateTime) -> String {
    value.format(&Rfc3339).unwrap_or_default()
}

fn opt_stamp(value: Option<OffsetDateTime>) -> String {
    value.map(stamp).unwrap_or_default()
}

fn number(value: f64) -> String {
    format!("{value:.3}")
}

fn opt_number(value: Option<f64>) -> String {
    value.map(|v| format!("{v:.2}")).unwrap_or_default()
}

pub fn inventory_movements_csv(rows: &[InventoryMovementDto]) -> String {
    let mut out = csv_row(&[
        "occurred_at".into(),
        "event_type".into(),
        "part_number".into(),
        "description".into(),
        "serial_number".into(),
        "quantity_delta".into(),
        "from_location".into(),
        "to_location".into(),
        "reference_type".into(),
        "reference_id".into(),
        "actor".into(),
        "correlation_id".into(),
        "notes".into(),
    ]);
    for row in rows {
        out.push_str(&csv_row(&[
            stamp(row.created_at),
            row.event_type.clone(),
            row.part_number.clone().unwrap_or_default(),
            row.description.clone().unwrap_or_default(),
            row.serial_number.clone().unwrap_or_default(),
            number(row.quantity_delta),
            row.from_location.clone().unwrap_or_default(),
            row.to_location.clone().unwrap_or_default(),
            row.reference_type.clone().unwrap_or_default(),
            row.reference_id.clone().unwrap_or_default(),
            row.actor.clone().unwrap_or_default(),
            row.correlation_id.to_string(),
            row.notes.clone().unwrap_or_default(),
        ]));
    }
    out
}

pub fn part_events_csv(rows: &[PartEventHistoryDto]) -> String {
    let mut out = csv_row(&[
        "occurred_at".into(),
        "event_kind".into(),
        "part_number".into(),
        "part_serial".into(),
        "aircraft_id".into(),
        "case_id".into(),
        "position".into(),
        "removal_reason".into(),
        "performed_by".into(),
        "notes".into(),
    ]);
    for row in rows {
        out.push_str(&csv_row(&[
            stamp(row.event_at),
            row.event_kind.clone(),
            row.part_number.clone(),
            row.part_serial.clone().unwrap_or_default(),
            row.aircraft_id.clone().unwrap_or_default(),
            row.case_id.map(|id| id.to_string()).unwrap_or_default(),
            row.position_reference.clone().unwrap_or_default(),
            row.removal_reason.clone().unwrap_or_default(),
            row.performed_by.clone().unwrap_or_default(),
            row.notes.clone().unwrap_or_default(),
        ]));
    }
    out
}

pub fn movement_summary_csv(rows: &[MovementSummaryDto]) -> String {
    let mut out = csv_row(&[
        "event_type".into(),
        "event_count".into(),
        "quantity_in".into(),
        "quantity_out".into(),
        "net_quantity".into(),
        "distinct_parts".into(),
        "first_at".into(),
        "last_at".into(),
    ]);
    for row in rows {
        out.push_str(&csv_row(&[
            row.event_type.clone(),
            row.event_count.to_string(),
            number(row.quantity_in),
            number(row.quantity_out),
            number(row.net_quantity),
            row.distinct_parts.to_string(),
            opt_stamp(row.first_at),
            opt_stamp(row.last_at),
        ]));
    }
    out
}

pub fn supplier_performance_csv(rows: &[SupplierPerformanceDto]) -> String {
    let mut out = csv_row(&[
        "supplier".into(),
        "order_count".into(),
        "total_spend_usd".into(),
        "average_order_usd".into(),
        "average_lead_time_days".into(),
        "delivered_orders".into(),
        "backordered_orders".into(),
        "cancelled_orders".into(),
        "last_ordered_at".into(),
    ]);
    for row in rows {
        out.push_str(&csv_row(&[
            row.supplier.clone(),
            row.order_count.to_string(),
            opt_number(row.total_spend_usd),
            opt_number(row.average_order_usd),
            opt_number(row.average_lead_time_days),
            row.delivered_orders.to_string(),
            row.backordered_orders.to_string(),
            row.cancelled_orders.to_string(),
            opt_stamp(row.last_ordered_at),
        ]));
    }
    out
}

pub fn part_activity_csv(rows: &[PartActivityDto]) -> String {
    let mut out = csv_row(&[
        "part_number".into(),
        "description".into(),
        "received".into(),
        "issued".into(),
        "scrapped".into(),
        "net_quantity".into(),
        "installs".into(),
        "removals".into(),
        "cannibalized".into(),
        "distinct_aircraft".into(),
        "last_activity_at".into(),
    ]);
    for row in rows {
        out.push_str(&csv_row(&[
            row.part_number.clone(),
            row.description.clone().unwrap_or_default(),
            row.received_count.to_string(),
            row.issued_count.to_string(),
            row.scrapped_count.to_string(),
            number(row.net_quantity),
            row.install_count.to_string(),
            row.removal_count.to_string(),
            row.cannibalized_count.to_string(),
            row.distinct_aircraft.to_string(),
            opt_stamp(row.last_activity_at),
        ]));
    }
    out
}
