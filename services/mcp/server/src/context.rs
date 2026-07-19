//! Authentication boundary. Production validates an OIDC bearer token against
//! discovery metadata/JWKS, then resolves the actor's tenant membership and
//! role from application state. Tool arguments never select trusted context.

use std::sync::Arc;

use async_trait::async_trait;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use parking_lot::RwLock;
use serde::Deserialize;
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use mxgenius_shared::application::context::{
    ClientIdentity, ExecutionContext, TrustedConfirmation,
};
use mxgenius_shared::application::policy::Role;
use mxgenius_shared::domain::ids::{CorrelationId, OrganizationId, RequestId, UserId};

#[derive(Debug, Clone, Default)]
pub struct AuthRequest {
    pub authorization: Option<String>,
    pub selected_organization_id: Option<OrganizationId>,
    pub confirmation_grant: Option<String>,
    pub correlation_id: Option<CorrelationId>,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("auth required")]
    Required,
    #[error("invalid token: {0}")]
    InvalidToken(String),
    #[error("tenant mismatch")]
    TenantMismatch,
    #[error("internal auth error: {0}")]
    Internal(String),
}

#[derive(Debug, Clone)]
pub struct TrustedContextInputs {
    pub organization_id: OrganizationId,
    pub user_id: UserId,
    pub role: Role,
    pub client: ClientIdentity,
    pub human_confirmed: bool,
    pub approval_granted: bool,
    pub confirmation: Option<TrustedConfirmation>,
}

impl TrustedContextInputs {
    pub fn to_execution_context(&self, request: &AuthRequest) -> ExecutionContext {
        ExecutionContext {
            request_id: RequestId(Uuid::new_v4()),
            organization_id: self.organization_id,
            user_id: self.user_id,
            role: self.role,
            human_confirmed: self.human_confirmed,
            approval_granted: self.approval_granted,
            confirmation: self.confirmation.clone(),
            case_id: None,
            correlation_id: request
                .correlation_id
                .unwrap_or_else(|| CorrelationId(Uuid::new_v4())),
            client: self.client.clone(),
            issued_at: time::OffsetDateTime::now_utc(),
        }
    }
}

#[async_trait]
pub trait ExecutionContextProvider: Send + Sync {
    async fn provide(&self, request: &AuthRequest) -> Result<ExecutionContext, AuthError>;
}

pub type ContextProvider = Arc<dyn ExecutionContextProvider>;

pub struct InsecureLocalProvider {
    inner: TrustedContextInputs,
}

impl InsecureLocalProvider {
    pub fn new(role: Role) -> Self {
        Self::with_trusted_state(role, true, true)
    }

    pub fn with_trusted_state(role: Role, human_confirmed: bool, approval_granted: bool) -> Self {
        Self {
            inner: TrustedContextInputs {
                organization_id: OrganizationId(Uuid::nil()),
                user_id: UserId(Uuid::nil()),
                role,
                client: ClientIdentity {
                    name: "mxgenius-mcp:insecure-local".into(),
                    version: mxgenius_shared::PACKAGE_VERSION.to_string(),
                },
                human_confirmed,
                approval_granted,
                confirmation: None,
            },
        }
    }

    pub fn with_trusted_confirmation(role: Role, confirmation: TrustedConfirmation) -> Self {
        let approval_granted = confirmation.qualified_approval
            && matches!(role, Role::Quality | Role::Manager | Role::Administrator);
        let mut provider = Self::with_trusted_state(role, false, approval_granted);
        provider.inner.confirmation = Some(confirmation);
        provider
    }
}

#[async_trait]
impl ExecutionContextProvider for InsecureLocalProvider {
    async fn provide(&self, request: &AuthRequest) -> Result<ExecutionContext, AuthError> {
        Ok(self.inner.to_execution_context(request))
    }
}

#[derive(Debug, Clone)]
pub struct VerifiedIdentity {
    pub issuer: String,
    pub subject: String,
    pub identity_tenant_id: Option<String>,
}

#[async_trait]
pub trait TokenVerifier: Send + Sync {
    async fn verify(&self, bearer_token: &str) -> Result<VerifiedIdentity, AuthError>;
}

#[derive(Debug, Clone)]
pub struct ResolvedMembership {
    pub organization_id: OrganizationId,
    pub user_id: UserId,
    pub role: Role,
}

#[async_trait]
pub trait MembershipResolver: Send + Sync {
    async fn resolve(
        &self,
        identity: &VerifiedIdentity,
        selected_organization_id: Option<OrganizationId>,
    ) -> Result<ResolvedMembership, AuthError>;
}

#[async_trait]
pub trait ConfirmationGrantVerifier: Send + Sync {
    async fn verify_and_consume(
        &self,
        token: &str,
        membership: &ResolvedMembership,
    ) -> Result<TrustedConfirmation, AuthError>;
}

#[derive(Debug, Deserialize)]
struct OidcDiscovery {
    issuer: String,
    jwks_uri: String,
}

#[derive(Debug, Deserialize)]
struct OidcClaims {
    iss: String,
    sub: String,
    oid: Option<String>,
    tid: Option<String>,
}

pub struct JwksTokenVerifier {
    issuer: String,
    audience: String,
    jwks_uri: String,
    keys: RwLock<JwkSet>,
    client: reqwest::Client,
}

impl JwksTokenVerifier {
    pub async fn from_discovery(
        discovery_url: &str,
        audience: impl Into<String>,
    ) -> Result<Self, AuthError> {
        let client = reqwest::Client::builder()
            .https_only(true)
            .build()
            .map_err(|e| AuthError::Internal(format!("OIDC client setup failed: {e}")))?;
        let discovery: OidcDiscovery = client
            .get(discovery_url)
            .send()
            .await
            .map_err(|e| AuthError::Internal(format!("OIDC discovery failed: {e}")))?
            .error_for_status()
            .map_err(|e| AuthError::Internal(format!("OIDC discovery rejected: {e}")))?
            .json()
            .await
            .map_err(|e| AuthError::Internal(format!("invalid OIDC discovery document: {e}")))?;
        let keys = fetch_jwks(&client, &discovery.jwks_uri).await?;
        Ok(Self {
            issuer: discovery.issuer,
            audience: audience.into(),
            jwks_uri: discovery.jwks_uri,
            keys: RwLock::new(keys),
            client,
        })
    }

    async fn refresh_keys(&self) -> Result<(), AuthError> {
        let keys = fetch_jwks(&self.client, &self.jwks_uri).await?;
        *self.keys.write() = keys;
        Ok(())
    }

    fn decode_with_cached_key(
        &self,
        token: &str,
        kid: &str,
    ) -> Result<VerifiedIdentity, AuthError> {
        let keys = self.keys.read();
        let jwk = keys
            .find(kid)
            .ok_or_else(|| AuthError::InvalidToken("signing key not found".into()))?;
        let key = DecodingKey::from_jwk(jwk)
            .map_err(|e| AuthError::InvalidToken(format!("unsupported signing key: {e}")))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.algorithms = vec![Algorithm::RS256];
        validation.set_audience(&[self.audience.as_str()]);
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_nbf = true;
        let claims = decode::<OidcClaims>(token, &key, &validation)
            .map_err(|e| AuthError::InvalidToken(format!("token validation failed: {e}")))?
            .claims;
        Ok(VerifiedIdentity {
            issuer: claims.iss,
            subject: claims.oid.unwrap_or(claims.sub),
            identity_tenant_id: claims.tid,
        })
    }
}

#[async_trait]
impl TokenVerifier for JwksTokenVerifier {
    async fn verify(&self, bearer_token: &str) -> Result<VerifiedIdentity, AuthError> {
        let header = decode_header(bearer_token)
            .map_err(|e| AuthError::InvalidToken(format!("invalid JWT header: {e}")))?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthError::InvalidToken(
                "only RS256 access tokens are accepted".into(),
            ));
        }
        let kid = header
            .kid
            .ok_or_else(|| AuthError::InvalidToken("missing signing key id".into()))?;
        match self.decode_with_cached_key(bearer_token, &kid) {
            Ok(identity) => Ok(identity),
            Err(AuthError::InvalidToken(message)) if message == "signing key not found" => {
                self.refresh_keys().await?;
                self.decode_with_cached_key(bearer_token, &kid)
            }
            Err(error) => Err(error),
        }
    }
}

async fn fetch_jwks(client: &reqwest::Client, uri: &str) -> Result<JwkSet, AuthError> {
    client
        .get(uri)
        .send()
        .await
        .map_err(|e| AuthError::Internal(format!("JWKS retrieval failed: {e}")))?
        .error_for_status()
        .map_err(|e| AuthError::Internal(format!("JWKS endpoint rejected request: {e}")))?
        .json()
        .await
        .map_err(|e| AuthError::Internal(format!("invalid JWKS document: {e}")))
}

pub struct PostgresMembershipResolver {
    pool: PgPool,
}

#[derive(Debug, Deserialize)]
struct ConfirmationGrantClaims {
    jti: String,
    sub: String,
    organization_id: String,
    tool_name: String,
    object_id: String,
    object_version: Option<i64>,
    qualified_approval: bool,
}

pub struct PostgresConfirmationGrantVerifier {
    pool: PgPool,
    decoding_key: DecodingKey,
    issuer: String,
    audience: String,
}

impl PostgresConfirmationGrantVerifier {
    pub fn new(
        pool: PgPool,
        secret: &[u8],
        issuer: impl Into<String>,
        audience: impl Into<String>,
    ) -> Result<Self, AuthError> {
        if secret.len() < 32 {
            return Err(AuthError::Internal(
                "confirmation signing secret must be at least 32 bytes".into(),
            ));
        }
        Ok(Self {
            pool,
            decoding_key: DecodingKey::from_secret(secret),
            issuer: issuer.into(),
            audience: audience.into(),
        })
    }
}

#[async_trait]
impl ConfirmationGrantVerifier for PostgresConfirmationGrantVerifier {
    async fn verify_and_consume(
        &self,
        token: &str,
        membership: &ResolvedMembership,
    ) -> Result<TrustedConfirmation, AuthError> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.algorithms = vec![Algorithm::HS256];
        validation.set_audience(&[self.audience.as_str()]);
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<ConfirmationGrantClaims>(token, &self.decoding_key, &validation)
            .map_err(|e| AuthError::InvalidToken(format!("invalid confirmation grant: {e}")))?
            .claims;
        let grant_id = Uuid::parse_str(&claims.jti)
            .map_err(|_| AuthError::InvalidToken("invalid confirmation grant id".into()))?;
        let subject = Uuid::parse_str(&claims.sub)
            .map_err(|_| AuthError::InvalidToken("invalid confirmation actor".into()))?;
        let organization_id = Uuid::parse_str(&claims.organization_id)
            .map_err(|_| AuthError::InvalidToken("invalid confirmation tenant".into()))?;
        if subject != membership.user_id.0 || organization_id != membership.organization_id.0 {
            return Err(AuthError::TenantMismatch);
        }

        let row: Option<(String, String, Option<i64>, time::OffsetDateTime, bool)> =
            sqlx::query_as(
                r#"UPDATE confirmation_grants
               SET consumed_at = now()
               WHERE id = $1 AND user_id = $2 AND organization_id = $3
                 AND consumed_at IS NULL AND expires_at > now()
               RETURNING tool_name, object_id, object_version, expires_at, qualified_approval"#,
            )
            .bind(grant_id)
            .bind(subject)
            .bind(organization_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| AuthError::Internal(format!("confirmation grant lookup failed: {e}")))?;
        let Some((tool_name, object_id, object_version, expires_at, qualified_approval)) = row
        else {
            return Err(AuthError::InvalidToken(
                "confirmation grant is expired, consumed, or unknown".into(),
            ));
        };
        if tool_name != claims.tool_name
            || object_id != claims.object_id
            || object_version != claims.object_version
            || qualified_approval != claims.qualified_approval
        {
            return Err(AuthError::InvalidToken(
                "confirmation grant claims do not match the server record".into(),
            ));
        }
        Ok(TrustedConfirmation {
            grant_id,
            tool_name,
            object_id,
            object_version,
            expires_at,
            qualified_approval,
        })
    }
}

impl PostgresMembershipResolver {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MembershipResolver for PostgresMembershipResolver {
    async fn resolve(
        &self,
        identity: &VerifiedIdentity,
        selected_organization_id: Option<OrganizationId>,
    ) -> Result<ResolvedMembership, AuthError> {
        let rows: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
            r#"SELECT u.id, m.organization_id, m.role
               FROM users u
               JOIN organization_memberships m ON m.user_id = u.id
               WHERE u.external_issuer = $1 AND u.external_subject = $2
                 AND ($3::uuid IS NULL OR m.organization_id = $3)"#,
        )
        .bind(&identity.issuer)
        .bind(&identity.subject)
        .bind(selected_organization_id.map(|id| id.0))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AuthError::Internal(format!("membership lookup failed: {e}")))?;
        if rows.len() != 1 {
            return Err(AuthError::TenantMismatch);
        }
        let (user_id, organization_id, role) = &rows[0];
        Ok(ResolvedMembership {
            organization_id: OrganizationId(*organization_id),
            user_id: UserId(*user_id),
            role: parse_role(role)?,
        })
    }
}

fn parse_role(value: &str) -> Result<Role, AuthError> {
    match value {
        "viewer" => Ok(Role::Viewer),
        "technician" => Ok(Role::Technician),
        "planner" => Ok(Role::Planner),
        "controller" => Ok(Role::Controller),
        "procurement" => Ok(Role::Procurement),
        "quality" => Ok(Role::Quality),
        "manager" => Ok(Role::Manager),
        "administrator" => Ok(Role::Administrator),
        _ => Err(AuthError::Internal("membership has an unknown role".into())),
    }
}

pub struct OidcProvider {
    verifier: Arc<dyn TokenVerifier>,
    memberships: Arc<dyn MembershipResolver>,
    confirmations: Option<Arc<dyn ConfirmationGrantVerifier>>,
}

impl OidcProvider {
    pub fn new(verifier: Arc<dyn TokenVerifier>, memberships: Arc<dyn MembershipResolver>) -> Self {
        Self {
            verifier,
            memberships,
            confirmations: None,
        }
    }

    pub fn with_confirmation_verifier(
        mut self,
        verifier: Arc<dyn ConfirmationGrantVerifier>,
    ) -> Self {
        self.confirmations = Some(verifier);
        self
    }

    /// Fail-closed instance for transport tests and incomplete configuration.
    pub fn unconfigured() -> Self {
        Self::new(Arc::new(RejectingVerifier), Arc::new(RejectingMemberships))
    }
}

struct RejectingVerifier;

#[async_trait]
impl TokenVerifier for RejectingVerifier {
    async fn verify(&self, _bearer_token: &str) -> Result<VerifiedIdentity, AuthError> {
        Err(AuthError::Required)
    }
}

struct RejectingMemberships;

#[async_trait]
impl MembershipResolver for RejectingMemberships {
    async fn resolve(
        &self,
        _identity: &VerifiedIdentity,
        _selected_organization_id: Option<OrganizationId>,
    ) -> Result<ResolvedMembership, AuthError> {
        Err(AuthError::Required)
    }
}

#[async_trait]
impl ExecutionContextProvider for OidcProvider {
    async fn provide(&self, request: &AuthRequest) -> Result<ExecutionContext, AuthError> {
        let header = request
            .authorization
            .as_deref()
            .ok_or(AuthError::Required)?;
        let token = header
            .strip_prefix("Bearer ")
            .or_else(|| header.strip_prefix("bearer "))
            .ok_or_else(|| AuthError::InvalidToken("authorization scheme must be Bearer".into()))?;
        let identity = self.verifier.verify(token).await?;
        let membership = self
            .memberships
            .resolve(&identity, request.selected_organization_id)
            .await?;
        let confirmation = match request.confirmation_grant.as_deref() {
            Some(token) => Some(
                self.confirmations
                    .as_ref()
                    .ok_or_else(|| {
                        AuthError::InvalidToken("confirmation grants are not configured".into())
                    })?
                    .verify_and_consume(token, &membership)
                    .await?,
            ),
            None => None,
        };
        let approval_granted = confirmation.as_ref().is_some_and(|grant| {
            grant.qualified_approval
                && matches!(
                    membership.role,
                    Role::Quality | Role::Manager | Role::Administrator
                )
        });
        Ok(TrustedContextInputs {
            organization_id: membership.organization_id,
            user_id: membership.user_id,
            role: membership.role,
            client: ClientIdentity {
                name: "mxgenius-application".into(),
                version: mxgenius_shared::PACKAGE_VERSION.into(),
            },
            human_confirmed: false,
            approval_granted,
            confirmation,
        }
        .to_execution_context(request))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AcceptedToken;

    #[async_trait]
    impl TokenVerifier for AcceptedToken {
        async fn verify(&self, bearer_token: &str) -> Result<VerifiedIdentity, AuthError> {
            assert_eq!(bearer_token, "signed-access-token");
            Ok(VerifiedIdentity {
                issuer: "https://issuer.example/tenant/v2.0".into(),
                subject: "entra-object-id".into(),
                identity_tenant_id: Some("entra-tenant-id".into()),
            })
        }
    }

    struct OneMembership {
        organization_id: OrganizationId,
        user_id: UserId,
    }

    #[async_trait]
    impl MembershipResolver for OneMembership {
        async fn resolve(
            &self,
            identity: &VerifiedIdentity,
            selected_organization_id: Option<OrganizationId>,
        ) -> Result<ResolvedMembership, AuthError> {
            assert_eq!(identity.subject, "entra-object-id");
            if selected_organization_id != Some(self.organization_id) {
                return Err(AuthError::TenantMismatch);
            }
            Ok(ResolvedMembership {
                organization_id: self.organization_id,
                user_id: self.user_id,
                role: Role::Technician,
            })
        }
    }

    #[tokio::test]
    async fn oidc_identity_is_resolved_to_server_side_membership_and_role() {
        let organization_id = OrganizationId(Uuid::new_v4());
        let user_id = UserId(Uuid::new_v4());
        let provider = OidcProvider::new(
            Arc::new(AcceptedToken),
            Arc::new(OneMembership {
                organization_id,
                user_id,
            }),
        );
        let context = provider
            .provide(&AuthRequest {
                authorization: Some("Bearer signed-access-token".into()),
                selected_organization_id: Some(organization_id),
                correlation_id: Some(CorrelationId(Uuid::new_v4())),
                ..AuthRequest::default()
            })
            .await
            .expect("trusted context");
        assert_eq!(context.organization_id, organization_id);
        assert_eq!(context.user_id, user_id);
        assert_eq!(context.role, Role::Technician);
        assert!(!context.human_confirmed);
    }

    #[tokio::test]
    async fn oidc_provider_fails_closed_without_bearer_or_valid_membership_selection() {
        let organization_id = OrganizationId(Uuid::new_v4());
        let provider = OidcProvider::new(
            Arc::new(AcceptedToken),
            Arc::new(OneMembership {
                organization_id,
                user_id: UserId(Uuid::new_v4()),
            }),
        );
        assert!(matches!(
            provider.provide(&AuthRequest::default()).await,
            Err(AuthError::Required)
        ));
        assert!(matches!(
            provider
                .provide(&AuthRequest {
                    authorization: Some("Bearer signed-access-token".into()),
                    selected_organization_id: Some(OrganizationId(Uuid::new_v4())),
                    ..AuthRequest::default()
                })
                .await,
            Err(AuthError::TenantMismatch)
        ));
    }
}
