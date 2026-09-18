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
    // Expanded part masters are a shared fictional catalog, but their stock
    // units belong to the organization loading the demo. Tenantize only the
    // d2 stock-card fixtures so a second organization receives its own 47
    // cards instead of colliding with the first organization's primary keys.
    for value in 1..=47_u16 {
        let fixture_id = format!("d2000000-0000-4000-8000-{value:012}");
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

    let (aircraft, cases, stock_units, evidence): (i64, i64, i64, i64) =
        sqlx::query_as(
            r#"SELECT
                (SELECT count(*) FROM aircraft_canonical WHERE organization_id=$1 AND metadata->>'dataset'='mxgenius_complete_demo'),
                (SELECT count(*) FROM maintenance_cases WHERE organization_id=$1 AND normalized_discrepancy->>'dataset'='mxgenius_complete_demo' AND COALESCE((normalized_discrepancy->>'presentation_hidden')::boolean, false)=false),
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
        stock_units,
        evidence,
        aircraft_id: "MXG-DEMO-N350MX",
        primary_case_id: Uuid::new_v5(
            &organization_id,
            b"d0000000-0000-4000-8000-000000000101",
        ),
        message: "Friday demo records loaded: strobe, main wheel, and windshield review. Every record is visibly labeled and reruns update the same records.",
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
    fn maintenance_seed_satisfies_the_model_facing_case_contract() {
        for scenario in [
            "\"demo_sequence\":1,\"summary\":\"ATA 33 left wingtip strobe light replacement\"",
            "\"demo_sequence\":2,\"summary\":\"ATA 32 right main wheel tire and brake replacement\"",
            "\"demo_sequence\":3,\"summary\":\"ATA 56 left windshield damage-limit review\"",
        ] {
            assert!(DEMO_SEED_SQL.contains(scenario));
        }
        assert!(DEMO_SEED_SQL.contains("\"remote_witness_ready\":true"));
        assert!(DEMO_SEED_SQL.contains("MXG-DEMO-33-5101"));
        assert!(DEMO_SEED_SQL.contains("\"presentation_hidden\":true"));
        assert!(DEMO_SEED_SQL.contains("name=EXCLUDED.name"));
        assert!(DEMO_SEED_SQL.contains("aircraft_id=EXCLUDED.aircraft_id"));
        assert!(!DEMO_SEED_SQL.contains("demo_org, 'MXG-DEMO-N350MX',\n        'awaiting_parts'"));
    }

    #[test]
    fn record_ids_are_stable_and_unique_per_tenant() {
        let left_org = Uuid::from_u128(1);
        let right_org = Uuid::from_u128(2);
        let left = tenant_seed_sql(left_org);
        let left_again = tenant_seed_sql(left_org);
        let right = tenant_seed_sql(right_org);
        assert_eq!(left, left_again);
        assert_ne!(left, right);
        assert!(left.contains("d0000000-0000-4000-8000-000000000601"));
        assert!(!left.contains("d0000000-0000-4000-8000-000000000101"));
        assert!(!right.contains("d0000000-0000-4000-8000-000000000101"));
        assert!(left.contains("d1000000-0000-4000-8000-000000000001"));
        assert!(!left.contains("d2000000-0000-4000-8000-000000000001"));
        assert!(!right.contains("d2000000-0000-4000-8000-000000000001"));
        let expanded_stock_fixture = b"d2000000-0000-4000-8000-000000000001";
        let left_stock_id = Uuid::new_v5(&left_org, expanded_stock_fixture).to_string();
        let right_stock_id = Uuid::new_v5(&right_org, expanded_stock_fixture).to_string();
        assert_ne!(left_stock_id, right_stock_id);
        assert!(left.contains(&left_stock_id));
        assert!(right.contains(&right_stock_id));
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
