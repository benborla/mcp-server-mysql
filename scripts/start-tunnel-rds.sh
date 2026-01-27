#!/usr/bin/env bash

# start-tunnel-rds.sh
# Creates an SSH tunnel from LOCAL_PORT -> RDS_ENDPOINT:RDS_PORT via a bastion host
#
# Usage:
#   1. Set environment variables (or edit defaults below)
#   2. Run: ./scripts/start-tunnel-rds.sh
#
# Environment Variables:
#   LOCAL_PORT        - Local port to bind (default: 3307)
#   BASTION_USER      - SSH user for bastion (default: ec2-user)
#   BASTION_HOST      - Bastion/jump host IP or hostname (REQUIRED)
#   BASTION_PORT      - SSH port on bastion (default: 22)
#   RDS_ENDPOINT      - RDS instance endpoint (REQUIRED)
#   RDS_PORT          - RDS port (default: 3306)
#   SSH_KEY           - Path to SSH private key (default: ~/.ssh/id_rsa)

set -euo pipefail

# Configuration - Override via environment variables or edit defaults
LOCAL_PORT="${LOCAL_PORT:-3307}"
BASTION_USER="${BASTION_USER:-ec2-user}"
BASTION_HOST="${BASTION_HOST:-}"  # e.g. 54.12.34.56 or bastion.example.com
BASTION_PORT="${BASTION_PORT:-22}"
RDS_ENDPOINT="${RDS_ENDPOINT:-}"  # e.g. mydb.abc123.us-east-1.rds.amazonaws.com
RDS_PORT="${RDS_PORT:-3306}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"

# Validate required variables
if [[ -z "$BASTION_HOST" ]]; then
  echo "❌ Error: BASTION_HOST is required"
  echo "   Set via: export BASTION_HOST=your-bastion-ip"
  exit 1
fi

if [[ -z "$RDS_ENDPOINT" ]]; then
  echo "❌ Error: RDS_ENDPOINT is required"
  echo "   Set via: export RDS_ENDPOINT=your-db.region.rds.amazonaws.com"
  exit 1
fi

if [[ ! -f "$SSH_KEY" ]]; then
  echo "❌ Error: SSH key not found at $SSH_KEY"
  echo "   Set via: export SSH_KEY=/path/to/your/key.pem"
  exit 1
fi

BASTION_USER_HOST="${BASTION_USER}@${BASTION_HOST}"

echo "🔗 Starting SSH tunnel to RDS"
echo "   Local:   127.0.0.1:$LOCAL_PORT"
echo "   Bastion: $BASTION_USER_HOST:$BASTION_PORT"
echo "   RDS:     $RDS_ENDPOINT:$RDS_PORT"

# Check if port is already in use (tunnel probably running)
if lsof -Pi :$LOCAL_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "⚠️  Local port $LOCAL_PORT is already in use. Tunnel may already be running."
  exit 0
fi

# Create the SSH tunnel
ssh -i "$SSH_KEY" -f -N -L "$LOCAL_PORT:$RDS_ENDPOINT:$RDS_PORT" -p "$BASTION_PORT" "$BASTION_USER_HOST"

sleep 1

if lsof -Pi :$LOCAL_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "✅ SSH tunnel established!"
  echo ""
  echo "   Connection: 127.0.0.1:$LOCAL_PORT -> $RDS_ENDPOINT:$RDS_PORT"
  echo ""
  echo "   Set in your MCP config:"
  echo "     MYSQL_HOST=127.0.0.1"
  echo "     MYSQL_PORT=$LOCAL_PORT"
else
  echo "❌ Failed to create SSH tunnel"
  exit 1
fi
