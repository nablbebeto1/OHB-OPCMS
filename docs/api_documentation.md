# OHB Polio Campaign Management System (OPCMS) — API Documentation

**Base URL:** `/api/v1`  
**Authentication:** Bearer JWT (`Authorization: Bearer <token>`) or Read-Only Command Room Display Token (`?display_token=<token>` / `X-Display-Token`)  
**Security Headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`  
**Zero Child PII Policy:** Requests containing child PII keys (`child_name`, `mother_name`, `phone_number`, `national_id`, etc.) are rejected with `HTTP 422`.

---

## 1. Health & Real-Time Streaming

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Public | Service health, Zone count (28), and Woreda count (261). |
| `GET` | `/api/v1/events/stream?token=<jwt>` | JWT | Scoped Server-Sent Events (SSE) stream (`connected`, `heartbeat`, `report:received`, `report:workflow`, `alert:updated`, `gis:updated`). |

---

## 2. Authentication, RBAC & Users

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Public (Rate-limited) | Authenticates user via scrypt hash and returns JWT access token + `UserProfile`. |
| `GET` | `/api/v1/auth/me` | Authenticated | Returns current user profile & administrative scope. |
| `GET` | `/api/v1/roles` | Authenticated | Lists the 5 RBAC role definitions and permissions. |
| `GET` | `/api/v1/users` | Admin, Coordination | Lists registered system accounts. |
| `POST` | `/api/v1/users` | Regional System Admin | Creates a new scoped user account. |
| `PATCH` | `/api/v1/users/:id` | Regional System Admin | Activates/suspends a user or updates role assignment. |

---

## 3. Administrative Hierarchy & Campaign Configuration

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/hierarchy/overview` | Authenticated | Returns Region, scoped Zones (up to 28), and scoped Woredas (up to 261). |
| `POST` | `/api/v1/hierarchy/zones` | Regional System Admin | Adds a new Zone/Town/City. |
| `POST` | `/api/v1/hierarchy/woredas` | Regional System Admin | Adds a new Woreda with planned & computed daily targets. |
| `GET` | `/api/v1/campaigns` | Authenticated | Lists campaigns and Day 1–Day 6 schedule (`Core` vs `Mop-Up`). |
| `PATCH` | `/api/v1/campaigns/:id` | Admin, Coordination | Updates campaign status and default doses per vial. |
| `PATCH` | `/api/v1/campaigns/:id/days/:dayId` | Admin, Coordination | Opens or closes a Campaign Day for reporting. |

---

## 4. Versioned Calculation Rules

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/calculation-configs` | Authenticated | Lists all formula profiles (`Approved`, `Pending Approval`, `Superseded`). |
| `POST` | `/api/v1/calculation-configs` | Admin, Coordination | Proposes a new formula profile (divisor `4` or `6`, doses/vial, wastage denominator mode). |
| `POST` | `/api/v1/calculation-configs/:id/approve` | Admin, Coordination | Activates the approved formula profile across all dashboards and validations. |

---

## 5. Daily Reporting, Offline Sync & Approval Workflow

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/reports` | Authenticated | Returns daily reports filtered to caller's administrative scope. |
| `POST` | `/api/v1/reports` | Admin, Woreda Officer | Upserts/submits daily report. Enforces idempotency via `client_report_id` and conflict detection (`HTTP 409`) via `base_version` / `base_updated_at` or locked `Approved` state. |
| `POST` | `/api/v1/reports/:id/submit` | Admin, Woreda Officer | Transitions `Draft` or `Returned for Correction` → `Submitted`. |
| `POST` | `/api/v1/reports/:id/review` | Admin, Coord, Zone Admin | Transitions `Submitted` → `Under Review`. |
| `POST` | `/api/v1/reports/:id/approve` | Admin, Coord, Zone Admin | Transitions `Submitted`/`Under Review` → `Approved` and **locks** the report. |
| `POST` | `/api/v1/reports/:id/return` | Admin, Coord, Zone Admin | Returns report with mandatory `comment` for correction. |
| `POST` | `/api/v1/reports/:id/reopen` | Regional System Admin | Reopens locked `Approved` report with mandatory administrative justification and increments `version`. |

---

## 6. Excel Workbook Import & Formula Audit

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/workbook-audit/discrepancies` | Authenticated | Returns documented Excel template formula discrepancies (e.g., Day1 `F266`). |
| `POST` | `/api/v1/workbook-audit/discrepancies/:id/resolve` | Admin, Coordination | Records OHB resolution status (`Approved Correction`, `Keep As-Is`, etc.). |
| `GET` | `/api/v1/imports/history` | Authenticated | Returns import audit trail. |
| `POST` | `/api/v1/imports/preview` | Admin, Coordination | Validates parsed workbook rows, detects duplicates/negatives, preserves raw names, and flags `Approved` protected records. |
| `POST` | `/api/v1/imports/commit` | Admin, Coordination | Commits valid/warning rows while never overwriting `Approved` reports. |

---

## 7. Security-Affected Settlements (Isolated Dataset)

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/security-settlements` | Authenticated | Lists scoped settlements excluded from regular Woreda targets. |
| `POST` | `/api/v1/security-settlements` | Admin, Coord, Zone Admin | Registers a new settlement. |
| `GET` | `/api/v1/security-reports` | Authenticated | Lists settlement daily reports. |
| `POST` | `/api/v1/security-reports` | Admin, Coord, Zone, Woreda | Records settlement vaccination metrics independently of Woreda totals. |

---

## 8. GIS Layers, Thresholds, Alerts & External Dispatch

| Method | Endpoint | Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` / `PATCH` | `/api/v1/monitoring-thresholds` | Read: Auth / Write: Admin, Coord | Configures coverage, completeness, wastage, and late-hour thresholds (`null` until explicitly set). |
| `GET` / `POST` / `DELETE` | `/api/v1/gis/layers` | Read: Auth / Write: Admin, Coord | Manages uploaded authentic GeoJSON `FeatureCollection` boundary layers. |
| `GET` | `/api/v1/alerts` | Authenticated | Lists automated campaign alerts across 11 trigger types. |
| `POST` | `/api/v1/alerts/scan` | Admin, Coord, Zone Admin | Executes an immediate campaign alert scan. |
| `POST` | `/api/v1/alerts/:id/acknowledge` | Admin, Coord, Zone, Woreda | Marks alert `Acknowledged`. |
| `POST` | `/api/v1/alerts/:id/resolve` | Admin, Coord, Zone Admin | Resolves alert with mandatory `resolution_notes`. |
| `GET` / `PATCH` / `POST` | `/api/v1/notifications/providers` | Read: Auth / Write: Admin | Configures and probes Email/SMS webhooks (`Not Configured` logged honestly until credentials are supplied). |

---

## 9. Command Room Large-Screen Display & Admin Backup/Restore

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/command-room/sessions` | Admin, Coordination | Lists issued read-only display URLs (`token_hash` never exposed). |
| `POST` | `/api/v1/command-room/sessions` | Admin, Coordination | Generates a revocable read-only `?display_token=...` URL (token shown once). |
| `POST` | `/api/v1/command-room/sessions/:id/revoke` | Admin, Coordination | Immediately revokes display token and disconnects active SSE streams (`revoked` event). |
| `GET` | `/api/v1/command-room/snapshot` | JWT or `display_token` | Returns strict read-only regional command snapshot across all 5 display layouts. |
| `GET` | `/api/v1/command-room/stream` | JWT or `display_token` | Read-only SSE telemetry stream for Command Room walls. |
| `GET` | `/api/v1/admin/backup` | Regional System Admin | Exports full database snapshot with SHA-256 checksum verification (`opcms_backup_YYYY-MM-DD.json`). |
| `POST` | `/api/v1/admin/restore` | Regional System Admin | Verifies SHA-256 checksum, creates a pre-restore safety snapshot, restores DB state, and re-evaluates alerts. |
