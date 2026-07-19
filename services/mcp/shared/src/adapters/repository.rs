//! Repository traits and the explicit local in-memory implementation.

use async_trait::async_trait;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

use super::source::AdapterResult;
use crate::domain::case::MaintenanceCase;
use crate::domain::ids::{CaseId, OrganizationId};

/// Read/write aggregate for cases. Production mounts Postgres; the in-memory
/// implementation is local/test only.
#[async_trait]
pub trait CaseRepository: Send + Sync {
    async fn insert(&self, case: &MaintenanceCase) -> AdapterResult<()>;
    async fn get(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> AdapterResult<Option<MaintenanceCase>>;
    async fn list(&self, org: OrganizationId) -> AdapterResult<Vec<MaintenanceCase>>;
}

/// In-memory default. Used until a real Postgres repository is mounted.
#[derive(Default, Clone)]
pub struct InMemoryCaseRepository {
    inner: Arc<RwLock<HashMap<(OrganizationId, CaseId), MaintenanceCase>>>,
}

impl InMemoryCaseRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl CaseRepository for InMemoryCaseRepository {
    async fn insert(&self, case: &MaintenanceCase) -> AdapterResult<()> {
        self.inner
            .write()
            .insert((case.organization_id, case.case_id), case.clone());
        Ok(())
    }
    async fn get(
        &self,
        org: OrganizationId,
        case_id: CaseId,
    ) -> AdapterResult<Option<MaintenanceCase>> {
        Ok(self.inner.read().get(&(org, case_id)).cloned())
    }
    async fn list(&self, org: OrganizationId) -> AdapterResult<Vec<MaintenanceCase>> {
        Ok(self
            .inner
            .read()
            .iter()
            .filter(|((o, _), _)| *o == org)
            .map(|(_, c)| c.clone())
            .collect())
    }
}
