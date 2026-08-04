//! MRO discovery tool handlers (5): `mxg.mro.*`.
//!
//! The MRO tools are bound to the tenant-scoped `mro_facilities` and
//! `facility_capabilities` tables when the application Postgres pool is
//! configured. In local mode they remain `not_configured` so the
//! `tools/list` metadata agrees with the runtime envelope.
//!
//! No external operator directory is introduced. Ranking, pricing,
//! quoting, route ETA, and contact directories are not provided by the
//! supplied source, so the corresponding tools return typed partial
//! envelopes with explicit `not_configured` warnings naming the absent
//! source. The JetNet Operations API is never invoked.

use std::sync::Arc;

use async_trait::async_trait;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{CapabilityEnvelope, EnvelopeError, EnvelopeStatus};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    FactorEvidence, MroCapabilityMatchRequest, MroCapabilityMatchResponse, MroContactPackRequest,
    MroContactPackResponse, MroFacilityDto, MroRankRequest, MroRankResponse, MroRankedFacility,
    MroRouteEtaRequest, MroRouteEtaResponse, MroSearchRequest, MroSearchResponse,
};
use mxgenius_shared::domain::evidence::ConfidenceBasis;
use uuid::Uuid;

use crate::handlers::{limited_spec, not_configured, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry, pool: Option<sqlx::PgPool>) {
    if let Some(pool) = pool {
        reg.register_typed_tool(wrap(Arc::new(MroSearchTool { pool: pool.clone() })));
        reg.register_typed_tool(wrap(Arc::new(MroCapabilityMatchTool {
            pool: pool.clone(),
        })));
        reg.register_typed_tool(wrap(Arc::new(MroRankTool { pool })));
    } else {
        reg.register_typed_tool(wrap(
            not_configured::<MroSearchRequest, MroSearchResponse, _>(
                "mxg.mro.search",
                "MRO Search",
                "Return candidate MROFacility entries with source completeness.",
                Action::MroRead,
                |_input| MroSearchResponse { facilities: vec![] },
            ),
        ));
        reg.register_typed_tool(wrap(not_configured::<
            MroCapabilityMatchRequest,
            MroCapabilityMatchResponse,
            _,
        >(
            "mxg.mro.capability_match",
            "MRO Capability Match",
            "Return supported tasks, gaps, ratings evidence, and match score for a case at a facility.",
            Action::MroRead,
            |input| MroCapabilityMatchResponse {
                facility_id: input.facility_id,
                supported_tasks: vec![],
                gaps: vec![],
                ratings_evidence: vec![],
                completeness: "unknown".into(),
                match_score: None,
            },
        )));
        reg.register_typed_tool(wrap(not_configured::<MroRankRequest, MroRankResponse, _>(
            "mxg.mro.rank",
            "Rank MRO Facilities",
            "Rank facilities using capability, distance, hours, weather, parts, performance, completeness.",
            Action::MroRead,
            |_input| MroRankResponse { ranked: vec![], advisory: true },
        )));
    }
    // contact_pack and route_eta stay not_configured in every mode because
    // no contact, operating_hours, route, or distance source is provided.
    reg.register_typed_tool(wrap(not_configured::<
        MroContactPackRequest,
        MroContactPackResponse,
        _,
    >(
        "mxg.mro.contact_pack",
        "MRO Contact Pack",
        "Return facility identity, verified contacts, operating hours, escalation channels.",
        Action::MroRead,
        |input| MroContactPackResponse {
            facility_id: input.facility_id,
            facility_name: String::new(),
            contacts: vec![],
            operating_hours: None,
            escalation_channels: vec![],
            source_freshness: None,
            source_references: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        MroRouteEtaRequest,
        MroRouteEtaResponse,
        _,
    >(
        "mxg.mro.route_eta",
        "MRO Route ETA",
        "Return estimated route, distance, time, assumptions, constraints, weather links.",
        Action::MroRead,
        |_input| MroRouteEtaResponse {
            distance_nm: None,
            estimated_duration_minutes: None,
            assumptions: vec![],
            constraints: vec![],
            weather_link: None,
            uncertainty: "unknown".into(),
        },
    )));
}

// 18. search --------------------------------------------------------------
pub struct MroSearchTool {
    pool: sqlx::PgPool,
}

#[async_trait]
impl Tool for MroSearchTool {
    type Request = MroSearchRequest;
    type Response = MroSearchResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.mro.search",
            "MRO Search",
            "Return candidate MROFacility entries from the existing operator/facility directory.",
            Action::MroRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MroSearchRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let location = input
            .location
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let icao = input
            .aircraft_type
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let task = input
            .task_capability
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let rows: Vec<(Uuid, String, Option<String>, Option<String>, Option<String>)> = if task.is_some() {
            sqlx::query_as(
                r#"SELECT DISTINCT f.id, f.name, f.source_reference, f.icao, f.city
                   FROM mro_facilities f
                   JOIN facility_capabilities c
                     ON c.facility_id=f.id
                   WHERE ($1::text IS NULL OR f.city ILIKE '%' || $1 || '%' OR f.country ILIKE '%' || $1 || '%' OR f.icao=$1)
                     AND ($2::text IS NULL OR f.icao=$2)
                     AND c.task_code=$3
                   ORDER BY f.name
                   LIMIT 50"#,
            )
            .bind(location)
            .bind(icao)
            .bind(task)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as(
                r#"SELECT f.id, f.name, f.source_reference, f.icao, f.city
                   FROM mro_facilities f
                   WHERE ($1::text IS NULL OR f.city ILIKE '%' || $1 || '%' OR f.country ILIKE '%' || $1 || '%' OR f.icao=$1)
                     AND ($2::text IS NULL OR f.icao=$2)
                   ORDER BY f.name
                   LIMIT 50"#,
            )
            .bind(location)
            .bind(icao)
            .fetch_all(&self.pool)
            .await
        }
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("mro_facilities query failed: {e}"),
            retryable: true,
        })?;
        let facilities: Vec<MroFacilityDto> = rows
            .into_iter()
            .map(|(id, name, source_reference, icao, city)| MroFacilityDto {
                facility_id: mxgenius_shared::domain::ids::FacilityId(id),
                name,
                source_reference,
                icao,
                city,
                country: None,
                source_completeness: "directory_only".into(),
                verified: false,
            })
            .collect();
        let mut env = CapabilityEnvelope::new(ctx.request_id.0, MroSearchResponse { facilities });
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.confidence.explanation =
            "tenant-scoped mro_facilities directory; rating, availability, hours, and contact data are not provided"
                .into();
        if env.output.facilities.is_empty() {
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "info".into(),
                message: "no mro_facilities rows match the supplied filter".into(),
                retryable: false,
            });
        }
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message: "rating, pricing, availability, and contact data are not provided by the supplied source".into(),
            retryable: false,
        });
        Ok(env)
    }
}

// 19. capability_match ----------------------------------------------------
pub struct MroCapabilityMatchTool {
    pool: sqlx::PgPool,
}

#[async_trait]
impl Tool for MroCapabilityMatchTool {
    type Request = MroCapabilityMatchRequest;
    type Response = MroCapabilityMatchResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.mro.capability_match",
            "MRO Capability Match",
            "Return supported tasks, gaps, ratings evidence, and match score for a case at a facility.",
            Action::MroRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MroCapabilityMatchRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let case_exists: Option<Uuid> = sqlx::query_scalar(
            "SELECT case_id FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2",
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("maintenance_cases lookup failed: {e}"),
            retryable: true,
        })?;
        if case_exists.is_none() {
            return Err(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: "case is not present in this tenant".into(),
                retryable: false,
            });
        }
        let rows: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
            r#"SELECT task_code, rating, evidence_reference
               FROM facility_capabilities
               WHERE facility_id=$1"#,
        )
        .bind(input.facility_id.0)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("facility_capabilities query failed: {e}"),
            retryable: true,
        })?;
        let mut supported: Vec<String> = Vec::new();
        let mut ratings_evidence: Vec<String> = Vec::new();
        for (task_code, rating, evidence) in rows {
            supported.push(task_code.clone());
            if let Some(rating) = rating {
                ratings_evidence.push(format!("{task_code}={rating}"));
            }
            if let Some(evidence) = evidence {
                ratings_evidence.push(format!("{task_code} evidence={evidence}"));
            }
        }
        let gaps: Vec<String> = vec![
            "case→facility capability diff is not provided by the supplied source; case-specific required_tasks are not derivable from mro_facilities or facility_capabilities alone"
                .into(),
        ];
        let completeness: String = if supported.is_empty() {
            "unknown".into()
        } else {
            "directory_only".into()
        };
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            MroCapabilityMatchResponse {
                facility_id: input.facility_id,
                supported_tasks: supported,
                gaps,
                ratings_evidence,
                completeness: completeness.clone(),
                match_score: None,
            },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        if completeness == "unknown" {
            env.status = EnvelopeStatus::Partial;
            env.warnings.push(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "warn".into(),
                message: "no facility_capabilities rows for this facility_id".into(),
                retryable: false,
            });
        }
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "info".into(),
            message:
                "match_score is not provided by the supplied source; ratings evidence is unverified"
                    .into(),
            retryable: false,
        });
        Ok(env)
    }
}

// 20. rank (advisory) -----------------------------------------------------
pub struct MroRankTool {
    pool: sqlx::PgPool,
}

#[async_trait]
impl Tool for MroRankTool {
    type Request = MroRankRequest;
    type Response = MroRankResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        limited_spec::<Self::Request, Self::Response>(
            "mxg.mro.rank",
            "Rank MRO Facilities",
            "Rank facilities by capability match count. Distance, weather, hours, and performance are not provided.",
            Action::MroRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: MroRankRequest,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let case_exists: Option<Uuid> = sqlx::query_scalar(
            "SELECT case_id FROM maintenance_cases WHERE organization_id=$1 AND case_id=$2",
        )
        .bind(ctx.organization_id.0)
        .bind(input.case_id.0)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("maintenance_cases lookup failed: {e}"),
            retryable: true,
        })?;
        if case_exists.is_none() {
            return Err(EnvelopeError {
                code: StableErrorCode::EntityNotFound,
                severity: "error".into(),
                message: "case is not present in this tenant".into(),
                retryable: false,
            });
        }
        // Advisory ranking: count of facility_capabilities per facility, with
        // a not_configured warning for every absent factor. This is the only
        // dimension the supplied source provides.
        let rows: Vec<(Uuid, String, i64)> = sqlx::query_as(
            r#"SELECT f.id, f.name, count(c.id) AS capability_count
               FROM mro_facilities f
               LEFT JOIN facility_capabilities c ON c.facility_id=f.id
               GROUP BY f.id, f.name
               ORDER BY capability_count DESC, f.name ASC
               LIMIT 25"#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| EnvelopeError {
            code: StableErrorCode::InternalError,
            severity: "error".into(),
            message: format!("mro_facilities aggregate query failed: {e}"),
            retryable: true,
        })?;
        let ranked: Vec<MroRankedFacility> = rows
            .into_iter()
            .enumerate()
            .map(|(idx, (id, name, capability_count))| {
                let score = if capability_count == 0 {
                    0.0
                } else {
                    (capability_count as f32).ln_1p() / 5.0
                };
                let factors = vec![
                    FactorEvidence {
                        factor: "capability_count".into(),
                        value: serde_json::json!(capability_count),
                        evidence_reference: Some(format!("facility_capabilities for {id}")),
                        unknown: false,
                    },
                    FactorEvidence {
                        factor: "distance".into(),
                        value: serde_json::Value::Null,
                        evidence_reference: None,
                        unknown: true,
                    },
                    FactorEvidence {
                        factor: "operating_hours".into(),
                        value: serde_json::Value::Null,
                        evidence_reference: None,
                        unknown: true,
                    },
                    FactorEvidence {
                        factor: "weather".into(),
                        value: serde_json::Value::Null,
                        evidence_reference: None,
                        unknown: true,
                    },
                    FactorEvidence {
                        factor: "parts_availability".into(),
                        value: serde_json::Value::Null,
                        evidence_reference: None,
                        unknown: true,
                    },
                ];
                let unknown_factors: Vec<String> = factors
                    .iter()
                    .filter(|f| f.unknown)
                    .map(|f| f.factor.clone())
                    .collect();
                MroRankedFacility {
                    rank: (idx + 1) as u32,
                    facility_id: mxgenius_shared::domain::ids::FacilityId(id),
                    name,
                    match_score: score,
                    factor_evidence: factors,
                    unknown_factors,
                }
            })
            .collect();
        let mut env = CapabilityEnvelope::new(
            ctx.request_id.0,
            MroRankResponse {
                ranked,
                advisory: true,
            },
        );
        env.confidence.basis = ConfidenceBasis::DeterministicLookup;
        env.confidence.explanation =
            "advisory ranking by capability_count only; distance, hours, weather, parts, and performance are not provided by the supplied source"
                .into();
        env.status = EnvelopeStatus::Partial;
        env.warnings.push(EnvelopeError {
            code: StableErrorCode::NotConfigured,
            severity: "warn".into(),
            message: "distance, operating_hours, weather, parts_availability, and performance sources are not provided; this ranking is advisory and must not be used for selection".into(),
            retryable: false,
        });
        Ok(env)
    }
}
