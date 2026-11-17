#!/usr/bin/env bash
# ==============================================================================
# OPCMS PostgreSQL Checksum-Verified Restore Script
# Usage: restore-db.sh /var/backups/opcms/db/opcms_db_YYYYMMDDTHHMMSSZ.dump
# ==============================================================================
set -euo pipefail

DUMP_FILE="${1:-}"
if [ -z "${DUMP_FILE}" ] || [ ! -f "${DUMP_FILE}" ]; then
  echo "Usage: $0 <path-to-backup.dump>"
  exit 1
fi

APP_DIR="${OPCMS_APP_DIR:-/opt/ohb-polio-command}"
if [ -f "${APP_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${APP_DIR}/.env"
  set +a
fi

if [ -f "${DUMP_FILE}.sha256" ]; then
  echo "[1/4] Verifying SHA-256 checksum..."
  (cd "$(dirname "${DUMP_FILE}")" && sha256sum -c "$(basename "${DUMP_FILE}.sha256")")
else
  echo "ERROR: Missing ${DUMP_FILE}.sha256 verification file. Aborting restore."
  exit 1
fi

PG_HOST="${POSTGRES_HOST:-127.0.0.1}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_DB="${POSTGRES_DB:-opcms_db}"
PG_USER="${POSTGRES_USER:-opcms_user}"

echo "[2/4] Taking mandatory pre-restore safety backup..."
bash "$(dirname "${BASH_SOURCE[0]}")/backup-db.sh"

echo "[3/4] Stopping OPCMS services before restore..."
systemctl stop opcms-frontend.service opcms-backend.service || true

echo "[4/4] Restoring ${DUMP_FILE} into ${PG_DB}..."
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_restore \
  -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
  --clean --if-exists --no-owner "${DUMP_FILE}"

systemctl start opcms-backend.service opcms-frontend.service
echo "Restore verified and services restarted cleanly."
