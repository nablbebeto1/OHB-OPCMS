# OPCMS Testing & Acceptance Report

**Application:** OHB Polio Campaign Management System (OPCMS)  
**Campaign:** 2026 Round 1 nOPV2 & bOPV Co-administration Campaign  
**Environment Tested:** Local AI Studio Build Runtime (`http://127.0.0.1:3000`)

---

## 1. Static Build, Type Checking & Syntax Verification

| Check | Command / Tool | Result |
| :--- | :--- | :--- |
| TypeScript & Vite Production Bundle | `compile_applet` (`npm run build`) | **PASSED** (`Build succeeded`) |
| TypeScript Strict Typecheck | `lint_applet` (`tsc --noEmit`) | **PASSED** (0 errors) |
| Python FastAPI & Alembic Syntax | `python3 -m py_compile` (`main.py`, `models`, `router.py`, `command_and_admin.py`, `0004_prompt4_command_display_sessions.py`) | **PASSED** (`SHELL_AND_PYTHON_SYNTAX_OK`) |
| Deployment Bash Scripts Syntax | `bash -n deploy/scripts/*.sh` (`preflight-inspect.sh`, `deploy.sh`, `rollback.sh`, `backup-db.sh`, `restore-db.sh`, `healthcheck.sh`) | **PASSED** (0 syntax errors) |

---

## 2. Live End-to-End Acceptance Tests (`16/16 PASSED`)

Executed directly against `http://127.0.0.1:3000/api/v1`:

| # | Test Area | Verified Outcome |
| :--- | :--- | :--- |
| 1 | Health & Security Headers | `woredas=261`, `zones=28`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` |
| 2a | 5-Role Authentication | All 5 RBAC roles (`admin.ohb`, `coord.ohb`, `zone.eastshewa`, `woreda.adama`, `monitor.ohb`) signed in cleanly |
| 2b | Read-Only Role Enforcement | `MONITORING_OFFICER` write attempt rejected with `HTTP 403` |
| 3 | Hierarchy Totals & Discrepancy Audit | Computed Planned Target = `7,580,915`, Daily Target = `1,895,263`; Day1 Template Cell `F266` (`33,537`) surfaced for OHB approval |
| 4 | Zero Child PII Policy | Payload containing `child_name` rejected with `HTTP 422` |
| 5a | Daily Report Submit & Idempotency | Created `rep-6059a76a` (`0–59m=600`); duplicate replay with same `client_report_id` returned `duplicate_prevented=true` |
| 5b | Zone Review & Approval Lock | Transitioned `Submitted → Under Review → Approved` (`is_locked=true`) |
| 6 | Excel Import Approved Protection | `/imports/preview` marked locked Woreda row `Protected (Approved)`; `/imports/commit` skipped overwrite (`rows_skipped_approved=1`) |
| 5c | Admin Reopen & Version Increment | `REGIONAL_SYSTEM_ADMIN` reopened approved report (`version=2`, unlocked) |
| 5d | Offline `409` Conflict Detection | Submitting stale `base_version=1` against `v2` server report returned `HTTP 409` (`conflict=true`) |
| 7 | Security Settlements, Thresholds, Alerts & GIS | `2` isolated security settlements, `thresholds_configured=false` by default, `268` automated alerts evaluated (including AFP alert), `Not Configured` external dispatch logs, GeoJSON upload/match (`1` matched) + delete |
| 8a | Regional Dashboard SSE Stream | `/api/v1/events/stream` returned `HTTP 200` and emitted `event: connected` |
| 8b | Command Room Display Token & 5-Layout Snapshot | Issued revocable display token (`disp-ed5d515e`); `/api/v1/command-room/snapshot` returned `read_only=true`, 261 Woredas, 6 daily progression slots, 3 age cohorts, and zero credential/hash leakage |
| 8c | Command Room SSE Stream | `/api/v1/command-room/stream?display_token=...` returned `HTTP 200` and `event: connected` |
| 8d | Immediate Display Token Revocation | Revoking session caused subsequent `/snapshot` request to fail immediately with `HTTP 401` |
| 9 | SHA-256 Database Backup & Restoration | `/api/v1/admin/backup` returned valid checksum (`bbfc24957580...`); tampered payload rejected (`HTTP 400`); valid backup restored cleanly with `pre_restore_snapshot_created=true` |

---

## 3. Target Server (`odmcserver`) Deployment Readiness Scope

- **Verified in Workspace:** All deployment automation (`deploy/scripts/*.sh`), systemd services (`127.0.0.1:3100`, `127.0.0.1:8100`), additive Nginx/Apache virtual hosts (`polio.orhb.gov.et`), and operational manuals (`/docs/*.md`).
- **Pending Operator Execution on `odmcserver`:** Live Ubuntu 24 LTS host pre-flight (`preflight-inspect.sh`), PostgreSQL database creation, `.env` secret population, `deploy.sh` execution, and Certbot HTTPS issuance cannot be executed from inside this isolated build container and must be run by the OHB infrastructure administrator directly on `odmcserver`.
