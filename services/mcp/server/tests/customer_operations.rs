const MIGRATION: &str = include_str!("../../migrations/0031_customer_operations.sql");
const APPLICATION: &str = include_str!("../src/application/customer_operations.rs");
const HTTP: &str = include_str!("../src/transport/http.rs");

#[test]
fn customer_accounts_and_payments_remain_tenant_scoped() {
    assert!(MIGRATION.contains("CREATE TABLE IF NOT EXISTS customer_accounts"));
    assert!(MIGRATION.contains("CREATE TABLE IF NOT EXISTS customer_payments"));
    assert!(MIGRATION.contains("UNIQUE (organization_id, id)"));
    assert!(MIGRATION.contains("FOREIGN KEY (organization_id, customer_id)"));
    assert!(MIGRATION.contains("REFERENCES customer_accounts(organization_id, id)"));
    assert!(!MIGRATION.to_ascii_lowercase().contains("card_number"));
    assert!(!MIGRATION.to_ascii_lowercase().contains("payment_token"));
}

#[test]
fn devices_can_be_grouped_under_one_customer_without_changing_device_identity() {
    assert!(MIGRATION.contains("ADD COLUMN IF NOT EXISTS customer_account_id uuid"));
    assert!(MIGRATION.contains("FOREIGN KEY (organization_id, customer_account_id)"));
    assert!(APPLICATION.contains("pub async fn assign_device"));
    assert!(APPLICATION.contains("WHERE organization_id=$2 AND id=$3"));
    assert!(HTTP.contains("/api/edge/devices/:device_id/customer"));
}

#[test]
fn customer_health_reuses_real_heartbeat_assignment_and_deployment_ledgers() {
    for source in [
        "edge_devices",
        "edge_device_assignments",
        "equipment_pack_versions",
        "edge_device_deployments",
        "latest.error_code",
    ] {
        assert!(APPLICATION.contains(source), "missing source {source}");
    }
    assert!(!MIGRATION.contains("customer_telemetry"));
}

#[test]
fn customer_operations_are_manager_or_administrator_only() {
    assert!(HTTP.contains("fn customer_operations_allowed"));
    let policy = HTTP
        .split("fn customer_operations_allowed")
        .nth(1)
        .and_then(|value| value.split("fn customer_operations_error").next())
        .expect("customer operations policy");
    assert!(policy.contains("Role::Manager"));
    assert!(policy.contains("Role::Administrator"));
    assert!(!policy.contains("Role::Viewer"));
}

#[test]
fn customer_rest_surface_covers_accounts_devices_payments_and_overview() {
    for route in [
        "/api/customer-accounts",
        "/api/customer-accounts/:customer_id",
        "/api/customer-accounts/:customer_id/payments",
        "/api/edge/devices/:device_id/customer",
    ] {
        assert!(HTTP.contains(route), "missing route {route}");
    }
    assert!(APPLICATION.contains("pub struct CustomerOverview"));
    assert!(APPLICATION.contains("pub devices: Vec<CustomerDeviceRow>"));
    assert!(APPLICATION.contains("pub payments: Vec<CustomerPaymentRow>"));
}
