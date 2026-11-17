#!/usr/bin/env bash
# ==============================================================================
# OPCMS Additive Production Deployment Script for odmcserver (Ubuntu 24 LTS)
# - Runs non-destructively inside /opt/ohb-polio-command
# - Never removes or alters existing ODMC/DSpace, IRB, or Visitor Portal vhosts
# - Binds application services strictly to 127.0.0.1:3100 and 127.0.0.1:8100
# ==============================================================================
set -euo pipefail

APP_DIR="${OPCMS_APP_DIR:-/opt/ohb-polio-command}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="/var/backups/opcms"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Run deploy.sh with sudo or as root."
  exit 1
fi

echo "[1/7] Creating application & backup directories..."
mkdir -p "${APP_DIR}" "${BACKUP_DIR}"
id -u opcms >/dev/null 2>&1 || useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin opcms

if [ -d "${APP_DIR}/current" ]; then
  echo "[2/7] Archiving previous release for instant rollback..."
  tar -czf "${BACKUP_DIR}/release_${TIMESTAMP}.tar.gz" -C "${APP_DIR}" current
fi

echo "[3/7] Syncing application files into ${APP_DIR}/current..."
mkdir -p "${APP_DIR}/current"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'backend/.venv' \
  --exclude '.env' \
  --exclude '.opcms-runtime-db.json' \
  "${SRC_DIR}/" "${APP_DIR}/current/"

if [ ! -f "${APP_DIR}/.env" ]; then
  cp "${APP_DIR}/current/.env.example" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  echo "NOTICE: Created ${APP_DIR}/.env from template. Update secrets before going live!"
fi

echo "[4/7] Building frontend bundle (npm ci && npm run build)..."
cd "${APP_DIR}/current"
npm ci --no-audit --no-fund
npm run build

echo "[5/7] Setting up Python FastAPI virtual environment & Alembic migrations..."
if [ ! -d "${APP_DIR}/venv" ]; then
  python3 -m venv "${APP_DIR}/venv"
fi
"${APP_DIR}/venv/bin/pip" install --upgrade pip >/dev/null
"${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/current/backend/requirements.txt"

set -a
# shellcheck disable=SC1090
source "${APP_DIR}/.env"
set +a

cd "${APP_DIR}/current/backend"
"${APP_DIR}/venv/bin/alembic" upgrade head

echo "[6/7] Installing systemd units (127.0.0.1 localhost bindings)..."
chown -R opcms:opcms "${APP_DIR}"
cp "${APP_DIR}/current/deploy/systemd/opcms-backend.service" /etc/systemd/system/opcms-backend.service
cp "${APP_DIR}/current/deploy/systemd/opcms-frontend.service" /etc/systemd/system/opcms-frontend.service
systemctl daemon-reload
systemctl enable opcms-backend.service opcms-frontend.service
systemctl restart opcms-backend.service opcms-frontend.service

echo "[7/7] Checking reverse proxy additive configuration..."
if systemctl is-active --quiet nginx && [ ! -f /etc/nginx/sites-available/polio.orhb.gov.et.conf ]; then
  cp "${APP_DIR}/current/deploy/nginx/polio.orhb.gov.et.conf" /etc/nginx/sites-available/polio.orhb.gov.et.conf
  ln -sf /etc/nginx/sites-available/polio.orhb.gov.et.conf /etc/nginx/sites-enabled/polio.orhb.gov.et.conf
  nginx -t && systemctl reload nginx
elif systemctl is-active --quiet apache2 && [ ! -f /etc/apache2/sites-available/polio.orhb.gov.et.conf ]; then
  cp "${APP_DIR}/current/deploy/apache/polio.orhb.gov.et.conf" /etc/apache2/sites-available/polio.orhb.gov.et.conf
  a2enmod proxy proxy_http headers rewrite ssl >/dev/null
  a2ensite polio.orhb.gov.et.conf
  apache2ctl configtest && systemctl reload apache2
else
  echo "INFO: Review reverse proxy vhost in ${APP_DIR}/current/deploy/{nginx,apache}/ before enabling TLS."
fi

bash "${APP_DIR}/current/deploy/scripts/healthcheck.sh"
echo "Deployment complete."
