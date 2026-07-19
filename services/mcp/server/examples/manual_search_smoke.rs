use anyhow::{Context, Result};
use mxgenius_mcp::adapters::manual::AzureManualCorpusAdapter;
use mxgenius_shared::adapters::manual::{ManualCorpusAdapter, ManualQuery};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<()> {
    let query = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    if query.trim().is_empty() {
        anyhow::bail!("usage: cargo run --example manual_search_smoke -- <query>");
    }

    let adapter = AzureManualCorpusAdapter::from_env()
        .context("authoritative manual adapter configuration is incomplete")?;
    let evidence = adapter
        .search(&ManualQuery {
            aircraft_id: None,
            ata: None,
            text: query,
            limit: Some(5),
        })
        .await
        .context("authoritative manual retrieval failed")?;

    let summary = evidence
        .iter()
        .map(|item| {
            json!({
                "evidence_id": item.evidence_id.0,
                "title": item.title,
                "source_reference": item.source_reference,
                "revision": item.revision,
                "content_hash": item.content_hash,
                "assets": item.assets,
            })
        })
        .collect::<Vec<_>>();
    println!("{}", serde_json::to_string_pretty(&summary)?);
    if evidence.is_empty() {
        anyhow::bail!("authoritative manual retrieval returned no evidence");
    }
    Ok(())
}
