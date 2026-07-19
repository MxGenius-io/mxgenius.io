//! In-memory evidence store with content-hash deduplication, immutable
//! linked records, and tenant scoping.
//!
//! Replaces the stub from `mxgenius-shared::adapters::repository`. The
//! Postgres-backed implementation is a mount task.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::RwLock;
use sqlx::PgPool;
use uuid::Uuid;

use mxgenius_shared::domain::datetime::UtcDateTime;
use mxgenius_shared::domain::ids::{CaseId, EvidenceId, OrganizationId};

#[derive(Debug, Clone)]
pub struct EvidenceRecord {
    pub evidence_id: EvidenceId,
    pub source_type: String,
    pub source_reference: String,
    pub kind: String,
    pub title: String,
    pub excerpt: Option<String>,
    pub retrieved_at: UtcDateTime,
    pub effective_at: Option<UtcDateTime>,
    pub revision: Option<String>,
    pub license_scope: Option<String>,
    pub content_hash: String,
    pub content: String,
}

#[async_trait]
pub trait EvidenceStore: Send + Sync {
    async fn exists_by_hash(&self, hash: &str, org: OrganizationId) -> Result<bool, String>;
    /// Returns true only when a new immutable record was inserted.
    async fn append(
        &self,
        record: EvidenceRecord,
        org: OrganizationId,
        case: Option<CaseId>,
    ) -> Result<bool, String>;
    async fn list_for_case(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<Vec<EvidenceRecord>, String>;
}

#[derive(Default)]
struct Inner {
    by_hash: HashSet<(OrganizationId, String)>,
    records: Vec<StoredEvidence>,
}

#[async_trait]
impl EvidenceStore for EvidenceService {
    async fn exists_by_hash(&self, hash: &str, org: OrganizationId) -> Result<bool, String> {
        Ok(EvidenceService::exists_by_hash(self, hash, org))
    }

    async fn append(
        &self,
        record: EvidenceRecord,
        org: OrganizationId,
        case: Option<CaseId>,
    ) -> Result<bool, String> {
        let existed = EvidenceService::exists_by_hash(self, &record.content_hash, org);
        EvidenceService::append(self, record, org, case);
        Ok(!existed)
    }

    async fn list_for_case(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<Vec<EvidenceRecord>, String> {
        Ok(EvidenceService::list_for_case(self, org, case_id))
    }
}

#[derive(Clone)]
pub struct PostgresEvidenceService {
    pool: PgPool,
}

impl PostgresEvidenceService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EvidenceStore for PostgresEvidenceService {
    async fn exists_by_hash(&self, hash: &str, org: OrganizationId) -> Result<bool, String> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM evidence WHERE organization_id=$1 AND content_hash=$2)",
        )
        .bind(org.0)
        .bind(hash)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| e.to_string())
    }

    async fn append(
        &self,
        record: EvidenceRecord,
        org: OrganizationId,
        case: Option<CaseId>,
    ) -> Result<bool, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let result = sqlx::query(
            r#"INSERT INTO evidence
               (id,organization_id,source_type,source_reference,kind,title,excerpt,retrieved_at,
                effective_at,revision,license_scope,content_hash,content)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               ON CONFLICT (organization_id,content_hash) DO NOTHING"#,
        )
        .bind(record.evidence_id.0)
        .bind(org.0)
        .bind(&record.source_type)
        .bind(&record.source_reference)
        .bind(&record.kind)
        .bind(&record.title)
        .bind(&record.excerpt)
        .bind(record.retrieved_at.inner())
        .bind(record.effective_at.map(|value| value.inner()))
        .bind(&record.revision)
        .bind(&record.license_scope)
        .bind(&record.content_hash)
        .bind(&record.content)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let inserted = result.rows_affected() == 1;
        if inserted {
            if let Some(case_id) = case {
                sqlx::query(
                    "INSERT INTO evidence_links (organization_id,evidence_id,case_id) VALUES ($1,$2,$3)",
                )
                .bind(org.0)
                .bind(record.evidence_id.0)
                .bind(case_id.0)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(inserted)
    }

    async fn list_for_case(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> Result<Vec<EvidenceRecord>, String> {
        let rows: Vec<(
            Uuid,
            String,
            String,
            String,
            String,
            Option<String>,
            time::OffsetDateTime,
            Option<time::OffsetDateTime>,
            Option<String>,
            Option<String>,
            String,
            String,
        )> = sqlx::query_as(
            r#"SELECT e.id,e.source_type,e.source_reference,e.kind,e.title,e.excerpt,
                      e.retrieved_at,e.effective_at,e.revision,e.license_scope,e.content_hash,e.content
               FROM evidence e JOIN evidence_links l
                 ON l.organization_id=e.organization_id AND l.evidence_id=e.id
               WHERE e.organization_id=$1 AND l.case_id=$2 ORDER BY e.retrieved_at,e.id"#,
        )
        .bind(org.0)
        .bind(case_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    source_type,
                    source_reference,
                    kind,
                    title,
                    excerpt,
                    retrieved_at,
                    effective_at,
                    revision,
                    license_scope,
                    content_hash,
                    content,
                )| EvidenceRecord {
                    evidence_id: EvidenceId(id),
                    source_type,
                    source_reference,
                    kind,
                    title,
                    excerpt,
                    retrieved_at: retrieved_at.into(),
                    effective_at: effective_at.map(Into::into),
                    revision,
                    license_scope,
                    content_hash,
                    content,
                },
            )
            .collect())
    }
}

#[derive(Debug, Clone)]
struct StoredEvidence {
    organization_id: OrganizationId,
    case_id: Option<CaseId>,
    record: EvidenceRecord,
}

#[derive(Clone, Default)]
pub struct EvidenceService {
    inner: Arc<RwLock<Inner>>,
}

impl EvidenceService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn exists_by_hash(&self, hash: &str, org: OrganizationId) -> bool {
        self.inner.read().by_hash.contains(&(org, hash.to_owned()))
    }

    pub fn append(&self, record: EvidenceRecord, org: OrganizationId, case: Option<CaseId>) {
        let mut w = self.inner.write();
        if w.by_hash.insert((org, record.content_hash.clone())) {
            w.records.push(StoredEvidence {
                organization_id: org,
                case_id: case,
                record,
            });
        }
    }

    pub fn list_for_org(&self, org: OrganizationId) -> Vec<EvidenceRecord> {
        self.inner
            .read()
            .records
            .iter()
            .filter(|stored| stored.organization_id == org)
            .map(|stored| stored.record.clone())
            .collect()
    }

    pub fn list_for_case(&self, org: OrganizationId, case_id: CaseId) -> Vec<EvidenceRecord> {
        self.inner
            .read()
            .records
            .iter()
            .filter(|stored| stored.organization_id == org && stored.case_id == Some(case_id))
            .map(|stored| stored.record.clone())
            .collect()
    }

    pub fn count_for_org(&self, org: OrganizationId) -> usize {
        self.inner
            .read()
            .records
            .iter()
            .filter(|stored| stored.organization_id == org)
            .count()
    }
}

#[allow(dead_code)]
fn _unused_uuid(_: Uuid) {}
