//! Trusted execution context. Identity is injected by the server boundary; tool
//! arguments must never override these fields.

use serde::{Deserialize, Serialize};

use time::OffsetDateTime;
use uuid::Uuid;

use super::policy::Role;
use crate::domain::ids::{CaseId, CorrelationId, OrganizationId, RequestId, UserId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientIdentity {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedConfirmation {
    pub grant_id: Uuid,
    pub tool_name: String,
    pub object_id: String,
    pub object_version: Option<i64>,
    pub expires_at: OffsetDateTime,
    pub qualified_approval: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionContext {
    pub request_id: RequestId,
    pub organization_id: OrganizationId,
    pub user_id: UserId,
    pub role: Role,
    /// Trusted confirmation derived by the server boundary. This value is
    /// never accepted from MCP tool arguments.
    pub human_confirmed: bool,
    /// Trusted qualified-approval state for actions with an approval
    /// precondition (for example, closing a maintenance case).
    pub approval_granted: bool,
    /// Signed, single-use grant verified and consumed at the server boundary.
    /// The typed-tool seam still checks its action/object/version binding.
    pub confirmation: Option<TrustedConfirmation>,
    /// Optional active case for case-bound tools.
    pub case_id: Option<CaseId>,
    pub correlation_id: CorrelationId,
    pub client: ClientIdentity,
    pub issued_at: OffsetDateTime,
}

impl ExecutionContext {
    /// Convenience constructor. `request_id` and `correlation_id` are minted
    /// here; in production they are typically propagated from the inbound
    /// transport headers.
    pub fn new(
        organization_id: OrganizationId,
        user_id: UserId,
        role: Role,
        client: ClientIdentity,
    ) -> Self {
        Self {
            request_id: RequestId(Uuid::new_v4()),
            organization_id,
            user_id,
            role,
            human_confirmed: false,
            approval_granted: false,
            confirmation: None,
            case_id: None,
            correlation_id: CorrelationId(Uuid::new_v4()),
            client,
            issued_at: OffsetDateTime::now_utc(),
        }
    }
}
