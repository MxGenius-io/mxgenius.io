use mxgenius_mcp::application::equipment_packs::{
    validate_manifest, validate_pack_path, validate_sha256,
};
use serde_json::json;

const MIGRATION: &str = include_str!("../../migrations/0027_equipment_packs.sql");
const HTTP: &str = include_str!("../src/transport/http.rs");

#[test]
fn migration_keeps_every_edge_record_tenant_scoped() {
    for table in [
        "equipment_packs",
        "equipment_pack_versions",
        "equipment_pack_upload_blocks",
        "edge_devices",
        "edge_device_enrollment_codes",
        "edge_device_assignments",
        "edge_device_deployments",
    ] {
        let marker = format!("CREATE TABLE IF NOT EXISTS {table}");
        assert!(MIGRATION.contains(&marker), "missing table {table}");
    }
    assert!(MIGRATION.matches("organization_id   uuid NOT NULL").count() >= 7);
    assert!(MIGRATION.matches("FOREIGN KEY (organization_id").count() >= 7);
    assert!(MIGRATION.contains("UNIQUE (organization_id, pack_id, version_number)"));
    assert!(MIGRATION.contains("UNIQUE (device_id, generation, state)"));
}

#[test]
fn device_credentials_are_revocable_and_enrollment_is_one_time() {
    assert!(MIGRATION.contains("status = 'revoked' AND credential_hash IS NULL"));
    assert!(MIGRATION.contains("UNIQUE (code_hash)"));
    assert!(MIGRATION.contains("consumed_at"));
    assert!(HTTP.contains("axum::routing::delete(revoke_edge_device)"));
    assert!(HTTP.contains("MXGENIUS_EQUIPMENT_PACKS_ENABLED"));
    assert!(HTTP.contains(".unwrap_or(false)"));
}

#[test]
fn package_contract_rejects_unsafe_or_ambiguous_paths() {
    for path in [
        "../manual.pdf",
        "/absolute/manual.pdf",
        "manuals\\ata-21.pdf",
        "CON/readme.txt",
        "folder./readme.txt",
    ] {
        assert!(
            validate_pack_path(path).is_err(),
            "accepted unsafe path {path}"
        );
    }
    assert!(validate_pack_path("manuals/ATA-21/inspection.pdf").is_ok());
    assert!(validate_sha256(&format!("sha256:{}", "a".repeat(64))).is_ok());
    assert!(validate_sha256(&format!("sha256:{}", "A".repeat(64))).is_err());
}

#[test]
fn manifest_is_strict_versioned_and_case_collision_safe() {
    let manifest = json!({
        "schemaVersion": 1,
        "files": [
            {
                "path": "manuals/checklist.pdf",
                "sizeBytes": 42,
                "sha256": format!("sha256:{}", "1".repeat(64))
            },
            {
                "path": "MANUALS/CHECKLIST.PDF",
                "sizeBytes": 42,
                "sha256": format!("sha256:{}", "2".repeat(64))
            }
        ]
    });
    assert!(validate_manifest(&manifest, 2).is_err());
    assert!(validate_manifest(&manifest, 1).is_err());
}
