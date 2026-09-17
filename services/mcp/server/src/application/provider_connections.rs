//! Organization-scoped provider credentials.
//!
//! Provider secrets are encrypted before they reach Postgres and are never
//! returned to a browser-facing caller. The organization id and provider name
//! are authenticated encryption associated data, so ciphertext cannot be
//! copied between tenants or providers and still decrypt successfully.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine as _;
use serde::Serialize;
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

const PROVIDER: &str = "jetnet";

#[derive(Debug, thiserror::Error)]
pub enum ProviderConnectionError {
    #[error("provider credential encryption is not configured")]
    NotConfigured,
    #[error("provider connection was not found")]
    NotFound,
    #[error("provider credentials could not be decrypted")]
    Decryption,
    #[error(transparent)]
    Persistence(#[from] sqlx::Error),
}

#[derive(Clone)]
pub struct ProviderConnectionRepository {
    pool: sqlx::PgPool,
    cipher: Aes256Gcm,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionStatus {
    pub provider: String,
    pub identity_hint: String,
    pub status: String,
    pub tested_at: Option<OffsetDateTime>,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct JetNetCredentials {
    pub identity: String,
    pub credential: String,
}

#[derive(Debug, FromRow)]
struct EncryptedConnectionRow {
    identity_ciphertext: Vec<u8>,
    credential_ciphertext: Vec<u8>,
}

impl ProviderConnectionRepository {
    pub fn from_env(pool: sqlx::PgPool) -> Result<Self, ProviderConnectionError> {
        let encoded = std::env::var("MXGENIUS_PROVIDER_CREDENTIAL_KEY")
            .map_err(|_| ProviderConnectionError::NotConfigured)?;
        let key = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded.trim()))
            .map_err(|_| ProviderConnectionError::NotConfigured)?;
        let key: [u8; 32] = key
            .try_into()
            .map_err(|_| ProviderConnectionError::NotConfigured)?;
        Ok(Self {
            pool,
            cipher: Aes256Gcm::new((&key).into()),
        })
    }

    pub async fn status(
        &self,
        organization_id: Uuid,
    ) -> Result<Option<ProviderConnectionStatus>, ProviderConnectionError> {
        Ok(sqlx::query_as::<_, ProviderConnectionStatus>(
            r#"SELECT provider,identity_hint,status,tested_at,updated_at
               FROM organization_provider_connections
               WHERE organization_id=$1 AND provider=$2"#,
        )
        .bind(organization_id)
        .bind(PROVIDER)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn save_jetnet(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        identity: &str,
        credential: &str,
    ) -> Result<ProviderConnectionStatus, ProviderConnectionError> {
        let identity_ciphertext = self.encrypt(organization_id, "identity", identity.as_bytes())?;
        let credential_ciphertext =
            self.encrypt(organization_id, "credential", credential.as_bytes())?;
        let identity_hint = masked_identity(identity);
        Ok(sqlx::query_as::<_, ProviderConnectionStatus>(
            r#"INSERT INTO organization_provider_connections
               (organization_id,provider,identity_hint,identity_ciphertext,
                credential_ciphertext,status,tested_at,created_by,updated_by,created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,'connected',now(),$6,$6,now(),now())
               ON CONFLICT (organization_id,provider)
               DO UPDATE SET identity_hint=EXCLUDED.identity_hint,
                             identity_ciphertext=EXCLUDED.identity_ciphertext,
                             credential_ciphertext=EXCLUDED.credential_ciphertext,
                             status='connected',tested_at=now(),updated_by=EXCLUDED.updated_by,
                             updated_at=now()
               RETURNING provider,identity_hint,status,tested_at,updated_at"#,
        )
        .bind(organization_id)
        .bind(PROVIDER)
        .bind(identity_hint)
        .bind(identity_ciphertext)
        .bind(credential_ciphertext)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn delete_jetnet(
        &self,
        organization_id: Uuid,
    ) -> Result<bool, ProviderConnectionError> {
        Ok(sqlx::query(
            "DELETE FROM organization_provider_connections WHERE organization_id=$1 AND provider=$2",
        )
        .bind(organization_id)
        .bind(PROVIDER)
        .execute(&self.pool)
        .await?
        .rows_affected()
            > 0)
    }

    pub async fn jetnet_credentials(
        &self,
        organization_id: Uuid,
    ) -> Result<JetNetCredentials, ProviderConnectionError> {
        let row = sqlx::query_as::<_, EncryptedConnectionRow>(
            r#"SELECT identity_ciphertext,credential_ciphertext
               FROM organization_provider_connections
               WHERE organization_id=$1 AND provider=$2 AND status='connected'"#,
        )
        .bind(organization_id)
        .bind(PROVIDER)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ProviderConnectionError::NotFound)?;
        let identity = String::from_utf8(self.decrypt(
            organization_id,
            "identity",
            &row.identity_ciphertext,
        )?)
        .map_err(|_| ProviderConnectionError::Decryption)?;
        let credential = String::from_utf8(self.decrypt(
            organization_id,
            "credential",
            &row.credential_ciphertext,
        )?)
        .map_err(|_| ProviderConnectionError::Decryption)?;
        Ok(JetNetCredentials {
            identity,
            credential,
        })
    }

    fn aad(organization_id: Uuid, field: &str) -> String {
        format!("mxgenius:{organization_id}:{PROVIDER}:{field}")
    }

    fn encrypt(
        &self,
        organization_id: Uuid,
        field: &str,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, ProviderConnectionError> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let aad = Self::aad(organization_id, field);
        let encrypted = self
            .cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| ProviderConnectionError::Decryption)?;
        let mut output = nonce.to_vec();
        output.extend(encrypted);
        Ok(output)
    }

    fn decrypt(
        &self,
        organization_id: Uuid,
        field: &str,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, ProviderConnectionError> {
        if ciphertext.len() <= 12 {
            return Err(ProviderConnectionError::Decryption);
        }
        let (nonce, encrypted) = ciphertext.split_at(12);
        let aad = Self::aad(organization_id, field);
        self.cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: encrypted,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| ProviderConnectionError::Decryption)
    }
}

pub fn masked_identity(identity: &str) -> String {
    let identity = identity.trim();
    let Some((local, domain)) = identity.split_once('@') else {
        return "Configured account".into();
    };
    let initial = local.chars().next().unwrap_or('*');
    format!("{initial}***@{domain}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository() -> ProviderConnectionRepository {
        ProviderConnectionRepository {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost/test").expect("lazy pool"),
            cipher: Aes256Gcm::new((&[7u8; 32]).into()),
        }
    }

    #[tokio::test]
    async fn credential_ciphertext_is_tenant_and_field_bound() {
        let repository = repository();
        let organization = Uuid::new_v4();
        let encrypted = repository
            .encrypt(organization, "credential", b"not-for-the-browser")
            .expect("encrypt");
        assert!(!encrypted
            .windows(19)
            .any(|value| value == b"not-for-the-browser"));
        assert_eq!(
            repository
                .decrypt(organization, "credential", &encrypted)
                .expect("decrypt"),
            b"not-for-the-browser"
        );
        assert!(repository
            .decrypt(Uuid::new_v4(), "credential", &encrypted)
            .is_err());
        assert!(repository
            .decrypt(organization, "identity", &encrypted)
            .is_err());
    }

    #[test]
    fn identity_hint_never_returns_the_full_identity() {
        assert_eq!(masked_identity("pilot@example.com"), "p***@example.com");
        assert_eq!(masked_identity("opaque-token"), "Configured account");
    }
}
