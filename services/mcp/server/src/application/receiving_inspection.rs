//! Receiving inspection and non-conforming material.
//!
//! The slice ships `quarantine_then_inspect`, so a received unit reaches
//! `available` only by passing inspection. Before this module the release was
//! a bare status flip that recorded no evidence: the ledger showed that a unit
//! left quarantine, but not what was checked, against which order, or which
//! tag was read.
//!
//! Recording an inspection and dispositioning the unit happen in one
//! transaction. A stored acceptance whose unit never left quarantine, or a
//! released unit with no inspection behind it, are both states the record
//! exists to prevent.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::paging::{Page, PageRequest};
use mxgenius_shared::domain::part::StockUnitStatus;
use mxgenius_shared::domain::quantity::quantity_problem;
use mxgenius_shared::domain::receiving_inspection::{
    DiscrepancyType, Disposition, GateResult, InspectionGates, Outcome,
};

use crate::application::parts_inventory::PartsInventoryError;

/// What an inspector recorded at receiving.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordInspectionInput {
    pub shipment_id: Option<Uuid>,
    /// Each gate defaults to `na` when the caller does not send it, matching
    /// the column default. An unstated gate is not a silent pass.
    #[serde(default = "default_gate")]
    pub part_number_matches_order: String,
    #[serde(default = "default_gate")]
    pub serial_matches_tag: String,
    #[serde(default = "default_gate")]
    pub tag_present_and_legible: String,
    #[serde(default = "default_gate")]
    pub shelf_life_acceptable: String,
    #[serde(default = "default_gate")]
    pub dangerous_goods_paperwork: String,
    #[serde(default = "default_tag_type")]
    pub tag_type: String,
    pub tag_reference: Option<String>,
    pub condition_code: Option<String>,
    pub quantity_received: Option<f64>,
    #[serde(default)]
    pub shipping_damage: bool,
    /// The inspector's conclusion. Omitted, it takes the outcome the gates
    /// point to; supplied, it must be one the gates can support.
    pub outcome: Option<String>,
    pub notes: Option<String>,
}

fn default_gate() -> String {
    "na".into()
}

fn default_tag_type() -> String {
    "none".into()
}

/// Exactly the vocabulary `stock_units.trace_type` carries after migration
/// 0020. Kept in step with it deliberately: an inspection records the tag the
/// unit ends up holding, so a second, narrower list here would make some tags
/// unrecordable.
const TAG_TYPES: [&str; 10] = [
    "form_8130",
    "easa_form1",
    "tso",
    "dual_release",
    "coc",
    "coc_mfr",
    "coc_vendor",
    "ata106",
    "teardown",
    "none",
];

const CONDITION_CODES: [&str; 8] = ["NE", "NS", "OH", "SV", "RP", "AR", "US", "SC"];

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReceivingInspectionDto {
    pub id: Uuid,
    pub stock_unit_id: Uuid,
    pub shipment_id: Option<Uuid>,
    pub part_number_matches_order: String,
    pub serial_matches_tag: String,
    pub tag_present_and_legible: String,
    pub shelf_life_acceptable: String,
    pub dangerous_goods_paperwork: String,
    pub tag_type: String,
    pub tag_reference: Option<String>,
    pub condition_code: Option<String>,
    pub quantity_received: Option<f64>,
    pub shipping_damage: bool,
    pub outcome: String,
    pub notes: Option<String>,
    pub inspected_by: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub inspected_at: OffsetDateTime,
}

/// Raising a discrepancy against material that failed.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDiscrepancyInput {
    pub receiving_inspection_id: Option<Uuid>,
    pub discrepancy_type: String,
    pub summary: String,
}

/// Closing one out. A resolution names a disposition and an approver, or it is
/// not a resolution.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDiscrepancyInput {
    pub disposition: String,
    pub resolution_notes: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiscrepancyReportDto {
    pub id: Uuid,
    pub stock_unit_id: Uuid,
    pub receiving_inspection_id: Option<Uuid>,
    pub discrepancy_type: String,
    pub summary: String,
    pub disposition: Option<String>,
    pub status: String,
    pub resolution_notes: Option<String>,
    pub approved_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub resolved_at: Option<OffsetDateTime>,
    pub reported_by: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub reported_at: OffsetDateTime,
    pub version: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscrepancyQuery {
    pub status: Option<String>,
    pub stock_unit_id: Option<Uuid>,
    #[serde(default, deserialize_with = "mxgenius_shared::application::paging::lenient_page_number")]
    pub page: Option<i64>,
    #[serde(default, deserialize_with = "mxgenius_shared::application::paging::lenient_page_number")]
    pub page_size: Option<i64>,
}

pub struct ReceivingInspectionRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> ReceivingInspectionRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// Record one inspection and disposition the unit in the same transaction.
    ///
    /// An acceptance releases the unit to `available`; a quarantine leaves it
    /// where it is. The version check is the same optimistic guard the other
    /// stock mutations use, so an inspection cannot be recorded against a unit
    /// that moved underneath the inspector.
    pub async fn record(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
        expected_version: i64,
        input: &RecordInspectionInput,
    ) -> Result<ReceivingInspectionDto, PartsInventoryError> {
        let gates = parse_gates(input)?;
        if !TAG_TYPES.contains(&input.tag_type.as_str()) {
            return Err(PartsInventoryError::Invalid(format!(
                "tagType must be one of {}; received {}",
                TAG_TYPES.join(", "),
                input.tag_type
            )));
        }
        if let Some(code) = input.condition_code.as_deref() {
            if !CONDITION_CODES.contains(&code) {
                return Err(PartsInventoryError::Invalid(format!(
                    "conditionCode must be one of {}; received {code}",
                    CONDITION_CODES.join(", ")
                )));
            }
        }
        if let Some(quantity) = input.quantity_received {
            if let Some(problem) = quantity_problem(quantity) {
                return Err(PartsInventoryError::Invalid(problem.message()));
            }
        }

        // Omitted, the outcome follows the gates. Supplied, it must be one the
        // gates can support: an acceptance over a failed gate is refused here
        // with a usable message rather than by a constraint name.
        let outcome = match input.outcome.as_deref() {
            None => Outcome::proposed_from(&gates, input.shipping_damage),
            Some(raw) => {
                let parsed = Outcome::parse(raw).ok_or_else(|| {
                    PartsInventoryError::Invalid(format!(
                        "outcome must be accepted or quarantined; received {raw}"
                    ))
                })?;
                if !parsed.is_supported_by(&gates, input.shipping_damage) {
                    // Nothing assessed is a different refusal from something
                    // failed, and saying "cannot be accepted with" followed by
                    // an empty list tells the inspector nothing.
                    if !gates.any_assessed() {
                        return Err(PartsInventoryError::Invalid(
                            "a part cannot be accepted on an inspection that checked nothing;                              record at least one gate as pass or fail"
                                .into(),
                        ));
                    }
                    let mut reasons = gates.failed_gate_names();
                    if input.shipping_damage {
                        reasons.push("shipping damage recorded");
                    }
                    return Err(PartsInventoryError::Invalid(format!(
                        "a part cannot be accepted with {}",
                        reasons.join(", ")
                    )));
                }
                parsed
            }
        };

        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64)> = sqlx::query_as(
            r#"SELECT status, version FROM stock_units
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
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
        let source = StockUnitStatus::parse(&status).ok_or_else(|| {
            PartsInventoryError::Conflict(format!("unit holds unknown status {status}"))
        })?;

        // An inspection is a receiving activity. Inspecting a unit that has
        // already been issued or shipped would record evidence about material
        // nobody can act on.
        if !matches!(
            source,
            StockUnitStatus::Quarantine | StockUnitStatus::HoldNcm | StockUnitStatus::Rejected
        ) {
            return Err(PartsInventoryError::Conflict(format!(
                "a unit in {} is not awaiting inspection",
                source.as_str()
            )));
        }

        let inspection_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO receiving_inspections
               (id,organization_id,stock_unit_id,shipment_id,
                part_number_matches_order,serial_matches_tag,
                tag_present_and_legible,shelf_life_acceptable,
                dangerous_goods_paperwork,tag_type,tag_reference,
                condition_code,quantity_received,shipping_damage,outcome,
                notes,inspected_by,inspected_at,created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),now())"#,
        )
        .bind(inspection_id)
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(input.shipment_id)
        .bind(gates.part_number_matches_order.as_str())
        .bind(gates.serial_matches_tag.as_str())
        .bind(gates.tag_present_and_legible.as_str())
        .bind(gates.shelf_life_acceptable.as_str())
        .bind(gates.dangerous_goods_paperwork.as_str())
        .bind(&input.tag_type)
        .bind(trimmed(input.tag_reference.as_deref()))
        .bind(input.condition_code.as_deref())
        .bind(input.quantity_received)
        .bind(input.shipping_damage)
        .bind(outcome.as_str())
        .bind(trimmed(input.notes.as_deref()))
        .bind(context.user_id.0)
        .execute(&mut *tx)
        .await?;

        // An acceptance releases the unit. A quarantine leaves it where it is:
        // the evidence is recorded either way, and the material only moves on
        // a decision that supports moving it.
        if outcome == Outcome::Accepted {
            if !source.can_transition_to(StockUnitStatus::Available) {
                return Err(PartsInventoryError::Conflict(format!(
                    "a unit in {} cannot be released to available",
                    source.as_str()
                )));
            }
            sqlx::query(
                r#"UPDATE stock_units
                   SET status='available', trace_type=$3, version=version+1, updated_at=now()
                   WHERE organization_id=$1 AND id=$2"#,
            )
            .bind(context.organization_id.0)
            .bind(unit_id)
            .bind(&input.tag_type)
            .execute(&mut *tx)
            .await?;
            ledger(
                &mut tx,
                context,
                unit_id,
                "inspect_pass",
                "receiving_inspection",
                inspection_id,
                source,
                StockUnitStatus::Available,
            )
            .await?;
        } else {
            ledger(
                &mut tx,
                context,
                unit_id,
                "inspect_quarantine",
                "receiving_inspection",
                inspection_id,
                source,
                source,
            )
            .await?;
        }
        tx.commit().await?;
        self.get(context, inspection_id).await
    }

    pub async fn get(
        &self,
        context: &ExecutionContext,
        inspection_id: Uuid,
    ) -> Result<ReceivingInspectionDto, PartsInventoryError> {
        sqlx::query_as::<_, ReceivingInspectionDto>(
            r#"SELECT id, stock_unit_id, shipment_id, part_number_matches_order,
                      serial_matches_tag, tag_present_and_legible,
                      shelf_life_acceptable, dangerous_goods_paperwork,
                      tag_type, tag_reference, condition_code,
                      quantity_received::double precision AS quantity_received,
                      shipping_damage, outcome, notes, inspected_by, inspected_at
               FROM receiving_inspections
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(inspection_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    /// One unit's inspection history, newest first. A unit re-inspected after
    /// rework keeps every record.
    pub async fn list_for_unit(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
    ) -> Result<Vec<ReceivingInspectionDto>, PartsInventoryError> {
        sqlx::query_as::<_, ReceivingInspectionDto>(
            r#"SELECT id, stock_unit_id, shipment_id, part_number_matches_order,
                      serial_matches_tag, tag_present_and_legible,
                      shelf_life_acceptable, dangerous_goods_paperwork,
                      tag_type, tag_reference, condition_code,
                      quantity_received::double precision AS quantity_received,
                      shipping_damage, outcome, notes, inspected_by, inspected_at
               FROM receiving_inspections
               WHERE organization_id=$1 AND stock_unit_id=$2
               ORDER BY inspected_at DESC, id"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }

    /// Raise a discrepancy and hold the material.
    ///
    /// The unit moves to `hold_ncm` so it cannot be issued while its
    /// disposition is undecided. A suspected unapproved part is additionally
    /// flagged on the unit itself, because that status travels with the part
    /// rather than living only in a report.
    pub async fn open_discrepancy(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
        expected_version: i64,
        input: &OpenDiscrepancyInput,
    ) -> Result<DiscrepancyReportDto, PartsInventoryError> {
        let kind = DiscrepancyType::parse(&input.discrepancy_type).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "discrepancyType is not a known value; received {}",
                input.discrepancy_type
            ))
        })?;
        let summary = input.summary.trim();
        if summary.is_empty() {
            return Err(PartsInventoryError::Invalid(
                "summary must say what is wrong with the material".into(),
            ));
        }

        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64)> = sqlx::query_as(
            r#"SELECT status, version FROM stock_units
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
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
        let source = StockUnitStatus::parse(&status).ok_or_else(|| {
            PartsInventoryError::Conflict(format!("unit holds unknown status {status}"))
        })?;

        let report_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO discrepancy_reports
               (id,organization_id,stock_unit_id,receiving_inspection_id,
                discrepancy_type,summary,status,reported_by,reported_at,
                created_at,updated_at,version)
               VALUES ($1,$2,$3,$4,$5,$6,'open',$7,now(),now(),now(),1)"#,
        )
        .bind(report_id)
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(input.receiving_inspection_id)
        .bind(kind.as_str())
        .bind(summary)
        .bind(context.user_id.0)
        .execute(&mut *tx)
        .await?;

        if kind.marks_suspected_unapproved() {
            sqlx::query(
                r#"UPDATE stock_units
                   SET suspected_unapproved=true, suspected_unapproved_reason=$3,
                       version=version+1, updated_at=now()
                   WHERE organization_id=$1 AND id=$2"#,
            )
            .bind(context.organization_id.0)
            .bind(unit_id)
            .bind(summary)
            .execute(&mut *tx)
            .await?;
        }

        // A part under an open discrepancy must not be fitted, so the hold is
        // the point of raising one. Refusing loudly beats the previous silent
        // skip, which recorded the discrepancy, left the unit untouched, and
        // let it be issued.
        if source != StockUnitStatus::HoldNcm
            && !source.is_terminal()
            && !source.can_transition_to(StockUnitStatus::HoldNcm)
        {
            return Err(PartsInventoryError::Conflict(format!(
                "a unit in {} cannot be held as non-conforming material",
                source.as_str()
            )));
        }
        if source != StockUnitStatus::HoldNcm && source.can_transition_to(StockUnitStatus::HoldNcm)
        {
            sqlx::query(
                r#"UPDATE stock_units
                   SET status='hold_ncm', version=version+1, updated_at=now()
                   WHERE organization_id=$1 AND id=$2"#,
            )
            .bind(context.organization_id.0)
            .bind(unit_id)
            .execute(&mut *tx)
            .await?;
            ledger(
                &mut tx,
                context,
                unit_id,
                "discrepancy_hold",
                "discrepancy_report",
                report_id,
                source,
                StockUnitStatus::HoldNcm,
            )
            .await?;
        }
        tx.commit().await?;
        self.get_discrepancy(context, report_id).await
    }

    /// Close a discrepancy with a disposition.
    ///
    /// The approver is the authenticated actor. `accept_as_is` releases the
    /// material; every other disposition leaves it held, because rework,
    /// return, and scrap are all followed by a movement the operator records
    /// separately rather than one this decision performs on their behalf.
    pub async fn resolve_discrepancy(
        &self,
        context: &ExecutionContext,
        report_id: Uuid,
        expected_version: i64,
        input: &ResolveDiscrepancyInput,
    ) -> Result<DiscrepancyReportDto, PartsInventoryError> {
        let disposition = Disposition::parse(&input.disposition).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "disposition must be one of return_to_vendor, rework, accept_as_is, scrap; \
                 received {}",
                input.disposition
            ))
        })?;

        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64, Uuid)> = sqlx::query_as(
            r#"SELECT status, version, stock_unit_id FROM discrepancy_reports
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(report_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((status, version, unit_id)) = current else {
            return Err(PartsInventoryError::NotFound);
        };
        if version != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {version}"
            )));
        }
        if status == "resolved" {
            return Err(PartsInventoryError::Conflict(
                "this discrepancy is already resolved".into(),
            ));
        }

        sqlx::query(
            r#"UPDATE discrepancy_reports
               SET status='resolved', disposition=$3, resolution_notes=$4,
                   approved_by=$5, resolved_at=now(), version=version+1,
                   updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(report_id)
        .bind(disposition.as_str())
        .bind(trimmed(input.resolution_notes.as_deref()))
        .bind(context.user_id.0)
        .execute(&mut *tx)
        .await?;

        if disposition == Disposition::AcceptAsIs {
            // Releasing held material is only defensible while nothing else is
            // still open against it.
            let still_open: i64 = sqlx::query_scalar(
                r#"SELECT count(*) FROM discrepancy_reports
                   WHERE organization_id=$1 AND stock_unit_id=$2
                     AND status='open' AND id <> $3"#,
            )
            .bind(context.organization_id.0)
            .bind(unit_id)
            .bind(report_id)
            .fetch_one(&mut *tx)
            .await?;
            if still_open == 0 {
                let unit_status: String = sqlx::query_scalar(
                    r#"SELECT status FROM stock_units
                       WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
                )
                .bind(context.organization_id.0)
                .bind(unit_id)
                .fetch_one(&mut *tx)
                .await?;
                let source = StockUnitStatus::parse(&unit_status).ok_or_else(|| {
                    PartsInventoryError::Conflict(format!(
                        "unit holds unknown status {unit_status}"
                    ))
                })?;
                if source.can_transition_to(StockUnitStatus::Available) {
                    // Clearing the Suspected Unapproved flag is part of the
                    // release, not a separate housekeeping step. A part left
                    // flagged while sitting on the serviceable shelf is a
                    // contradiction someone could fit an aircraft from; the
                    // accept-as-is decision, made by a qualified role and
                    // retained on the report, is the determination that
                    // resolves it.
                    sqlx::query(
                        r#"UPDATE stock_units
                           SET status='available', suspected_unapproved=false,
                               suspected_unapproved_reason=NULL,
                               version=version+1, updated_at=now()
                           WHERE organization_id=$1 AND id=$2"#,
                    )
                    .bind(context.organization_id.0)
                    .bind(unit_id)
                    .execute(&mut *tx)
                    .await?;
                    ledger(
                        &mut tx,
                        context,
                        unit_id,
                        "discrepancy_release",
                        "discrepancy_report",
                        report_id,
                        source,
                        StockUnitStatus::Available,
                    )
                    .await?;
                }
            }
        }
        tx.commit().await?;
        self.get_discrepancy(context, report_id).await
    }

    pub async fn get_discrepancy(
        &self,
        context: &ExecutionContext,
        report_id: Uuid,
    ) -> Result<DiscrepancyReportDto, PartsInventoryError> {
        sqlx::query_as::<_, DiscrepancyReportDto>(
            r#"SELECT id, stock_unit_id, receiving_inspection_id, discrepancy_type,
                      summary, disposition, status, resolution_notes, approved_by,
                      resolved_at, reported_by, reported_at, version
               FROM discrepancy_reports
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(report_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    pub async fn list_discrepancies(
        &self,
        context: &ExecutionContext,
        query: &DiscrepancyQuery,
    ) -> Result<Page<DiscrepancyReportDto>, PartsInventoryError> {
        if let Some(status) = query.status.as_deref() {
            if !matches!(status, "open" | "resolved") {
                return Err(PartsInventoryError::Invalid(format!(
                    "status must be open or resolved; received {status}"
                )));
            }
        }
        let paging = PageRequest::clamped(query.page, query.page_size);
        const FILTER: &str = "FROM discrepancy_reports
               WHERE organization_id=$1
                 AND ($2::text IS NULL OR status=$2)
                 AND ($3::uuid IS NULL OR stock_unit_id=$3)";

        let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) {FILTER}"))
            .bind(context.organization_id.0)
            .bind(query.status.as_deref())
            .bind(query.stock_unit_id)
            .fetch_one(self.pool)
            .await?;

        let rows = sqlx::query_as::<_, DiscrepancyReportDto>(&format!(
            r#"SELECT id, stock_unit_id, receiving_inspection_id, discrepancy_type,
                      summary, disposition, status, resolution_notes, approved_by,
                      resolved_at, reported_by, reported_at, version
               {FILTER}
               ORDER BY reported_at DESC, id
               LIMIT $4 OFFSET $5"#
        ))
        .bind(context.organization_id.0)
        .bind(query.status.as_deref())
        .bind(query.stock_unit_id)
        .bind(paging.limit())
        .bind(paging.offset())
        .fetch_all(self.pool)
        .await?;
        Ok(Page::new(rows, paging, total))
    }
}

fn parse_gates(input: &RecordInspectionInput) -> Result<InspectionGates, PartsInventoryError> {
    let gate = |name: &str, raw: &str| -> Result<GateResult, PartsInventoryError> {
        GateResult::parse(raw).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "{name} must be pass, fail, or na; received {raw}"
            ))
        })
    };
    Ok(InspectionGates {
        part_number_matches_order: gate(
            "partNumberMatchesOrder",
            &input.part_number_matches_order,
        )?,
        serial_matches_tag: gate("serialMatchesTag", &input.serial_matches_tag)?,
        tag_present_and_legible: gate("tagPresentAndLegible", &input.tag_present_and_legible)?,
        shelf_life_acceptable: gate("shelfLifeAcceptable", &input.shelf_life_acceptable)?,
        dangerous_goods_paperwork: gate(
            "dangerousGoodsPaperwork",
            &input.dangerous_goods_paperwork,
        )?,
    })
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// One ledger row. The inspection or report id is the reference, so the
/// movement and the evidence behind it point at each other.
async fn ledger(
    tx: &mut Transaction<'_, Postgres>,
    context: &ExecutionContext,
    unit_id: Uuid,
    event_type: &str,
    reference_type: &str,
    reference_id: Uuid,
    from: StockUnitStatus,
    to: StockUnitStatus,
) -> Result<(), PartsInventoryError> {
    let location: Uuid = sqlx::query_scalar(
        r#"SELECT location_id FROM stock_units WHERE organization_id=$1 AND id=$2"#,
    )
    .bind(context.organization_id.0)
    .bind(unit_id)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO inventory_events
           (id,organization_id,stock_unit_id,event_type,quantity_delta,
            from_location_id,to_location_id,reference_type,reference_id,
            actor_user_id,correlation_id,notes,payload,created_at)
           VALUES ($1,$2,$3,$4,0,$5,$5,$6,$7,$8,$9,NULL,$10,now())"#,
    )
    .bind(Uuid::new_v4())
    .bind(context.organization_id.0)
    .bind(unit_id)
    .bind(event_type)
    .bind(location)
    .bind(reference_type)
    .bind(reference_id.to_string())
    .bind(context.user_id.0)
    .bind(context.correlation_id.0)
    .bind(serde_json::json!({"fromStatus": from.as_str(), "toStatus": to.as_str()}))
    .execute(&mut **tx)
    .await?;
    Ok(())
}
