# OPCMS Backup & Restoration Guide

OHB Polio Campaign Management System supports two complementary layers of checksum-verified backup and recovery:
1. **In-App Application Snapshot Backup/Restore** (Regional System Admin UI + `/api/v1/admin/backup` & `/api/v1/admin/restore`)
2. **Production PostgreSQL CLI Backup/Restore** (`/deploy/scripts/backup-db.sh` & `/deploy/scripts/restore-db.sh` on `odmcserver`)

---

## 1. In-App Verified JSON Snapshot (UI & API)

### Creating a Backup
1. Sign in as **Regional System Administrator** (`REGIONAL_SYSTEM_ADMIN`).
2. Navigate to **11. Roles & Audit Logs** → **Database Backup & Checksum-Verified Restoration**.
3. Click **Download JSON Backup** (calls `GET /api/v1/admin/backup`).
4. The server computes a canonical `SHA-256` digest across all collections (`zones`, `woredas`, `campaigns`, `reports`, `security_settlements`, `security_reports`, `alerts`, `calculation_configs`, `audit_logs`, etc.), records an `EXPORT_DATABASE_BACKUP` audit entry, and downloads `opcms_backup_YYYY-MM-DD.json`.

### Restoring from a Backup
1. Click **Restore Verified Backup** and select a saved `opcms_backup_*.json` file.
2. The server verifies `app === "OPCMS"` and recomputes `SHA-256(data)`. Any tampered or corrupted file is rejected with `HTTP 400`.
3. Before modifying active state, the server automatically writes a **pre-restore safety snapshot** (`.opcms-pre-restore-<timestamp>.json`).
4. Data is restored, `evaluateCampaignAlerts()` runs to refresh alert state, `RESTORE_DATABASE_BACKUP` is logged in the audit trail, and connected Command Room / Dashboard clients receive an SSE refresh event.

---

## 2. Production PostgreSQL Backup & Restore (`odmcserver`)

### Automated Daily Cron Setup
```bash
sudo crontab -e
# Run daily at 02:00 EAT (23:00 UTC)
0 23 * * * /opt/ohb-polio-command/current/deploy/scripts/backup-db.sh >> /var/log/opcms-backup.log 2>&1
```

### Manual Backup Verification
```bash
sudo /opt/ohb-polio-command/current/deploy/scripts/backup-db.sh
ls -lh /var/backups/opcms/db/
sha256sum -c /var/backups/opcms/db/opcms_db_*.dump.sha256
```

### Verified Restoration Drill
```bash
sudo /opt/ohb-polio-command/current/deploy/scripts/restore-db.sh \
  /var/backups/opcms/db/opcms_db_20261120T020000Z.dump
```
`restore-db.sh` automatically verifies the `.sha256` checksum, captures a mandatory pre-restore safety dump, pauses `opcms-frontend` and `opcms-backend`, restores with `pg_restore --clean --if-exists --no-owner`, and restarts services cleanly.
