//! Lightweight policy check wrapper. Delegates to the shared `PolicyMatrix`
//! and reports back a `PolicyDecision`.

use mxgenius_shared::application::policy::{Action, PolicyDecision, PolicyMatrix, Role};

pub fn check(role: Role, action: Action) -> PolicyDecision {
    PolicyMatrix::is_authorized(role, action)
}
