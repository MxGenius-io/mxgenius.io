//! Policy enforcement helpers used by application services. Maps to
//! `mxgenius-shared::application::policy::PolicyMatrix`.

use mxgenius_shared::application::policy::{Action, PolicyDecision, PolicyMatrix, Role};

use crate::application::case_service::CaseError;

pub fn check_action(role: Role, action: Action) -> Result<(), CaseError> {
    match PolicyMatrix::is_authorized(role, action) {
        PolicyDecision::Allow => Ok(()),
        PolicyDecision::RequireHumanApproval => Ok(()),
        PolicyDecision::Deny => Err(CaseError::PolicyDenied {
            role: role.as_str().into(),
            action: format!("{action:?}"),
        }),
    }
}
