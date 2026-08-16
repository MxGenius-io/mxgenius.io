# MXGenius MiniLM retrieval support

This service exposes the corpus-compatible `all-MiniLM-L6-v2` embedding model
through the OpenAI embeddings response shape already consumed by the Rust
`ManualCorpusAdapter`.

Required environment:

- `EMBEDDINGS_API_KEY`: shared server-side credential.
- `PORT`: optional; defaults to `8080`.

Endpoints:

- `GET /healthz`
- `GET /readyz` (loads the model and verifies a finite 384-dimensional vector)
- `POST /v1/embeddings`

Production MCP settings:

```text
AZURE_SEARCH_INDEX=manuals-authoritative-v2
MXGENIUS_MANUAL_PACK_ID=mxg-cl350-starter-manuals-v1
MXGENIUS_EMBEDDINGS_ENDPOINT=https://<service>/v1/embeddings
MXGENIUS_EMBEDDINGS_MODEL=all-MiniLM-L6-v2
MXGENIUS_EMBEDDINGS_AUTH=bearer
MXGENIUS_EMBEDDINGS_API_KEY=<same secret>
```

The service does not contain manuals and cannot retrieve documents. It only
converts bounded query text into the same 384-dimensional vector space used by
the prebuilt corpus.

The MCP now rejects startup when the pack ID, index name, embedding model,
embedding dimensions, or private embedding endpoint do not match this contract.
