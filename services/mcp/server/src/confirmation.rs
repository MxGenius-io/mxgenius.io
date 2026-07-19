//! Short-lived, single-use confirmation-grant issuance for authenticated
//! application surfaces. Model output and browser arguments never become
//! trusted confirmation without this server-side record and signature.

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Serialize;
use sqlx::PgPool;
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use mxgenius_shared::application::context::ExecutionContext;

#[derive(Debug, Error)]
pub enum ConfirmationIssueError {
    #[error("confirmation signing secret must be at least 32 bytes")]
    InvalidSecret,
    #[error("confirmation token signing failed")]
    Signing,
    #[error("confirmation grant persistence failed")]
    Persistence,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssuedConfirmationGrant {
    pub token: String,
    pub grant_id: Uuid,
    pub tool_name: String,
    pub object_id: String,
    pub object_version: Option<i64>,
    pub qualified_approval: bool,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
struct ConfirmationGrantClaims<'a> {
    jti: String,
    sub: String,
    organization_id: String,
    tool_name: &'a str,
    object_id: &'a str,
    object_version: Option<i64>,
    qualified_approval: bool,
    iss: &'a str,
    aud: &'a str,
    iat: i64,
    exp: i64,
}

pub struct PostgresConfirmationGrantIssuer {
    pool: PgPool,
    encoding_key: EncodingKey,
    issuer: String,
    audience: String,
}

impl PostgresConfirmationGrantIssuer {
    pub fn new(
        pool: PgPool,
        secret: &[u8],
        issuer: impl Into<String>,
        audience: impl Into<String>,
    ) -> Result<Self, ConfirmationIssueError> {
        if secret.len() < 32 {
            return Err(ConfirmationIssueError::InvalidSecret);
        }
        Ok(Self {
            pool,
            encoding_key: EncodingKey::from_secret(secret),
            issuer: issuer.into(),
            audience: audience.into(),
        })
    }

    pub async fn issue(
        &self,
        context: &ExecutionContext,
        tool_name: &str,
        object_id: &str,
        object_version: Option<i64>,
        qualified_approval: bool,
    ) -> Result<IssuedConfirmationGrant, ConfirmationIssueError> {
        let grant_id = Uuid::new_v4();
        let issued_at = OffsetDateTime::now_utc();
        let expires_at = issued_at + Duration::minutes(2);
        let claims = ConfirmationGrantClaims {
            jti: grant_id.to_string(),
            sub: context.user_id.to_string(),
            organization_id: context.organization_id.to_string(),
            tool_name,
            object_id,
            object_version,
            qualified_approval,
            iss: &self.issuer,
            aud: &self.audience,
            iat: issued_at.unix_timestamp(),
            exp: expires_at.unix_timestamp(),
        };
        let token = encode(&Header::new(Algorithm::HS256), &claims, &self.encoding_key)
            .map_err(|_| ConfirmationIssueError::Signing)?;
        sqlx::query(
            r#"INSERT INTO confirmation_grants
               (id, organization_id, user_id, tool_name, object_id, object_version,
                qualified_approval, issued_at, expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"#,
        )
        .bind(grant_id)
        .bind(context.organization_id.0)
        .bind(context.user_id.0)
        .bind(tool_name)
        .bind(object_id)
        .bind(object_version)
        .bind(qualified_approval)
        .bind(issued_at)
        .bind(expires_at)
        .execute(&self.pool)
        .await
        .map_err(|_| ConfirmationIssueError::Persistence)?;
        Ok(IssuedConfirmationGrant {
            token,
            grant_id,
            tool_name: tool_name.into(),
            object_id: object_id.into(),
            object_version,
            qualified_approval,
            expires_at,
        })
    }
}
