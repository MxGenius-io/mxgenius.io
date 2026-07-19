//! Strongly-typed IDs. Names are frozen by the contract lock.

use schemars::gen::SchemaGenerator;
use schemars::schema::{InstanceType, Schema, SchemaObject};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! typed_uuid {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            #[inline]
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                std::fmt::Display::fmt(&self.0, f)
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(Uuid::parse_str(s)?))
            }
        }

        impl JsonSchema for $name {
            fn schema_name() -> String {
                stringify!($name).into()
            }
            fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
                SchemaObject {
                    instance_type: Some(InstanceType::String.into()),
                    format: Some("uuid".into()),
                    ..Default::default()
                }
                .into()
            }
        }
    };
}

typed_uuid!(OrganizationId, "Tenant identifier.");
typed_uuid!(UserId, "User identifier.");
typed_uuid!(AircraftId, "Canonical aircraft identifier.");
typed_uuid!(
    AirportId,
    "Airport identifier (canonical, may be derived from ICAO/IATA)."
);
typed_uuid!(CaseId, "MaintenanceCase aggregate root identifier.");
typed_uuid!(DiscrepancyId, "Normalized discrepancy identifier.");
typed_uuid!(MaintenanceEventId, "MaintenanceEvent identifier.");
typed_uuid!(ObservationId, "Observation identifier.");
typed_uuid!(ComponentId, "Aircraft component identifier.");
typed_uuid!(DocumentId, "Technical document identifier.");
typed_uuid!(RevisionId, "Document revision identifier.");
typed_uuid!(AdvisoryId, "Regulatory advisory identifier (AD/SAIB/DRS).");
typed_uuid!(PartId, "Canonical part identifier.");
typed_uuid!(
    PartRequirementId,
    "PartRequirement identifier inside a case."
);
typed_uuid!(SupplierId, "Supplier identifier.");
typed_uuid!(CertificateId, "Certificate record identifier.");
typed_uuid!(FacilityId, "MRO facility identifier.");
typed_uuid!(FacilityCapabilityId, "MRO facility capability identifier.");
typed_uuid!(ScheduleOptionId, "Schedule option identifier.");
typed_uuid!(MarkerId, "Digital twin marker identifier.");
typed_uuid!(TwinModelId, "Digital twin model identifier.");
typed_uuid!(ModelId, "Generic model id for the digital twin catalog.");
typed_uuid!(RecommendationId, "Recommendation identifier.");
typed_uuid!(EvidenceId, "Evidence identifier.");
typed_uuid!(ApprovalId, "Approval identifier.");
typed_uuid!(AuditEventId, "AuditEvent identifier.");
typed_uuid!(RequestId, "Per-invocation request identifier.");
typed_uuid!(CorrelationId, "Cross-invocation correlation identifier.");
typed_uuid!(ContactId, "Contact identifier (linked to a Company).");
typed_uuid!(
    CompanyId,
    "Company identifier (may be an operator, owner, MRO, etc.)."
);
