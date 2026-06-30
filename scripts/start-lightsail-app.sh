#!/usr/bin/env bash
set -euo pipefail

api_pid=""
web_pid=""

shutdown() {
    if [ -n "$api_pid" ]; then
        kill "$api_pid" 2>/dev/null || true
    fi
    if [ -n "$web_pid" ]; then
        kill "$web_pid" 2>/dev/null || true
    fi
    wait
}

trap shutdown INT TERM

PORT="${API_PORT:-3000}" node -r dotenv/config apps/api/build/index.js &
api_pid="$!"

pnpm --dir apps/web start -p "${WEB_PORT:-3001}" &
web_pid="$!"

wait -n "$api_pid" "$web_pid"
shutdown
