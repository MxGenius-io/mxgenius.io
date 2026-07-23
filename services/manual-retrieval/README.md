# MXGenius MiniLM retrieval support

This service exposes the corpus-compatible `all-MiniLM-L6-v2` embedding model
through the OpenAI embeddings response shape already consumed by the Rust
`ManualCorpusAdapter`.

Required environment:

- `EMBEDDINGS_API_KEY`: shared server-side credential.
- `PORT`: optional; defaults to `8080`.

Endpoints:

- `GET /healthz`
- `POST /v1/embeddings`

Production MCP settings:

```text
AZURE_SEARCH_INDEX=manuals-authoritative-v2
MXGENIUS_EMBEDDINGS_ENDPOINT=https://<service>/v1/embeddings
MXGENIUS_EMBEDDINGS_MODEL=all-MiniLM-L6-v2
MXGENIUS_EMBEDDINGS_AUTH=bearer
MXGENIUS_EMBEDDINGS_API_KEY=<same secret>
```

The service does not contain manuals and cannot retrieve documents. It only
converts bounded query text into the same 384-dimensional vector space used by
the prebuilt corpus.
