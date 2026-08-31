//! Parts tool handlers (5): `mxg.parts.*`.
//!
//! All five tools are remounted on the existing Parts inventory repository
//! and `parts` catalog when the application Postgres pool is present. When
//! the pool is absent (local mode) every tool is registered as a typed
//! `NotConfiguredTool` so `tools/list` reports `availability:
//! not_configured` and the runtime envelope carries a `NOT_CONFIGURED`
//! warning. No mock data, no simulated success.
//!
//! The `parts.alternates` tool has no supersession table in the supplied
//! migrations, so it stays `not_configured` in every mode. The remaining
//! four tools (`resolve`, `inventory`, `rank_options`,
//! `attach_certificate`) write through to `parts`, `stock_units`,
//! `part_source_options`, and `certificate_records` exactly as the
//! application service expects.

use std::sync::Arc;

use async_trait::async_trait;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError, EnvelopeStatus};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    CertificateRecordDto, PartsAlternatesRequest, PartsAlternatesResponse,
    PartsAttachCertificateRequest, PartsAttachCertificateResponse, PartsInventoryOption,
    PartsInventoryRequest, PartsInventoryResponse, PartsRankOption, PartsRankOptionsRequest,
    PartsRankOptionsResponse, PartsResolveMatch, PartsResolveRequest, PartsResolveResponse,
};
use mxgenius_shared::domain::evidence::ConfidenceBasis;
use sha2::Digest as _;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::parts_inventory::{PartsInventoryRepository, SearchPartsQuery};
use crate::handlers::{not_configured, not_configured_mutating, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry, pool: Option<sqlx::PgPool>) {
    let pool = pool.map(Arc::new);
    match pool.clone() {
        Some(pool) => {
            reg.register_typed_tool(wrap(Arc::new(PartsResolveTool { pool: pool.clone() })));
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
            reg.register_typed_tool(wrap(Arc::new(PartsInventoryTool { pool: pool.clone() })));
            reg.register_typed_tool(wrap(Arc::new(PartsRankOptionsTool { pool: pool.clone() })));
            reg.register_typed_tool(wrap(Arc::new(PartsAttachCertificateTool { pool })));
        }
        None => {
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
    }
}

// --- resolve --------------------------------------------------------------

pub struct PartsResolveTool {
    pool: Arc<sqlx::PgPool>,
}

#[async_trait]
impl Tool for PartsResolveTool {
    type Request = PartsResolveRequest;
    type Response = PartsResolveResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.parts.resolve",
            "Resolve Part",
            "Resolve a part number or description to a canonical Part.",
            Action::PartsRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: PartsResolveRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let part_number = input
            .part_number
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let description = input
            .description_query
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        if part_number.is_none() && description.is_none() {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "part_number or description_query is required".into(),
                retryable: false,
            });
        }
        let rows: Vec<(Uuid, String, String, Option<String>)> = sqlx::query_as(
            r#"SELECT id, part_number, description, manufacturer
               FROM parts
               WHERE ($1::text IS NULL OR lower(part_number) LIKE '%' || lower($1) || '%')
                 AND ($2::text IS NULL OR lower(description) LIKE '%' || lower($2) || '%')
               ORDER BY length(part_number), part_number
               LIMIT 50"#,
        )
        .bind(part_number)
        .bind(description)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| parts_db_error("parts resolve", e))?;
        let matches: Vec<PartsResolveMatch> = rows
            .into_iter()
            .map(|row| {
                let ambiguity_state = if part_number.is_some_and(|p| p.eq_ignore_ascii_case(&row.1))
                {
                    "exact".to_string()
                } else {
                    "candidate".to_string()
                };
                PartsResolveMatch {
                    part_id: mxgenius_shared::domain::ids::PartId(row.0),
                    part_number: row.1,
                    description: row.2,
                    manufacturer: row.3,
                    applicability: "shared_catalog".into(),
                    ambiguity_state,
                }
            })
            .collect();
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, PartsResolveResponse { matches });
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.confidence.explanation = "shared canonical parts catalog resolution".into();
        if env.output.matches.is_empty() {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no parts matched the supplied identifier".into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
        }
        Ok(env)
    }
}

// --- inventory ------------------------------------------------------------

pub struct PartsInventoryTool {
    pool: Arc<sqlx::PgPool>,
}

#[async_trait]
impl Tool for PartsInventoryTool {
    type Request = PartsInventoryRequest;
    type Response = PartsInventoryResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.parts.inventory",
            "Part Inventory",
            "Return tenant-scoped inventory and certificate state for a part.",
            Action::PartsRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: PartsInventoryRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let conditions: Vec<String> = input
            .acceptable_conditions
            .as_ref()
            .map(|c| {
                c.iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let repository = PartsInventoryRepository::new(self.pool.as_ref());
        // Unwindowed: the part and condition filters below are applied in
        // Rust, so a page here would drop matching units before they are
        // considered.
        let mut units = repository
            .search_all(
                ctx,
                &SearchPartsQuery {
                    query: None,
                    status: Some("available".into()),
                    location: None,
                    page: None,
                    page_size: None,
                },
            )
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        let part_id = input.part_id.0;
        units.retain(|unit| unit.part_id == part_id);
        if !conditions.is_empty() {
            units.retain(|unit| conditions.iter().any(|c| c == &unit.condition_code));
        }
        let options: Vec<PartsInventoryOption> = units
            .into_iter()
            .map(|unit| {
                let source_reference = format!("stock_unit://{}", unit.id);
                PartsInventoryOption {
                    supplier_id: None,
                    location: unit.location,
                    quantity: unit.quantity.round() as i32,
                    condition: unit.condition_code,
                    certificate_state: if unit.certificate_number.is_some() {
                        "present"
                    } else {
                        "absent"
                    }
                    .into(),
                    price: None,
                    currency: None,
                    source_freshness: Some(mxgenius_shared::domain::datetime::UtcDateTime::from(
                        unit.updated_at,
                    )),
                    source_reference,
                    supplier_confidence: if unit.certificate_number.is_some() {
                        0.7
                    } else {
                        0.4
                    },
                }
            })
            .collect();
        let mut envelope =
            CapabilityEnvelope::new(ctx.request_id.0, PartsInventoryResponse { options });
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        envelope.confidence.explanation =
            "tenant-scoped stock_units; supplier_id, price, and currency are not provided by the supplied source"
                .into();
        if envelope.output.options.is_empty() {
            envelope.status = EnvelopeStatus::Partial;
            envelope.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no available stock units match this part in this tenant".into(),
                retryable: false,
            });
            envelope.confidence.score = 0.0;
        } else {
            envelope.warnings.push(EnvelopeError {
                code: StableErrorCode::NotConfigured,
                severity: "info".into(),
                message:
                    "supplier directory and pricing source are not provided by the supplied build"
                        .into(),
                retryable: false,
            });
        }
        Ok(envelope)
    }
}

// --- rank_options ---------------------------------------------------------

pub struct PartsRankOptionsTool {
    pool: Arc<sqlx::PgPool>,
}

#[async_trait]
impl Tool for PartsRankOptionsTool {
    type Request = PartsRankOptionsRequest;
    type Response = PartsRankOptionsResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.parts.rank_options",
            "Rank Part Options",
            "Return ranked sourcing options. Supplier ETA/pricing/quoting is not provided by the supplied source; ranking is conditional and advisory only.",
            Action::PartsRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: PartsRankOptionsRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let priorities: Vec<String> = input
            .priorities
            .clone()
            .unwrap_or_else(|| vec!["certificate_present".into(), "condition".into()]);
        let part_id = input
            .part_requirement_id
            .as_deref()
            .and_then(|raw| Uuid::parse_str(raw).ok());
        let Some(part_id) = part_id else {
            let mut env = CapabilityEnvelope::new(
                ctx.request_id.0,
                PartsRankOptionsResponse {
                    ranked: vec![],
                    advisory: true,
                },
            );
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "warn".into(),
                message:
                    "part_requirement_id must reference a part id; ranking requires a known part"
                        .into(),
                retryable: false,
            });
            env.confidence.score = 0.0;
            return Ok(env);
        };
        let repository = PartsInventoryRepository::new(self.pool.as_ref());
        // Unwindowed: ranking below filters in Rust, so a page would drop
        // candidates before they are ranked.
        let mut units = repository
            .search_all(
                ctx,
                &SearchPartsQuery {
                    query: None,
                    status: Some("available".into()),
                    location: None,
                    page: None,
                    page_size: None,
                },
            )
            .await
            .map_err(|e| EnvelopeError {
                code: StableErrorCode::InternalError,
                severity: "error".into(),
                message: e.to_string(),
                retryable: true,
            })?;
        let acceptable: Vec<String> = input
            .acceptable_conditions
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        units.retain(|unit| unit.part_id == part_id);
        if !acceptable.is_empty() {
            units.retain(|unit| acceptable.iter().any(|c| c == &unit.condition_code));
        }
        units.sort_by(|a, b| {
            rank_score(b, &priorities)
                .partial_cmp(&rank_score(a, &priorities))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let ranked: Vec<PartsRankOption> = units
            .into_iter()
            .enumerate()
            .map(|(idx, unit)| {
                let certificate_state = if unit.certificate_number.is_some() {
                    "present"
                } else {
                    "absent"
                };
                PartsRankOption {
                    rank: (idx + 1) as u32,
                    supplier_id: None,
                    eta: None,
                    availability: unit.status,
                    location: unit.location,
                    condition: unit.condition_code,
                    certificate_state: certificate_state.into(),
                    price: None,
                    warranty: None,
                    confidence: if unit.certificate_number.is_some() {
                        0.7
                    } else {
                        0.4
                    },
                    assumptions: vec![
                        "supplier ETA and pricing are not provided by the supplied source".into(),
                    ],
                    blocking_items: if unit.certificate_number.is_none() {
                        vec!["certificate_number".into()]
                    } else {
                        vec![]
                    },
                }
            })
            .collect();
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            PartsRankOptionsResponse {
                ranked,
                advisory: true,
            },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.confidence.explanation =
            "tenant-scoped stock_units ranked by certificate/condition; supplier ETA, price, and warranty are not provided by the supplied source"
                .into();
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message: "supplier ETA/price/warranty source is not provided by the supplied build; ranking is conditional on certificate and condition only".into(),
            retryable: false,
        });
        if env.output.ranked.is_empty() {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no stock units match the requested part and condition filters".into(),
                retryable: false,
            });
        }
        Ok(env)
    }
}

fn rank_score(
    unit: &crate::application::parts_inventory::StockUnitDto,
    priorities: &[String],
) -> f32 {
    let mut score = 0.0_f32;
    for priority in priorities {
        match priority.as_str() {
            "certificate_present" => {
                if unit.certificate_number.is_some() {
                    score += 1.0;
                }
            }
            "condition" => match unit.condition_code.as_str() {
                "NE" => score += 1.0,
                "NS" => score += 0.95,
                "OH" => score += 0.9,
                "SV" => score += 0.8,
                "RP" => score += 0.7,
                "AR" => score += 0.5,
                "US" => score += 0.4,
                "SC" => score += 0.2,
                _ => {}
            },
            "freshness" => {
                let age = (OffsetDateTime::now_utc() - unit.updated_at).whole_hours() as f32;
                score += 1.0 / (1.0 + age / 24.0);
            }
            _ => {}
        }
    }
    score
}

// --- attach_certificate ---------------------------------------------------

pub struct PartsAttachCertificateTool {
    pool: Arc<sqlx::PgPool>,
}

#[async_trait]
impl Tool for PartsAttachCertificateTool {
    type Request = PartsAttachCertificateRequest;
    type Response = PartsAttachCertificateResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.parts.attach_certificate",
            "Attach Certificate",
            "Persist a CertificateRecord showing file presence separately from validation status.",
            Action::PartsAttachCertificate,
            true,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: PartsAttachCertificateRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        if !ctx.human_confirmed {
            return Err(EnvelopeError {
                code: StableErrorCode::HumanApprovalRequired,
                severity: "error".into(),
                message: "trusted human confirmation is required for mxg.parts.attach_certificate"
                    .into(),
                retryable: false,
            });
        }
        if input.certificate_type.trim().is_empty() || input.document_reference.trim().is_empty() {
            return Err(EnvelopeError {
                code: StableErrorCode::InvalidInput,
                severity: "error".into(),
                message: "certificate_type and document_reference are required".into(),
                retryable: false,
            });
        }
        let case_id = input.case_id.0;
        let part_id = input.part_id.map(|p| p.0);
        let case_exists: Option<Uuid> = sqlx::query_scalar(
            r#"SELECT case_id FROM maintenance_cases
               WHERE organization_id=$1 AND case_id=$2"#,
        )
        .bind(ctx.organization_id.0)
        .bind(case_id)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| parts_db_error("certificate case lookup", e))?;
        if case_exists.is_none() {
            return Err(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: "case is not present in this tenant's maintenance_cases".into(),
                retryable: false,
            });
        }
        let certificate_id = Uuid::new_v4();
        let audit_id = Uuid::new_v4();
        let content_hash = format!(
            "sha256:{}",
            hex::encode(sha2::Sha256::digest(input.document_reference.as_bytes()))
        );
        let mut tx = self.pool.begin().await.map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: e.to_string(),
            retryable: true,
        })?;
        sqlx::query(
            r#"INSERT INTO certificate_records
               (id, case_id, part_id, certificate_type, document_reference, validated, created_at)
               VALUES ($1, $2, $3, $4, $5, false, now())"#,
        )
        .bind(certificate_id)
        .bind(case_id)
        .bind(part_id)
        .bind(&input.certificate_type)
        .bind(&input.document_reference)
        .execute(&mut *tx)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("certificate_records insert failed: {e}"),
            retryable: true,
        })?;
        sqlx::query(
            r#"INSERT INTO audit_events
               (id, case_id, actor_user_id, organization_id, action, payload, correlation_id, created_at)
               VALUES ($1, $2, $3, $4, 'parts.attach_certificate', $5, $6, now())"#,
        )
        .bind(audit_id)
        .bind(case_id)
        .bind(ctx.user_id.0)
        .bind(ctx.organization_id.0)
        .bind(serde_json::json!({
            "certificate_id": certificate_id,
            "case_id": case_id,
            "part_id": part_id,
            "certificate_type": input.certificate_type,
            "document_reference": input.document_reference,
            "content_hash": content_hash,
        }))
        .bind(ctx.correlation_id.0)
        .execute(&mut *tx)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("audit_events insert failed: {e}"),
            retryable: true,
        })?;
        tx.commit().await.map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: e.to_string(),
            retryable: true,
        })?;
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            PartsAttachCertificateResponse {
                certificate: Some(CertificateRecordDto {
                    certificate_id: certificate_id.to_string(),
                    case_id: input.case_id,
                    part_id: input.part_id,
                    certificate_type: input.certificate_type.clone(),
                    document_reference: input.document_reference.clone(),
                    file_present: true,
                    validation_state: "pending".into(),
                    created_at: mxgenius_shared::domain::datetime::UtcDateTime::now(),
                }),
                audit_event_id: Some(audit_id.to_string()),
            },
        );
        env.confidence.basis = ConfidenceBasis::HumanConfirmed;
        env.confidence.explanation =
            "human-confirmed persistence of certificate file presence".into();
        Ok(env)
    }
}

fn parts_db_error(context: &'static str, error: sqlx::Error) -> EnvelopeError {
    EnvelopeError {
        code: StableErrorCode::InternalError,
        severity: "error".into(),
        message: format!("{context} failed: {error}"),
        retryable: true,
    }
}
