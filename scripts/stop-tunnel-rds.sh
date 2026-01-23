#!/usr/bin/env bash

# stop-tunnel-rds.sh
# Stops the SSH tunnel created by start-tunnel-rds.sh
#
# Usage:
#   ./scripts/stop-tunnel-rds.sh
#   LOCAL_PORT=3308 ./scripts/stop-tunnel-rds.sh
#
# Environment Variables:
#   LOCAL_PORT - Local port the tunnel is bound to (default: 3307)

set -euo pipefail

LOCAL_PORT="${LOCAL_PORT:-3307}"

echo "🛑 Stopping SSH tunnel on local port $LOCAL_PORT..."

PID=$(lsof -ti :$LOCAL_PORT 2>/dev/null || true)

if [[ -n "$PID" ]]; then
  echo "   Killing PID(s): $PID"
  kill $PID 2>/dev/null || true
  sleep 1
  
  if ! lsof -Pi :$LOCAL_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "✅ Tunnel stopped successfully"
  else
    echo "⚠️  Port $LOCAL_PORT still in use - may need manual cleanup"
    echo "   Try: kill -9 \$(lsof -ti :$LOCAL_PORT)"
  fi
else
  echo "ℹ️  No process found listening on port $LOCAL_PORT"
fi
