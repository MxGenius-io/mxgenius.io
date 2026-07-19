//! MXGenius MCP server library.
//!
//! Owns:
//! - tool / resource / prompt registration,
//! - JSON-RPC 2.0 dispatch over Streamable HTTP and stdio,
//! - envelope, evidence, capability-trace, and policy enforcement.
//!
//! Unmounted adapters fail honestly with typed `NOT_CONFIGURED` envelopes.
//! Local fixture services require explicit `--insecure-local` mode.

#![deny(unsafe_code)]
#![allow(missing_docs)]

pub mod adapters;
pub mod application;
pub mod confirmation;
pub mod context;
pub mod dispatcher;
pub mod error;
pub mod handlers;
pub mod policy;
pub mod prompts;
pub mod registry;
pub mod resources;
pub mod telemetry;
pub mod tool;
pub mod transport;
pub mod typed_tool;

pub use context::{
    AuthError, ContextProvider, ExecutionContextProvider, InsecureLocalProvider, OidcProvider,
    TrustedContextInputs,
};
pub use dispatcher::Dispatcher;
pub use error::ServerError;
pub use registry::Registry;
pub use typed_tool::{wrap, TypedTool, TypedToolImpl};
