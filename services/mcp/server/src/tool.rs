//! Tool trait and tool spec. Each tool is generic over its own request and
//! response types. The dispatcher deserializes the request, hands the typed
//! value to the tool, and serializes the typed response inside the envelope.

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError};
use mxgenius_shared::application::policy::Action;

#[derive(Debug, Clone, Serialize)]
pub struct ToolSpec {
    pub name: String,
    pub title: String,
    pub description: String,
    /// Generated from the request type at registration time.
    pub input_schema: Value,
    /// Generated from `CapabilityEnvelope<O>` at registration time.
    pub output_schema: Value,
    pub tool_version: String,
    pub input_schema_version: String,
    pub output_schema_version: String,
    pub domain_schema_version: String,
    pub action: Action,
    pub requires_human_approval: bool,
}

/// Typed tool. Implementations map a single MCP tool name to a service call.
#[async_trait]
pub trait Tool: Send + Sync {
    type Request: DeserializeOwned + JsonSchema + Send + 'static;
    type Response: Serialize + JsonSchema + Send + 'static;

    fn spec(&self) -> ToolSpec;
    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Self::Request,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError>;
}

/// Convenience for tools that take `serde_json::Value` (a small number of
/// boundary cases such as `initialize`-style admin).
pub type UntypedRequest = Value;
pub type UntypedResponse = Value;
