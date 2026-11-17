#!/usr/bin/env bash
# ==============================================================================
# OPCMS Pre-Flight Server Inspection Script (READ-ONLY / NON-DESTRUCTIVE)
# Target Host: odmcserver (Ubuntu 24 LTS)
# Purpose: Inspect resources, ports, existing services (ODMC/DSpace, IRB,
#          Visitor Portal), PostgreSQL, Nginx/Apache, DNS, and TLS before deploy.
# ==============================================================================
set -euo pipefail

DOMAIN="${PUBLIC_DOMAIN:-polio.orhb.gov.et}"
FRONTEND_PORT="${OPCMS_FRONTEND_PORT:-3100}"
BACKEND_PORT="${OPCMS_BACKEND_PORT:-8100}"
APP_DIR="${OPCMS_APP_DIR:-/opt/ohb-polio-command}"

echo "========================================================================"
echo "OHB OPCMS Pre-Flight Inspection (Read-Only) — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================================"

echo ""
echo "[1/7] Operating System, Kernel, CPU, RAM & Disk"
cat /etc/os-release | grep -E '^(PRETTY_NAME|VERSION_ID)=' || true
uname -a
nproc --all 2>/dev/null || true
free -h
df -h / /opt /var 2>/dev/null || df -h /

echo ""
echo "[2/7] Proposed Ports Conflict Check (${FRONTEND_PORT}, ${BACKEND_PORT}, 5432, 80, 443)"
if command -v ss >/dev/null 2>&1; then
  ss -tulpn | grep -E ":(80|443|5432|${FRONTEND_PORT}|${BACKEND_PORT})\b" || echo "Ports ${FRONTEND_PORT} and ${BACKEND_PORT} are currently FREE."
else
  netstat -tulpn 2>/dev/null | grep -E ":(80|443|5432|${FRONTEND_PORT}|${BACKEND_PORT})\b" || true
fi

echo ""
echo "[3/7] Existing Services & Co-Hosted Portals Check (ODMC/DSpace, IRB, Visitor Portal)"
systemctl list-units --type=service --state=running | grep -iE 'nginx|apache|httpd|postgres|dspace|tomcat|solr|irb|visitor|pm2|docker|node|uvicorn|gunicorn|opcms' || true

echo ""
echo "[4/7] Reverse Proxy Sites Inspection"
if [ -d /etc/nginx/sites-enabled ]; then
  echo "-- Nginx enabled sites --"
  ls -la /etc/nginx/sites-enabled/
fi
if [ -d /etc/apache2/sites-enabled ]; then
  echo "-- Apache2 enabled sites --"
  ls -la /etc/apache2/sites-enabled/
fi

echo ""
echo "[5/7] PostgreSQL Connectivity & Existing Databases/Roles"
if command -v psql >/dev/null 2>&1; then
  psql --version
  if sudo -u postgres psql -c "\l" >/dev/null 2>&1; then
    sudo -u postgres psql -c "SELECT datname FROM pg_database WHERE datistemplate = false;"
  else
    echo "Postgres CLI present; run as root/postgres user to list databases."
  fi
else
  echo "PostgreSQL client (psql) not installed."
fi

echo ""
echo "[6/7] Runtime Tooling Versions (Node.js, Python, Certbot)"
node -v 2>/dev/null || echo "Node.js: missing"
npm -v 2>/dev/null || echo "npm: missing"
python3 --version 2>/dev/null || echo "Python3: missing"
certbot --version 2>/dev/null || echo "Certbot: missing"

echo ""
echo "[7/7] DNS & Target Directory Check (${DOMAIN}, ${APP_DIR})"
getent hosts "${DOMAIN}" || echo "DNS lookup for ${DOMAIN} not yet resolving on this host."
[ -d "${APP_DIR}" ] && echo "Target directory ${APP_DIR} already exists." || echo "Target directory ${APP_DIR} does not exist yet (ready to create)."

echo ""
echo "Pre-flight inspection finished without modifying any files or services."
