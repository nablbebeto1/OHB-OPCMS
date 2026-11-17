#!/usr/bin/env bash
# ==============================================================================
# OPCMS Safe Rollback Script
# Restores most recent archived release from /var/backups/opcms or stops OPCMS
# without touching any co-hosted ODMC/DSpace, IRB, or Visitor Portal services.
# ==============================================================================
set -euo pipefail

APP_DIR="${OPCMS_APP_DIR:-/opt/ohb-polio-command}"
BACKUP_DIR="/var/backups/opcms"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Run rollback.sh with sudo or as root."
  exit 1
fi

LATEST_ARCHIVE="$(ls -1t "${BACKUP_DIR}"/release_*.tar.gz 2>/dev/null | head -n 1 || true)"

systemctl stop opcms-frontend.service opcms-backend.service || true

if [ -n "${LATEST_ARCHIVE}" ]; then
  echo "Restoring previous release from ${LATEST_ARCHIVE}..."
  rm -rf "${APP_DIR}/current"
  tar -xzf "${LATEST_ARCHIVE}" -C "${APP_DIR}"
  chown -R opcms:opcms "${APP_DIR}"
  systemctl start opcms-backend.service opcms-frontend.service
  echo "Previous release restored and started."
else
  echo "No prior release archive found in ${BACKUP_DIR}. OPCMS services stopped safely."
fi
