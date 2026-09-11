//! Durable Equipment Pack and edge-device control-plane state.
//!
//! WebSockets are deliberately absent from this module. Assignment commits are
//! authoritative; transports may notify a connected device only after commit.

use std::collections::BTreeSet;

use mxgenius_shared::application::context::ExecutionContext;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

pub const EQUIPMENT_PACK_BLOCK_BYTES: usize = 8 * 1024 * 1024;
pub const EQUIPMENT_PACK_MAX_BYTES: i64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum EquipmentPackError {
    #[error("the requested record was not found")]
    NotFound,
    #[error("the requested operation conflicts with current state")]
    Conflict,
    #[error("the request is invalid: {0}")]
    Invalid(&'static str),
    #[error("the device credential is invalid")]
    Unauthorized,
    #[error("the enrollment code is expired or already consumed")]
    EnrollmentGone,
    #[error("persistence failed: {0}")]
    Persistence(#[from] sqlx::Error),
}

#[derive(Debug, Deserialize)]
pub struct CreateEquipmentPackInput {
    pub name: String,
    #[serde(rename = "equipmentFamily")]
    pub equipment_family: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEquipmentPackVersionInput {
    pub manifest: Value,
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    #[serde(rename = "byteSize")]
    pub byte_size: i64,
    #[serde(rename = "fileCount")]
    pub file_count: i32,
}

#[derive(Debug, Deserialize)]
pub struct RegisterEdgeDeviceInput {
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "hardwareId")]
    pub hardware_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AssignEquipmentPackInput {
    #[serde(rename = "versionId")]
    pub version_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct EdgeEnrollmentInput {
    pub code: String,
    #[serde(rename = "hardwareId")]
    pub hardware_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EdgeDeploymentStatusInput {
    pub state: String,
    #[serde(rename = "activeSlot")]
    pub active_slot: Option<String>,
    #[serde(rename = "observedHash")]
    pub observed_hash: Option<String>,
    #[serde(rename = "errorCode")]
    pub error_code: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentPackRow {
    pub id: Uuid,
    pub name: String,
    pub equipment_family: String,
    pub description: Option<String>,
    pub archived: bool,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentPackVersionRow {
    pub id: Uuid,
    pub pack_id: Uuid,
    pub version_number: i64,
    pub status: String,
    pub manifest: Value,
    pub content_hash: String,
    pub byte_size: i64,
    pub file_count: i32,
    #[serde(skip_serializing)]
    pub storage_key: String,
    pub created_at: OffsetDateTime,
    pub published_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EdgeDeviceRow {
    pub id: Uuid,
    pub display_name: String,
    pub hardware_id: Option<String>,
    pub status: String,
    pub last_seen_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, FromRow)]
pub struct DeviceIdentity {
    pub organization_id: Uuid,
    pub device_id: Uuid,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDesiredState {
    #[serde(skip_serializing)]
    pub organization_id: Uuid,
    pub device_id: Uuid,
    pub generation: i64,
    pub version_id: Uuid,
    pub pack_id: Uuid,
    pub version_number: i64,
    pub content_hash: String,
    pub byte_size: i64,
    pub file_count: i32,
    pub manifest: Value,
    #[serde(skip_serializing)]
    pub storage_key: String,
    pub requested_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UploadBlockRow {
    pub block_index: i32,
    pub block_id: String,
    pub byte_size: i32,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EdgeDeploymentRow {
    pub id: Uuid,
    pub version_id: Uuid,
    pub generation: i64,
    pub state: String,
    pub active_slot: Option<String>,
    pub observed_hash: Option<String>,
    pub error_code: Option<String>,
    pub detail: Option<String>,
    pub reported_at: OffsetDateTime,
}

#[derive(Clone)]
pub struct EquipmentPackRepository {
    pool: PgPool,
}

impl EquipmentPackRepository {
    pub fn new(pool: &PgPool) -> Self {
        Self { pool: pool.clone() }
    }

    pub async fn create_pack(
        &self,
        context: &ExecutionContext,
        input: &CreateEquipmentPackInput,
    ) -> Result<EquipmentPackRow, EquipmentPackError> {
        let name = bounded_text(&input.name, 120, "pack name is required")?;
        let family = bounded_text(&input.equipment_family, 120, "equipment family is required")?;
        if input
            .description
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1000)
        {
            return Err(EquipmentPackError::Invalid("description is too long"));
        }
        sqlx::query_as(
            r#"INSERT INTO equipment_packs
               (id,organization_id,name,equipment_family,description,created_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               RETURNING id,name,equipment_family,description,archived,created_at,updated_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(name)
        .bind(family)
        .bind(input.description.as_deref().map(str::trim))
        .bind(context.user_id.0)
        .fetch_one(&self.pool)
        .await
        .map_err(map_database_error)
    }

    pub async fn list_packs(
        &self,
        context: &ExecutionContext,
    ) -> Result<Vec<EquipmentPackRow>, EquipmentPackError> {
        Ok(sqlx::query_as(
            r#"SELECT id,name,equipment_family,description,archived,created_at,updated_at
               FROM equipment_packs
               WHERE organization_id=$1 AND archived=false
               ORDER BY updated_at DESC,id"#,
        )
        .bind(context.organization_id.0)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn create_version(
        &self,
        context: &ExecutionContext,
        pack_id: Uuid,
        input: &CreateEquipmentPackVersionInput,
    ) -> Result<EquipmentPackVersionRow, EquipmentPackError> {
        validate_manifest(&input.manifest, input.file_count)?;
        if input.byte_size < 1 || input.byte_size > EQUIPMENT_PACK_MAX_BYTES {
            return Err(EquipmentPackError::Invalid(
                "package size is outside the 2 GiB limit",
            ));
        }
        validate_sha256(&input.content_hash)?;
        let mut transaction = self.pool.begin().await?;
        let locked_pack: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM equipment_packs WHERE organization_id=$1 AND id=$2 AND archived=false FOR UPDATE",
        )
        .bind(context.organization_id.0)
        .bind(pack_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if locked_pack.is_none() {
            return Err(EquipmentPackError::NotFound);
        }
        let version_number: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(version_number),0)+1 FROM equipment_pack_versions WHERE organization_id=$1 AND pack_id=$2",
        )
        .bind(context.organization_id.0)
        .bind(pack_id)
        .fetch_one(&mut *transaction)
        .await?;
        let id = Uuid::new_v4();
        let digest = input.content_hash.trim_start_matches("sha256:");
        let storage_key = format!(
            "documents/equipment-packs/{}/{}/{}/{}.zip",
            context.organization_id.0, pack_id, id, digest
        );
        let row = sqlx::query_as(
            r#"INSERT INTO equipment_pack_versions
               (id,organization_id,pack_id,version_number,manifest,content_hash,
                byte_size,file_count,storage_key,created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               RETURNING id,pack_id,version_number,status,manifest,content_hash,
                         byte_size,file_count,storage_key,created_at,published_at"#,
        )
        .bind(id)
        .bind(context.organization_id.0)
        .bind(pack_id)
        .bind(version_number)
        .bind(&input.manifest)
        .bind(&input.content_hash)
        .bind(input.byte_size)
        .bind(input.file_count)
        .bind(storage_key)
        .bind(context.user_id.0)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(row)
    }

    pub async fn version_for_upload(
        &self,
        organization_id: Uuid,
        version_id: Uuid,
    ) -> Result<EquipmentPackVersionRow, EquipmentPackError> {
        sqlx::query_as(
            r#"SELECT id,pack_id,version_number,status,manifest,content_hash,
                      byte_size,file_count,storage_key,created_at,published_at
               FROM equipment_pack_versions WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(organization_id)
        .bind(version_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(EquipmentPackError::NotFound)
    }

    pub async fn list_versions(
        &self,
        context: &ExecutionContext,
        pack_id: Uuid,
    ) -> Result<Vec<EquipmentPackVersionRow>, EquipmentPackError> {
        Ok(sqlx::query_as(
            r#"SELECT v.id,v.pack_id,v.version_number,v.status,v.manifest,v.content_hash,
                      v.byte_size,v.file_count,v.storage_key,v.created_at,v.published_at
               FROM equipment_pack_versions v
               JOIN equipment_packs p
                 ON p.organization_id=v.organization_id AND p.id=v.pack_id
               WHERE v.organization_id=$1 AND v.pack_id=$2 AND p.archived=false
               ORDER BY v.version_number DESC"#,
        )
        .bind(context.organization_id.0)
        .bind(pack_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn record_upload_block(
        &self,
        organization_id: Uuid,
        version_id: Uuid,
        block_index: i32,
        block_id: &str,
        byte_size: i32,
        content_hash: &str,
    ) -> Result<(), EquipmentPackError> {
        if !(0..50_000).contains(&block_index)
            || !(1..=EQUIPMENT_PACK_BLOCK_BYTES as i32).contains(&byte_size)
        {
            return Err(EquipmentPackError::Invalid(
                "upload block is outside its bounds",
            ));
        }
        validate_sha256(content_hash)?;
        let result = sqlx::query(
            r#"INSERT INTO equipment_pack_upload_blocks
               (organization_id,version_id,block_index,block_id,byte_size,content_hash)
               SELECT $1,$2,$3,$4,$5,$6
               WHERE EXISTS (
                 SELECT 1 FROM equipment_pack_versions
                 WHERE organization_id=$1 AND id=$2 AND status='uploading'
               )
               ON CONFLICT (version_id,block_index) DO UPDATE SET
                 block_id=EXCLUDED.block_id,byte_size=EXCLUDED.byte_size,
                 content_hash=EXCLUDED.content_hash,uploaded_at=now()"#,
        )
        .bind(organization_id)
        .bind(version_id)
        .bind(block_index)
        .bind(block_id)
        .bind(byte_size)
        .bind(content_hash)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(EquipmentPackError::Conflict);
        }
        Ok(())
    }

    pub async fn upload_blocks(
        &self,
        organization_id: Uuid,
        version_id: Uuid,
    ) -> Result<Vec<UploadBlockRow>, EquipmentPackError> {
        Ok(sqlx::query_as(
            r#"SELECT block_index,block_id,byte_size,content_hash
               FROM equipment_pack_upload_blocks
               WHERE organization_id=$1 AND version_id=$2
               ORDER BY block_index"#,
        )
        .bind(organization_id)
        .bind(version_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn publish_version(
        &self,
        organization_id: Uuid,
        version_id: Uuid,
    ) -> Result<EquipmentPackVersionRow, EquipmentPackError> {
        sqlx::query_as(
            r#"UPDATE equipment_pack_versions SET status='published',published_at=now()
               WHERE organization_id=$1 AND id=$2 AND status='uploading'
               RETURNING id,pack_id,version_number,status,manifest,content_hash,
                         byte_size,file_count,storage_key,created_at,published_at"#,
        )
        .bind(organization_id)
        .bind(version_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(EquipmentPackError::Conflict)
    }

    pub async fn mark_version_failed(&self, organization_id: Uuid, version_id: Uuid) {
        let _ = sqlx::query(
            "UPDATE equipment_pack_versions SET status='failed' WHERE organization_id=$1 AND id=$2 AND status='uploading'",
        )
        .bind(organization_id)
        .bind(version_id)
        .execute(&self.pool)
        .await;
    }

    pub async fn register_device(
        &self,
        context: &ExecutionContext,
        input: &RegisterEdgeDeviceInput,
    ) -> Result<EdgeDeviceRow, EquipmentPackError> {
        let display_name = bounded_text(&input.display_name, 120, "device name is required")?;
        if input
            .hardware_id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 180)
        {
            return Err(EquipmentPackError::Invalid("hardware id is invalid"));
        }
        sqlx::query_as(
            r#"INSERT INTO edge_devices
               (id,organization_id,display_name,hardware_id,created_by)
               VALUES ($1,$2,$3,$4,$5)
               RETURNING id,display_name,hardware_id,status,last_seen_at,created_at,updated_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(display_name)
        .bind(input.hardware_id.as_deref().map(str::trim))
        .bind(context.user_id.0)
        .fetch_one(&self.pool)
        .await
        .map_err(map_database_error)
    }

    pub async fn list_devices(
        &self,
        context: &ExecutionContext,
    ) -> Result<Vec<EdgeDeviceRow>, EquipmentPackError> {
        Ok(sqlx::query_as(
            r#"SELECT id,display_name,hardware_id,status,last_seen_at,created_at,updated_at
               FROM edge_devices WHERE organization_id=$1
               ORDER BY updated_at DESC,id"#,
        )
        .bind(context.organization_id.0)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn revoke_device(
        &self,
        context: &ExecutionContext,
        device_id: Uuid,
    ) -> Result<EdgeDeviceRow, EquipmentPackError> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query_as(
            r#"UPDATE edge_devices SET status='revoked',credential_hash=NULL,
                      credential_issued_at=NULL,updated_at=now()
               WHERE organization_id=$1 AND id=$2 AND status<>'revoked'
               RETURNING id,display_name,hardware_id,status,last_seen_at,created_at,updated_at"#,
        )
        .bind(context.organization_id.0)
        .bind(device_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(EquipmentPackError::NotFound)?;
        sqlx::query(
            r#"UPDATE edge_device_enrollment_codes SET consumed_at=now()
               WHERE organization_id=$1 AND device_id=$2 AND consumed_at IS NULL"#,
        )
        .bind(context.organization_id.0)
        .bind(device_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(row)
    }

    pub async fn deployment_history(
        &self,
        context: &ExecutionContext,
        device_id: Uuid,
    ) -> Result<Vec<EdgeDeploymentRow>, EquipmentPackError> {
        let device_exists: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM edge_devices
               WHERE organization_id=$1 AND id=$2)"#,
        )
        .bind(context.organization_id.0)
        .bind(device_id)
        .fetch_one(&self.pool)
        .await?;
        if !device_exists {
            return Err(EquipmentPackError::NotFound);
        }
        Ok(sqlx::query_as(
            r#"SELECT id,version_id,generation,state,active_slot,observed_hash,
                      error_code,detail,reported_at
               FROM edge_device_deployments
               WHERE organization_id=$1 AND device_id=$2
               ORDER BY generation DESC,reported_at DESC,id"#,
        )
        .bind(context.organization_id.0)
        .bind(device_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn issue_enrollment_code(
        &self,
        context: &ExecutionContext,
        device_id: Uuid,
        code_hash: &str,
    ) -> Result<OffsetDateTime, EquipmentPackError> {
        validate_sha256(code_hash)?;
        let expires_at = OffsetDateTime::now_utc() + Duration::minutes(10);
        let mut transaction = self.pool.begin().await?;
        let locked_device: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM edge_devices WHERE organization_id=$1 AND id=$2 AND status<>'revoked' FOR UPDATE",
        )
        .bind(context.organization_id.0)
        .bind(device_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if locked_device.is_none() {
            return Err(EquipmentPackError::NotFound);
        }
        sqlx::query(
            "UPDATE edge_device_enrollment_codes SET consumed_at=now() WHERE organization_id=$1 AND device_id=$2 AND consumed_at IS NULL",
        )
        .bind(context.organization_id.0)
        .bind(device_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            r#"INSERT INTO edge_device_enrollment_codes
               (id,organization_id,device_id,code_hash,expires_at,created_by)
               VALUES ($1,$2,$3,$4,$5,$6)"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(device_id)
        .bind(code_hash)
        .bind(expires_at)
        .bind(context.user_id.0)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(expires_at)
    }

    pub async fn enrollment_device_id(&self, code_hash: &str) -> Result<Uuid, EquipmentPackError> {
        validate_sha256(code_hash)?;
        sqlx::query_scalar(
            r#"SELECT device_id FROM edge_device_enrollment_codes
               WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now()"#,
        )
        .bind(code_hash)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(EquipmentPackError::Unauthorized)
    }

    pub async fn enroll_device(
        &self,
        code_hash: &str,
        credential_hash: &str,
        hardware_id: Option<&str>,
    ) -> Result<DeviceIdentity, EquipmentPackError> {
        validate_sha256(code_hash)?;
        validate_sha256(credential_hash)?;
        if hardware_id.is_some_and(|value| value.trim().is_empty() || value.chars().count() > 180) {
            return Err(EquipmentPackError::Invalid("hardware id is invalid"));
        }
        let mut transaction = self.pool.begin().await?;
        let enrollment: Option<(Uuid, Uuid, OffsetDateTime, Option<OffsetDateTime>)> =
            sqlx::query_as(
                r#"SELECT organization_id,device_id,expires_at,consumed_at
                   FROM edge_device_enrollment_codes WHERE code_hash=$1 FOR UPDATE"#,
            )
            .bind(code_hash)
            .fetch_optional(&mut *transaction)
            .await?;
        let Some((organization_id, device_id, expires_at, consumed_at)) = enrollment else {
            return Err(EquipmentPackError::Unauthorized);
        };
        if consumed_at.is_some() || expires_at <= OffsetDateTime::now_utc() {
            return Err(EquipmentPackError::EnrollmentGone);
        }
        let identity: DeviceIdentity = sqlx::query_as(
            r#"UPDATE edge_devices SET
                 credential_hash=$1,credential_issued_at=now(),status='active',
                 hardware_id=COALESCE($2,hardware_id),last_seen_at=now(),updated_at=now()
               WHERE organization_id=$3 AND id=$4 AND status<>'revoked'
               RETURNING organization_id,id AS device_id,display_name"#,
        )
        .bind(credential_hash)
        .bind(hardware_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(organization_id)
        .bind(device_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(EquipmentPackError::EnrollmentGone)?;
        sqlx::query("UPDATE edge_device_enrollment_codes SET consumed_at=now() WHERE code_hash=$1")
            .bind(code_hash)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(identity)
    }

    pub async fn authenticate_device(
        &self,
        device_id: Uuid,
        credential_hash: &str,
    ) -> Result<DeviceIdentity, EquipmentPackError> {
        validate_sha256(credential_hash)?;
        let stored: Option<(Uuid, Uuid, String, String)> = sqlx::query_as(
            r#"SELECT organization_id,id,display_name,credential_hash
               FROM edge_devices WHERE id=$1 AND status IN ('active','offline')"#,
        )
        .bind(device_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((organization_id, device_id, display_name, stored_hash)) = stored else {
            return Err(EquipmentPackError::Unauthorized);
        };
        if !constant_time_eq(stored_hash.as_bytes(), credential_hash.as_bytes()) {
            return Err(EquipmentPackError::Unauthorized);
        }
        sqlx::query(
            r#"UPDATE edge_devices SET last_seen_at=now(),updated_at=now(),
                 status=CASE WHEN status='offline' THEN 'active' ELSE status END
               WHERE id=$1 AND status IN ('active','offline')"#,
        )
        .bind(device_id)
        .execute(&self.pool)
        .await?;
        Ok(DeviceIdentity {
            organization_id,
            device_id,
            display_name,
        })
    }

    pub async fn assign_version(
        &self,
        context: &ExecutionContext,
        device_id: Uuid,
        version_id: Uuid,
    ) -> Result<i64, EquipmentPackError> {
        let mut transaction = self.pool.begin().await?;
        let valid: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1 FROM edge_devices d
                 JOIN equipment_pack_versions v ON v.organization_id=d.organization_id
                 WHERE d.organization_id=$1 AND d.id=$2 AND d.status<>'revoked'
                   AND v.id=$3 AND v.status='published'
               )"#,
        )
        .bind(context.organization_id.0)
        .bind(device_id)
        .bind(version_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !valid {
            return Err(EquipmentPackError::NotFound);
        }
        let generation: i64 = sqlx::query_scalar(
            r#"INSERT INTO edge_device_assignments
               (device_id,organization_id,version_id,generation,requested_by)
               VALUES ($1,$2,$3,1,$4)
               ON CONFLICT (device_id) DO UPDATE SET
                 version_id=EXCLUDED.version_id,
                 generation=edge_device_assignments.generation+1,
                 requested_by=EXCLUDED.requested_by,
                 requested_at=now()
               RETURNING generation"#,
        )
        .bind(device_id)
        .bind(context.organization_id.0)
        .bind(version_id)
        .bind(context.user_id.0)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(generation)
    }

    pub async fn desired_state(
        &self,
        identity: &DeviceIdentity,
    ) -> Result<Option<DeviceDesiredState>, EquipmentPackError> {
        Ok(sqlx::query_as(
            r#"SELECT a.organization_id,a.device_id,a.generation,a.version_id,
                      v.pack_id,v.version_number,v.content_hash,v.byte_size,
                      v.file_count,v.manifest,v.storage_key,a.requested_at
               FROM edge_device_assignments a
               JOIN equipment_pack_versions v
                 ON v.organization_id=a.organization_id AND v.id=a.version_id
               WHERE a.organization_id=$1 AND a.device_id=$2 AND v.status='published'"#,
        )
        .bind(identity.organization_id)
        .bind(identity.device_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn assigned_version(
        &self,
        identity: &DeviceIdentity,
        version_id: Uuid,
    ) -> Result<DeviceDesiredState, EquipmentPackError> {
        self.desired_state(identity)
            .await?
            .filter(|state| state.version_id == version_id)
            .ok_or(EquipmentPackError::NotFound)
    }

    pub async fn record_deployment(
        &self,
        identity: &DeviceIdentity,
        generation: i64,
        input: &EdgeDeploymentStatusInput,
    ) -> Result<(), EquipmentPackError> {
        validate_deployment_status(input)?;
        let state = self
            .desired_state(identity)
            .await?
            .filter(|state| state.generation == generation)
            .ok_or(EquipmentPackError::Conflict)?;
        if input.state != "failed"
            && input
                .observed_hash
                .as_deref()
                .is_some_and(|hash| hash != state.content_hash)
        {
            return Err(EquipmentPackError::Invalid(
                "observed hash does not match the assigned package",
            ));
        }
        sqlx::query(
            r#"INSERT INTO edge_device_deployments
               (id,organization_id,device_id,version_id,generation,state,
                active_slot,observed_hash,error_code,detail)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (device_id,generation,state) DO UPDATE SET
                 active_slot=EXCLUDED.active_slot,observed_hash=EXCLUDED.observed_hash,
                 error_code=EXCLUDED.error_code,detail=EXCLUDED.detail,reported_at=now()"#,
        )
        .bind(Uuid::new_v4())
        .bind(identity.organization_id)
        .bind(identity.device_id)
        .bind(state.version_id)
        .bind(generation)
        .bind(&input.state)
        .bind(input.active_slot.as_deref())
        .bind(input.observed_hash.as_deref())
        .bind(input.error_code.as_deref())
        .bind(input.detail.as_deref())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn bounded_text<'a>(
    value: &'a str,
    maximum: usize,
    message: &'static str,
) -> Result<&'a str, EquipmentPackError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        Err(EquipmentPackError::Invalid(message))
    } else {
        Ok(value)
    }
}

pub fn validate_sha256(value: &str) -> Result<(), EquipmentPackError> {
    let digest = value.strip_prefix("sha256:").unwrap_or_default();
    if digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(EquipmentPackError::Invalid(
            "SHA-256 must use lowercase sha256:<hex> form",
        ))
    }
}

pub fn validate_manifest(
    manifest: &Value,
    expected_file_count: i32,
) -> Result<(), EquipmentPackError> {
    if manifest.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(EquipmentPackError::Invalid(
            "manifest schemaVersion must be 1",
        ));
    }
    let files =
        manifest
            .get("files")
            .and_then(Value::as_array)
            .ok_or(EquipmentPackError::Invalid(
                "manifest files must be an array",
            ))?;
    if expected_file_count < 1
        || files.len() != expected_file_count as usize
        || files.len() > 100_000
    {
        return Err(EquipmentPackError::Invalid(
            "manifest file count does not match",
        ));
    }
    let mut paths = BTreeSet::new();
    for file in files {
        let path = file
            .get("path")
            .and_then(Value::as_str)
            .ok_or(EquipmentPackError::Invalid(
                "every manifest file requires a path",
            ))?;
        validate_pack_path(path)?;
        if !paths.insert(path.to_ascii_lowercase()) {
            return Err(EquipmentPackError::Invalid(
                "manifest paths collide case-insensitively",
            ));
        }
        let size = file.get("sizeBytes").and_then(Value::as_u64);
        if size.is_none() || size.is_some_and(|value| value > EQUIPMENT_PACK_MAX_BYTES as u64) {
            return Err(EquipmentPackError::Invalid("manifest file size is invalid"));
        }
        validate_sha256(
            file.get("sha256")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?;
    }
    Ok(())
}

pub fn validate_pack_path(path: &str) -> Result<(), EquipmentPackError> {
    if path.is_empty()
        || path.len() > 1024
        || path.starts_with(['/', '\\'])
        || path.contains('\\')
        || path.bytes().any(|byte| byte == 0 || byte < 32)
    {
        return Err(EquipmentPackError::Invalid("manifest path is unsafe"));
    }
    for component in path.split('/') {
        if component.is_empty()
            || matches!(component, "." | "..")
            || component.len() > 255
            || component.ends_with(['.', ' '])
        {
            return Err(EquipmentPackError::Invalid("manifest path is unsafe"));
        }
        let stem = component
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit())
        {
            return Err(EquipmentPackError::Invalid(
                "manifest path uses a reserved FAT name",
            ));
        }
    }
    Ok(())
}

fn validate_deployment_status(input: &EdgeDeploymentStatusInput) -> Result<(), EquipmentPackError> {
    if !matches!(
        input.state.as_str(),
        "downloading" | "verified" | "staged" | "activating" | "active" | "failed"
    ) {
        return Err(EquipmentPackError::Invalid("deployment state is invalid"));
    }
    if input
        .active_slot
        .as_deref()
        .is_some_and(|value| !matches!(value, "A" | "B"))
    {
        return Err(EquipmentPackError::Invalid("active slot must be A or B"));
    }
    if let Some(hash) = &input.observed_hash {
        validate_sha256(hash)?;
    }
    if matches!(
        input.state.as_str(),
        "verified" | "staged" | "activating" | "active"
    ) && input.observed_hash.is_none()
    {
        return Err(EquipmentPackError::Invalid(
            "verified deployment states require the observed package hash",
        ));
    }
    if matches!(input.state.as_str(), "staged" | "activating" | "active")
        && input.active_slot.is_none()
    {
        return Err(EquipmentPackError::Invalid(
            "staged deployment states require the active image slot",
        ));
    }
    if input.state == "failed" && input.error_code.is_none() {
        return Err(EquipmentPackError::Invalid(
            "failed deployments require an error code",
        ));
    }
    if input.error_code.as_ref().is_some_and(|value| {
        value.is_empty()
            || value.len() > 80
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    }) {
        return Err(EquipmentPackError::Invalid("error code is invalid"));
    }
    if input
        .detail
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1000)
    {
        return Err(EquipmentPackError::Invalid("deployment detail is too long"));
    }
    Ok(())
}

fn map_database_error(error: sqlx::Error) -> EquipmentPackError {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .is_some_and(|code| code == "23505")
    {
        EquipmentPackError::Conflict
    } else {
        EquipmentPackError::Persistence(error)
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn hash() -> String {
        format!("sha256:{}", "a".repeat(64))
    }

    #[test]
    fn manifest_accepts_a_normalized_equipment_tree() {
        let manifest = json!({
            "schemaVersion": 1,
            "files": [
                {"path": "MANUALS/AMM/section-29.pdf", "sizeBytes": 42, "sha256": hash()},
                {"path": "CONFIG/device.json", "sizeBytes": 7, "sha256": hash()}
            ]
        });
        assert!(validate_manifest(&manifest, 2).is_ok());
    }

    #[test]
    fn manifest_rejects_traversal_case_collisions_and_reserved_names() {
        for path in [
            "../secret",
            "A/../../secret",
            "CONFIG\\device.json",
            "AUX.txt",
        ] {
            assert!(validate_pack_path(path).is_err(), "{path} must be rejected");
        }
        let manifest = json!({
            "schemaVersion": 1,
            "files": [
                {"path": "Manuals/AMM.pdf", "sizeBytes": 42, "sha256": hash()},
                {"path": "manuals/amm.PDF", "sizeBytes": 42, "sha256": hash()}
            ]
        });
        assert!(validate_manifest(&manifest, 2).is_err());
    }

    #[test]
    fn device_status_is_bounded_and_hashes_are_strict() {
        assert!(validate_sha256(&hash()).is_ok());
        assert!(validate_sha256(&format!("sha256:{}", "A".repeat(64))).is_err());
        assert!(validate_deployment_status(&EdgeDeploymentStatusInput {
            state: "active".into(),
            active_slot: Some("A".into()),
            observed_hash: Some(hash()),
            error_code: None,
            detail: None,
        })
        .is_ok());
        assert!(validate_deployment_status(&EdgeDeploymentStatusInput {
            state: "active".into(),
            active_slot: None,
            observed_hash: Some(hash()),
            error_code: None,
            detail: None,
        })
        .is_err());
        assert!(validate_deployment_status(&EdgeDeploymentStatusInput {
            state: "failed".into(),
            active_slot: None,
            observed_hash: None,
            error_code: None,
            detail: Some("download stopped".into()),
        })
        .is_err());
    }
}
