//! Technical document and revision stubs.

use serde::{Deserialize, Serialize};

use time::{Date, OffsetDateTime};

use super::ids::{DocumentId, OrganizationId, RevisionId, UserId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnicalDocument {
    pub id: DocumentId,
    pub organization_id: OrganizationId,
    pub title: String,
    pub doc_type: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRevision {
    pub id: RevisionId,
    pub document_id: DocumentId,
    pub revision: String,
    pub effective_date: Option<Date>,
    pub supersedes: Option<RevisionId>,
    pub uploaded_by: UserId,
    pub sha256: String,
    pub created_at: OffsetDateTime,
}
