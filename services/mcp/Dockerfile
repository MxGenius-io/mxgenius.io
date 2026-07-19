FROM rust:1.91-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY shared ./shared
COPY server ./server
COPY migrations ./migrations
COPY fixtures ./fixtures
RUN cargo build --locked --release -p mxgenius-mcp

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 mxgenius \
    && useradd --system --uid 10001 --gid mxgenius --no-create-home mxgenius
COPY --from=builder /build/target/release/mxgenius-mcp /usr/local/bin/mxgenius-mcp
USER 10001:10001
ENV MXGENIUS_MCP_ADDR=0.0.0.0:3030
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:3030/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/mxgenius-mcp"]
