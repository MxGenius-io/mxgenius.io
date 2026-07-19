//! Organization, User, and Role stubs.

use serde::{Deserialize, Serialize};

use time::OffsetDateTime;

use super::ids::{OrganizationId, UserId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization {
    pub id: OrganizationId,
    pub name: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: UserId,
    pub organization_id: OrganizationId,
    pub email: String,
    pub display_name: Option<String>,
    pub role: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationMembership {
    pub user_id: UserId,
    pub organization_id: OrganizationId,
    pub role: String,
    pub joined_at: OffsetDateTime,
}

/// Re-export here for backwards compatibility; the canonical role enum lives
/// in `application::policy::Role` and is what the policy engine enforces.
pub type Role = super::super::application::policy::Role;
