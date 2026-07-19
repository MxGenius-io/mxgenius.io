use mxgenius_mcp::adapters::faa::FaaDrsHttpAdapter;
use mxgenius_shared::adapters::faa::{AdQuery, FaaAdAdapter, SaibAdapter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let adapter = FaaDrsHttpAdapter::from_env()?;
    let ads = adapter
        .applicable_ads(&AdQuery {
            aircraft_id: None,
            make: Some("Bombardier".into()),
            model: Some("Global 7500".into()),
            serial: None,
            ata: None,
        })
        .await?;
    println!("ad_candidates={}", ads.len());
    for ad in ads.iter().take(5) {
        println!(
            "ad={} source={} applicability={:?}",
            ad.ad_number, ad.source_reference, ad.applicability
        );
    }

    let saibs = SaibAdapter::search(&adapter, "Bombardier fuel").await?;
    println!("saib_matches={}", saibs.len());
    for saib in saibs.iter().take(5) {
        println!(
            "saib={} source={}",
            saib.notice_number, saib.source_reference
        );
    }
    Ok(())
}
