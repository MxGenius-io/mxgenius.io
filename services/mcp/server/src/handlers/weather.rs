//! Weather tool handlers (5): `mxg.weather.*`.

use std::sync::Arc;

use async_trait::async_trait;
use mxgenius_shared::adapters::source::AdapterError;
use mxgenius_shared::adapters::weather::AviationWeatherAdapter;
use mxgenius_shared::application::context::ExecutionContext;
use mxgenius_shared::application::envelope::{
    CapabilityEnvelope, EnvelopeError, EnvelopeStatus, PromotionState,
};
use mxgenius_shared::application::errors::StableErrorCode;
use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    WeatherAirportNowRequest, WeatherAirportNowResponse, WeatherFerryAssessmentRequest,
    WeatherFerryAssessmentResponse, WeatherHazardOverlayRequest, WeatherHazardOverlayResponse,
    WeatherMaintenanceWindowRequest, WeatherMaintenanceWindowResponse, WeatherRampRiskRequest,
    WeatherRampRiskResponse,
};
use mxgenius_shared::domain::datetime::UtcDateTime;
use mxgenius_shared::domain::evidence::ConfidenceBasis;

use crate::handlers::{not_configured, spec};
use crate::registry::Registry;
use crate::tool::Tool;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry, adapter: Option<Arc<dyn AviationWeatherAdapter>>) {
    if let Some(adapter) = adapter {
        reg.register_typed_tool(wrap(Arc::new(WeatherAirportNowTool { adapter })));
    } else {
        reg.register_typed_tool(wrap(not_configured::<
            WeatherAirportNowRequest,
            WeatherAirportNowResponse,
            _,
        >(
            "mxg.weather.airport_now",
            "Airport Weather Now",
            "Return METAR, TAF, flight category, and decoded fields for an airport.",
            Action::WeatherRead,
            |input| empty_airport_now(input.airport_icao),
        )));
    }
    register_derived_tools(reg);
}

fn register_derived_tools(reg: &mut Registry) {
    // These remain closed until maintenance thresholds and hazard geometry
    // mappings are accepted; live METAR/TAF alone does not justify a verdict.
    reg.register_typed_tool(wrap(not_configured::<
        WeatherMaintenanceWindowRequest,
        WeatherMaintenanceWindowResponse,
        _,
    >(
        "mxg.weather.maintenance_window",
        "Maintenance Window",
        "Return candidate outdoor/maintenance windows with suitability and drivers.",
        Action::WeatherRead,
        |input| WeatherMaintenanceWindowResponse {
            airport_icao: input.airport_icao,
            windows: vec![],
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<WeatherRampRiskRequest, WeatherRampRiskResponse, _>(
        "mxg.weather.ramp_risk", "Ramp Risk",
        "Return advisory ramp risk level and drivers (wind, precip, lightning, temp, icing, visibility).", Action::WeatherRead,
        |input| WeatherRampRiskResponse { airport_icao: input.airport_icao, risk_level: None, drivers: vec![], advisory_only: true },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        WeatherFerryAssessmentRequest,
        WeatherFerryAssessmentResponse,
        _,
    >(
        "mxg.weather.ferry_assessment",
        "Ferry Assessment",
        "Return weather constraints, hazards, missing information, advisory feasibility state.",
        Action::WeatherRead,
        |input| WeatherFerryAssessmentResponse {
            origin: input.origin,
            destination: input.destination,
            feasibility_state: "unknown".into(),
            constraints: vec![],
            hazards: vec![],
            missing_information: vec![],
            advisory_only: true,
        },
    )));
    reg.register_typed_tool(wrap(not_configured::<
        WeatherHazardOverlayRequest,
        WeatherHazardOverlayResponse,
        _,
    >(
        "mxg.weather.hazard_overlay",
        "Hazard Overlay",
        "Return geospatial hazard objects suitable for globe layers.",
        Action::WeatherRead,
        |_input| WeatherHazardOverlayResponse { hazards: vec![] },
    )));
}

struct WeatherAirportNowTool {
    adapter: Arc<dyn AviationWeatherAdapter>,
}

#[async_trait]
impl Tool for WeatherAirportNowTool {
    type Request = WeatherAirportNowRequest;
    type Response = WeatherAirportNowResponse;

    fn spec(&self) -> crate::tool::ToolSpec {
        spec::<Self::Request, Self::Response>(
            "mxg.weather.airport_now",
            "Airport Weather Now",
            "Return live METAR, TAF, flight category, and decoded fields from AviationWeather.gov.",
            Action::WeatherRead,
            false,
        )
    }

    async fn invoke(
        &self,
        ctx: &ExecutionContext,
        input: Self::Request,
    ) -> Result<CapabilityEnvelope<Self::Response>, EnvelopeError> {
        let requested_icao = input.airport_icao.trim().to_ascii_uppercase();
        let weather = match self.adapter.airport_now(&requested_icao).await {
            Ok(weather) => weather,
            Err(error) => return Ok(weather_failure(ctx, requested_icao, error)),
        };
        let mut envelope = CapabilityEnvelope::new(
            ctx.request_id.0,
            WeatherAirportNowResponse {
                airport_icao: weather.airport_icao,
                observed_at: Some(UtcDateTime(weather.observed_at)),
                forecast_at: None,
                flight_category: weather.flight_category,
                metar: weather.metar,
                taf: weather.taf,
                decoded: weather.decoded,
                source: weather.source_reference,
            },
        );
        envelope.confidence.basis = ConfidenceBasis::DeterministicLookup;
        envelope.confidence.explanation =
            "direct public aviation-weather API response; no operational suitability judgment"
                .into();
        Ok(envelope)
    }
}

fn empty_airport_now(airport_icao: String) -> WeatherAirportNowResponse {
    WeatherAirportNowResponse {
        airport_icao,
        observed_at: None,
        forecast_at: None,
        flight_category: None,
        metar: None,
        taf: None,
        decoded: None,
        source: "not_configured".into(),
    }
}

fn weather_failure(
    ctx: &ExecutionContext,
    airport_icao: String,
    error: AdapterError,
) -> CapabilityEnvelope<WeatherAirportNowResponse> {
    let (code, retryable) = match error {
        AdapterError::NotConfigured { .. } => (StableErrorCode::NotConfigured, false),
        AdapterError::InvalidInput(_) => (StableErrorCode::InvalidInput, false),
        AdapterError::Timeout(_) => (StableErrorCode::SourceTimeout, true),
        AdapterError::RateLimited(_) => (StableErrorCode::SourceRateLimited, true),
        AdapterError::NotLicensed(_) => (StableErrorCode::SourceNotLicensed, false),
        AdapterError::Stale(_) => (StableErrorCode::SourceStale, false),
        AdapterError::Unavailable(_) | AdapterError::Internal(_) => {
            (StableErrorCode::SourceUnavailable, true)
        }
    };
    let mut envelope = CapabilityEnvelope::new(ctx.request_id.0, empty_airport_now(airport_icao));
    envelope.status = EnvelopeStatus::Partial;
    envelope.promotion_state = PromotionState::Shadow;
    envelope.warnings.push(EnvelopeError {
        code,
        severity: "warn".into(),
        message: error.to_string(),
        retryable,
    });
    envelope.confidence.score = 0.0;
    envelope
}
