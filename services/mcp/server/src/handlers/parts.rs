//! Parts tool handlers (5): `mxg.parts.*`.
//!
//! All five return typed `NOT_CONFIGURED` envelopes with no invented
//! operational facts. The first vertical slice does not include parts.

use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    PartsAlternatesRequest, PartsAlternatesResponse, PartsAttachCertificateRequest,
    PartsAttachCertificateResponse, PartsInventoryRequest, PartsInventoryResponse,
    PartsRankOptionsRequest, PartsRankOptionsResponse, PartsResolveRequest, PartsResolveResponse,
};

use crate::handlers::{not_configured, not_configured_mutating};
use crate::registry::Registry;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry) {
    reg.register_typed_tool(wrap(not_configured::<
        PartsResolveRequest,
        PartsResolveResponse,
        _,
    >(
        "mxg.parts.resolve",
        "Resolve Part",
        "Resolve a part number or description to a canonical Part.",
        Action::PartsRead,
        |_input| PartsResolveResponse { matches: vec![] },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        PartsAlternatesRequest,
        PartsAlternatesResponse,
        _,
    >(
        "mxg.parts.alternates",
        "Part Alternates",
        "Return supersessions and alternates with applicability and authoritative evidence.",
        Action::PartsRead,
        |_input| PartsAlternatesResponse {
            alternates: vec![],
            supersessions: vec![],
            insufficient_evidence: true,
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        PartsInventoryRequest,
        PartsInventoryResponse,
        _,
    >(
        "mxg.parts.inventory",
        "Part Inventory",
        "Return inventory and supplier options for a destination.",
        Action::PartsRead,
        |_input| PartsInventoryResponse { options: vec![] },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        PartsRankOptionsRequest,
        PartsRankOptionsResponse,
        _,
    >(
        "mxg.parts.rank_options",
        "Rank Part Options",
        "Return ranked sourcing options with ETA, location, condition, certificate, confidence.",
        Action::PartsRead,
        |_input| PartsRankOptionsResponse {
            ranked: vec![],
            advisory: true,
        },
    )));
    reg.register_typed_tool(wrap(not_configured_mutating::<
        PartsAttachCertificateRequest,
        PartsAttachCertificateResponse,
        _,
    >(
        "mxg.parts.attach_certificate",
        "Attach Certificate",
        "Persist a CertificateRecord showing file presence separately from validation status.",
        Action::PartsAttachCertificate,
        |_input| PartsAttachCertificateResponse {
            certificate: None,
            audit_event_id: None,
        },
    )));
}
