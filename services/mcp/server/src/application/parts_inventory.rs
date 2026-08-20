//! PostgreSQL repository for tenant-owned physical parts inventory.
//!
//! Catalog `parts` remain global. Every physical unit, draft, asset,
//! extraction, and event is scoped by the trusted organization context.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::domain::part::StockUnitStatus;

#[derive(Debug, Deserialize, Default)]
pub struct SearchPartsQuery {
    pub query: Option<String>,
    pub status: Option<String>,
    pub location: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StockUnitDto {
    pub id: Uuid,
    pub part_id: Uuid,
    pub part_number: String,
    pub description: String,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
    pub lot_number: Option<String>,
    pub quantity: f64,
    pub condition_code: String,
    pub status: String,
    pub trace_type: String,
    pub certificate_number: Option<String>,
    pub location_id: Uuid,
    pub location: String,
    pub owner_type: String,
    pub metadata: Value,
    pub version: i64,
    pub received_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReceivingDraftInput {
    pub part_id: Option<Uuid>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReceivingDraftDto {
    pub id: Uuid,
    pub part_id: Option<Uuid>,
    pub status: String,
    pub proposed_fields: Value,
    pub expires_at: OffsetDateTime,
    pub version: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmReceivingInput {
    pub part_id: Option<Uuid>,
    pub part_number: String,
    pub description: String,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
    pub lot_number: Option<String>,
    pub quantity: f64,
    pub condition_code: String,
    #[serde(default = "default_trace_type")]
    pub trace_type: String,
    pub certificate_number: Option<String>,
    pub location_code: String,
    #[serde(default = "default_owner_type")]
    pub owner_type: String,
    #[serde(default)]
    pub metadata: Value,
}

fn default_trace_type() -> String {
    "none".into()
}

fn default_owner_type() -> String {
    "owned".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterAssetInput {
    pub kind: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PartAssetDto {
    pub id: Uuid,
    pub receiving_draft_id: Option<Uuid>,
    pub stock_unit_id: Option<Uuid>,
    pub kind: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub processing_state: String,
    pub uploaded_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
pub struct PartAssetStorage {
    pub id: Uuid,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub storage_key: String,
    pub processing_state: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionRunDto {
    pub id: Uuid,
    pub asset_id: Uuid,
    pub state: String,
    pub provider: String,
    pub model_version: Option<String>,
    pub failure_code: Option<String>,
    pub started_at: Option<OffsetDateTime>,
    pub completed_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct ExtractionProposal {
    pub field_name: String,
    pub proposed_value: String,
    pub normalized_value: Option<String>,
    pub confidence: Option<f64>,
    pub source_region: Option<Value>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionCandidateDto {
    pub id: Uuid,
    pub field_name: String,
    pub proposed_value: Option<String>,
    pub normalized_value: Option<String>,
    pub confidence: Option<f64>,
    pub source_region: Option<Value>,
    pub review_state: String,
    pub final_value: Option<String>,
    pub confirmed_by: Option<Uuid>,
    pub confirmed_at: Option<OffsetDateTime>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewExtractionInput {
    pub decisions: Vec<ExtractionDecision>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionDecision {
    pub candidate_id: Uuid,
    pub review_state: String,
    pub final_value: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InventoryEventDto {
    pub id: Uuid,
    pub event_type: String,
    pub quantity_delta: f64,
    pub from_location_id: Option<Uuid>,
    pub to_location_id: Option<Uuid>,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    pub asset_id: Option<Uuid>,
    pub actor_user_id: Uuid,
    pub correlation_id: Uuid,
    pub notes: Option<String>,
    pub payload: Value,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InventoryLocationDto {
    pub id: Uuid,
    pub code: String,
    pub name: Option<String>,
    pub location_type: String,
    pub barcode: Option<String>,
    pub active: bool,
    pub metadata: Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertLocationInput {
    pub code: Option<String>,
    pub name: Option<String>,
    pub location_type: Option<String>,
    pub barcode: Option<String>,
    pub active: Option<bool>,
}

/// Receiving inspection outcome. Phase 1 exposes only the two dispositions
/// that release a unit from quarantine.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionUnitInput {
    pub action: String,
    pub location_code: Option<String>,
    pub reference_id: Option<String>,
    pub notes: Option<String>,
}

/// One stock movement: what it writes to the ledger, where it leaves the unit,
/// and what the caller must supply for it to be meaningful.
pub struct StockAction {
    pub event_type: &'static str,
    /// `None` relocates the unit without changing its status.
    pub target_status: Option<StockUnitStatus>,
    /// Multiplied by the unit quantity to form the ledger delta.
    pub quantity_delta: f64,
    pub requires_location: bool,
    pub requires_reference: bool,
    pub reference_type: Option<&'static str>,
    /// Location type used when the destination code is not yet on file.
    pub location_type: &'static str,
}

impl StockAction {
    pub fn parse(action: &str) -> Option<Self> {
        use StockUnitStatus::*;
        let spec = match action {
            "inspect_pass" => Self {
                event_type: "inspect_pass",
                target_status: Some(Available),
                quantity_delta: 0.0,
                requires_location: false,
                requires_reference: false,
                reference_type: None,
                location_type: "stock",
            },
            "inspect_reject" => Self {
                event_type: "inspect_reject",
                target_status: Some(Rejected),
                quantity_delta: 0.0,
                requires_location: false,
                requires_reference: false,
                reference_type: None,
                location_type: "quarantine",
            },
            "transfer" => Self {
                event_type: "transfer",
                target_status: None,
                quantity_delta: 0.0,
                requires_location: true,
                requires_reference: false,
                reference_type: None,
                location_type: "stock",
            },
            "reserve" => Self {
                event_type: "adjust",
                target_status: Some(Reserved),
                quantity_delta: 0.0,
                requires_location: false,
                requires_reference: true,
                reference_type: Some("maintenance_case"),
                location_type: "stock",
            },
            "unreserve" => Self {
                event_type: "adjust",
                target_status: Some(Available),
                quantity_delta: 0.0,
                requires_location: false,
                requires_reference: false,
                reference_type: Some("maintenance_case"),
                location_type: "stock",
            },
            "issue" => Self {
                event_type: "issue",
                target_status: Some(Issued),
                quantity_delta: -1.0,
                requires_location: false,
                requires_reference: true,
                reference_type: Some("maintenance_case"),
                location_type: "stock",
            },
            "return" => Self {
                event_type: "return",
                target_status: Some(Available),
                quantity_delta: 1.0,
                requires_location: true,
                requires_reference: false,
                reference_type: Some("maintenance_case"),
                location_type: "stock",
            },
            "scrap" => Self {
                event_type: "scrap",
                target_status: Some(Scrapped),
                quantity_delta: -1.0,
                requires_location: false,
                requires_reference: false,
                reference_type: None,
                location_type: "scrap",
            },
            "ship" => Self {
                event_type: "ship",
                target_status: Some(Shipped),
                quantity_delta: -1.0,
                requires_location: true,
                requires_reference: true,
                reference_type: Some("shipment"),
                location_type: "shipping",
            },
            _ => return None,
        };
        Some(spec)
    }

    pub fn names() -> [&'static str; 9] {
        [
            "inspect_pass",
            "inspect_reject",
            "transfer",
            "reserve",
            "unreserve",
            "issue",
            "return",
            "scrap",
            "ship",
        ]
    }

    /// Releasing stock to serviceable condition is an inspection buy-off.
    pub fn is_quarantine_release(action: &str) -> bool {
        action == "inspect_pass"
    }
}

/// Human correction of confirmed metadata. Quantity, status, and location are
/// deliberately excluded: those move through ledger events, not corrections.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectUnitInput {
    pub serial_number: Option<String>,
    pub lot_number: Option<String>,
    pub condition_code: Option<String>,
    pub trace_type: Option<String>,
    pub certificate_number: Option<String>,
    pub notes: Option<String>,
}

pub const LOCATION_TYPES: [&str; 6] = [
    "stock",
    "quarantine",
    "bonded",
    "scrap",
    "shipping",
    "receiving",
];

pub const CONDITION_CODES: [&str; 8] = ["NE", "NS", "OH", "SV", "RP", "AR", "US", "SC"];

pub const TRACE_TYPES: [&str; 6] = [
    "form_8130",
    "easa_form1",
    "dual_release",
    "coc",
    "teardown",
    "none",
];

#[derive(Debug, thiserror::Error)]
pub enum PartsInventoryError {
    #[error("record not found")]
    NotFound,
    #[error("request conflicts with current state: {0}")]
    Conflict(String),
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("persistence failed")]
    Persistence(#[from] sqlx::Error),
}

pub struct PartsInventoryRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> PartsInventoryRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    pub async fn search(
        &self,
        context: &ExecutionContext,
        query: &SearchPartsQuery,
    ) -> Result<Vec<StockUnitDto>, PartsInventoryError> {
        let search = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{}%", value.to_lowercase()));
        let rows = sqlx::query_as::<_, StockUnitDto>(
            r#"SELECT su.id, su.part_id, p.part_number, p.description, p.manufacturer,
                      su.serial_number, su.lot_number,
                      su.quantity::double precision AS quantity,
                      su.condition_code, su.status, su.trace_type,
                      su.certificate_number, su.location_id, l.code AS location,
                      su.owner_type, su.metadata, su.version, su.received_at, su.updated_at
               FROM stock_units su
               JOIN parts p ON p.id=su.part_id
               JOIN inventory_locations l
                 ON l.organization_id=su.organization_id AND l.id=su.location_id
               WHERE su.organization_id=$1 AND su.status <> 'archived'
                 AND ($2::text IS NULL OR
                      lower(p.part_number) LIKE $2 OR
                      lower(p.description) LIKE $2 OR
                      lower(COALESCE(su.serial_number,'')) LIKE $2)
                 AND ($3::text IS NULL OR su.status=$3)
                 AND ($4::text IS NULL OR l.code=$4)
               ORDER BY su.updated_at DESC, su.id
               LIMIT 250"#,
        )
        .bind(context.organization_id.0)
        .bind(search)
        .bind(query.status.as_deref())
        .bind(query.location.as_deref())
        .fetch_all(self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn get_unit(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
    ) -> Result<StockUnitDto, PartsInventoryError> {
        sqlx::query_as::<_, StockUnitDto>(
            r#"SELECT su.id, su.part_id, p.part_number, p.description, p.manufacturer,
                      su.serial_number, su.lot_number,
                      su.quantity::double precision AS quantity,
                      su.condition_code, su.status, su.trace_type,
                      su.certificate_number, su.location_id, l.code AS location,
                      su.owner_type, su.metadata, su.version, su.received_at, su.updated_at
               FROM stock_units su
               JOIN parts p ON p.id=su.part_id
               JOIN inventory_locations l
                 ON l.organization_id=su.organization_id AND l.id=su.location_id
               WHERE su.organization_id=$1 AND su.id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    pub async fn create_draft(
        &self,
        context: &ExecutionContext,
        input: &CreateReceivingDraftInput,
    ) -> Result<ReceivingDraftDto, PartsInventoryError> {
        if let Some(part_id) = input.part_id {
            let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM parts WHERE id=$1)")
                .bind(part_id)
                .fetch_one(self.pool)
                .await?;
            if !exists {
                return Err(PartsInventoryError::Invalid("partId is unknown".into()));
            }
        }
        let now = OffsetDateTime::now_utc();
        sqlx::query_as::<_, ReceivingDraftDto>(
            r#"INSERT INTO receiving_drafts
               (id,organization_id,part_id,status,proposed_fields,created_by,
                expires_at,created_at,updated_at,version)
               VALUES ($1,$2,$3,'draft','{}'::jsonb,$4,$5,$6,$6,1)
               RETURNING id,part_id,status,proposed_fields,expires_at,version,
                         created_at,updated_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(input.part_id)
        .bind(context.user_id.0)
        .bind(now + Duration::hours(24))
        .bind(now)
        .fetch_one(self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn register_asset(
        &self,
        context: &ExecutionContext,
        draft_id: Uuid,
        input: &RegisterAssetInput,
    ) -> Result<(PartAssetDto, String), PartsInventoryError> {
        if input.byte_size <= 0 || input.byte_size > 50 * 1024 * 1024 {
            return Err(PartsInventoryError::Invalid(
                "asset size must be between 1 byte and 50 MiB".into(),
            ));
        }
        if !matches!(
            input.media_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
        ) {
            return Err(PartsInventoryError::Invalid(
                "asset media type is not supported".into(),
            ));
        }
        let draft_exists: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1 FROM receiving_drafts
                 WHERE organization_id=$1 AND id=$2 AND status IN ('draft','processing','ready')
               )"#,
        )
        .bind(context.organization_id.0)
        .bind(draft_id)
        .fetch_one(self.pool)
        .await?;
        if !draft_exists {
            return Err(PartsInventoryError::NotFound);
        }
        let id = Uuid::new_v4();
        let storage_key = format!(
            "documents/parts/{}/{}/{}",
            context.organization_id, draft_id, id
        );
        let asset = sqlx::query_as::<_, PartAssetDto>(
            r#"INSERT INTO part_assets
               (id,organization_id,receiving_draft_id,kind,original_filename,
                media_type,byte_size,sha256,storage_key,processing_state,
                uploaded_by,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,lower($8),$9,'pending_upload',$10,now(),now())
               RETURNING id,receiving_draft_id,stock_unit_id,kind,original_filename,
                         media_type,byte_size,sha256,processing_state,uploaded_at,created_at"#,
        )
        .bind(id)
        .bind(context.organization_id.0)
        .bind(draft_id)
        .bind(&input.kind)
        .bind(input.original_filename.trim())
        .bind(&input.media_type)
        .bind(input.byte_size)
        .bind(&input.sha256)
        .bind(&storage_key)
        .bind(context.user_id.0)
        .fetch_one(self.pool)
        .await?;
        Ok((asset, storage_key))
    }

    pub async fn asset_storage(
        &self,
        context: &ExecutionContext,
        asset_id: Uuid,
    ) -> Result<PartAssetStorage, PartsInventoryError> {
        sqlx::query_as::<_, PartAssetStorage>(
            r#"SELECT id,media_type,byte_size,sha256,storage_key,processing_state
               FROM part_assets WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(asset_id)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    pub async fn mark_asset_uploaded(
        &self,
        context: &ExecutionContext,
        asset_id: Uuid,
    ) -> Result<(), PartsInventoryError> {
        let updated = sqlx::query(
            r#"UPDATE part_assets
               SET processing_state='uploaded',uploaded_at=now(),updated_at=now()
               WHERE organization_id=$1 AND id=$2 AND processing_state='pending_upload'"#,
        )
        .bind(context.organization_id.0)
        .bind(asset_id)
        .execute(self.pool)
        .await?
        .rows_affected();
        if updated == 0 {
            return Err(PartsInventoryError::Conflict(
                "asset is not awaiting upload".into(),
            ));
        }
        Ok(())
    }

    pub async fn start_extraction(
        &self,
        context: &ExecutionContext,
        asset_id: Uuid,
    ) -> Result<ExtractionRunDto, PartsInventoryError> {
        let asset = self.asset_storage(context, asset_id).await?;
        if !matches!(
            asset.processing_state.as_str(),
            "uploaded" | "ready" | "failed"
        ) {
            return Err(PartsInventoryError::Conflict(
                "asset must be uploaded before extraction".into(),
            ));
        }
        if let Some(existing) = sqlx::query_as::<_, ExtractionRunDto>(
            r#"SELECT id,asset_id,state,provider,model_version,failure_code,
                      started_at,completed_at,created_at
               FROM extraction_runs
               WHERE organization_id=$1 AND asset_id=$2
                 AND state IN ('queued','processing','review_ready')
               ORDER BY created_at DESC LIMIT 1"#,
        )
        .bind(context.organization_id.0)
        .bind(asset_id)
        .fetch_optional(self.pool)
        .await?
        {
            return Ok(existing);
        }
        let run = sqlx::query_as::<_, ExtractionRunDto>(
            r#"INSERT INTO extraction_runs
               (id,organization_id,asset_id,state,provider,model_version,
                requested_by,started_at,created_at,updated_at)
               VALUES ($1,$2,$3,'processing','azure_document_intelligence',
                       'prebuilt-layout',$4,now(),now(),now())
               RETURNING id,asset_id,state,provider,model_version,failure_code,
                         started_at,completed_at,created_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(asset_id)
        .bind(context.user_id.0)
        .fetch_one(self.pool)
        .await?;
        sqlx::query(
            r#"UPDATE part_assets SET processing_state='processing',updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(asset_id)
        .execute(self.pool)
        .await?;
        Ok(run)
    }

    pub async fn complete_extraction(
        &self,
        context: &ExecutionContext,
        run_id: Uuid,
        raw_result_reference: &str,
        proposals: &[ExtractionProposal],
    ) -> Result<Vec<ExtractionCandidateDto>, PartsInventoryError> {
        let mut tx = self.pool.begin().await?;
        let asset_id: Uuid = sqlx::query_scalar(
            r#"SELECT asset_id FROM extraction_runs
               WHERE organization_id=$1 AND id=$2 AND state='processing'
               FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| PartsInventoryError::Conflict("extraction is not processing".into()))?;
        for proposal in proposals {
            sqlx::query(
                r#"INSERT INTO extraction_candidates
                   (id,organization_id,extraction_run_id,field_name,proposed_value,
                    normalized_value,confidence,source_region,review_state,created_at,updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proposed',now(),now())
                   ON CONFLICT (extraction_run_id,field_name) DO NOTHING"#,
            )
            .bind(Uuid::new_v4())
            .bind(context.organization_id.0)
            .bind(run_id)
            .bind(&proposal.field_name)
            .bind(&proposal.proposed_value)
            .bind(&proposal.normalized_value)
            .bind(proposal.confidence)
            .bind(&proposal.source_region)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            r#"UPDATE extraction_runs
               SET state='review_ready',raw_result_reference=$3,
                   completed_at=now(),updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(run_id)
        .bind(raw_result_reference)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"UPDATE part_assets SET processing_state='ready',updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(asset_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.list_extraction_candidates(context, run_id).await
    }

    pub async fn fail_extraction(
        &self,
        context: &ExecutionContext,
        run_id: Uuid,
        failure_code: &str,
    ) -> Result<(), PartsInventoryError> {
        sqlx::query(
            r#"WITH failed AS (
                 UPDATE extraction_runs
                 SET state='failed',failure_code=$3,completed_at=now(),updated_at=now()
                 WHERE organization_id=$1 AND id=$2
                 RETURNING asset_id
               )
               UPDATE part_assets SET processing_state='failed',updated_at=now()
               WHERE organization_id=$1 AND id IN (SELECT asset_id FROM failed)"#,
        )
        .bind(context.organization_id.0)
        .bind(run_id)
        .bind(failure_code)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_extraction_candidates(
        &self,
        context: &ExecutionContext,
        run_id: Uuid,
    ) -> Result<Vec<ExtractionCandidateDto>, PartsInventoryError> {
        Ok(sqlx::query_as::<_, ExtractionCandidateDto>(
            r#"SELECT id,field_name,proposed_value,normalized_value,
                      confidence::double precision AS confidence,source_region,
                      review_state,final_value,confirmed_by,confirmed_at
               FROM extraction_candidates
               WHERE organization_id=$1 AND extraction_run_id=$2
               ORDER BY field_name,id"#,
        )
        .bind(context.organization_id.0)
        .bind(run_id)
        .fetch_all(self.pool)
        .await?)
    }

    pub async fn review_extraction(
        &self,
        context: &ExecutionContext,
        run_id: Uuid,
        input: &ReviewExtractionInput,
    ) -> Result<Vec<ExtractionCandidateDto>, PartsInventoryError> {
        if input.decisions.is_empty() {
            return Err(PartsInventoryError::Invalid(
                "at least one extraction decision is required".into(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        for decision in &input.decisions {
            if !matches!(
                decision.review_state.as_str(),
                "accepted" | "edited" | "rejected"
            ) {
                return Err(PartsInventoryError::Invalid(
                    "reviewState must be accepted, edited, or rejected".into(),
                ));
            }
            if decision.review_state == "edited"
                && decision
                    .final_value
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
            {
                return Err(PartsInventoryError::Invalid(
                    "edited candidates require finalValue".into(),
                ));
            }
            let changed = sqlx::query(
                r#"UPDATE extraction_candidates
                   SET review_state=$4,
                       final_value=CASE
                         WHEN $4='accepted' THEN proposed_value
                         WHEN $4='edited' THEN $5
                         ELSE NULL
                       END,
                       confirmed_by=$6,confirmed_at=now(),updated_at=now()
                   WHERE organization_id=$1 AND extraction_run_id=$2 AND id=$3
                     AND review_state='proposed'"#,
            )
            .bind(context.organization_id.0)
            .bind(run_id)
            .bind(decision.candidate_id)
            .bind(&decision.review_state)
            .bind(decision.final_value.as_deref().map(str::trim))
            .bind(context.user_id.0)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if changed != 1 {
                return Err(PartsInventoryError::Conflict(format!(
                    "candidate {} is missing or already reviewed",
                    decision.candidate_id
                )));
            }
        }
        let remaining: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM extraction_candidates
               WHERE organization_id=$1 AND extraction_run_id=$2
                 AND review_state='proposed'"#,
        )
        .bind(context.organization_id.0)
        .bind(run_id)
        .fetch_one(&mut *tx)
        .await?;
        if remaining == 0 {
            sqlx::query(
                r#"UPDATE extraction_runs SET state='completed',updated_at=now()
                   WHERE organization_id=$1 AND id=$2 AND state='review_ready'"#,
            )
            .bind(context.organization_id.0)
            .bind(run_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.list_extraction_candidates(context, run_id).await
    }

    pub async fn list_assets(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
    ) -> Result<Vec<PartAssetDto>, PartsInventoryError> {
        Ok(sqlx::query_as::<_, PartAssetDto>(
            r#"SELECT id,receiving_draft_id,stock_unit_id,kind,original_filename,
                      media_type,byte_size,sha256,processing_state,uploaded_at,created_at
               FROM part_assets
               WHERE organization_id=$1 AND stock_unit_id=$2
               ORDER BY created_at,id"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_all(self.pool)
        .await?)
    }

    pub async fn list_events(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
    ) -> Result<Vec<InventoryEventDto>, PartsInventoryError> {
        Ok(sqlx::query_as::<_, InventoryEventDto>(
            r#"SELECT id,event_type,quantity_delta::double precision AS quantity_delta,
                      from_location_id,to_location_id,reference_type,reference_id,
                      asset_id,actor_user_id,correlation_id,notes,payload,created_at
               FROM inventory_events
               WHERE organization_id=$1 AND stock_unit_id=$2
               ORDER BY created_at,id"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_all(self.pool)
        .await?)
    }

    pub async fn confirm_receiving(
        &self,
        context: &ExecutionContext,
        draft_id: Uuid,
        expected_version: i64,
        idempotency_key: &str,
        request_hash: &str,
        input: &ConfirmReceivingInput,
    ) -> Result<StockUnitDto, PartsInventoryError> {
        if input.part_number.trim().is_empty()
            || input.description.trim().is_empty()
            || input.location_code.trim().is_empty()
            || input.quantity <= 0.0
        {
            return Err(PartsInventoryError::Invalid(
                "part number, description, positive quantity, and location are required".into(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        let previous: Option<(String, Option<Value>)> = sqlx::query_as(
            r#"SELECT request_hash,response_body
               FROM part_operation_requests
               WHERE organization_id=$1 AND idempotency_key=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(idempotency_key)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((stored_hash, response)) = previous {
            if stored_hash != request_hash {
                return Err(PartsInventoryError::Conflict(
                    "idempotency key was reused with a different request".into(),
                ));
            }
            let unit_id = response
                .and_then(|value| {
                    value
                        .get("unitId")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .and_then(|value| Uuid::parse_str(&value).ok())
                .ok_or_else(|| {
                    PartsInventoryError::Conflict("operation is still in progress".into())
                })?;
            tx.rollback().await?;
            return self.get_unit(context, unit_id).await;
        }
        sqlx::query(
            r#"INSERT INTO part_operation_requests
               (organization_id,idempotency_key,operation,request_hash,created_by,created_at,expires_at)
               VALUES ($1,$2,'confirm_receiving',$3,$4,now(),now()+interval '24 hours')"#,
        )
        .bind(context.organization_id.0)
        .bind(idempotency_key)
        .bind(request_hash)
        .bind(context.user_id.0)
        .execute(&mut *tx)
        .await?;

        let draft: Option<(String, i64, Option<Uuid>)> = sqlx::query_as(
            r#"SELECT status,version,part_id FROM receiving_drafts
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(draft_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((status, version, draft_part_id)) = draft else {
            return Err(PartsInventoryError::NotFound);
        };
        if status != "draft" && status != "ready" {
            return Err(PartsInventoryError::Conflict(format!(
                "receiving draft is {status}"
            )));
        }
        if version != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {version}"
            )));
        }

        let part_id = if let Some(part_id) = input.part_id.or(draft_part_id) {
            part_id
        } else if let Some(existing) = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id FROM parts
               WHERE lower(part_number)=lower($1)
                 AND lower(COALESCE(manufacturer,''))=lower(COALESCE($2,''))
               ORDER BY id LIMIT 1"#,
        )
        .bind(input.part_number.trim())
        .bind(input.manufacturer.as_deref())
        .fetch_optional(&mut *tx)
        .await?
        {
            existing
        } else {
            let id = Uuid::new_v4();
            sqlx::query(
                r#"INSERT INTO parts
                   (id,part_number,description,manufacturer,canonical,metadata,updated_at)
                   VALUES ($1,$2,$3,$4,true,'{}'::jsonb,now())"#,
            )
            .bind(id)
            .bind(input.part_number.trim())
            .bind(input.description.trim())
            .bind(input.manufacturer.as_deref())
            .execute(&mut *tx)
            .await?;
            id
        };
        let is_serialized: bool = sqlx::query_scalar("SELECT is_serialized FROM parts WHERE id=$1")
            .bind(part_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| PartsInventoryError::Invalid("partId is unknown".into()))?;
        if is_serialized
            && (input
                .serial_number
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
                || (input.quantity - 1.0).abs() > f64::EPSILON)
        {
            return Err(PartsInventoryError::Invalid(
                "serialized parts require a serial number and quantity 1".into(),
            ));
        }

        let location_id = if let Some(id) = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM inventory_locations WHERE organization_id=$1 AND code=$2",
        )
        .bind(context.organization_id.0)
        .bind(input.location_code.trim())
        .fetch_optional(&mut *tx)
        .await?
        {
            id
        } else {
            let id = Uuid::new_v4();
            sqlx::query(
                r#"INSERT INTO inventory_locations
                   (id,organization_id,code,name,location_type,created_at,updated_at)
                   VALUES ($1,$2,$3,$3,'receiving',now(),now())"#,
            )
            .bind(id)
            .bind(context.organization_id.0)
            .bind(input.location_code.trim())
            .execute(&mut *tx)
            .await?;
            id
        };

        let unit_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO stock_units
               (id,organization_id,part_id,serial_number,lot_number,quantity,
                condition_code,status,trace_type,certificate_number,location_id,
                owner_type,received_at,created_by,metadata,version,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'quarantine',$8,$9,$10,$11,now(),$12,$13,1,now(),now())"#,
        )
        .bind(unit_id)
        .bind(context.organization_id.0)
        .bind(part_id)
        .bind(input.serial_number.as_deref().map(str::trim).filter(|v| !v.is_empty()))
        .bind(input.lot_number.as_deref().map(str::trim).filter(|v| !v.is_empty()))
        .bind(input.quantity)
        .bind(&input.condition_code)
        .bind(&input.trace_type)
        .bind(input.certificate_number.as_deref())
        .bind(location_id)
        .bind(&input.owner_type)
        .bind(context.user_id.0)
        .bind(&input.metadata)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"UPDATE part_assets SET receiving_draft_id=NULL,stock_unit_id=$3,updated_at=now()
               WHERE organization_id=$1 AND receiving_draft_id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(draft_id)
        .bind(unit_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO inventory_events
               (id,organization_id,stock_unit_id,event_type,quantity_delta,
                to_location_id,reference_type,reference_id,actor_user_id,
                correlation_id,notes,payload,created_at)
               VALUES ($1,$2,$3,'receive',$4,$5,'receiving_draft',$6,$7,$8,
                       'Received through confirmed MXGenius workflow',$9,now())"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(input.quantity)
        .bind(location_id)
        .bind(draft_id.to_string())
        .bind(context.user_id.0)
        .bind(context.correlation_id.0)
        .bind(json!({"conditionCode": input.condition_code, "traceType": input.trace_type}))
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"UPDATE receiving_drafts
               SET status='confirmed',part_id=$3,confirmed_by=$4,confirmed_at=now(),
                   version=version+1,updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(draft_id)
        .bind(part_id)
        .bind(context.user_id.0)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"UPDATE part_operation_requests
               SET response_status=201,response_body=$3
               WHERE organization_id=$1 AND idempotency_key=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(idempotency_key)
        .bind(json!({"unitId": unit_id}))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get_unit(context, unit_id).await
    }

    pub async fn list_locations(
        &self,
        context: &ExecutionContext,
        include_inactive: bool,
    ) -> Result<Vec<InventoryLocationDto>, PartsInventoryError> {
        let rows = sqlx::query_as::<_, InventoryLocationDto>(
            r#"SELECT id,code,name,location_type,barcode,active,metadata,created_at,updated_at
               FROM inventory_locations
               WHERE organization_id=$1 AND ($2 OR active)
               ORDER BY code"#,
        )
        .bind(context.organization_id.0)
        .bind(include_inactive)
        .fetch_all(self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn create_location(
        &self,
        context: &ExecutionContext,
        input: &UpsertLocationInput,
    ) -> Result<InventoryLocationDto, PartsInventoryError> {
        let code = normalized_location_code(input.code.as_deref())?;
        let location_type = input.location_type.as_deref().unwrap_or("stock");
        if !LOCATION_TYPES.contains(&location_type) {
            return Err(PartsInventoryError::Invalid(format!(
                "locationType must be one of {}",
                LOCATION_TYPES.join(", ")
            )));
        }
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM inventory_locations WHERE organization_id=$1 AND code=$2)",
        )
        .bind(context.organization_id.0)
        .bind(&code)
        .fetch_one(self.pool)
        .await?;
        if exists {
            return Err(PartsInventoryError::Conflict(format!(
                "location {code} already exists"
            )));
        }
        sqlx::query_as::<_, InventoryLocationDto>(
            r#"INSERT INTO inventory_locations
               (id,organization_id,code,name,location_type,barcode,active,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,true,now(),now())
               RETURNING id,code,name,location_type,barcode,active,metadata,created_at,updated_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(&code)
        .bind(
            input
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(&code),
        )
        .bind(location_type)
        .bind(
            input
                .barcode
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .fetch_one(self.pool)
        .await
        .map_err(PartsInventoryError::from)
    }

    pub async fn update_location(
        &self,
        context: &ExecutionContext,
        location_id: Uuid,
        input: &UpsertLocationInput,
    ) -> Result<InventoryLocationDto, PartsInventoryError> {
        if let Some(location_type) = input.location_type.as_deref() {
            if !LOCATION_TYPES.contains(&location_type) {
                return Err(PartsInventoryError::Invalid(format!(
                    "locationType must be one of {}",
                    LOCATION_TYPES.join(", ")
                )));
            }
        }
        // A location still holding stock cannot be retired out from under it.
        if input.active == Some(false) {
            let occupied: i64 = sqlx::query_scalar(
                r#"SELECT count(*) FROM stock_units
                   WHERE organization_id=$1 AND location_id=$2 AND status <> 'archived'"#,
            )
            .bind(context.organization_id.0)
            .bind(location_id)
            .fetch_one(self.pool)
            .await?;
            if occupied > 0 {
                return Err(PartsInventoryError::Conflict(format!(
                    "location still holds {occupied} unit(s); move them before deactivating it"
                )));
            }
        }
        sqlx::query_as::<_, InventoryLocationDto>(
            r#"UPDATE inventory_locations
               SET name=COALESCE($3,name),
                   location_type=COALESCE($4,location_type),
                   barcode=COALESCE($5,barcode),
                   active=COALESCE($6,active),
                   updated_at=now()
               WHERE organization_id=$1 AND id=$2
               RETURNING id,code,name,location_type,barcode,active,metadata,created_at,updated_at"#,
        )
        .bind(context.organization_id.0)
        .bind(location_id)
        .bind(
            input
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(input.location_type.as_deref())
        .bind(
            input
                .barcode
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(input.active)
        .fetch_optional(self.pool)
        .await?
        .ok_or(PartsInventoryError::NotFound)
    }

    /// Applies one stock movement. The unit row and the append-only ledger
    /// move together or not at all.
    pub async fn transition_unit(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
        expected_version: i64,
        input: &TransitionUnitInput,
    ) -> Result<StockUnitDto, PartsInventoryError> {
        let spec = StockAction::parse(&input.action).ok_or_else(|| {
            PartsInventoryError::Invalid(format!(
                "action must be one of {}, received {}",
                StockAction::names().join(", "),
                input.action
            ))
        })?;
        let reference = input
            .reference_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if spec.requires_reference && reference.is_none() {
            return Err(PartsInventoryError::Invalid(format!(
                "{} requires referenceId identifying the job or order it serves",
                input.action
            )));
        }

        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64, Uuid, f64)> = sqlx::query_as(
            r#"SELECT status,version,location_id,quantity::double precision
               FROM stock_units
               WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((status, version, current_location, quantity)) = current else {
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
        let target = match spec.target_status {
            Some(target) => {
                if !source.can_transition_to(target) {
                    return Err(PartsInventoryError::Conflict(format!(
                        "a unit in {} cannot move to {}",
                        source.as_str(),
                        target.as_str()
                    )));
                }
                target
            }
            // A transfer relocates stock without changing what the stock is.
            None => {
                if source.is_terminal() {
                    return Err(PartsInventoryError::Conflict(format!(
                        "a unit in {} can no longer be moved",
                        source.as_str()
                    )));
                }
                source
            }
        };

        let requested_location = input
            .location_code
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if spec.requires_location && requested_location.is_none() {
            return Err(PartsInventoryError::Invalid(format!(
                "{} requires locationCode naming the destination",
                input.action
            )));
        }
        let destination = match requested_location {
            Some(code) => resolve_location(&mut tx, context, code, spec.location_type).await?,
            None => current_location,
        };
        if spec.requires_location && destination == current_location {
            return Err(PartsInventoryError::Invalid(
                "the destination is the location the unit already occupies".into(),
            ));
        }

        sqlx::query(
            r#"UPDATE stock_units
               SET status=$3,location_id=$4,version=version+1,updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(target.as_str())
        .bind(destination)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO inventory_events
               (id,organization_id,stock_unit_id,event_type,quantity_delta,
                from_location_id,to_location_id,reference_type,reference_id,
                actor_user_id,correlation_id,notes,payload,created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(spec.event_type)
        .bind(spec.quantity_delta * quantity)
        .bind(current_location)
        .bind(destination)
        .bind(spec.reference_type)
        .bind(reference)
        .bind(context.user_id.0)
        .bind(context.correlation_id.0)
        .bind(
            input
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(json!({"fromStatus": source.as_str(), "toStatus": target.as_str()}))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get_unit(context, unit_id).await
    }

    /// Applies a human correction to confirmed metadata and records the
    /// `metadata_corrected` event carrying the before/after values.
    pub async fn correct_unit(
        &self,
        context: &ExecutionContext,
        unit_id: Uuid,
        expected_version: i64,
        input: &CorrectUnitInput,
    ) -> Result<StockUnitDto, PartsInventoryError> {
        if let Some(code) = input.condition_code.as_deref() {
            if !CONDITION_CODES.contains(&code) {
                return Err(PartsInventoryError::Invalid(format!(
                    "conditionCode must be one of {}",
                    CONDITION_CODES.join(", ")
                )));
            }
        }
        if let Some(trace) = input.trace_type.as_deref() {
            if !TRACE_TYPES.contains(&trace) {
                return Err(PartsInventoryError::Invalid(format!(
                    "traceType must be one of {}",
                    TRACE_TYPES.join(", ")
                )));
            }
        }

        let mut tx = self.pool.begin().await?;
        let current: Option<CorrectableUnitRow> = sqlx::query_as(
            r#"SELECT status,version,serial_number,lot_number,condition_code,
                          trace_type,certificate_number
                   FROM stock_units
                   WHERE organization_id=$1 AND id=$2 FOR UPDATE"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((
            status,
            version,
            serial_number,
            lot_number,
            condition_code,
            trace_type,
            certificate_number,
        )) = current
        else {
            return Err(PartsInventoryError::NotFound);
        };
        if version != expected_version {
            return Err(PartsInventoryError::Conflict(format!(
                "expected version {expected_version}, current version is {version}"
            )));
        }
        let state = StockUnitStatus::parse(&status).ok_or_else(|| {
            PartsInventoryError::Conflict(format!("unit holds unknown status {status}"))
        })?;
        if state.is_terminal() {
            return Err(PartsInventoryError::Conflict(format!(
                "a unit in {} can no longer be corrected",
                state.as_str()
            )));
        }

        let next_serial = corrected(input.serial_number.as_deref(), serial_number.as_deref());
        let next_lot = corrected(input.lot_number.as_deref(), lot_number.as_deref());
        let next_condition = input
            .condition_code
            .as_deref()
            .unwrap_or(&condition_code)
            .to_owned();
        let next_trace = input
            .trace_type
            .as_deref()
            .unwrap_or(&trace_type)
            .to_owned();
        let next_certificate = corrected(
            input.certificate_number.as_deref(),
            certificate_number.as_deref(),
        );

        let mut changed = serde_json::Map::new();
        record_change(
            &mut changed,
            "serialNumber",
            serial_number.as_deref(),
            next_serial.as_deref(),
        );
        record_change(
            &mut changed,
            "lotNumber",
            lot_number.as_deref(),
            next_lot.as_deref(),
        );
        record_change(
            &mut changed,
            "conditionCode",
            Some(&condition_code),
            Some(&next_condition),
        );
        record_change(
            &mut changed,
            "traceType",
            Some(&trace_type),
            Some(&next_trace),
        );
        record_change(
            &mut changed,
            "certificateNumber",
            certificate_number.as_deref(),
            next_certificate.as_deref(),
        );
        if changed.is_empty() {
            return Err(PartsInventoryError::Invalid(
                "no field was changed by this correction".into(),
            ));
        }
        let changed = Value::Object(changed);

        sqlx::query(
            r#"UPDATE stock_units
               SET serial_number=$3,lot_number=$4,condition_code=$5,trace_type=$6,
                   certificate_number=$7,version=version+1,updated_at=now()
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(next_serial.as_deref())
        .bind(next_lot.as_deref())
        .bind(&next_condition)
        .bind(&next_trace)
        .bind(next_certificate.as_deref())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO inventory_events
               (id,organization_id,stock_unit_id,event_type,quantity_delta,
                actor_user_id,correlation_id,notes,payload,created_at)
               VALUES ($1,$2,$3,'metadata_corrected',0,$4,$5,$6,$7,now())"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(unit_id)
        .bind(context.user_id.0)
        .bind(context.correlation_id.0)
        .bind(
            input
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(&changed)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get_unit(context, unit_id).await
    }
}

/// `(status, version, serial_number, lot_number, condition_code, trace_type,
/// certificate_number)` as selected for a correction.
type CorrectableUnitRow = (
    String,
    i64,
    Option<String>,
    Option<String>,
    String,
    String,
    Option<String>,
);

fn normalized_location_code(code: Option<&str>) -> Result<String, PartsInventoryError> {
    let code = code.map(str::trim).unwrap_or_default().to_uppercase();
    if code.is_empty() {
        return Err(PartsInventoryError::Invalid("code is required".into()));
    }
    if code.len() > 64 {
        return Err(PartsInventoryError::Invalid(
            "code must be 64 characters or fewer".into(),
        ));
    }
    Ok(code)
}

/// An omitted field keeps its stored value; an explicit empty string clears it.
fn corrected(proposed: Option<&str>, stored: Option<&str>) -> Option<String> {
    match proposed {
        Some(value) => {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_owned())
        }
        None => stored.map(str::to_owned),
    }
}

fn record_change(
    target: &mut serde_json::Map<String, Value>,
    field: &str,
    before: Option<&str>,
    after: Option<&str>,
) {
    if before == after {
        return;
    }
    target.insert(field.to_owned(), json!({"from": before, "to": after}));
}

async fn resolve_location(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    context: &ExecutionContext,
    code: &str,
    default_type: &str,
) -> Result<Uuid, PartsInventoryError> {
    let code = normalized_location_code(Some(code))?;
    if let Some(id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM inventory_locations WHERE organization_id=$1 AND code=$2 AND active",
    )
    .bind(context.organization_id.0)
    .bind(&code)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(id);
    }
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO inventory_locations
           (id,organization_id,code,name,location_type,created_at,updated_at)
           VALUES ($1,$2,$3,$3,$4,now(),now())"#,
    )
    .bind(id)
    .bind(context.organization_id.0)
    .bind(&code)
    .bind(default_type)
    .execute(&mut **tx)
    .await?;
    Ok(id)
}
