//! Tenant-scoped canonical aircraft persistence.

use async_trait::async_trait;
use parking_lot::RwLock;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use time::OffsetDateTime;

use mxgenius_shared::adapters::source::{AdapterError, AdapterResult};
use mxgenius_shared::domain::ids::{AircraftId, OrganizationId};

#[derive(Debug, Clone)]
pub struct CanonicalAircraft {
    pub aircraft_id: AircraftId,
    pub source_system: String,
    pub source_id: String,
    pub registration: Option<String>,
    pub serial_number: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i32>,
    pub base_icao: Option<String>,
    pub freshness_at: OffsetDateTime,
}

#[async_trait]
pub trait AircraftCatalog: Send + Sync {
    async fn upsert(
        &self,
        organization_id: OrganizationId,
        aircraft: &CanonicalAircraft,
    ) -> AdapterResult<()>;
    async fn get(
        &self,
        organization_id: OrganizationId,
        aircraft_id: AircraftId,
    ) -> AdapterResult<Option<CanonicalAircraft>>;
}

#[derive(Clone, Default)]
pub struct InMemoryAircraftCatalog {
    records: Arc<RwLock<HashMap<(OrganizationId, AircraftId), CanonicalAircraft>>>,
}

#[async_trait]
impl AircraftCatalog for InMemoryAircraftCatalog {
    async fn upsert(
        &self,
        organization_id: OrganizationId,
        aircraft: &CanonicalAircraft,
    ) -> AdapterResult<()> {
        self.records
            .write()
            .insert((organization_id, aircraft.aircraft_id), aircraft.clone());
        Ok(())
    }

    async fn get(
        &self,
        organization_id: OrganizationId,
        aircraft_id: AircraftId,
    ) -> AdapterResult<Option<CanonicalAircraft>> {
        Ok(self
            .records
            .read()
            .get(&(organization_id, aircraft_id))
            .cloned())
    }
}

#[derive(Clone)]
pub struct PostgresAircraftCatalog {
    pool: PgPool,
}

impl PostgresAircraftCatalog {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AircraftCatalog for PostgresAircraftCatalog {
    async fn upsert(
        &self,
        organization_id: OrganizationId,
        aircraft: &CanonicalAircraft,
    ) -> AdapterResult<()> {
        sqlx::query(
            r#"INSERT INTO aircraft_canonical (
                   id, organization_id, aircraft_id, source_system, source_id,
                   make, model, year, registration, serial_number, base_icao,
                   metadata, freshness_at, updated_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb,$12,now())
               ON CONFLICT (organization_id, aircraft_id) DO UPDATE SET
                   source_system=EXCLUDED.source_system, source_id=EXCLUDED.source_id,
                   make=EXCLUDED.make, model=EXCLUDED.model, year=EXCLUDED.year,
                   registration=EXCLUDED.registration, serial_number=EXCLUDED.serial_number,
                   base_icao=EXCLUDED.base_icao, freshness_at=EXCLUDED.freshness_at,
                   updated_at=now()"#,
        )
        .bind(aircraft.aircraft_id.0)
        .bind(organization_id.0)
        .bind(aircraft.aircraft_id.to_string())
        .bind(&aircraft.source_system)
        .bind(&aircraft.source_id)
        .bind(&aircraft.make)
        .bind(&aircraft.model)
        .bind(aircraft.year)
        .bind(&aircraft.registration)
        .bind(&aircraft.serial_number)
        .bind(&aircraft.base_icao)
        .bind(aircraft.freshness_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AdapterError::Internal(format!("canonical aircraft upsert failed: {error}"))
        })?;
        Ok(())
    }

    async fn get(
        &self,
        organization_id: OrganizationId,
        aircraft_id: AircraftId,
    ) -> AdapterResult<Option<CanonicalAircraft>> {
        let row: Option<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i32>,
            Option<String>,
            OffsetDateTime,
        )> = sqlx::query_as(
            r#"SELECT source_system, source_id, registration, serial_number,
                      make, model, year, base_icao, freshness_at
               FROM aircraft_canonical
               WHERE organization_id=$1 AND id=$2"#,
        )
        .bind(organization_id.0)
        .bind(aircraft_id.0)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AdapterError::Internal(format!("canonical aircraft read failed: {error}"))
        })?;
        Ok(row.map(|row| CanonicalAircraft {
            aircraft_id,
            source_system: row.0,
            source_id: row.1,
            registration: row.2,
            serial_number: row.3,
            make: row.4,
            model: row.5,
            year: row.6,
            base_icao: row.7,
            freshness_at: row.8,
        }))
    }
}
