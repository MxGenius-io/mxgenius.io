#!/usr/bin/env bash
# Run MXGenius entirely on this machine: local Postgres, local Rust backend,
# local static frontend. Nothing here touches the deployed environment.
#
#   ./scripts/dev-local.sh          start both servers
#   ./scripts/dev-local.sh stop     stop them
#   ./scripts/dev-local.sh seed     load the demo dataset
#
# The backend runs with --insecure-local, which accepts an unauthenticated
# caller as an administrator. That is why this is a development script and
# must never be pointed at a real database.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
DB_NAME="${MXG_DEV_DB:-mxgenius_dev}"
API_PORT="${MXG_DEV_API_PORT:-3030}"
WEB_PORT="${MXG_DEV_WEB_PORT:-8811}"
RUN_DIR="$REPO_ROOT/.dev-local"

export PATH="$PG_BIN:$PATH"
mkdir -p "$RUN_DIR"

stop_servers() {
    for name in api web; do
        pidfile="$RUN_DIR/$name.pid"
        if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
            kill "$(cat "$pidfile")" 2>/dev/null || true
        fi
        rm -f "$pidfile"
    done
    # A pid file only records what this script started. Anything else still
    # holding these ports would make the next start fail with "address already
    # in use" while the stale server keeps answering, which is confusing to
    # diagnose from the outside.
    for port in "$API_PORT" "$WEB_PORT"; do
        holder=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
        if [ -n "$holder" ]; then
            echo "releasing port $port (pid $holder)"
            kill $holder 2>/dev/null || true
        fi
    done
    sleep 1
}

ensure_postgres() {
    if ! pg_isready -q 2>/dev/null; then
        echo "starting postgres"
        pg_ctl -D /opt/homebrew/var/postgresql@16 -l "$RUN_DIR/postgres.log" start >/dev/null 2>&1 || true
        for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 0.5; done
    fi
    if ! psql -lqt | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
        echo "creating database $DB_NAME"
        createdb "$DB_NAME"
    fi
}

seed_demo() {
    # The seed is a DO block that reads the target org and actor from settings,
    # so those rows have to exist before it runs.
    # InsecureLocalProvider presents the nil UUID as both organization and
    # user, so the demo data has to be scoped to that or the API returns an
    # empty result for a database that is visibly full.
    local org="00000000-0000-0000-0000-000000000000"
    local actor="00000000-0000-0000-0000-000000000000"
    psql -d "$DB_NAME" -q \
        -c "INSERT INTO organizations (id,name,created_at) VALUES ('$org','Local Dev Org',now()) ON CONFLICT DO NOTHING;" \
        -c "INSERT INTO users (id,email,display_name,created_at) VALUES ('$actor','dev@localhost','Local Developer',now()) ON CONFLICT DO NOTHING;"
    psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
        -c "SET mxgenius.demo_org='$org'; SET mxgenius.demo_actor='$actor';" \
        -f "$REPO_ROOT/services/mcp/demo/seed.sql"
    echo "demo data loaded into $DB_NAME"
    psql -d "$DB_NAME" -tA -c \
        "SELECT 'parts: '||count(*) FROM parts
         UNION ALL SELECT 'stock units: '||count(*) FROM stock_units
         UNION ALL SELECT 'requests: '||count(*) FROM part_requirements;"
}

case "${1:-start}" in
    stop)
        stop_servers
        exit 0
        ;;
    seed)
        ensure_postgres
        seed_demo
        exit 0
        ;;
    start) ;;
    *)
        echo "usage: $0 [start|stop|seed]" >&2
        exit 2
        ;;
esac

stop_servers
ensure_postgres

echo "building the backend"
(cd "$REPO_ROOT/services/mcp" && cargo build -p mxgenius-mcp 2>&1 | tail -3)

# The CORS allowlist is exact-match on origin, and a browser origin carries the
# port, so the web port has to be named explicitly here.
export DATABASE_URL="postgres://localhost/$DB_NAME"
export MXGENIUS_MCP_ADDR="127.0.0.1:$API_PORT"
export MXGENIUS_MCP_ALLOWED_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT"
# The parts workspace is behind a flag; without it every parts route 404s.
export MXGENIUS_PARTS_ENABLED=1
# Stock-mutating parts operations (receiving confirm, unit transitions,
# metadata correction, quantity adjust, split) require a signed single-use
# confirmation grant. Without a secret the issuer is never built and all five
# reject with 428, which reads as a broken feature rather than a missing
# setting. The issuer requires at least 32 bytes. This is a fixed development
# value on a local-only database; production supplies its own.
export MXGENIUS_CONFIRMATION_SECRET="${MXGENIUS_CONFIRMATION_SECRET:-mxgenius-local-development-confirmation-secret}"
# Which role the insecure-local provider presents. Defaults to administrator.
# Set it to walk a gated path as the role that is actually restricted -- for
# example `technician` to confirm a quarantine release is refused, then
# `quality` to confirm it is allowed. An unknown name refuses to boot rather
# than falling back, so a typo cannot quietly answer "yes" to a test that was
# never run as the role under test. Ignored outside --insecure-local.
export MXGENIUS_INSECURE_LOCAL_ROLE="${MXGENIUS_INSECURE_LOCAL_ROLE:-administrator}"

echo "starting the api on $API_PORT (migrations run at startup)"
(cd "$REPO_ROOT/services/mcp" && exec ./target/debug/mxgenius-mcp --insecure-local \
    >"$RUN_DIR/api.log" 2>&1 </dev/null) &
echo $! >"$RUN_DIR/api.pid"
disown

for _ in $(seq 1 40); do
    curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/api/parts" && break
    sleep 0.5
done

echo "starting the web server on $WEB_PORT"
(cd "$REPO_ROOT" && exec python3 -m http.server "$WEB_PORT" \
    >"$RUN_DIR/web.log" 2>&1 </dev/null) &
echo $! >"$RUN_DIR/web.pid"
disown
sleep 1

echo
echo "  dashboard   http://localhost:$WEB_PORT/dashboard.html"
echo "  api         http://127.0.0.1:$API_PORT"
echo "  logs        $RUN_DIR/api.log, $RUN_DIR/web.log"
echo
echo "  seed demo data:  $0 seed"
echo "  stop:            $0 stop"
