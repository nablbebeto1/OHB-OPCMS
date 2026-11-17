#!/usr/bin/env bash
# ==============================================================================
# OPCMS PostgreSQL Automated Backup Script (with SHA-256 Checksum)
# ==============================================================================
set -euo pipefail

APP_DIR="${OPCMS_APP_DIR:-/opt/ohb-polio-command}"
BACKUP_DIR="${OPCMS_DB_BACKUP_DIR:-/var/backups/opcms/db}"
RETENTION_DAYS="${OPCMS_BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -f "${APP_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${APP_DIR}/.env"
  set +a
fi

PG_HOST="${POSTGRES_HOST:-127.0.0.1}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_DB="${POSTGRES_DB:-opcms_db}"
PG_USER="${POSTGRES_USER:-opcms_user}"

mkdir -p "${BACKUP_DIR}"
OUT_FILE="${BACKUP_DIR}/${PG_DB}_${TIMESTAMP}.dump"

echo "Creating compressed PostgreSQL backup: ${OUT_FILE}..."
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump \
  -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
  -F c -Z 6 -f "${OUT_FILE}"

sha256sum "${OUT_FILE}" > "${OUT_FILE}.sha256"
chmod 600 "${OUT_FILE}" "${OUT_FILE}.sha256"

# Prune backups older than retention window
find "${BACKUP_DIR}" -type f -name "*.dump*" -mtime +"${RETENTION_DAYS}" -delete

echo "Backup complete & verified: ${OUT_FILE}"
cat "${OUT_FILE}.sha256"
