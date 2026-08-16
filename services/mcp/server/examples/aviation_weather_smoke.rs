//! Read-only smoke test for the public AviationWeather.gov adapter.

use mxgenius_mcp::adapters::weather::AviationWeatherHttpAdapter;
use mxgenius_shared::adapters::weather::AviationWeatherAdapter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let icao = std::env::args().nth(1).unwrap_or_else(|| "KATL".into());
    let adapter = AviationWeatherHttpAdapter::from_env()?;
    let weather = adapter.airport_now(&icao).await?;
    println!(
        "{} observed={} category={} metar={} taf={} source={}",
        weather.airport_icao,
        weather.observed_at,
        weather.flight_category.as_deref().unwrap_or("unknown"),
        weather.metar.is_some(),
        weather.taf.is_some(),
        weather.source_reference,
    );
    Ok(())
}
