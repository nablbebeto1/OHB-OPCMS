# OHB Polio Campaign Management System (OPCMS) — User & Administrator Manual

**Organization:** Oromia Health Bureau (OHB)  
**Campaign:** 2026 Round 1 nOPV2 and bOPV Co-administration Campaign (Day 1–Day 6)

---

## 1. User Roles & Scopes

OPCMS enforces strict Role-Based Access Control (RBAC) across 5 roles:

1. **Regional System Administrator (`REGIONAL_SYSTEM_ADMIN`)**: Full Oromia oversight, user provisioning, Zone/Woreda registration, formula configuration approval, reopening locked reports, Command Room display token governance, and SHA-256 database backup/restore.
2. **Regional Coordination Team (`REGIONAL_COORDINATION_TEAM`)**: Regional command oversight, workbook import/discrepancy resolution, report review/approval, threshold & GIS management, and Command Room display token governance.
3. **Zone Administrator (`ZONE_ADMIN`)**: Scoped strictly to one Zone. Reviews, approves, or returns Woreda reports; manages Zone alerts and security settlements.
4. **Woreda Reporting Officer (`WOREDA_REPORTING_OFFICER`)**: Scoped strictly to one Woreda. Enters daily vaccination reports (online or offline PWA), submits reports for review, and corrects returned reports.
5. **Monitoring Officer (`MONITORING_OFFICER`)**: Read-only access to dashboards, GIS maps, audit logs, and reporting exports.

> **Security & Privacy Rule:** OPCMS collects **zero child PII** (no child names, mother names, phone numbers, or national IDs). Any API payload containing PII fields is automatically rejected.

---

## 2. Field Officer Guide (Daily Reporting & Offline PWA)

1. Open **04. Daily Reporting** and choose the Campaign Day (`Day 1`–`Day 6`) and Woreda.
2. Enter:
   - **Vaccination Performance** (`0–11m`, `12–59m`, `60–120m` split into *Vaccinated Before* and *Not Vaccinated Before*)
   - **Vaccine Utilization** for both **nOPV2** and **bOPV** (Received, Used, Partial, Returned Good, Broken, Stage 3/4 Bad, Lost)
   - **Surveillance** (AFP & AEFI alerts), **Social Mobilization** (HHs visited, community meetings, home-to-home IPC), **Zero-Dose** & **Under-Vaccinated** cascades (*Identified → Linked → Vaccinated*), and **Team Deployment**.
3. **Offline Operation**:
   - Install OPCMS as a PWA (`Install OPCMS App`) when served over HTTPS or localhost.
   - Without internet, click **Save Local Draft** (*Saved locally*) or **Queue Offline Submission** (*Waiting for synchronization*).
   - Locally saved reports remain strictly marked as **not yet received by server** until connectivity returns and the automatic sync worker receives server acknowledgement (`LIVE`).
   - If a report was modified on the server while offline (`409 Conflict`), resolve the conflict before re-submitting.

---

## 3. Supervisor Workflow (Zone & Region)

- **Submitted → Under Review → Approved (Locked)**: Once approved, Woreda officers and Excel imports cannot overwrite the report.
- **Return for Correction**: Supervisors must provide a mandatory comment explaining corrections needed.
- **Reopen Approved Report**: Only Regional System Administrators can unlock an approved report, with mandatory audit justification.

---

## 4. Large-Screen Command Room (`COMMAND ROOM – LARGE SCREEN MONITORING`)

Designed for 16:9 EOC video walls, 55–85 inch TVs, LED walls, and projectors (`1920×1080` and `3840×2160`):

- **5 Rotating Layouts (30-second default interval):**
  1. **Regional Overview**: Overall coverage, total vaccinated, planned target, completeness, Oromia map, Zone performance, latest activity.
  2. **Vaccination Performance**: Day 1–Day 6 trend & cumulative coverage, VB vs NV age-group cohorts, Top & Lowest Woreda rankings.
  3. **Vaccine Management**: nOPV2 & bOPV vial reconciliation, wastage rates (`N/A` when denominator is zero), wastage alerts, active formula profile.
  4. **Surveillance & Security**: AFP/AEFI alerts, isolated security settlements & reporting gaps, zero-dose & under-vaccinated cascades.
  5. **Reporting Compliance**: Completeness %, expected vs received vs approved vs missing/late reports, Zone leaderboard.
- **Keyboard Shortcuts:** `F` Fullscreen · `Space` Pause/Resume · `1–5` Select Layout · `R` Refresh · `Esc` Exit.
- **Read-Only Display Kiosk URLs:** Authorized Regional Administrators or Coordination Team members can click **Display URLs** to issue an expiring, revocable `?display_token=...` URL for public Command Center screens without exposing user accounts or write controls.
