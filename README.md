# OHB Polio Campaign Management System (OPCMS)

**Organization:** Oromia Health Bureau (OHB)  
**Campaign:** 2026 Round 1 nOPV2 and bOPV Co-administration Campaign  

OPCMS is an independent, offline-capable, role-based public health campaign management platform built for regional, zonal, and woreda-level monitoring, daily reporting workflow governance, vaccine utilization tracking, and data quality control across Oromia Region.

---

## Architecture & Project Structure

- **`/src`** — React 19, TypeScript, Vite, Tailwind CSS, Recharts, Leaflet, IndexedDB (`idb`), and `vite-plugin-pwa` Service Worker.
- **`/backend`** — Python FastAPI, SQLAlchemy 2.0, Alembic migrations, and PostgreSQL normalized schema (24 tables covering RBAC, Oromia hierarchy, campaigns, daily reporting, workflow history, notifications, audit logs, and Excel/CSV discrepancy auditing).
- **`server.ts`** — Integrated Node/Express preview runtime serving the Vite SPA and `/api/v1/*` API seeded directly from the OHB Day 1 CSV template for single-port preview (`:3000`).
- **`/docs/workbook_audit_report.md`** — Formal inspection and formula discrepancy audit of the OHB Excel/CSV reporting template.

---

## Quick Start: Preview Runtime (Port 3000)

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Production / Local Setup: Python FastAPI + PostgreSQL + Alembic

### Option A: Docker Compose (Recommended)

```bash
cp .env.example .env
# Edit .env with strong POSTGRES_PASSWORD and JWT_SECRET_KEY
docker compose up --build -d
```

- FastAPI OpenAPI Docs: `http://localhost:8000/api/v1/docs`
- PostgreSQL: `localhost:5432`

### Option B: Manual Local Setup

1. **Create PostgreSQL database & user:**
   ```sql
   CREATE USER opcms_user WITH PASSWORD 'your_strong_password';
   CREATE DATABASE opcms_db OWNER opcms_user;
   ```
2. **Install Python dependencies & run Alembic migrations:**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   export DATABASE_URL="postgresql+psycopg2://opcms_user:your_strong_password@localhost:5432/opcms_db"
   alembic upgrade head
   ```
3. **Seed Oromia hierarchy (28 Zones, 261 Woredas), Roles, and 2026 Campaign from CSV:**
   ```bash
   python -m app.scripts.seed_from_csv
   ```
4. **Start FastAPI server:**
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
5. **Start Vite Frontend:**
   ```bash
   cd ..
   npm install
   npm run build
   npm run start
   ```

---

## Role-Based Demo Credentials

| Role | Username | Password | Scope |
| :--- | :--- | :--- | :--- |
| Regional System Administrator | `admin.ohb` | `OhbPolio@2026` | Full Oromia Region + System/User Admin |
| Regional Coordination Team | `coord.ohb` | `OhbPolio@2026` | Full Oromia Region + Review/Approve/Audit |
| Zone Administrator | `zone.eastshewa` | `OhbPolio@2026` | East Shewa Zone (13 Woredas) |
| Woreda Reporting Officer | `woreda.adama` | `OhbPolio@2026` | Adama Woreda (East Shewa) |
| Monitoring Officer (Read-Only) | `monitor.ohb` | `OhbPolio@2026` | Regional Read-Only Oversight |
