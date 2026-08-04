//! Explicit tenant demo-data loader. This is never called during startup.

use serde::Serialize;
use uuid::Uuid;

const DEMO_SEED_SQL: &str = include_str!("../../demo/seed.sql");

fn tenant_seed_sql(organization_id: Uuid) -> String {
    let mut sql = DEMO_SEED_SQL.to_string();
    let shared_catalog_ids = [601_u16, 602, 603, 621, 622];
    for value in 0..=999_u16 {
        if shared_catalog_ids.contains(&value) {
            continue;
        }
        let fixture_id = format!("d0000000-0000-4000-8000-{value:012}");
        if sql.contains(&fixture_id) {
            let tenant_id = Uuid::new_v5(&organization_id, fixture_id.as_bytes());
            sql = sql.replace(&fixture_id, &tenant_id.to_string());
        }
    }
    sql
}

#[derive(Debug, Serialize)]
pub struct DemoSeedSummary {
    pub loaded: bool,
    pub dataset: &'static str,
    pub aircraft: i64,
    pub cases: i64,
    pub facilities: i64,
    pub stock_units: i64,
    pub evidence: i64,
    pub aircraft_id: &'static str,
    pub primary_case_id: Uuid,
    pub message: &'static str,
}

pub async fn seed_demo_data(
    pool: &sqlx::PgPool,
    organization_id: Uuid,
    actor_user_id: Uuid,
) -> Result<DemoSeedSummary, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "SELECT set_config('mxgenius.demo_org', $1, true), \
                set_config('mxgenius.demo_actor', $2, true)",
    )
    .bind(organization_id.to_string())
    .bind(actor_user_id.to_string())
    .execute(&mut *transaction)
    .await?;
    let seed_sql = tenant_seed_sql(organization_id);
    sqlx::query(&seed_sql).execute(&mut *transaction).await?;

    let (aircraft, cases, facilities, stock_units, evidence): (i64, i64, i64, i64, i64) =
        sqlx::query_as(
            r#"SELECT
                (SELECT count(*) FROM aircraft_canonical WHERE organization_id=$1 AND metadata->>'dataset'='mxgenius_complete_demo'),
                (SELECT count(*) FROM maintenance_cases WHERE organization_id=$1 AND normalized_discrepancy->>'dataset'='mxgenius_complete_demo'),
                (SELECT count(*) FROM mro_facilities WHERE organization_id=$1 AND source_reference LIKE 'demo://%'),
                (SELECT count(*) FROM stock_units WHERE organization_id=$1 AND metadata->>'dataset'='mxgenius_complete_demo'),
                (SELECT count(*) FROM evidence WHERE organization_id=$1 AND source_type='demo')"#,
        )
        .bind(organization_id)
        .fetch_one(&mut *transaction)
        .await?;
    transaction.commit().await?;

    Ok(DemoSeedSummary {
        loaded: true,
        dataset: "mxgenius_complete_demo",
        aircraft,
        cases,
        facilities,
        stock_units,
        evidence,
        aircraft_id: "MXG-DEMO-N350MX",
        primary_case_id: Uuid::new_v5(
            &organization_id,
            b"d0000000-0000-4000-8000-000000000101",
        ),
        message: "Demo records loaded. Every demo record is visibly labeled and reruns update the same records.",
    })
}

#[cfg(test)]
mod tests {
    use super::{tenant_seed_sql, DEMO_SEED_SQL};
    use uuid::Uuid;

    #[test]
    fn seed_is_explicit_labeled_and_idempotent() {
        assert!(DEMO_SEED_SQL.contains("mxgenius.demo_org"));
        assert!(DEMO_SEED_SQL.contains("mxgenius_complete_demo"));
        assert!(DEMO_SEED_SQL.contains("ON CONFLICT"));
        assert!(!DEMO_SEED_SQL.contains("INSERT INTO organizations"));
    }

    #[test]
    fn record_ids_are_stable_and_unique_per_tenant() {
        let left = tenant_seed_sql(Uuid::from_u128(1));
        let left_again = tenant_seed_sql(Uuid::from_u128(1));
        let right = tenant_seed_sql(Uuid::from_u128(2));
        assert_eq!(left, left_again);
        assert_ne!(left, right);
        assert!(left.contains("d0000000-0000-4000-8000-000000000601"));
        assert!(!left.contains("d0000000-0000-4000-8000-000000000101"));
        assert!(!right.contains("d0000000-0000-4000-8000-000000000101"));
    }

    #[test]
    fn seed_covers_the_operational_spine_and_parts_inventory() {
        for table in [
            "aircraft_canonical",
            "maintenance_cases",
            "maintenance_events",
            "observations",
            "components",
            "technical_documents",
            "regulatory_requirements",
            "parts",
            "part_requirements",
            "stock_units",
            "inventory_events",
            "faa_candidate_queries",
            "mro_facilities",
            "facility_capabilities",
            "schedule_options",
            "evidence",
            "approvals",
            "digital_twin_markers",
        ] {
            assert!(
                DEMO_SEED_SQL.contains(&format!("INSERT INTO {table}")),
                "demo seed must cover {table}"
            );
        }
    }
}
