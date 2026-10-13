# Multi-Source Network Event & Incident Analysis Platform (EventAnalyzer)

แพลตฟอร์มวิเคราะห์และจัดการเหตุการณ์เครือข่ายอัตโนมัติ (Network Event & Incident RCA Platform) ออกแบบมาเพื่อรับข้อมูลเหตุการณ์เครือข่ายจากหลายแหล่งข้อมูล (PRTG Network Monitor, Syslog, SNMP Traps) แปลงข้อมูลให้อยู่ในมาตรฐานเดียวกัน (Normalized Data Model) ติดตามวงจรชีวิตของ Incident อัตโนมัติ ตรวจสอบความถูกต้องด้วย SNMP Verification และจำแนกสาเหตุที่แท้จริง (Root Cause Classification) พร้อมระบบเปิดและซิงค์ใบงาน Trouble Ticket อัตโนมัติกับ **NT TTS** และ **osTicket (MSTicket)**

---

## 🏗️ Architecture Stack

ระบบทำงานแบบ Microservices Orchestration ประกอบด้วย 6 คอนเทนเนอร์หลัก:

| Service Name | Container Name | Technology | Port (Internal / Host) | Responsibility |
|---|---|---|---|---|
| **Database** | `eventanalyzer-db` | PostgreSQL 16 Alpine | `5432` / - | จัดเก็บข้อมูล Incidents, Devices, Events, Timelines |
| **Cache & Broker** | `eventanalyzer-redis` | Redis 7 Alpine | `6379` / - | Cache-First Layer, Distributed Locks, Celery Message Broker |
| **Backend & API** | `eventanalyzer-backend` | Django 5.0 + DRF + Gunicorn | `8000` / - | Business Logic, REST API, Event & Incident Engine |
| **Task Worker** | `eventanalyzer-celery` | Celery 5.4 (Worker & Beat) | - | งานเบื้องหลัง: Periodic Sync, Soak Timers, Verification |
| **Frontend & Proxy** | `eventanalyzer-frontend` | React 18 + TS + Tailwind + Nginx | `80` / **`8089`** | SPA Dashboard, Incident Management, Nginx Reverse Proxy |
| **TTS Automation** | `eventanalyzer-tts` | Node.js + Puppeteer Engine | `8088` / - | บริการเปิดและค้นหาตั๋ว NT TTS Headless Automation |

---

## ✨ Key Features & Capabilities

### 1. Ingestion & Event Normalization
- รับ Webhook จาก **PRTG Network Monitor** (`POST /api/v1/integrations/prtg/events/`)
- แปลงข้อมูล Interface Down/Up, Ping Failure เป็น Normalized Event Model โดยไม่ขึ้นกับยี่ห้ออุปกรณ์

### 2. Incident Lifecycle & Flapping Protection
- **45-Minute Continuous Hold-Down Soak Timer**: ป้องกัน Link Flapping โดยนับรอบ Flap และรอจนกว่าสัญญาณจะนิ่งต่อเนื่องครบ 45 นาที ก่อนเปลี่ยนสถานะเป็น `RECOVERED`
- **Accumulated Net Downtime**: บันทึกเวลารวมที่ Down จริงอย่างแม่นยำ

### 3. Automated Verification & Root Cause Classification
- **SNMP v2c Verification**: สอบถามสถานะพอร์ตและเวลา Uptime จากอุปกรณ์ปลายทาง
- **Classification Engine**: จำแนกสาเหตุของปัญหาเป็นหมวดหมู่อัตโนมัติ:
  - `Physical Link Failure` (สายสัญญาณหรือพอร์ตขัดข้อง)
  - `Power Outage` (ไฟดับ ยืนยันจาก Ping Alarms ของ Node)
  - `Device Reboot` (อุปกรณ์รีบูต Uptime < 3600s)
  - `Link Flapping` (ลิงก์สวิงเกินเกณฑ์)
  - `Connectivity Loss` (การเชื่อมต่อขาดหาย)

### 4. NT TTS Trouble Ticket Integration
- **Cache-First Architecture**: แคชข้อมูล Alarms และตั๋วจาก IPGET ใน Redis ช่วยให้การค้นหาเร็วระดับมิลลิวินาที
- **4-Point Ticket Eligibility Policy**: ประเมินความพร้อมก่อนเปิดตั๋ว (Alarm ยืนยัน, Down ต่อเนื่อง > 15 นาที, มี Circuit ID, ยังไม่มีตั๋วเปิดอยู่)
- **Smart Ticket Upgrade & Historical Preservation**: อัปเกรดตั๋วรอบปัจจุบันอัตโนมัติเมื่อมีตั๋ว `Work In Progress` ใหม่เข้ามา โดย **ไม่แก้ไขหรือเขียนทับประวัติตั๋วเก่าย้อนหลัง**

### 5. osTicket (MSTicket) Integration & Circuit Peer Auto-Propagation
- **5-Layered Deduplication & Concurrency Protection**:
  - Layer 1: In-memory & Database `select_for_update` Checks
  - Layer 2: Redis Distributed Locking (Scoped ตาม Circuit ID)
  - Layer 3: Atomic State Transitions (`PENDING_CREATION`)
  - Layer 4: Active Circuit Ticket Reuse
  - Layer 4.5: Real-time Search ตรวจจับตั๋วเดิมที่ NOC เปิดไว้แล้วบน osTicket Staff Portal
- **Circuit Peer Auto-Propagation**: เมื่อตั๋ว osTicket ถูกเปิดขึ้นที่ฝั่งใดฝั่งหนึ่งของวงจร Point-to-Point (Node A หรือ Node B) ระบบจะ **กระจายเลขตั๋ว osTicket ไปยัง Incident คู่ขนานของวงจรเดียวกันทันทีโดยอัตโนมัติ**
- **Precise Timezone Handling**: ส่งค่าเวลา Down Time ในรูปแบบ UTC เพื่อให้ PHP Engine ของ osTicket บวกชดเชย +7 แสดงผลเวลาท้องถิ่นไทยได้ถูกต้อง 100%

---

## 🚀 Quick Start

### 1. เริ่มต้นระบบ
```bash
./start.sh
```
หรือใช้คำสั่ง Docker Compose มาตรฐาน:
```bash
docker compose up -d --build
```

### 2. การเข้าใช้งาน
- **Web Dashboard & Incident Management**: [http://localhost:8089](http://localhost:8089)
- **Backend Health Check**: [http://localhost:8089/api/health/](http://localhost:8089/api/health/)
- **Django Admin Portal**: [http://localhost:8089/admin/](http://localhost:8089/admin/)
- **API Documentation**: [http://localhost:8089/api/v1/](http://localhost:8089/api/v1/)

### 3. หยุดการทำงาน
```bash
./stop.sh
# หรือ
docker compose down
```

---

## 📂 Project Structure

```text
event-analyzer/
├── docker-compose.yml              # 6-tier container orchestration
├── .env                            # Active environment variables
├── .env.example                    # Environment template
├── start.sh                        # Automated startup script
├── stop.sh                         # Automated shutdown script
│
├── backend/
│   ├── Dockerfile                  # Python 3.11-slim container
│   ├── requirements.txt            # Django, Celery, Redis, psycopg2, pysnmp
│   ├── entrypoint.sh               # DB/Redis readiness check & migrations
│   ├── manage.py
│   ├── analyzer_project/           # Django core settings & Celery config
│   ├── common/                     # Shared constants, enums, timeline types
│   ├── devices/                    # Device & SourceDeviceMapping models
│   ├── events/                     # EventSource, NetworkEvent models & Event Engine
│   ├── incidents/                  # Incident models, engines, tasks, views
│   │   ├── link_engine.py          # Link Outage, Flapping & Soak Timer Engine
│   │   ├── tasks.py                # Celery Background & Beat Scheduled Tasks
│   │   └── services/               # Domain Services
│   │       ├── enrichment_service.py     # IPGET / TTS / osTicket Sync
│   │       ├── ticket_policy_service.py  # 4-point Ticket Eligibility Checker
│   │       └── report_service.py         # KPI & Regional Reporting Service
│   ├── integrations/               # External Integration Gateways
│   │   ├── prtg/                   # PRTG Webhook Ingestion Adapter
│   │   ├── ipget/                  # IPGET Alarm & TTS Data Gateway
│   │   ├── tts/                    # NT TTS REST & Automation Client
│   │   └── osticket/               # osTicket Gateway (Builder, Searcher, Client)
│   ├── verification/               # SNMP v2c IF-MIB Verification Client
│   └── classification/             # Root Cause Decision Engine
│
├── frontend/
│   ├── Dockerfile                  # Multi-stage Node 20 build -> Nginx Alpine
│   ├── nginx.conf                  # Reverse proxy routing /api/, /admin/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx                 # Core Single Page Application
│       ├── types/                  # TypeScript Data Models
│       ├── services/api.ts         # Centralized REST API Client
│       └── components/             # UI Components
│           ├── DashboardView.tsx   # Executive metrics, MTTR, charts
│           ├── IncidentsView.tsx   # Real-time incident table with live filters
│           ├── IncidentDetailModal.tsx # Full timeline, RCA override, TTS/osTicket
│           └── incident/
│               └── TTSWorkOrderCard.tsx # Ticket eligibility & Work order actions
│
└── tts-service/
    ├── Dockerfile                  # Node.js + Chromium Puppeteer container
    ├── package.json
    └── src/
        ├── server.js               # Express API (Port 8088)
        └── tts_engine.js           # Headless Web Automation for NT TTS
```

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| **Platform** | | |
| `PORT` | `8089` | Host HTTP port สำหรับเข้าใช้งานผ่าน Web Browser |
| `TZ` / `TIME_ZONE` | `Asia/Bangkok` | เขตเวลาของระบบ |
| **Database & Cache** | | |
| `POSTGRES_DB` | `eventanalyzer_db` | ชื่อฐานข้อมูล PostgreSQL |
| `POSTGRES_USER` | `eventanalyzer_user` | ผู้ใช้งานฐานข้อมูล |
| `POSTGRES_PASSWORD` | `eventanalyzer_secure_pass_2026` | รหัสผ่านฐานข้อมูล |
| `REDIS_HOST` | `redis` | Hostname ของ Redis |
| **Thresholds & Timing** | | |
| `ROUTER_REBOOT_THRESHOLD_SECONDS` | `3600` | เกณฑ์ Uptime (1 ชม.) สำหรับจำแนก Device Reboot |
| `REBOOT_TIME_TOLERANCE_SECONDS` | `300` | ความคลาดเคลื่อนเวลาเกิดเหตุ (±5 นาที) |
| **SNMP & Network** | | |
| `SNMP_COMMUNITY` | `tpk-snmp` | SNMP v2c Community String สำหรับตรวจสอบอุปกรณ์ |
| `SNMP_VERIFY_MAX_RETRIES` | `3` | จำนวนครั้งสูงสุดในการส่งคำขอ SNMP Verification |
| `SNMP_VERIFY_RETRY_DELAY` | `30` | ระยะเวลารอระหว่างการทดสอบซ้ำ (วินาที) |
| **PRTG Ingestion** | | |
| `PRTG_ENABLED` | `True` | เปิด/ปิดการรับ Webhook จาก PRTG |
| `PRTG_API_TOKEN` | `prtg-secure-webhook-token-2026` | Header `X-PRTG-Token` ยืนยันตัวตน Webhook |
| **osTicket Integration** | | |
| `OSTICKET_URL` | `https://msticket.catbb.net/` | URL หน้าเว็บ osTicket Staff Portal |
| `OSTICKET_API_URL` | `http://192.168.243.127/osticket/api/tickets.json` | Internal REST API endpoint สำหรับยิงสร้างตั๋ว |
| `OSTICKET_API_KEY` | *(Key string)* | API Key สำหรับการสร้างตั๋ว |
| `OSTICKET_TOPIC_ID` | `27` | Help Topic ID (CATMA TTS) |
| `OSTICKET_SLA_ID` | `10` | Service Level Agreement ID |
| `OSTICKET_STAFF_USER` | `somphong` | บัญชี Staff สำหรับค้นหาตั๋ว Real-time |
| `OSTICKET_STAFF_PASS` | `Phong@1797` | รหัสผ่าน Staff สำหรับค้นหาตั๋ว Real-time |
| **NT TTS Integration** | | |
| `TTS_SERVICE_URL` | `http://tts-service:8088` | URL ของบริการ Automation `tts-service` |
| `TTS_USERNAME` | `catma` | บัญชีผู้ใช้งานระบบ NT TTS |
| `TTS_PASSWORD` | *(Password)* | รหัสผ่านระบบ NT TTS |

---

## 📡 Core API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health/` | `GET` | ตรวจสอบความพร้อมของระบบ (Database, Redis, Worker) |
| `/api/v1/integrations/prtg/events/` | `POST` | Webhook Receiver รับข้อมูลสัญญาณเตือนจาก PRTG |
| `/api/v1/incidents/` | `GET` | รายการ Incidents ทั้งหมด รองรับการค้นหา กรอง และ Pagination |
| `/api/v1/incidents/{id}/` | `GET`, `PATCH` | ดึงรายละเอียด และ Override การจำแนกสาเหตุ (Manual RCA) |
| `/api/v1/incidents/{id}/sync-ticket/` | `POST` | ซิงค์ข้อมูล Trouble Ticket (NT TTS และ osTicket) แบบ Real-time |
| `/api/v1/incidents/{id}/ticket-eligibility/` | `GET` | ตรวจสอบเกณฑ์ 4 ข้อสำหรับความพร้อมในการเปิดตั๋ว |
| `/api/v1/incidents/{id}/open-ticket/` | `POST` | สั่งเปิดตั๋ว NT TTS อัตโนมัติ |
| `/api/v1/incidents/{id}/open-osticket/` | `POST` | สั่งเปิดตั๋ว osTicket และกระจายเลขตั๋วไปยังคู่ขนานอัตโนมัติ |
| `/api/v1/reports/summary/` | `GET` | ดึงข้อมูลสถิติภาพรวม MTTR, RCA Breakdown, และ Regional Tree |
