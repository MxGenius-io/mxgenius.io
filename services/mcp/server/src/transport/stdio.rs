//! Stdio transport. Reads one JSON-RPC message per line from stdin, writes
//! one JSON-RPC response per line to stdout. Same dispatcher as HTTP.

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use crate::dispatcher::{Dispatcher, JsonRpcRequest};

pub async fn run(dispatcher: Dispatcher) -> anyhow::Result<()> {
    run_io(tokio::io::stdin(), tokio::io::stdout(), dispatcher).await
}

pub async fn run_io<R, W>(input: R, mut output: W, dispatcher: Dispatcher) -> anyhow::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut reader = BufReader::new(input).lines();

    while let Some(line) = reader.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let req: JsonRpcRequest = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(err) => {
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": {
                        "code": -32700,
                        "message": format!("parse error: {err}"),
                    }
                });
                output.write_all(resp.to_string().as_bytes()).await?;
                output.write_all(b"\n").await?;
                output.flush().await?;
                continue;
            }
        };
        if let Some(resp) = dispatcher.dispatch(req).await {
            let line = serde_json::to_string(&resp)?;
            output.write_all(line.as_bytes()).await?;
            output.write_all(b"\n").await?;
            output.flush().await?;
        }
    }
    Ok(())
}
