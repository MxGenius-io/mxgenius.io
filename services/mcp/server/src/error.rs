//! Top-level server errors.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ServerError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("unknown method: {0}")]
    UnknownMethod(String),
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    #[error("unknown resource: {0}")]
    UnknownResource(String),
    #[error("unknown prompt: {0}")]
    UnknownPrompt(String),
    #[error("internal error: {0}")]
    Internal(String),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}
