#!/usr/bin/env bash
#
# One command to bring the whole local stack up: `npm run dev` / `pnpm dev`.
#
# The web app is useless on its own here. Every ops dashboard reads the
# control service, and a missing one does not fail loudly - the consoles
# render "The control service did not answer, so this list is unknown - not
# empty", which reads like a data problem rather than a process that was
# never started. So this script runs both.
#
# It also enforces the boot ORDER, which is the sharp edge that costs the
# most time here. control-service rehydrates its in-memory state exactly
# once at boot (control-service/src/index.ts) with NO retry: an instance
# started before its Postgres is reachable parks on
# `/readyz -> rehydrationStatus: "failed"` forever, silently ingests
# nothing, and still answers 200 on its read endpoints - so it looks alive
# while the GPS pipeline is dead. Waiting for the database here is what
# stops that state from ever being reached.
#
# Deliberately dependency-free (no concurrently/npm-run-all): the two
# packages have separate node_modules, and a dev launcher should not be the
# reason an install is required.
#
# Run either half alone with `pnpm dev:web` / `pnpm dev:control`.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL_DIR="$ROOT/control-service"

RED=$'\033[31m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

note() { printf '%s[dev]%s %s\n' "$CYAN" "$RESET" "$1"; }
warn() { printf '%s[dev]%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '%s[dev]%s %s\n' "$RED" "$RESET" "$1" >&2; }

# Pull host:port out of a postgres:// URL in an env file, without sourcing
# the file (it holds secrets we have no reason to put in this process).
db_host_port() {
  local file="$1" var="$2" url
  [ -f "$file" ] || return 1
  url="$(grep -E "^${var}=" "$file" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
  [ -n "$url" ] || return 1
  printf '%s' "$url" | sed -E 's|^[a-z+]+://[^@]*@||; s|/.*$||'
}

port_open() { nc -z "$1" "$2" >/dev/null 2>&1; }

wait_for_db() {
  local label="$1" hostport="$2" host port i
  host="${hostport%%:*}"; port="${hostport##*:}"
  for i in $(seq 1 45); do
    port_open "$host" "$port" && { note "$label reachable on $hostport"; return 0; }
    [ "$i" = 1 ] && note "waiting for $label on $hostport ..."
    sleep 1
  done
  return 1
}

db_hint() {
  fail "Start them first, then re-run. They are Docker containers another"
  fail "process may also depend on - start, never recreate:"
  fail "    docker start olympuss-ops-db olympuss-control-db"
  fail "(If Docker itself is not running, open Docker Desktop first.)"
}

# ---------------------------------------------------------------- preflight
OPS_DB="$(db_host_port "$ROOT/.env.local" OPS_DATABASE_URL || true)"
CONTROL_DB="$(db_host_port "$CONTROL_DIR/.env.local" CONTROL_SERVICE_DATABASE_URL || true)"

if [ -z "${OPS_DB:-}" ]; then
  fail "OPS_DATABASE_URL is not set in .env.local - sign-in cannot resolve an ops role without it."
  exit 1
fi
if ! wait_for_db "ops database" "$OPS_DB"; then
  fail "ops database ($OPS_DB) is not accepting connections."
  fail "Sign-in will succeed and then bounce to /login?notice=no-ops-access."
  db_hint
  exit 1
fi

RUN_CONTROL=1
if [ -z "${CONTROL_DB:-}" ]; then
  warn "control-service/.env.local has no CONTROL_SERVICE_DATABASE_URL; starting the web app alone."
  warn "Ops dashboards will report that the control service did not answer."
  RUN_CONTROL=0
elif port_open 127.0.0.1 8080; then
  note "something is already listening on :8080 - leaving it alone, starting the web app only."
  RUN_CONTROL=0
elif [ ! -d "$CONTROL_DIR/node_modules" ]; then
  warn "control-service has no node_modules. Run: (cd control-service && pnpm install)"
  warn "Starting the web app alone for now."
  RUN_CONTROL=0
elif ! wait_for_db "control database" "$CONTROL_DB"; then
  fail "control database ($CONTROL_DB) is not accepting connections."
  fail "Refusing to start control-service against it: rehydration runs once at"
  fail "boot and never retries, so it would wedge as permanently not-ready."
  db_hint
  exit 1
fi

# ------------------------------------------------------------------- launch
# Job control on, so each background job becomes its own process-group
# leader. That is what makes the cleanup below able to kill a whole subtree:
# these servers are `pnpm -> tsx -> node` and `next -> render worker`, so
# signalling only the PID we launched leaves the actual listener orphaned on
# :8080 and the next `npm run dev` finds the port taken.
set -m

PIDS=()

signal_all() {
  local sig="$1" pid
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    # Negative PID = "the whole process group". Falls back to the bare PID if
    # the job was never made a group leader.
    kill "-$sig" -- -"$pid" 2>/dev/null || kill "-$sig" "$pid" 2>/dev/null
  done
}

any_alive() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null && return 0
  done
  return 1
}

cleanup() {
  trap - INT TERM EXIT
  signal_all TERM
  # Bounded, then escalate. A plain `wait` here blocks forever if any child
  # declines to die on TERM, which strands this script and its watcher alive
  # with the port already released - so the stack looks stopped while it is
  # not, and the next run inherits a phantom file-watcher.
  local i
  for i in $(seq 1 10); do
    any_alive || return 0
    sleep 1
  done
  signal_all KILL
}
trap cleanup INT TERM EXIT

# Call each package's own `dev` script rather than re-spelling the command
# here, so package.json stays the single source of truth for how each half
# starts (control-service's carries the --env-file flag it cannot boot without).
if command -v pnpm >/dev/null 2>&1; then PM=pnpm; else PM=npm; fi

# Not piped through a prefixer: a pipeline would hand back the prefixer's
# PID instead of the server's (leaving an orphan on shutdown) and macOS sed
# block-buffers, so the logs would arrive in lumps. control-service's output
# is JSON tagged with "service":"control-service", so it labels itself.
if [ "$RUN_CONTROL" = 1 ]; then
  note "starting control-service (:8080)"
  ( cd "$CONTROL_DIR" && exec "$PM" run dev ) &
  PIDS+=("$!")
fi

note "starting web app (:3000)"
NEXT_BIN="$ROOT/node_modules/.bin/next"
[ -x "$NEXT_BIN" ] || NEXT_BIN=next
( cd "$ROOT" && exec "$NEXT_BIN" dev ) &
PIDS+=("$!")

# Exit as soon as EITHER half dies, so a crashed control-service is visible
# immediately instead of leaving a half-stack that reports empty dashboards.
# Polled rather than `wait -n`, which macOS's stock bash 3.2 does not have.
while :; do
  for pid in "${PIDS[@]:-}"; do
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      fail "a dev process exited; shutting the rest down."
      exit 1
    fi
  done
  sleep 1
done
