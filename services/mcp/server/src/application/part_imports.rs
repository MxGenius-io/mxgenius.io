//! Bulk import: preview what a file would do, apply it as one reversible
//! batch, and reverse a batch that should not have been applied.
//!
//! Three safety layers, in the order they matter. The preview is the one that
//! actually prevents mistakes, because it shows the operator the plan before
//! anything is written. Add-only mode stops the common accident, a stock load
//! silently rewriting the catalog. Rollback is the net for what still gets
//! through.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::domain::part_import::{
    csv_escape, csv_header, validate_row, ImportFormat, ImportMode, ParsedRow, RawRow, RowPlan,
    IMPORT_COLUMNS,
};

use crate::application::parts_inventory::PartsInventoryError;

/// A parts file is a few thousand rows of short text. Anything approaching
/// this is not a parts file.
pub const MAX_IMPORT_ROWS: usize = 20_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowReport {
    /// 1-based line as the operator sees it in the spreadsheet, header
    /// included, so "row 7" means row 7 on their screen.
    pub row_number: usize,
    pub part_number: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<RowPlan>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub file_name: String,
    pub format: String,
    pub mode: String,
    /// The digest of the previewed bytes. Applying requires echoing this back,
    /// so a plan shown for one file cannot wave through a different one.
    pub source_sha256: String,
    pub total_rows: usize,
    pub creates: usize,
    pub updates: usize,
    pub skips: usize,
    pub conflicts: usize,
    pub error_rows: usize,
    /// True when nothing blocks applying this exact file in this mode.
    pub applicable: bool,
    pub rows: Vec<RowReport>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchDto {
    pub id: Uuid,
    pub file_name: String,
    pub file_format: String,
    pub mode: String,
    pub status: String,
    pub source_sha256: String,
    pub parts_created: i32,
    pub parts_updated: i32,
    pub units_created: i32,
    pub rows_skipped: i32,
    pub uploaded_by: Uuid,
    pub rolled_back_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub rolled_back_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub version: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequestQuery {
    pub file_name: Option<String>,
    pub mode: Option<String>,
    /// Required on apply: the digest the operator was shown a plan for.
    pub preview_sha256: Option<String>,
}

pub struct PartImportRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> PartImportRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    // -- reading the file -------------------------------------------------

    /// Turns raw bytes into rows. Rejects a file whose header does not match
    /// the column contract, because a shifted header silently loads every
    /// value into the wrong field.
    pub fn read_rows(
        bytes: &[u8],
        format: ImportFormat,
    ) -> Result<Vec<(usize, RawRow)>, PartsInventoryError> {
        let grid = match format {
            ImportFormat::Csv => read_csv(bytes)?,
            ImportFormat::Xlsx => read_xlsx(bytes)?,
        };
        let mut lines = grid.into_iter();
        let header = lines
            .next()
            .ok_or_else(|| PartsInventoryError::Invalid("the file is empty".into()))?;
        assert_header(&header)?;

        let mut rows = Vec::new();
        for (index, cells) in lines.enumerate() {
            let row = RawRow::from_cells(&cells);
            if row.is_blank() {
                continue;
            }
            // +2: one for the header, one because operators count from 1.
            rows.push((index + 2, row));
            if rows.len() > MAX_IMPORT_ROWS {
                return Err(PartsInventoryError::Invalid(format!(
                    "this file has more than {MAX_IMPORT_ROWS} rows; split it into smaller imports"
                )));
            }
        }
        if rows.is_empty() {
            return Err(PartsInventoryError::Invalid(
                "the file has a header but no rows".into(),
            ));
        }
        Ok(rows)
    }

    // -- preview ----------------------------------------------------------

    /// Works out what the file would do, without writing anything.
    pub async fn preview(
        &self,
        context: &ExecutionContext,
        bytes: &[u8],
        file_name: &str,
        format: ImportFormat,
        mode: ImportMode,
    ) -> Result<ImportPreview, PartsInventoryError> {
        let rows = Self::read_rows(bytes, format)?;
        let mut reports = Vec::with_capacity(rows.len());
        let (mut creates, mut updates, mut skips, mut conflicts, mut error_rows) = (0, 0, 0, 0, 0);

        // Rows earlier in the same file can create the part a later row then
        // matches, so the plan has to account for the file's own effects.
        let mut created_in_file: HashSet<String> = HashSet::new();

        for (row_number, raw) in &rows {
            match validate_row(raw) {
                Err(problems) => {
                    error_rows += 1;
                    reports.push(RowReport {
                        row_number: *row_number,
                        part_number: raw.part_number.clone(),
                        problems: problems.iter().map(|p| p.message()).collect(),
                        plan: None,
                    });
                }
                Ok(parsed) => {
                    let key = part_key(&parsed);
                    let existing = if created_in_file.contains(&key) {
                        None
                    } else {
                        self.find_part(context, &parsed).await?
                    };
                    let plan = match existing {
                        None => {
                            created_in_file.insert(key);
                            creates += 1;
                            RowPlan::Create {
                                creates_part: true,
                                creates_unit: parsed.quantity.is_some_and(|q| q > 0.0),
                            }
                        }
                        Some(current) => {
                            let changed = changed_fields(&parsed, &current);
                            match mode {
                                ImportMode::AddOnly if !changed.is_empty() => {
                                    conflicts += 1;
                                    RowPlan::Conflict {
                                        reason: format!(
                                            "{} already exists and this row would change {}. Switch to add-and-update if that is intended.",
                                            parsed.part_number,
                                            changed.join(", ")
                                        ),
                                    }
                                }
                                _ if changed.is_empty() => {
                                    // Nothing to change on the part; the row
                                    // may still bring new stock.
                                    if let Some(reason) = self
                                        .duplicate_unit_reason(context, &parsed, current.id)
                                        .await?
                                    {
                                        skips += 1;
                                        RowPlan::Skip { reason }
                                    } else if parsed.quantity.is_some_and(|q| q > 0.0) {
                                        creates += 1;
                                        RowPlan::Create {
                                            creates_part: false,
                                            creates_unit: true,
                                        }
                                    } else {
                                        skips += 1;
                                        RowPlan::Skip {
                                            reason: "already on file with no changes".into(),
                                        }
                                    }
                                }
                                _ => {
                                    updates += 1;
                                    RowPlan::Update {
                                        changed_fields: changed,
                                    }
                                }
                            }
                        }
                    };
                    reports.push(RowReport {
                        row_number: *row_number,
                        part_number: parsed.part_number.clone(),
                        problems: Vec::new(),
                        plan: Some(plan),
                    });
                }
            }
        }

        Ok(ImportPreview {
            file_name: file_name.to_owned(),
            format: format.as_str().to_owned(),
            mode: mode.as_str().to_owned(),
            source_sha256: digest(bytes),
            total_rows: rows.len(),
            creates,
            updates,
            skips,
            conflicts,
            error_rows,
            applicable: error_rows == 0 && conflicts == 0,
            rows: reports,
        })
    }

    // -- apply ------------------------------------------------------------

    /// Applies a file as one batch. All or nothing: a single bad row and
    /// nothing is written.
    pub async fn apply(
        &self,
        context: &ExecutionContext,
        bytes: &[u8],
        file_name: &str,
        format: ImportFormat,
        mode: ImportMode,
        preview_sha256: &str,
    ) -> Result<ImportBatchDto, PartsInventoryError> {
        let actual = digest(bytes);
        if !actual.eq_ignore_ascii_case(preview_sha256.trim()) {
            return Err(PartsInventoryError::Conflict(
                "this is not the file that was previewed; preview it again before applying".into(),
            ));
        }

        // Re-run the whole plan rather than trusting the earlier one: the
        // catalog may have moved under it since.
        let plan = self
            .preview(context, bytes, file_name, format, mode)
            .await?;
        if plan.error_rows > 0 {
            return Err(PartsInventoryError::Invalid(format!(
                "{} row(s) cannot be read; nothing was imported. Fix the file and preview it again.",
                plan.error_rows
            )));
        }
        if plan.conflicts > 0 {
            return Err(PartsInventoryError::Conflict(format!(
                "{} row(s) would change parts that already exist, which add-only mode does not permit; nothing was imported",
                plan.conflicts
            )));
        }

        let rows = Self::read_rows(bytes, format)?;
        let batch_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"INSERT INTO part_import_batches
               (id,organization_id,file_name,file_format,mode,status,source_sha256,uploaded_by,
                created_at,updated_at,version)
               VALUES ($1,$2,$3,$4,$5,'applied',$6,$7,now(),now(),1)"#,
        )
        .bind(batch_id)
        .bind(context.organization_id.0)
        .bind(file_name)
        .bind(format.as_str())
        .bind(mode.as_str())
        .bind(&actual)
        .bind(context.user_id.0)
        .execute(&mut *tx)
        .await?;

        // Resolved once per key per file: 400 rows naming one location should
        // not be 400 lookups.
        let mut location_cache: HashMap<String, Uuid> = HashMap::new();
        let mut part_cache: HashMap<String, Uuid> = HashMap::new();
        let (mut parts_created, mut parts_updated, mut units_created, mut rows_skipped) =
            (0i32, 0i32, 0i32, 0i32);

        for (_, raw) in &rows {
            let parsed =
                validate_row(raw).map_err(|p| PartsInventoryError::Invalid(p[0].message()))?;
            let key = part_key(&parsed);

            let part_id = match part_cache.get(&key) {
                Some(id) => *id,
                None => {
                    let (id, created, before) =
                        self.upsert_part(&mut tx, context, &parsed, mode).await?;
                    if created {
                        parts_created += 1;
                        journal(&mut tx, context, batch_id, "part", id, "created", None).await?;
                    } else if let Some(before) = before {
                        parts_updated += 1;
                        journal(
                            &mut tx,
                            context,
                            batch_id,
                            "part",
                            id,
                            "updated",
                            Some(before),
                        )
                        .await?;
                    }
                    part_cache.insert(key, id);
                    id
                }
            };

            let Some(quantity) = parsed.quantity.filter(|q| *q > 0.0) else {
                continue;
            };
            let Some(location_code) = parsed.location_code.clone() else {
                continue;
            };

            let location_id = match location_cache.get(&location_code) {
                Some(id) => *id,
                None => {
                    let (id, created) = self
                        .resolve_location(&mut tx, context, &location_code)
                        .await?;
                    if created {
                        journal(&mut tx, context, batch_id, "location", id, "created", None)
                            .await?;
                    }
                    location_cache.insert(location_code.clone(), id);
                    id
                }
            };

            // Without this, re-importing an exported file doubles the stock.
            if self
                .find_duplicate_unit(&mut tx, context, part_id, location_id, &parsed)
                .await?
                .is_some()
            {
                rows_skipped += 1;
                continue;
            }

            let unit_id = self
                .create_unit(&mut tx, context, part_id, location_id, &parsed, quantity)
                .await?;
            units_created += 1;
            journal(
                &mut tx,
                context,
                batch_id,
                "stock_unit",
                unit_id,
                "created",
                None,
            )
            .await?;
        }

        sqlx::query(
            r#"UPDATE part_import_batches
               SET parts_created=$3, parts_updated=$4, units_created=$5, rows_skipped=$6,
                   updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(batch_id)
        .bind(parts_created)
        .bind(parts_updated)
        .bind(units_created)
        .bind(rows_skipped)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        self.get_batch(context, batch_id).await
    }

    // -- rollback ---------------------------------------------------------

    /// Reverses a batch, refusing when reversing it would contradict
    /// something that happened afterwards.
    pub async fn rollback(
        &self,
        context: &ExecutionContext,
        batch_id: Uuid,
    ) -> Result<ImportBatchDto, PartsInventoryError> {
        let mut tx = self.pool.begin().await?;

        let batch: Option<(String, OffsetDateTime)> = sqlx::query_as(
            r#"SELECT status, created_at FROM part_import_batches
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(batch_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((status, _created_at)) = batch else {
            return Err(PartsInventoryError::NotFound);
        };
        if status == "rolled_back" {
            return Err(PartsInventoryError::Conflict(
                "this import has already been rolled back".into(),
            ));
        }

        let changes: Vec<(i64, String, Uuid, String, Option<Value>)> = sqlx::query_as(
            r#"SELECT id, entity_type, entity_id, action, before_json
               FROM part_import_changes
               WHERE organization_id=$1 AND import_batch_id=$2
               ORDER BY id DESC"#,
        )
        .bind(context.organization_id.0)
        .bind(batch_id)
        .fetch_all(&mut *tx)
        .await?;

        // Guard one: a later import touched something this batch did.
        // Reversing underneath it would corrupt that batch's before-state.
        let newer: Option<String> = sqlx::query_scalar(
            r#"SELECT b.file_name
               FROM part_import_changes later
               JOIN part_import_batches b
                 ON b.organization_id = later.organization_id
                AND b.id = later.import_batch_id
               WHERE later.organization_id = $1
                 AND later.import_batch_id <> $2
                 AND b.status = 'applied'
                 AND later.id > (
                     SELECT max(id) FROM part_import_changes
                     WHERE organization_id=$1 AND import_batch_id=$2
                 )
                 AND (later.entity_type, later.entity_id) IN (
                     SELECT entity_type, entity_id FROM part_import_changes
                     WHERE organization_id=$1 AND import_batch_id=$2
                 )
               LIMIT 1"#,
        )
        .bind(context.organization_id.0)
        .bind(batch_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(file_name) = newer {
            return Err(PartsInventoryError::Conflict(format!(
                "a later import ({file_name}) has since touched the same records; roll that one back first"
            )));
        }

        // Guard two: imported stock has moved in the real world since.
        let moved: i64 = sqlx::query_scalar(
            r#"SELECT count(*)
               FROM inventory_events e
               WHERE e.organization_id = $1
                 AND e.event_type <> 'receive'
                 AND e.stock_unit_id IN (
                     SELECT entity_id FROM part_import_changes
                     WHERE organization_id=$1 AND import_batch_id=$2
                       AND entity_type='stock_unit'
                 )"#,
        )
        .bind(context.organization_id.0)
        .bind(batch_id)
        .fetch_one(&mut *tx)
        .await?;
        if moved > 0 {
            return Err(PartsInventoryError::Conflict(format!(
                "{moved} movement(s) have been recorded against stock this import created; rolling it back would contradict them. Resolve those first."
            )));
        }

        // Rows archived in this pass are not yet invisible to the queries
        // below, so they are tracked explicitly. Without this every parent
        // still looks occupied and nothing gets cleaned up.
        let mut archived_units: HashSet<Uuid> = HashSet::new();

        for (_, entity_type, entity_id, action, before) in &changes {
            match (entity_type.as_str(), action.as_str()) {
                ("stock_unit", "created") => {
                    let quantity: Option<f64> = sqlx::query_scalar(
                        "SELECT quantity::double precision FROM stock_units WHERE organization_id=$1 AND id=$2",
                    )
                    .bind(context.organization_id.0)
                    .bind(entity_id)
                    .fetch_optional(&mut *tx)
                    .await?;
                    let Some(quantity) = quantity else { continue };

                    // Corrected forward: the ledger records the reversal
                    // rather than losing the original receipt.
                    if quantity != 0.0 {
                        sqlx::query(
                            r#"INSERT INTO inventory_events
                               (id,organization_id,stock_unit_id,event_type,quantity_delta,
                                reference_type,reference_id,actor_user_id,correlation_id,notes,payload,created_at)
                               VALUES ($1,$2,$3,'adjust',$4,'import_rollback',$5,$6,$7,
                                       'Reversed by an import rollback', $8, now())"#,
                        )
                        .bind(Uuid::new_v4())
                        .bind(context.organization_id.0)
                        .bind(entity_id)
                        .bind(-quantity)
                        .bind(batch_id.to_string())
                        .bind(context.user_id.0)
                        .bind(context.correlation_id.0)
                        .bind(json!({"importBatchId": batch_id, "reversedQuantity": quantity}))
                        .execute(&mut *tx)
                        .await?;
                    }
                    sqlx::query(
                        r#"UPDATE stock_units
                           SET quantity=0.001, status='archived', archived_at=now(),
                               version=version+1, updated_at=now()
                           WHERE organization_id=$1 AND id=$2"#,
                    )
                    .bind(context.organization_id.0)
                    .bind(entity_id)
                    .execute(&mut *tx)
                    .await?;
                    archived_units.insert(*entity_id);
                }
                ("part", "created") => {
                    // Someone may have added their own stock against this part
                    // since; keep it if so.
                    let live: i64 = sqlx::query_scalar(
                        r#"SELECT count(*) FROM stock_units
                           WHERE organization_id=$1 AND part_id=$2
                             AND archived_at IS NULL AND NOT (id = ANY($3))"#,
                    )
                    .bind(context.organization_id.0)
                    .bind(entity_id)
                    .bind(archived_units.iter().copied().collect::<Vec<_>>())
                    .fetch_one(&mut *tx)
                    .await?;
                    if live == 0 {
                        sqlx::query(
                            "UPDATE parts SET archived_at=now(), updated_at=now() WHERE id=$1",
                        )
                        .bind(entity_id)
                        .execute(&mut *tx)
                        .await?;
                    }
                }
                ("part", "updated") => {
                    if let Some(before) = before {
                        restore_part(&mut tx, *entity_id, before).await?;
                    }
                }
                ("location", "created") => {
                    let occupied: i64 = sqlx::query_scalar(
                        r#"SELECT count(*) FROM stock_units
                           WHERE organization_id=$1 AND location_id=$2
                             AND archived_at IS NULL AND NOT (id = ANY($3))"#,
                    )
                    .bind(context.organization_id.0)
                    .bind(entity_id)
                    .bind(archived_units.iter().copied().collect::<Vec<_>>())
                    .fetch_one(&mut *tx)
                    .await?;
                    if occupied == 0 {
                        sqlx::query(
                            r#"UPDATE inventory_locations SET active=false, updated_at=now()
                               WHERE organization_id=$1 AND id=$2"#,
                        )
                        .bind(context.organization_id.0)
                        .bind(entity_id)
                        .execute(&mut *tx)
                        .await?;
                    }
                }
                _ => {}
            }
        }

        sqlx::query(
            r#"UPDATE part_import_batches
               SET status='rolled_back', rolled_back_by=$3, rolled_back_at=now(),
                   version=version+1, updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(batch_id)
        .bind(context.user_id.0)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        self.get_batch(context, batch_id).await
    }

    // -- batches ----------------------------------------------------------

    pub async fn list_batches(
        &self,
        context: &ExecutionContext,
    ) -> Result<Vec<ImportBatchDto>, PartsInventoryError> {
        sqlx::query_as::<_, ImportBatchDto>(
            r#"SELECT id, file_name, file_format, mode, status, source_sha256,
                      parts_created, parts_updated, units_created, rows_skipped,
                      uploaded_by, rolled_back_by, rolled_back_at, created_at, version
               FROM part_import_batches
               WHERE organization_id=$1
               ORDER BY created_at DESC
               LIMIT 100"#,
        )
        .bind(context.organization_id.0)
        .fetch_all(self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_batch(
        &self,
        context: &ExecutionContext,
        batch_id: Uuid,
    ) -> Result<ImportBatchDto, PartsInventoryError> {
        sqlx::query_as::<_, ImportBatchDto>(
            r#"SELECT id, file_name, file_format, mode, status, source_sha256,
                      parts_created, parts_updated, units_created, rows_skipped,
                      uploaded_by, rolled_back_by, rolled_back_at, created_at, version
               FROM part_import_batches WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(batch_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    /// Exports current stock in exactly the import column order, so an export
    /// is a valid template and a round trip changes nothing.
    pub async fn export_csv(
        &self,
        context: &ExecutionContext,
    ) -> Result<String, PartsInventoryError> {
        let rows: Vec<ExportRow> = sqlx::query_as(
            r#"SELECT p.part_number, p.description, p.manufacturer, p.classification,
                      p.is_serialized, l.code AS location_code,
                      su.quantity::double precision AS quantity, su.condition_code,
                      su.serial_number, su.lot_number, su.trace_type,
                      su.certificate_number, su.owner_type
               FROM stock_units su
               JOIN parts p ON p.id = su.part_id
               JOIN inventory_locations l
                 ON l.organization_id = su.organization_id AND l.id = su.location_id
               WHERE su.organization_id=$1 AND su.archived_at IS NULL
               ORDER BY p.part_number, su.serial_number NULLS LAST, su.lot_number NULLS LAST"#,
        )
        .bind(context.organization_id.0)
        .fetch_all(self.pool)
        .await?;

        let mut out = String::from(&csv_header());
        out.push('\n');
        for row in rows {
            let cells = [
                row.part_number,
                row.description,
                row.manufacturer.unwrap_or_default(),
                row.classification.unwrap_or_default(),
                if row.is_serialized {
                    "yes".into()
                } else {
                    "no".into()
                },
                row.location_code,
                format_quantity(row.quantity),
                row.condition_code,
                row.serial_number.unwrap_or_default(),
                row.lot_number.unwrap_or_default(),
                row.trace_type,
                row.certificate_number.unwrap_or_default(),
                row.owner_type,
            ];
            out.push_str(
                &cells
                    .iter()
                    .map(|c| csv_escape(c))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            out.push('\n');
        }
        Ok(out)
    }

    // -- helpers ----------------------------------------------------------

    async fn find_part(
        &self,
        context: &ExecutionContext,
        parsed: &ParsedRow,
    ) -> Result<Option<ExistingPart>, PartsInventoryError> {
        let _ = context;
        sqlx::query_as::<_, ExistingPart>(
            r#"SELECT id, description, manufacturer, classification, is_serialized
               FROM parts
               WHERE lower(part_number)=lower($1)
                 AND lower(COALESCE(manufacturer,''))=lower(COALESCE($2,''))
                 AND archived_at IS NULL
               LIMIT 1"#,
        )
        .bind(&parsed.part_number)
        .bind(parsed.manufacturer.as_deref())
        .fetch_optional(self.pool)
        .await
        .map_err(Into::into)
    }

    async fn duplicate_unit_reason(
        &self,
        context: &ExecutionContext,
        parsed: &ParsedRow,
        part_id: Uuid,
    ) -> Result<Option<String>, PartsInventoryError> {
        let Some(quantity) = parsed.quantity.filter(|q| *q > 0.0) else {
            return Ok(None);
        };
        let _ = quantity;
        let Some(location) = parsed.location_code.as_deref() else {
            return Ok(None);
        };
        let found: Option<Uuid> = sqlx::query_scalar(
            r#"SELECT su.id FROM stock_units su
               JOIN inventory_locations l
                 ON l.organization_id=su.organization_id AND l.id=su.location_id
               WHERE su.organization_id=$1 AND su.part_id=$2 AND l.code=$3
                 AND su.archived_at IS NULL
                 AND COALESCE(su.serial_number,'')=COALESCE($4,'')
                 AND COALESCE(su.lot_number,'')=COALESCE($5,'')
               LIMIT 1"#,
        )
        .bind(context.organization_id.0)
        .bind(part_id)
        .bind(location)
        .bind(parsed.serial_number.as_deref())
        .bind(parsed.lot_number.as_deref())
        .fetch_optional(self.pool)
        .await?;
        Ok(found.map(|_| {
            "an identical unit is already on file at this location; re-importing would double the stock".to_string()
        }))
    }

    async fn find_duplicate_unit(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        context: &ExecutionContext,
        part_id: Uuid,
        location_id: Uuid,
        parsed: &ParsedRow,
    ) -> Result<Option<Uuid>, PartsInventoryError> {
        sqlx::query_scalar(
            r#"SELECT id FROM stock_units
               WHERE organization_id=$1 AND part_id=$2 AND location_id=$3
                 AND archived_at IS NULL
                 AND COALESCE(serial_number,'')=COALESCE($4,'')
                 AND COALESCE(lot_number,'')=COALESCE($5,'')
               LIMIT 1"#,
        )
        .bind(context.organization_id.0)
        .bind(part_id)
        .bind(location_id)
        .bind(parsed.serial_number.as_deref())
        .bind(parsed.lot_number.as_deref())
        .fetch_optional(&mut **tx)
        .await
        .map_err(Into::into)
    }

    /// Returns `(part_id, created, before_state)`. A non-empty cell overwrites;
    /// an empty cell leaves the stored value alone.
    async fn upsert_part(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        context: &ExecutionContext,
        parsed: &ParsedRow,
        mode: ImportMode,
    ) -> Result<(Uuid, bool, Option<Value>), PartsInventoryError> {
        let existing = self.find_part(context, parsed).await?;
        match existing {
            None => {
                let id = Uuid::new_v4();
                sqlx::query(
                    r#"INSERT INTO parts
                       (id,part_number,description,manufacturer,canonical,classification,
                        is_serialized,metadata,updated_at)
                       VALUES ($1,$2,$3,$4,true,$5,$6,'{}'::jsonb,now())"#,
                )
                .bind(id)
                .bind(&parsed.part_number)
                .bind(parsed.description.as_deref().unwrap_or(&parsed.part_number))
                .bind(parsed.manufacturer.as_deref())
                .bind(parsed.classification.as_deref())
                .bind(parsed.is_serialized.unwrap_or(false))
                .execute(&mut **tx)
                .await?;
                Ok((id, true, None))
            }
            Some(current) => {
                let changed = changed_fields(parsed, &current);
                if changed.is_empty() || mode == ImportMode::AddOnly {
                    return Ok((current.id, false, None));
                }
                let before = json!({
                    "description": current.description,
                    "manufacturer": current.manufacturer,
                    "classification": current.classification,
                    "is_serialized": current.is_serialized,
                });
                sqlx::query(
                    r#"UPDATE parts
                       SET description=COALESCE($2, description),
                           classification=COALESCE($3, classification),
                           is_serialized=COALESCE($4, is_serialized),
                           updated_at=now()
                       WHERE id=$1"#,
                )
                .bind(current.id)
                .bind(parsed.description.as_deref())
                .bind(parsed.classification.as_deref())
                .bind(parsed.is_serialized)
                .execute(&mut **tx)
                .await?;
                Ok((current.id, false, Some(before)))
            }
        }
    }

    async fn resolve_location(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        context: &ExecutionContext,
        code: &str,
    ) -> Result<(Uuid, bool), PartsInventoryError> {
        if let Some(id) = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM inventory_locations WHERE organization_id=$1 AND code=$2",
        )
        .bind(context.organization_id.0)
        .bind(code)
        .fetch_optional(&mut **tx)
        .await?
        {
            return Ok((id, false));
        }
        let id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO inventory_locations
               (id,organization_id,code,name,location_type,created_at,updated_at)
               VALUES ($1,$2,$3,$3,'stock',now(),now())"#,
        )
        .bind(id)
        .bind(context.organization_id.0)
        .bind(code)
        .execute(&mut **tx)
        .await?;
        Ok((id, true))
    }

    async fn create_unit(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        context: &ExecutionContext,
        part_id: Uuid,
        location_id: Uuid,
        parsed: &ParsedRow,
        quantity: f64,
    ) -> Result<Uuid, PartsInventoryError> {
        let unit_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO stock_units
               (id,organization_id,part_id,serial_number,lot_number,quantity,
                condition_code,status,trace_type,certificate_number,location_id,
                owner_type,received_at,created_by,metadata,version,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'quarantine',$8,$9,$10,$11,now(),$12,
                       $13,1,now(),now())"#,
        )
        .bind(unit_id)
        .bind(context.organization_id.0)
        .bind(part_id)
        .bind(parsed.serial_number.as_deref())
        .bind(parsed.lot_number.as_deref())
        .bind(quantity)
        .bind(parsed.condition_code.as_deref().unwrap_or("SV"))
        .bind(parsed.trace_type.as_deref().unwrap_or("none"))
        .bind(parsed.certificate_number.as_deref())
        .bind(location_id)
        .bind(parsed.owner_type.as_deref().unwrap_or("owned"))
        .bind(context.user_id.0)
        .bind(json!({"source": "bulk_import"}))
        .execute(&mut **tx)
        .await?;

        sqlx::query(
            r#"INSERT INTO inventory_events
               (id,organization_id,stock_unit_id,event_type,quantity_delta,
                to_location_id,reference_type,actor_user_id,correlation_id,notes,payload,created_at)
               VALUES ($1,$2,$3,'receive',$4,$5,'bulk_import',$6,$7,
                       'Received through a bulk import', $8, now())"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(quantity)
        .bind(location_id)
        .bind(context.user_id.0)
        .bind(context.correlation_id.0)
        .bind(json!({"source": "bulk_import"}))
        .execute(&mut **tx)
        .await?;
        Ok(unit_id)
    }
}

#[derive(Debug, FromRow)]
struct ExportRow {
    part_number: String,
    description: String,
    manufacturer: Option<String>,
    classification: Option<String>,
    is_serialized: bool,
    location_code: String,
    quantity: f64,
    condition_code: String,
    serial_number: Option<String>,
    lot_number: Option<String>,
    trace_type: String,
    certificate_number: Option<String>,
    owner_type: String,
}

#[derive(Debug, FromRow)]
struct ExistingPart {
    id: Uuid,
    description: String,
    manufacturer: Option<String>,
    classification: Option<String>,
    is_serialized: bool,
}

/// Which catalog fields this row would actually change. Empty cells are not
/// changes: they mean "not stated", not "clear it".
fn changed_fields(parsed: &ParsedRow, current: &ExistingPart) -> Vec<String> {
    let mut changed = Vec::new();
    if let Some(value) = parsed.description.as_deref() {
        if value != current.description {
            changed.push("description".into());
        }
    }
    if let Some(value) = parsed.classification.as_deref() {
        if Some(value) != current.classification.as_deref() {
            changed.push("classification".into());
        }
    }
    if let Some(value) = parsed.is_serialized {
        if value != current.is_serialized {
            changed.push("is_serialized".into());
        }
    }
    changed
}

fn part_key(parsed: &ParsedRow) -> String {
    format!(
        "{}|{}",
        parsed.part_number.to_lowercase(),
        parsed.manufacturer.as_deref().unwrap_or("").to_lowercase()
    )
}

fn digest(bytes: &[u8]) -> String {
    use sha2::Digest;
    hex::encode(sha2::Sha256::digest(bytes))
}

fn format_quantity(value: f64) -> String {
    if (value - value.round()).abs() < f64::EPSILON {
        format!("{}", value.round() as i64)
    } else {
        format!("{value}")
    }
}

fn assert_header(header: &[String]) -> Result<(), PartsInventoryError> {
    let actual: Vec<String> = header
        .iter()
        .map(|c| c.trim().to_ascii_lowercase())
        .collect();
    let expected: Vec<String> = IMPORT_COLUMNS.iter().map(|c| c.to_string()).collect();
    if actual.len() < expected.len() || actual[..expected.len()] != expected[..] {
        return Err(PartsInventoryError::Invalid(format!(
            "the header row does not match the template. Expected: {}. Download the template and start from that.",
            expected.join(", ")
        )));
    }
    Ok(())
}

fn read_csv(bytes: &[u8]) -> Result<Vec<Vec<String>>, PartsInventoryError> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(bytes);
    let mut grid = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| {
            PartsInventoryError::Invalid(format!("this file is not readable as CSV: {error}"))
        })?;
        grid.push(record.iter().map(|c| c.to_owned()).collect());
    }
    Ok(grid)
}

/// Reads the first worksheet. Cells are addressed explicitly rather than
/// pushed in order: a spreadsheet's empty cells are frequently absent from the
/// stream, and appending would slide every later value one column left.
fn read_xlsx(bytes: &[u8]) -> Result<Vec<Vec<String>>, PartsInventoryError> {
    use calamine::{Reader, Xlsx};
    use std::io::Cursor;

    let mut workbook = Xlsx::new(Cursor::new(bytes.to_vec())).map_err(|error| {
        PartsInventoryError::Invalid(format!(
            "this file is not readable as a spreadsheet: {error}"
        ))
    })?;
    let name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| PartsInventoryError::Invalid("the workbook has no sheets".into()))?;
    let range = workbook.worksheet_range(&name).map_err(|error| {
        PartsInventoryError::Invalid(format!("the first sheet could not be read: {error}"))
    })?;

    let width = range.width();
    let mut grid = Vec::with_capacity(range.height());
    for row in range.rows() {
        let mut cells = vec![String::new(); width];
        for (index, cell) in row.iter().enumerate() {
            if index < width {
                cells[index] = cell.to_string().trim().to_owned();
            }
        }
        grid.push(cells);
    }
    Ok(grid)
}

async fn restore_part(
    tx: &mut Transaction<'_, Postgres>,
    part_id: Uuid,
    before: &Value,
) -> Result<(), PartsInventoryError> {
    sqlx::query(
        r#"UPDATE parts
           SET description=COALESCE($2, description),
               classification=$3,
               is_serialized=COALESCE($4, is_serialized),
               updated_at=now()
           WHERE id=$1"#,
    )
    .bind(part_id)
    .bind(before.get("description").and_then(Value::as_str))
    .bind(before.get("classification").and_then(Value::as_str))
    .bind(before.get("is_serialized").and_then(Value::as_bool))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn journal(
    tx: &mut Transaction<'_, Postgres>,
    context: &ExecutionContext,
    batch_id: Uuid,
    entity_type: &str,
    entity_id: Uuid,
    action: &str,
    before: Option<Value>,
) -> Result<(), PartsInventoryError> {
    sqlx::query(
        r#"INSERT INTO part_import_changes
           (organization_id,import_batch_id,entity_type,entity_id,action,before_json,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())"#,
    )
    .bind(context.organization_id.0)
    .bind(batch_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(action)
    .bind(before)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
