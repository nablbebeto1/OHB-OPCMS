# OPCMS Server Deployment Guide — `odmcserver` (Ubuntu 24 LTS)

> **Important Status Disclosure:**  
> This guide and all scripts inside `/deploy/` were **authored and syntax-verified inside the build workspace**. They have **not** yet been executed against the live `odmcserver` host because direct SSH/network access to `odmcserver` is external to the build container. Operators must execute **Step 1 (Pre-Flight Inspection)** on `odmcserver` first before modifying anything.

---

## 1. Proposed Non-Conflicting Architecture for `odmcserver`

| Resource | Proposed Value | Co-Host Safety Guarantee |
| :--- | :--- | :--- |
| Installation Directory | `/opt/ohb-polio-command` | Isolated from ODMC/DSpace, IRB, and Visitor Portal directories |
| Frontend / BFF Service | `127.0.0.1:3100` (`opcms-frontend.service`) | Bound strictly to localhost; never exposed directly on `0.0.0.0` |
| FastAPI Backend Service | `127.0.0.1:8100` (`opcms-backend.service`) | Bound strictly to localhost (`uvicorn --host 127.0.0.1 --port 8100`) |
| PostgreSQL Database | `127.0.0.1:5432` (`opcms_db` / `opcms_user`) | Dedicated database & role; existing databases untouched |
| Public Subdomain | `https://polio.orhb.gov.et` | Additive Nginx/Apache virtual host only; existing vhosts preserved |

---

## 2. Step 1 — Run Non-Destructive Pre-Flight Inspection

Copy the repository onto `odmcserver` (or pull from Git), then run:

```bash
chmod +x deploy/scripts/*.sh
sudo ./deploy/scripts/preflight-inspect.sh
```

Verify from the output that:
1. Ports `3100` and `8100` are **free**.
2. Disk space under `/opt` and `/var` is sufficient (recommended ≥ 10 GB free).
3. You know whether **Nginx** or **Apache2** owns ports `80`/`443` on `odmcserver`.
4. DNS `A`/`AAAA` record for `polio.orhb.gov.et` resolves to `odmcserver` before requesting a TLS certificate.

---

## 3. Step 2 — Provision PostgreSQL Database & Configure `.env`

Create a dedicated PostgreSQL user and database (never touching ODMC/DSpace/IRB databases):

```bash
sudo -u postgres psql <<'SQL'
CREATE USER opcms_user WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE opcms_db OWNER opcms_user ENCODING 'UTF8';
GRANT ALL PRIVILEGES ON DATABASE opcms_db TO opcms_user;
SQL
```

Create `/opt/ohb-polio-command/.env` from `.env.example` and replace:
- `POSTGRES_PASSWORD` & `DATABASE_URL`
- `JWT_SECRET_KEY` (`openssl rand -hex 32`)
- `APP_URL="https://polio.orhb.gov.et"`
- `NODE_ENV="production"`

---

## 4. Step 3 — Run Additive Deployment Script

```bash
sudo ./deploy/scripts/deploy.sh
```

This script:
- Archives any existing `/opt/ohb-polio-command/current` release into `/var/backups/opcms/`
- Installs Node dependencies & builds the production frontend bundle (`npm run build`)
- Installs Python dependencies inside `/opt/ohb-polio-command/venv` and runs `alembic upgrade head`
- Installs and starts `opcms-backend.service` (`127.0.0.1:8100`) and `opcms-frontend.service` (`127.0.0.1:3100`)
- Adds the `polio.orhb.gov.et.conf` reverse proxy vhost cleanly without touching existing portals
- Runs `healthcheck.sh`

---

## 5. Step 4 — Enable HTTPS (Required for Full Offline PWA Service Worker)

Service Workers and offline PWA installation require a secure origin (`https://`). Enable TLS via Certbot:

```bash
# If using Nginx:
sudo certbot --nginx -d polio.orhb.gov.et

# If using Apache2:
sudo certbot --apache -d polio.orhb.gov.et
```

Verify in `/etc/nginx/sites-available/polio.orhb.gov.et.conf` (or Apache config) that:
- `/api/v1/events/stream` and `/api/v1/command-room/stream` have `proxy_buffering off`
- `/sw.js` has `Cache-Control: no-cache, no-store, must-revalidate`

---

## 6. Step 5 — Verify & Rollback Procedures

- **Health Check:** `sudo /opt/ohb-polio-command/current/deploy/scripts/healthcheck.sh`
- **Service Logs:** `journalctl -u opcms-frontend -u opcms-backend -f`
- **Instant Rollback:** `sudo /opt/ohb-polio-command/current/deploy/scripts/rollback.sh`
