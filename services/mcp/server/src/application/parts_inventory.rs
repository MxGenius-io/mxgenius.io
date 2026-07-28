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
}
