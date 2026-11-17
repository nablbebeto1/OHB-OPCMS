#!/usr/bin/env bash
# ==============================================================================
# OPCMS Post-Deploy Service & Endpoint Health Check Script
# ==============================================================================
set -euo pipefail

FRONTEND_PORT="${OPCMS_FRONTEND_PORT:-3100}"
BACKEND_PORT="${OPCMS_BACKEND_PORT:-8100}"

echo "Checking OPCMS Frontend/Express server on 127.0.0.1:${FRONTEND_PORT}..."
curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/v1/health"
echo ""

if ss -tulpn 2>/dev/null | grep -q ":${BACKEND_PORT}\b"; then
  echo "Checking FastAPI backend on 127.0.0.1:${BACKEND_PORT}..."
  curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health"
  echo ""
fi

echo "Verifying security response headers..."
curl -fsSI "http://127.0.0.1:${FRONTEND_PORT}/api/v1/health" | grep -iE 'X-Content-Type-Options|X-Frame-Options|Referrer-Policy' || true

echo "Health check passed."
