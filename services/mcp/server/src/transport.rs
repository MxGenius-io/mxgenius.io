//! Transport layer. Both Streamable HTTP and stdio share the same dispatcher
//! and the same handler registry.

pub mod http;
pub mod stdio;
