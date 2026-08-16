//! Server-side external-provider authentication.
//!
//! Browser login is terminated by a future connection broker; adapters only
//! consume its short-lived bearer file. Vendor secrets never enter tool input.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::{Client, Method, RequestBuilder, Url};
use serde::Deserialize;
use tokio::sync::RwLock;

use mxgenius_shared::adapters::source::{AdapterError, AdapterResult};

#[derive(Clone)]
pub enum ProviderAuth {
    Anonymous,
    ApiKey {
        header: reqwest::header::HeaderName,
        value: String,
    },
    Bearer {
        token: String,
    },
    /// A server-side broker may atomically refresh this file after browser OAuth.
    BearerFile {
        path: PathBuf,
    },
    OAuthPassword(Arc<OAuthPasswordGrant>),
}

impl fmt::Debug for ProviderAuth {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProviderAuth")
            .field("mode", &self.mode())
            .finish_non_exhaustive()
    }
}

impl ProviderAuth {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::Anonymous => "anonymous",
            Self::ApiKey { .. } => "api_key",
            Self::Bearer { .. } => "bearer",
            Self::BearerFile { .. } => "browser_broker",
            Self::OAuthPassword(_) => "oauth_password",
        }
    }

    pub async fn request(
        &self,
        client: &Client,
        method: Method,
        url: Url,
    ) -> AdapterResult<RequestBuilder> {
        let request = client.request(method, url);
        match self {
            Self::Anonymous => Ok(request),
            Self::ApiKey { header, value } => Ok(request.header(header, value)),
            Self::Bearer { token } => Ok(request.bearer_auth(token)),
            Self::BearerFile { path } => {
                let token = tokio::fs::read_to_string(path).await.map_err(|error| {
                    AdapterError::NotConfigured {
                        reason: format!("provider connection token is unavailable: {error}"),
                    }
                })?;
                let token = token.trim();
                if token.is_empty() {
                    return Err(AdapterError::NotConfigured {
                        reason: "provider connection token is empty".into(),
                    });
                }
                Ok(request.bearer_auth(token))
            }
            Self::OAuthPassword(grant) => {
                Ok(request.bearer_auth(grant.access_token(client).await?))
            }
        }
    }
}

#[derive(Clone)]
struct CachedToken {
    value: String,
    refresh_at: Instant,
}

pub struct OAuthPasswordGrant {
    token_url: Url,
    client_id: String,
    client_secret: String,
    username: String,
    password: String,
    scope: String,
    cached: RwLock<Option<CachedToken>>,
}

impl fmt::Debug for OAuthPasswordGrant {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OAuthPasswordGrant")
            .field("token_url", &self.token_url)
            .field("scope", &self.scope)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default = "default_token_lifetime")]
    expires_in: u64,
}

fn default_token_lifetime() -> u64 {
    300
}

impl OAuthPasswordGrant {
    pub fn new(
        token_url: Url,
        client_id: String,
        client_secret: String,
        username: String,
        password: String,
        scope: String,
    ) -> Self {
        Self {
            token_url,
            client_id,
            client_secret,
            username,
            password,
            scope,
            cached: RwLock::new(None),
        }
    }

    async fn access_token(&self, client: &Client) -> AdapterResult<String> {
        if let Some(token) = self
            .cached
            .read()
            .await
            .as_ref()
            .filter(|token| token.refresh_at > Instant::now())
        {
            return Ok(token.value.clone());
        }
        let response = client
            .post(self.token_url.clone())
            .form(&[
                ("grant_type", "password"),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("scope", self.scope.as_str()),
                ("username", self.username.as_str()),
                ("password", self.password.as_str()),
            ])
            .send()
            .await
            .map_err(map_request_error)?;
        if !response.status().is_success() {
            return Err(AdapterError::NotLicensed(format!(
                "provider token endpoint returned HTTP {}",
                response.status()
            )));
        }
        let token: TokenResponse = response.json().await.map_err(|error| {
            AdapterError::Internal(format!("invalid provider token response: {error}"))
        })?;
        if token.access_token.trim().is_empty() {
            return Err(AdapterError::NotLicensed(
                "provider token response omitted access_token".into(),
            ));
        }
        let lifetime = token.expires_in.saturating_sub(60).max(1);
        *self.cached.write().await = Some(CachedToken {
            value: token.access_token.clone(),
            refresh_at: Instant::now() + Duration::from_secs(lifetime),
        });
        Ok(token.access_token)
    }
}

pub fn map_request_error(error: reqwest::Error) -> AdapterError {
    if error.is_timeout() {
        AdapterError::Timeout(error.to_string())
    } else {
        AdapterError::Unavailable(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderAuth;

    #[test]
    fn debug_output_never_contains_static_secrets() {
        let auth = ProviderAuth::Bearer {
            token: "do-not-print".into(),
        };
        let output = format!("{auth:?}");
        assert!(output.contains("bearer"));
        assert!(!output.contains("do-not-print"));
    }

    #[tokio::test]
    async fn broker_file_is_read_at_request_time() {
        let path =
            std::env::temp_dir().join(format!("mxg-provider-token-{}", uuid::Uuid::new_v4()));
        tokio::fs::write(&path, "first-token\n").await.unwrap();
        let auth = ProviderAuth::BearerFile { path: path.clone() };
        let client = reqwest::Client::new();
        let request = auth
            .request(
                &client,
                reqwest::Method::GET,
                "https://example.invalid/".parse().unwrap(),
            )
            .await
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(
            request.headers()[reqwest::header::AUTHORIZATION],
            "Bearer first-token"
        );

        tokio::fs::write(&path, "refreshed-token").await.unwrap();
        let refreshed = auth
            .request(
                &client,
                reqwest::Method::GET,
                "https://example.invalid/".parse().unwrap(),
            )
            .await
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(
            refreshed.headers()[reqwest::header::AUTHORIZATION],
            "Bearer refreshed-token"
        );
        let _ = tokio::fs::remove_file(path).await;
    }
}
