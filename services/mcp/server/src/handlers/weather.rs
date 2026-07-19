//! Weather tool handlers (5): `mxg.weather.*`.

use mxgenius_shared::application::policy::Action;
use mxgenius_shared::contracts::{
    WeatherAirportNowRequest, WeatherAirportNowResponse, WeatherFerryAssessmentRequest,
    WeatherFerryAssessmentResponse, WeatherHazardOverlayRequest, WeatherHazardOverlayResponse,
    WeatherMaintenanceWindowRequest, WeatherMaintenanceWindowResponse, WeatherRampRiskRequest,
    WeatherRampRiskResponse,
};

use crate::handlers::not_configured;
use crate::registry::Registry;
use crate::typed_tool::wrap;

pub fn register(reg: &mut Registry) {
    reg.register_typed_tool(wrap(not_configured::<
        WeatherAirportNowRequest,
        WeatherAirportNowResponse,
        _,
    >(
        "mxg.weather.airport_now",
        "Airport Weather Now",
        "Return METAR, TAF, flight category, and decoded fields for an airport.",
        Action::WeatherRead,
        |input| WeatherAirportNowResponse {
            airport_icao: input.airport_icao,
            observed_at: None,
            forecast_at: None,
            flight_category: None,
            metar: None,
            taf: None,
            decoded: None,
            source: "not_configured".into(),
        },
    )));
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
        "mxg.weather.ramp_risk",
        "Ramp Risk",
        "Return advisory ramp risk level and drivers (wind, precip, lightning, temp, icing, visibility).",
        Action::WeatherRead,
        |input| WeatherRampRiskResponse {
            airport_icao: input.airport_icao,
            risk_level: None,
            drivers: vec![],
            advisory_only: true,
        },
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
