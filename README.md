# Multi-Source Network Event & Incident Analysis Platform

A modular, extendable Web Application platform designed for receiving network events from multiple monitoring systems (starting with PRTG Network Monitor), normalizing events into a vendor-agnostic data model, tracking incident lifecycles, and performing automated SNMP verification and incident classification.

---

## 🏗️ Architecture Stack

| Layer | Technology | Service Name | Internal Port |
|---|---|---|---|
| **Database** | PostgreSQL 16 Alpine | `eventanalyzer-db` | 5432 |
| **Broker / Cache** | Redis 7 Alpine | `eventanalyzer-redis` | 6379 |
| **Backend & API** | Django 5.0 + DRF + Gunicorn | `eventanalyzer-backend` | 8000 |
| **Task Worker** | Celery 5.4 | `eventanalyzer-celery` | - |
| **Frontend & Proxy** | React 18 + TypeScript + Vite + Tailwind CSS + Nginx | `eventanalyzer-frontend` | 80 (Host: 8089) |

---

## 🚀 Quick Start

### 1. Start Platform
```bash
./start.sh
```
Or with standard Docker Compose:
```bash
docker compose up -d --build
```

### 2. Access Web UI & APIs
- **Web Dashboard**: [http://localhost:8089](http://localhost:8089)
- **Backend Health Check**: [http://localhost:8089/api/health/](http://localhost:8089/api/health/)
- **Django Admin**: [http://localhost:8089/admin/](http://localhost:8089/admin/)
- **PRTG Webhook Ingestion**: `POST http://localhost:8089/api/v1/integrations/prtg/events/`

### 3. Stop Platform
```bash
./stop.sh
```
Or:
```bash
docker compose down
```

---

## 📂 Project Structure

```text
event-analyzer/
├── docker-compose.yml          # Complete 5-tier container orchestration
├── .env                        # Active environment variables
├── .env.example                # Example environment template
├── start.sh                    # Automated startup script
├── stop.sh                     # Automated shutdown script
│
├── backend/
│   ├── Dockerfile              # Python 3.11-slim container
│   ├── requirements.txt        # Django, Celery, Redis, psycopg2, pysnmp-lextudio
│   ├── entrypoint.sh           # DB/Redis readiness check & migrations
│   ├── manage.py
│   ├── analyzer_project/       # Django core settings & Celery config
│   ├── common/                 # Shared utilities, constants, logging
│   ├── devices/                # Device & SourceDeviceMapping models
│   ├── events/                 # EventSource, NetworkEvent models & Event Engine
│   ├── incidents/              # Incident, IncidentEvent, Timeline models & Engine
│   ├── integrations/           # Source Adapters (BaseAdapter & PRTGAdapter)
│   ├── verification/           # Verification models & SNMP v2c client
│   └── classification/         # Decision Engine (Reboot vs Connectivity Loss)
│
└── frontend/
    ├── Dockerfile              # Multi-stage Node 20 build -> Nginx Alpine
    ├── nginx.conf              # Reverse proxy routing /api/, /admin/, /static/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── App.tsx             # SPA Dashboard UI
        ├── main.tsx
        ├── index.css
        └── lib/utils.ts
```

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8089` | Host HTTP port for Frontend and Reverse Proxy |
| `POSTGRES_DB` | `eventanalyzer_db` | PostgreSQL database name |
| `POSTGRES_USER` | `eventanalyzer_user` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `eventanalyzer_secure_pass_2026` | PostgreSQL password |
| `ROUTER_REBOOT_THRESHOLD_SECONDS` | `3600` | 1 hour threshold for reboot vs link loss |
| `REBOOT_TIME_TOLERANCE_SECONDS` | `300` | ±5 minutes tolerance for boot correlation |
| `SNMP_COMMUNITY` | `public` | Default SNMP v2c community string |
| `SNMP_VERIFY_MAX_RETRIES` | `3` | Maximum SNMP verification attempts |
| `SNMP_VERIFY_RETRY_DELAY` | `30` | Seconds between verification retries |
| `PRTG_API_TOKEN` | `prtg-secure-webhook-token-2026` | `X-PRTG-Token` header for PRTG webhooks |
