//! Transport-neutral application services used by the MCP tool handlers
//! (and mountable into the Axum REST/BFF).

pub mod aircraft_catalog;
pub mod cannibalizations;
pub mod case_service;
pub mod evidence_service;
pub mod part_imports;
pub mod part_procurement;
pub mod part_reporting;
pub mod part_traceability;
pub mod parts_inventory;
pub mod policy_enforce;
pub mod postgres_case_service;
pub mod receiving_inspection;
pub mod remote_witness;
pub mod rotables;
pub mod spatial_scan;
