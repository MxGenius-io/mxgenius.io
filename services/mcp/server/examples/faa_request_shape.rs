use mxgenius_mcp::adapters::faa::drs_filtered_request_preview;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let make = args.next().unwrap_or_else(|| "Gulfstream".into());
    let model = args.next().unwrap_or_else(|| "G550".into());

    for document_type in ["ADFRAWD", "ADFREAD"] {
        let payload = drs_filtered_request_preview(document_type, &make, &model, 0);
        println!("POST https://drs.faa.gov/api/drs/data-pull/{document_type}/filtered");
        println!("x-api-key: <redacted>");
        println!("{}", serde_json::to_string_pretty(&payload)?);
    }

    Ok(())
}
