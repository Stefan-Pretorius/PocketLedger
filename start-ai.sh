#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PASSWORD_FILE=".ai-password"
PASSWORD="${OPENCODE_SERVER_PASSWORD:-}"

if [ -z "$PASSWORD" ] && [ -f "$PASSWORD_FILE" ]; then
  PASSWORD="$(cat "$PASSWORD_FILE")"
fi

if [ -z "$PASSWORD" ]; then
  if command -v openssl >/dev/null 2>&1; then
    PASSWORD="$(openssl rand -hex 16)"
  else
    PASSWORD="$(date +%s%N | sha256sum | cut -c1-32)"
  fi
  echo "$PASSWORD" > "$PASSWORD_FILE"
  chmod 600 "$PASSWORD_FILE"
  echo "Generated a new AI server password (saved to $PASSWORD_FILE):"
  echo
  echo "    $PASSWORD"
  echo
  echo "Paste it once into Settings → AI Statement Matching → Password."
  echo
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

CORS_ARGS=(
  --cors "http://localhost:5173"
  --cors "http://localhost:4173"
)
if [ -n "$LAN_IP" ]; then
  CORS_ARGS+=(
    --cors "http://$LAN_IP:5173"
    --cors "http://$LAN_IP:4173"
  )
  echo "Reachable on your network at http://$LAN_IP:4096 (app on the LAN uses this automatically)."
fi

echo "Starting opencode AI server on port 4096... (Ctrl+C to stop)"
OPENCODE_SERVER_PASSWORD="$PASSWORD" npx opencode-ai serve \
  --hostname 0.0.0.0 \
  --port 4096 \
  "${CORS_ARGS[@]}"
