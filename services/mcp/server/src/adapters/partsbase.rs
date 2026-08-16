//! PartsBase client boundary. Live calls remain disabled until issued credentials exist.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use reqwest::{Client, Method, StatusCode, Url};
use serde_json::Value;

use mxgenius_shared::adapters::source::{AdapterError, AdapterResult};

use super::provider_auth::{OAuthPasswordGrant, ProviderAuth};

#[derive(Clone, Debug)]
pub struct PartsBaseHttpClient {
    client: Client,
    service_url: Url,
    auth: ProviderAuth,
}

impl PartsBaseHttpClient {
    pub fn from_env() -> anyhow::Result<Self> {
        let service_url = std::env::var("MXGENIUS_PARTSBASE_ENDPOINT")
            .unwrap_or_else(|_| "https://services.partsbase.com/".into())
            .parse::<Url>()?;
        let mode = std::env::var("MXGENIUS_PARTSBASE_AUTH_MODE")
            .unwrap_or_else(|_| "disabled".into())
            .to_ascii_lowercase();
        let auth = match mode.as_str() {
            "bearer" => ProviderAuth::Bearer {
                token: required_env("MXGENIUS_PARTSBASE_BEARER_TOKEN")?,
            },
            "browser" | "browser_broker" => ProviderAuth::BearerFile {
                path: PathBuf::from(required_env("MXGENIUS_PARTSBASE_BEARER_FILE")?),
            },
            "oauth_password" | "password" => {
                ProviderAuth::OAuthPassword(Arc::new(OAuthPasswordGrant::new(
                    std::env::var("MXGENIUS_PARTSBASE_TOKEN_ENDPOINT")
                        .unwrap_or_else(|_| "https://auth.partsbase.com/connect/token".into())
                        .parse()?,
                    required_env("MXGENIUS_PARTSBASE_CLIENT_ID")?,
                    required_env("MXGENIUS_PARTSBASE_CLIENT_SECRET")?,
                    required_env("MXGENIUS_PARTSBASE_USERNAME")?,
                    required_env("MXGENIUS_PARTSBASE_PASSWORD")?,
                    std::env::var("MXGENIUS_PARTSBASE_SCOPE").unwrap_or_else(|_| "api".into()),
                )))
            }
            "disabled" | "" => anyhow::bail!("PartsBase authentication is disabled"),
            _ => anyhow::bail!("unsupported PartsBase auth mode {mode}"),
        };
        let timeout = std::env::var("MXGENIUS_PARTSBASE_TIMEOUT_SECONDS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(20);
        Ok(Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(timeout))
                .build()?,
            service_url,
            auth,
        })
    }

    pub fn auth_mode(&self) -> &'static str {
        self.auth.mode()
    }

    /// Official market-pricing lookup; the value is retained losslessly until
    /// a typed supplier mapping is validated against live licensed responses.
    pub async fn market_pricing(&self, part_number: &str) -> AdapterResult<Value> {
        let part_number = part_number.trim();
        if part_number.is_empty() {
            return Err(AdapterError::InvalidInput("part number is required".into()));
        }
        let url = self
            .service_url
            .join("prod-pbd-marketpricing")
            .map_err(|error| AdapterError::InvalidInput(error.to_string()))?;
        let response = self
            .auth
            .request(&self.client, Method::GET, url)
            .await?
            .query(&[("partnumber", part_number)])
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(super::provider_auth::map_request_error)?;
        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(AdapterError::NotLicensed(
                "PartsBase rejected the configured credential".into(),
            )),
            StatusCode::TOO_MANY_REQUESTS => Err(AdapterError::RateLimited(
                "PartsBase rate limit reached".into(),
            )),
            status if !status.is_success() => Err(AdapterError::Unavailable(format!(
                "PartsBase returned HTTP {status}"
            ))),
            _ => response.json().await.map_err(|error| {
                AdapterError::Internal(format!("invalid PartsBase response: {error}"))
            }),
        }
    }
}

fn required_env(name: &str) -> anyhow::Result<String> {
    std::env::var(name)
        .map_err(|_| anyhow::anyhow!("required environment variable {name} is unset"))
}
