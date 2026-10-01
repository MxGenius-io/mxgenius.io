//! Transport-neutral application services used by the MCP tool handlers
//! (and mountable into the Axum REST/BFF).

pub mod aircraft_catalog;
pub mod case_service;
pub mod corpus_release;
pub mod customer_operations;
pub mod environment_manifest;
pub mod equipment_packs;
pub mod evidence_service;
pub mod manual_library;
pub mod policy_enforce;
pub mod postgres_case_service;
pub mod provider_connections;
pub mod remote_witness;
pub mod spatial_scan;
