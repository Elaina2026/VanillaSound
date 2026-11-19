#!/usr/bin/env bash
set -u

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Locate NodeLink directory (supports ./NodeLink, ../NodeLink, or NODELINK_DIR env override)
if [ -n "${NODELINK_DIR:-}" ]; then
  NL_DIR="$NODELINK_DIR"
elif [ -d "$BOT_DIR/NodeLink" ]; then
  NL_DIR="$BOT_DIR/NodeLink"
elif [ -d "$BOT_DIR/../NodeLink" ]; then
  NL_DIR="$(cd "$BOT_DIR/../NodeLink" && pwd)"
else
  NL_DIR="$BOT_DIR/NodeLink"
fi

# Read host/port from .env if present, defaulting to 127.0.0.1:2333
NL_HOST="127.0.0.1"
NL_PORT="2333"
if [ -f "$BOT_DIR/.env" ]; then
  ENV_URL="$(grep -E '^NODELINK_URL=' "$BOT_DIR/.env" | tail -n 1 | cut -d '=' -f 2- | tr -d '[:space:]\r"'\''')"
  ENV_URL="${ENV_URL#http://}"
  ENV_URL="${ENV_URL#https://}"
  ENV_URL="${ENV_URL#ws://}"
  ENV_URL="${ENV_URL#wss://}"
  ENV_URL="${ENV_URL%%/*}"
  if [ -n "$ENV_URL" ]; then
    NL_HOST="${ENV_URL%%:*}"
    if [[ "$ENV_URL" == *:* ]]; then
      NL_PORT="${ENV_URL##*:}"
    fi
  fi
fi

STOPPING=0
NL_SUPERVISOR_PID=""
BOT_SUPERVISOR_PID=""

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

prefix_stream() {
  local prefix="$1"
  while IFS= read -r line; do
    printf '%s %s\n' "$prefix" "$line"
  done
}

wait_for_nodelink() {
  local host="$1"
  local port="$2"
  local attempts=0
  local max_attempts=60

  echo "[VanillaSound] [$(timestamp)] Waiting for NodeLink on ${host}:${port}..."
  while [ "$STOPPING" -eq 0 ] && [ "$attempts" -lt "$max_attempts" ]; do
    if node -e "
      const net = require('node:net');
      const s = net.connect({ host: '${host}', port: ${port} });
      s.setTimeout(1000);
      s.on('connect', () => { s.destroy(); process.exit(0); });
      s.on('error', () => process.exit(1));
      s.on('timeout', () => { s.destroy(); process.exit(1); });
    " 2>/dev/null; then
      echo "[VanillaSound] [$(timestamp)] NodeLink is accepting connections on ${host}:${port}."
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  echo "[VanillaSound] [$(timestamp)] Timed out waiting for NodeLink on ${host}:${port}; starting bot anyway."
  return 0
}

run_nodelink_supervisor() {
  local backoff=3
  local max_backoff=30
  local stable_reset_seconds=300
  local child_pid=""

  trap 'STOPPING=1; if [ -n "$child_pid" ]; then kill -TERM "$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; fi; exit 0' SIGTERM SIGINT

  if [ ! -d "$NL_DIR" ]; then
    echo "[VanillaSound] [$(timestamp)] NodeLink directory not found at $NL_DIR."
    exit 1
  fi

  while [ "$STOPPING" -eq 0 ]; do
    local start_ts
    start_ts="$(date +%s)"
    echo "[VanillaSound] [$(timestamp)] Starting NodeLink from $NL_DIR..."

    (
      cd "$NL_DIR" || exit 1
      if [ -f "dist/src/index.js" ]; then
        exec node --max-old-space-size=512 --dns-result-order=ipv4first dist/src/index.js
      elif [ -f "src/index.ts" ]; then
        exec node --max-old-space-size=512 --dns-result-order=ipv4first --experimental-strip-types src/index.ts
      elif [ -f "src/connection/index.js" ]; then
        exec node --max-old-space-size=512 --dns-result-order=ipv4first src/connection/index.js
      else
        echo "[VanillaSound] NodeLink entrypoint not found in $NL_DIR." >&2
        exit 1
      fi
    ) > >(prefix_stream "[VanillaSound/NodeLink]") 2>&1 &

    child_pid=$!
    wait "$child_pid"
    local exit_code=$?
    child_pid=""

    if [ "$STOPPING" -eq 1 ]; then
      break
    fi

    local end_ts elapsed
    end_ts="$(date +%s)"
    elapsed=$((end_ts - start_ts))
    if [ "$elapsed" -ge "$stable_reset_seconds" ]; then
      backoff=3
    fi

    echo "[VanillaSound] [$(timestamp)] NodeLink exited with code ${exit_code} after ${elapsed}s. Restarting in ${backoff}s..."
    sleep "$backoff"
    backoff=$((backoff * 2))
    if [ "$backoff" -gt "$max_backoff" ]; then
      backoff="$max_backoff"
    fi
  done
}

run_bot_supervisor() {
  local backoff=3
  local max_backoff=30
  local stable_reset_seconds=300
  local child_pid=""

  trap 'STOPPING=1; if [ -n "$child_pid" ]; then kill -TERM "$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; fi; exit 0' SIGTERM SIGINT

  while [ "$STOPPING" -eq 0 ]; do
    local start_ts
    start_ts="$(date +%s)"
    echo "[VanillaSound] [$(timestamp)] Starting VanillaSound bot..."

    (
      cd "$BOT_DIR" || exit 1
      exec node --max-old-space-size=384 index.js
    ) &

    child_pid=$!
    wait "$child_pid"
    local exit_code=$?
    child_pid=""

    if [ "$STOPPING" -eq 1 ]; then
      break
    fi

    local end_ts elapsed
    end_ts="$(date +%s)"
    elapsed=$((end_ts - start_ts))
    if [ "$elapsed" -ge "$stable_reset_seconds" ]; then
      backoff=3
    fi

    echo "[VanillaSound] [$(timestamp)] Bot exited with code ${exit_code} after ${elapsed}s. Restarting in ${backoff}s..."
    sleep "$backoff"
    backoff=$((backoff * 2))
    if [ "$backoff" -gt "$max_backoff" ]; then
      backoff="$max_backoff"
    fi
  done
}

cleanup() {
  if [ "$STOPPING" -eq 1 ]; then
    return
  fi
  STOPPING=1
  echo "[VanillaSound] [$(timestamp)] Shutdown signal received. Stopping processes..."

  if [ -n "$BOT_SUPERVISOR_PID" ]; then
    kill -TERM "$BOT_SUPERVISOR_PID" 2>/dev/null || true
  fi
  if [ -n "$NL_SUPERVISOR_PID" ]; then
    kill -TERM "$NL_SUPERVISOR_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit 0
}

trap cleanup SIGTERM SIGINT

run_nodelink_supervisor &
NL_SUPERVISOR_PID=$!

wait_for_nodelink "$NL_HOST" "$NL_PORT"

run_bot_supervisor &
BOT_SUPERVISOR_PID=$!

wait "$NL_SUPERVISOR_PID" "$BOT_SUPERVISOR_PID"
