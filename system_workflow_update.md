# คู่มือการทำงานของระบบ Multi-Source Network Event & Incident Analysis Platform (ฉบับปรับปรุงล่าสุด)
**System Workflow & Architecture Specification (Updated Edition)**

เอกสารฉบับนี้อธิบาย **Workflow การทำงานของระบบ Multi-Source Network Event & Incident Analysis Platform** ทั้งหมดที่ได้รับการอัปเดต โดยครอบคลุมทั้งสถาปัตยกรรมหลัก, กลไก State Machine การคัดแยกความผิดปกติ, ระบบบูรณาการเชื่อมต่อ **IPGET API Suite** และ **TTS Trouble Ticket System** ล่าสุด, ระบบ Automated Verification, โครงสร้างฐานข้อมูลที่ขยายใหม่, การปรับปรุง User Interface (UI/UX) และมาตรการความทนทานต่อข้อผิดพลาด (Fault Tolerance)

---

## สารบัญ (Table of Contents)
1. [ภาพรวมสถาปัตยกรรมระบบหลังการอัปเดต (Updated System Architecture)](#1-ภาพรวมสถาปัตยกรรมระบบหลังการอัปเดต)
2. [ขั้นตอนที่ 1: การรับสัญญาณและการสกัดข้อมูลมาตรฐาน (Ingestion & Normalization Layer)](#2-ขั้นตอนที่-1-การรับสัญญาณและการสกัดข้อมูลมาตรฐาน)
3. [ขั้นตอนที่ 2: Core Dispatcher และ State Machine การจัดการ Incident](#3-ขั้นตอนที่-2-core-dispatcher-และ-state-machine-การจัดการ-incident)
4. [ขั้นตอนที่ 3: ระบบตรวจพิสูจน์สาเหตุรากเหง้าอัตโนมัติ (Automated RCA & Verification Engine)](#4-ขั้นตอนที่-3-ระบบตรวจพิสูจน์สาเหตุรากเหง้าอัตโนมัติ)
5. [ขั้นตอนที่ 4: สถาปัตยกรรมและการเชื่อมต่อ IPGET & TTS Integration Suite](#5-ขั้นตอนที่-4-สถาปัตยกรรมและการเชื่อมต่อ-ipget--tts-integration-suite)
6. [ขั้นตอนที่ 5: มาตรการรักษาเสถียรภาพ ประสิทธิภาพ และการรับมือเมื่อ API ขัดข้อง (Resilience & Fault Tolerance)](#6-ขั้นตอนที่-5-มาตรการรักษาเสถียรภาพ-ประสิทธิภาพ-และการรับมือเมื่อ-api-ขัดข้อง)
7. [ขั้นตอนที่ 6: การปรับปรุงการแสดงผลและ User Experience (Frontend UI/UX Optimization)](#7-ขั้นตอนที่-6-การปรับปรุงการแสดงผลและ-user-experience)
8. [โครงสร้างฐานข้อมูลและฟิลด์ที่ได้รับการขยาย (Database Schema Reference)](#8-โครงสร้างฐานข้อมูลและฟิลด์ที่ได้รับการขยาย)
9. [คู่มือการทดสอบ ตรวจสอบ และวินิจฉัยระบบ (System Verification & Diagnostic Guide)](#9-คู่มือการทดสอบ-ตรวจสอบ-และวินิจฉัยระบบ)

---

## 1. ภาพรวมสถาปัตยกรรมระบบหลังการอัปเดต

ระบบทำงานในรูปแบบ **Containerized Microservices Stack** บน Docker โดยแยกหน้าที่กันอย่างชัดเจน และเชื่อมต่อกับระบบภายนอกแบบ Non-blocking:

```mermaid
flowchart TD
    subgraph Sources["1. แหล่งสัญญาณต้นทาง (Event Sources)"]
        PRTG["PRTG Network Monitor<br>(Ping & Port Sensors Webhook)"]
        Syslog["Syslog / Other Monitors<br>(Network Traps)"]
    end

    subgraph ExternalAPIs["2. ระบบภายนอกที่บูรณาการ (External APIs)"]
        IPGET_IF["IPGET API 1: Interface Alarm<br>/device/alarm/interface/<br>(Circuit NTID, Remote Peer, Speed)"]
        IPGET_NODE["IPGET API 2: Node Ping Alarm<br>/device/alarm/ping/<br>(Site Name, Province, Office)"]
        TTS_API["IPGET API 3: TTS listNTID<br>/tts/data/open/listNTID<br>(Ticket ID, Status, Team, GPS, Cause)"]
        Routers["Physical Core/PE Routers<br>(SNMP sysUpTime / SSH IOS-XR)"]
    end

    subgraph Proxy["3. ประตูรับส่งข้อมูล (Gateway & Reverse Proxy)"]
        Nginx["Nginx Reverse Proxy (Port 8089)<br>Frontend SPA + Backend API Gateway"]
    end

    subgraph CoreBackend["4. ประมวลผลและกระจายงาน (Core Backend & Ingestion)"]
        Adapter["PRTG Adapter<br>Regex Port/IP/Status Normalizer"]
        Dispatcher{"Core Dispatcher<br>dispatch_event()"}
        DevEngine["Device Incident Engine<br>(Router Reachability State Machine)"]
        LinkEngine["Link Incident Engine<br>(Flapping Protection & Hold-Down Soak)"]
    end

    subgraph AsyncWorker["5. ระบบงานเบื้องหลัง (Celery Workers & Scheduler)"]
        CeleryWorker["Celery Worker (Concurrency 4)<br>- Automated Verification (SNMP/SSH)<br>- On-Demand Ticket Sync<br>- Soak Completion Check"]
        CeleryBeat["Celery Beat Scheduler<br>- Continuous Soak Watcher (60s)<br>- Periodic TTS Background Sync (2m)"]
        Redis[("Redis In-Memory Broker<br>& Results Backend")]
    end

    subgraph DataStore["6. ฐานข้อมูลและรายงาน (Persistence & Presentation)"]
        Postgres[("PostgreSQL 15+ Database<br>Incidents, Events, Devices, Timeline")]
        Frontend["React 18 SPA (Vite + Tailwind CSS)<br>- Dashboard Overview<br>- Compact Incidents View<br>- TTS Work Order Modal & Reports"]
    end

    Sources -->|HTTP POST Webhook| Nginx
    Nginx -->|/api/v1/integrations/prtg/webhook/| Adapter
    Adapter -->|Normalized Event| Dispatcher
    Dispatcher -->|Type = DEVICE_REACHABILITY| DevEngine
    Dispatcher -->|Type = LINK_STATUS| LinkEngine
    DevEngine --> Postgres
    LinkEngine --> Postgres

    DevEngine -.->|Trigger Async RCA| Redis
    LinkEngine -.->|Schedule Soak Check| Redis
    Redis --> CeleryWorker
    CeleryBeat --> Redis

    CeleryWorker <-->|"Query SNMP / SSH"| Routers
    CeleryWorker <-->|"Query Interface Alarms"| IPGET_IF
    CeleryWorker <-->|"Query Node Ping Alarms"| IPGET_NODE
    CeleryWorker <-->|"Query TTS Tickets (NTID or IP)"| TTS_API
    CeleryWorker -->|"Update Enriched Data"| Postgres

    Postgres <--> Nginx
    Nginx <--> Frontend
```

### องค์ประกอบสำคัญของระบบ:
1. **Nginx Reverse Proxy** (Port `8089`): ทำหน้าที่เป็น Single Entry Point สำหรับทั้ง Webhook Ingestion, Backend REST API และให้บริการ Static Assets ของ React Frontend
2. **Backend API & Dispatcher** (`Django 5.x / DRF`): ทำหน้าที่ Ingest Event, รัน State Machine, คำนวณความเสถียร และให้บริการ REST API
3. **Celery Worker & Beat** (`Celery 5.x`): แยกการประมวลผลงานหนัก เช่น SNMP/SSH Verification, Soak Timer 45 นาที และการเชื่อมโยงข้อมูล IPGET/TTS ออกจาก Webhook Thread
4. **Redis 7.x**: จัดการ Message Queue ระหว่าง Django และ Celery Worker
5. **PostgreSQL 15+**: จัดเก็บตารางข้อมูลเชิงสัมพันธ์ที่มี ACID Guarantee พร้อมรองรับ Concurrent Status Locks
6. **Frontend SPA** (`React 18 / TypeScript / Vite / Tailwind`): นำเสนอข้อมูล Dashboard, ตาราง Incident แบบ Compact พร้อม Quick Actions, Modal แสดงรายละเอียดการซ่อม TTS และรายงานแบบ Hierarchical Drill-down

---

## 2. ขั้นตอนที่ 1: การรับสัญญาณและการสกัดข้อมูลมาตรฐาน

ระบบรองรับ Event จากอุปกรณ์ตรวจวัด (Monitoring) หลากหลายค่าย โดยมีกระบวนการแปลงข้อมูล (Normalization Pipeline) เพื่อไม่ให้โครงสร้างเฉพาะของ PRTG หรือ Syslog ปะปนกับ Core Business Logic:

```mermaid
sequenceDiagram
    autonumber
    participant PRTG as PRTG Network Monitor
    participant Webhook as Webhook View (/prtg/webhook/)
    participant Adapter as PRTGAdapter (Normalizer)
    participant DB as PostgreSQL (NetworkEvent)
    participant Dispatcher as Core Dispatcher

    PRTG->>Webhook: HTTP POST JSON Payload (Sensor, Status, IP, Message)
    Webhook->>Adapter: normalize_payload(data)
    Note over Adapter: 1. ตรวจสอบชนิด Sensor (Ping -> DEVICE, Port -> LINK)<br/>2. ใช้ Regex สกัด Canonical Port Name (Hu/Te/Gi/BE)<br/>3. แมปสถานะเป็น DOWN / UP<br/>4. จับคู่ Management IP กับตาราง Device
    Adapter-->>Webhook: Normalized Data Dictionary
    Webhook->>DB: บันทึก NetworkEvent (Audit Trail)
    Webhook->>Dispatcher: dispatch_event(event) (Non-blocking)
    Webhook-->>PRTG: HTTP 200 OK (Under 15ms)
```

### การสกัดข้อมูลและแปลงรูปแบบพอร์ต (Interface Normalization):
ฟังก์ชัน `IPGETClient.normalize_port_name()` และ `PRTGAdapter.extract_interface_name()` จะทำความสะอาดชื่อพอร์ตให้อยู่ใน Canonical Short Form สากล เพื่อให้จับคู่ได้แม่นยำ 100%:
* `HundredGigE0/1/0/0` $\rightarrow$ `hu0/1/0/0`
* `TenGigabitEthernet0/0/0/31` หรือ `TenGigE0/0/0/31` $\rightarrow$ `te0/0/0/31`
* `GigabitEthernet0/1/2` $\rightarrow$ `gi0/1/2`
* `Bundle-Ether1` $\rightarrow$ `be1`

---

## 3. ขั้นตอนที่ 2: Core Dispatcher และ State Machine การจัดการ Incident

Core Dispatcher (`backend/events/engine.py`) จะตรวจสอบ `event.event_type` เพื่อส่งต่องานไปยัง Engine ที่รับผิดชอบโดยเฉพาะ:

### 3.1 Device Reachability Engine (เมื่อเราเตอร์หลักดับ)
มุ่งเน้นการตรวจจับการขาดหายไปของอุปกรณ์ (Node Down) และการป้องกันปัญหาเปิดเคสซ้ำซ้อน:

```mermaid
stateDiagram-v2
    [*] --> DOWN : รับ Event Ping DOWN ครั้งแรก
    DOWN --> DOWN : รับ Ping DOWN ซ้ำ (บันทึก DOWN_REPEAT)
    DOWN --> RECOVERY_CHECK : รับ Event Ping UP กลับมา
    RECOVERY_CHECK --> RECOVERED : Automated Verification ตรวจสอบผ่าน
    RECOVERY_CHECK --> MANUAL_REVIEW_REQUIRED : ตรวจสอบล้มเหลว / SNMP Timeout
    RECOVERED --> [*]
    MANUAL_REVIEW_REQUIRED --> RECOVERED : ผู้ดูแลระบบปรับสถานะผ่าน Quick Action
```

* **De-duplication**: หากได้รับ Ping DOWN ซ้ำในขณะที่ Incident เดิมยังไม่ปิด ระบบจะบันทึก Timeline เป็น `DOWN_REPEAT` โดยไม่เปิด Incident ใหม่
* **Recovery Trigger**: เมื่อได้รับสัญญาณ Ping UP ระบบจะเปลี่ยนสถานะเป็น `RECOVERY_CHECK` และเรียกใช้งาน Automated Verification Engine แบบ Asynchronous

---

### 3.2 Link Incident & Flapping Engine (เมื่อสายสัญญาณ/พอร์ตขัดข้อง)
สร้างขึ้นตามมาตรฐาน **Carrier-Grade Flapping Protection** โดยยึด **4 กฎเหล็ก**:

```mermaid
flowchart TD
    Event["รับ Event LINK_STATUS (DOWN หรือ UP)"] --> CheckParent{"กฎข้อที่ 1 (Parent Correlation):<br/>เราเตอร์แม่ (Device) ดับอยู่หรือไม่?"}
    
    CheckParent -- "ใช่ (เราเตอร์แม่ดับ)" --> SuppressParent["ระงับการเปิด Link Incident ใหม่<br/>ผูก Event เป็น Child ใต้เหตุการณ์เราเตอร์แม่<br/>(Classification: PARENT_DEVICE_DOWN)"]
    
    CheckParent -- "ไม่ใช่ (เราเตอร์แม่ปกติ)" --> CheckHistory{"กฎข้อที่ 2 (Flapping Window 30m):<br/>มี Incident เดิมของคู่นี้<br/>ภายใน 30 นาทีหรือไม่?"}
    
    CheckHistory -- "ไม่มี (เคสใหม่)" --> CreateNewLink["เปิด Incident ใหม่ (LNK-YYYYMMDD-NNNNNN)<br/>สถานะ: ACTIVE (DOWN)"]
    CheckHistory -- "มีเคสเดิมอยู่" --> EventType{"Event ที่เข้ามาคือ?"}
    
    EventType -- "สถานะ = DOWN" --> HandleDown["กฎข้อที่ 4 (Flap Reset on DOWN):<br/>1. ยกเลิก Soak Timer ทันที<br/>2. เพิ่ม flap_count += 1<br/>3. สะสม net_downtime_seconds<br/>4. ปรับสถานะเป็น FLAPPING หรือ DOWN"]
    
    EventType -- "สถานะ = UP" --> HandleUp["กฎข้อที่ 3 (Continuous UP Soak 45m):<br/>1. ปรับสถานะเป็น STABILIZING<br/>2. กำหนด soak_until = ปัจจุบัน + 45 นาที<br/>3. ส่ง Task check_link_soak_completion"]

    HandleUp --> SoakCheck{"พอร์ตอยู่นิ่งต่อเนื่อง<br/>ครบ 45 นาทีเต็มหรือไม่?"}
    SoakCheck -- "มี DOWN ซ้ำก่อนครบเวลา" --> HandleDown
    SoakCheck -- "นิ่งครบ 45 นาทีต่อเนื่อง" --> CloseLink["ปิด Incident ➔ RECOVERED<br/>- flap_count >= 2: LINK_FLAPPING<br/>- Downtime >= 15m: PHYSICAL_LINK_FAILURE<br/>- อื่นๆ: TRANSIENT_GLITCH"]
```

#### สรุป 4 กฎเหล็กของ Link Engine:
1. **Parent Device Correlation (Suppression)**: เมื่อเราเตอร์แม่ดับ พอร์ตทั้งหมดใต้เราเตอร์จะดับตาม ระบบจะไม่สแปมเปิด Link Incident นับร้อยรายการ แต่จะจัดกลุ่มเป็น Child ภายใต้เหตุการณ์ของเราเตอร์หลัก
2. **Flapping Window (30 นาที)**: หากพอร์ตเกิดหลุดหรือติดซ้ำภายในช่วง 30 นาที ระบบจะรวมอยู่ใน Incident เดียวกัน (`LNK-...`) และนับรอบ `flap_count += 1`
3. **Continuous UP Soak Timer (45 นาที)**: เมื่อพอร์ตกลับมาติด (UP) ระบบจะยังไม่ปิดเคสทันที แต่จะให้อยู่ในสถานะ `STABILIZING` เป็นเวลา 45 นาที เพื่อเฝ้าดูความเสถียร
4. **Flap Reset on DOWN**: หากในระหว่าง 45 นาที พอร์ตหลุดลงไปอีกแม้แต่วินาทีเดียว ระบบจะยกเลิกเวลารอดูอาการทันที, คำนวณ Net Downtime สะสม และกลับไปนับรอบ Flap เพิ่ม

---

## 4. ขั้นตอนที่ 3: ระบบตรวจพิสูจน์สาเหตุรากเหง้าอัตโนมัติ

ระบบมีโมดูล **Automated RCA & Verification Engine** (`backend/verification/`) เพื่อค้นหาสาเหตุที่แท้จริงของการหยุดทำงานของเครือข่าย โดยใช้ Strategy Pattern:

```mermaid
flowchart TD
    Trigger["Incident เข้าสู่สถานะ RECOVERY_CHECK / STABILIZING"] --> StratSelect{"ประเภทของ Incident"}
    
    StratSelect -- "DEVICE (Router Down)" --> PingCheck["ยิง ICMP Ping ยืนยัน Reachability"]
    PingCheck --> SNMPQuery["ส่งคำสั่ง SNMP sysUpTime.0 (OID: 1.3.6.1.2.1.1.3.0)"]
    
    SNMPQuery --> EvalUptime{"ผลลัพธ์ Uptime ของเราเตอร์"}
    EvalUptime -- "Uptime < 3,600 วินาที<br/>(เพิ่งสตาร์ตเครื่องใหม่)" --> RebootPath["เราเตอร์รีบูตจริง (Reboot Detected)"]
    EvalUptime -- "Uptime > เวลาที่ดับ<br/>(เครื่องไม่เคยดับ)" --> ConnLoss["เครือข่ายขัดข้องภายนอก<br/>RCA: CONNECTIVITY_LOSS (High Conf)"]
    EvalUptime -- "SNMP Timeout / Error" --> Unverified["ไม่สามารถเชื่อมต่อได้<br/>RCA: UNABLE_TO_VERIFY"]

    RebootPath --> CheckOS{"ระบบปฏิบัติการเราเตอร์"}
    CheckOS -- "Cisco IOS-XR" --> SSHCommand["ยิง SSH พอร์ต 22 รันคำสั่ง<br/>'show reboot-history'"]
    CheckOS -- "Cisco IOS-XE / อื่นๆ" --> SNMPWhyReload["ดึง OID whyReload หรือ 'show version'"]
    
    SSHCommand --> ParseReason{"พบเหตุผลการ Reload หรือไม่?"}
    SNMPWhyReload --> ParseReason
    ParseReason -- "พบ เช่น Power Loss, Kernel Crash" --> Confirmed["RCA: DEVICE_REBOOT_RELATED (High Conf)"]
    ParseReason -- "ไม่พบข้อความชัดเจน" --> Suspected["RCA: DEVICE_REBOOT_SUSPECTED (Medium Conf)"]

    StratSelect -- "LINK (Interface Down)" --> IFMIB["ยิง SNMP IF-MIB (ifOperStatus / ifAdminStatus)"]
    IFMIB --> VerifyLink["ยืนยันสถานะพอร์ตและบันทึกลง Incident Timeline"]
```

---

## 5. ขั้นตอนที่ 4: สถาปัตยกรรมและการเชื่อมต่อ IPGET & TTS Integration Suite

ระบบได้รับการขยายขีดความสามารถในการเชื่อมต่อกับ **IPGET Network Monitoring & Alarm API** (`http://10.199.47.38`) ครบทั้ง 3 API:

```mermaid
sequenceDiagram
    autonumber
    participant System as Incident Engine / Celery
    participant IPGET_IF as IPGET API 1 (/device/alarm/interface/)
    participant IPGET_PING as IPGET API 2 (/device/alarm/ping/)
    participant TTS as IPGET API 3 (/tts/data/open/listNTID)
    participant DB as Incidents Database

    Note over System, DB: กรณีที่ 1: Link Incident (สายสัญญาณ/พอร์ตล่ม)
    System->>IPGET_IF: POST {"interval_hour": 24, "layer": "L3", "group_name": "..."}
    IPGET_IF-->>System: รายการ Alarms พร้อม cat_id, destname, destport, site_name
    System->>System: แมปด้วย (Device IP, Canonical Port) หรือ (Hostname, Canonical Port)
    System->>DB: บันทึก circuit_id, remote_device, site_name
    System->>TTS: POST {"ntid": [circuit_id]}
    TTS-->>System: Trouble Ticket Data (INCIDENT_ID, IM_STATUS, REPAIRTEAM, GPS, CAUSE)
    System->>DB: บันทึก ticket_id_tss, tts_status, repair_team, actual_cause, resolution, GPS

    Note over System, DB: กรณีที่ 2: Device Incident (เราเตอร์หลักดับ)
    System->>IPGET_PING: POST {"interval_hour": 72, "layer": "L3"}
    IPGET_PING-->>System: รายการ Node Alarms พร้อม site_name, province, cat_office_name
    System->>DB: บันทึก site_name ของเราเตอร์
    System->>TTS: POST {"ntid": [device_ip, device_name, sys_name]}
    TTS-->>System: Trouble Ticket Data ของอุปกรณ์ Down
    System->>DB: บันทึก ticket_id_tss, tts_status, repair_team, actual_cause, GPS
```

### รายละเอียดของแต่ละ API ใน Suite:

#### API 1: Interface Alarm Info (`/device/alarm/interface/`)
* **หน้าที่**: ค้นหาข้อมูลเชิงลึกของวงจรที่พอร์ตดับ
* **Payload ที่ส่ง**: `{"layer": "L3", "group_name": "bangkok, central, north...", "interval_hour": 24}`
* **ข้อมูลที่สกัดได้**:
  * `circuit_id`: รหัสวงจร NTID (เช่น `TBB001234`, `308123456`)
  * `remote_device` & `remote_interface`: อุปกรณ์และพอร์ตปลายทาง (`destname`, `destport`)
  * `site_name`: ชื่อชุมสาย/สถานีของพอร์ต

#### API 2: Node Ping Info (`/device/alarm/ping/`)
* **หน้าที่**: ค้นหาข้อมูลเชิงลึกของชุมสายและสถานีฐานเมื่อเราเตอร์ดับ
* **Payload ที่ส่ง**: `{"layer": "L3", "group_name": "...", "interval_hour": 72}`
* **ข้อมูลที่สกัดได้**:
  * `site_name`: ชื่อชุมสาย/สถานีฐาน
  * `province`: จังหวัดที่ตั้ง
  * `cat_office_name`: ศูนย์บริการโทรคมนาคมที่ดูแล

#### API 3: TTS Trouble Ticket System by NTID (`/tts/data/open/listNTID`)
* **หน้าที่**: ดึงข้อมูลใบสั่งงานแจ้งซ่อมบำรุง (Trouble Ticket) ของ ITSM
* **การรองรับ Dual-Mode Query**:
  1. **สำหรับ Link Incident**: ส่งค้นหาด้วย **Circuit NTID** (`ntid=[circuit_id]`)
  2. **สำหรับ Device Incident**: ส่งค้นหาด้วย **Device IP / Hostname Candidates** (`ntid=[device_ip, device_name, sys_name]`)
* **ข้อมูลที่สกัดและจัดเก็บ**:
  * `ticket_id_tss`: หมายเลข Ticket แจ้งซ่อม (เช่น `INC20260929-0012`)
  * `tts_status`: สถานะงานแก้ (เช่น `Work In Progress`, `Resolved`, `Closed`)
  * `repair_team`: ทีมช่างผู้รับผิดชอบงานแก้
  * `response_department`: หน่วยงานต้นสังกัด
  * `actual_cause`: สาเหตุจริงของปัญหา (Parsed จาก `CAUSE_DETAIL` / `CAUSE_GROUP`)
  * `resolution`: วิธีการแก้ไข / ผลการซ่อมบำรุง
  * `source_gps` & `dest_gps`: พิกัด GPS ต้นทางและปลายทาง สกัดจากข้อความ Location ใน Description

---

### กลไกการ Sync ข้อมูล (Synchronization Workflows)

ระบบแบ่งการ Sync ข้อมูลออกเป็น 2 รูปแบบเพื่อความยืดหยุ่นและประสิทธิภาพสูงสุด:

```mermaid
flowchart LR
    subgraph Scheduled["1. รอบการทำงานอัตโนมัติ (Periodic Sync)"]
        Cron["Celery Beat Task ทุกๆ 2 นาที<br>sync_pending_tss_tickets_task"]
        QueryPending["ค้นหาเคสที่ยังไม่มี ticket_id_tss<br>(Active หรือสร้างใน 24 ชม.)"]
        BatchSync["ดึงข้อมูล Alarms และ TTS แบบกลุ่ม<br>บันทึกลงฐานข้อมูล"]
        StopPoll["เมื่อได้ Ticket แล้ว ➔ ยุติการ Polling เคสนั้นทันที"]
        Cron --> QueryPending --> BatchSync --> StopPoll
    end

    subgraph OnDemand["2. การเรียกข้อมูลทันใจ (On-Demand Sync)"]
        UserClick["ผู้ใช้กดปุ่ม 'Sync TSS' บน Modal<br>หรือเปิดหน้า Incident Detail"]
        APICall["POST /api/v1/incidents/{id}/sync-ticket/"]
        WorkerExec["Celery Task ดึงข้อมูลล่าสุดทันที<br>(ทั้ง Ticket ID, สถานะงานแก้, สาเหตุจริง)"]
        UIUpdate["หน้าจอ Modal อัปเดตข้อมูลแบบ Real-time"]
        UserClick --> APICall --> WorkerExec --> UIUpdate
    end
```

---

## 6. ขั้นตอนที่ 5: มาตรการรักษาเสถียรภาพ ประสิทธิภาพ และการรับมือเมื่อ API ขัดข้อง

การเพิ่มการเชื่อมต่อ API ภายนอก (โดยเฉพาะ TTS ที่ต้องค้นหาฐานข้อมูล ITSM ส่วนกลาง) มีการออกแบบสถาปัตยกรรมป้องกันความเสี่ยง (Resilience & Fault Tolerance) อย่างเข้มงวด:

```mermaid
flowchart TD
    Incoming["Webhook PRTG ส่งเข้ามา"] --> AsyncSave["1. Non-Blocking Ingestion<br>บันทึก Incident และตอบ HTTP 200 ทันที (Under 15ms)<br>ไม่รอผลของ IPGET/TTS ใน Webhook Request"]
    
    AsyncSave --> CeleryQueue["2. ส่งเข้า Celery Background Queue"]
    
    CeleryQueue --> CallAPI["3. Celery Worker เรียก IPGET / TTS API"]
    
    CallAPI --> CheckResp{"สถานะการตอบกลับของ API"}
    
    CheckResp -- "ปกติ (HTTP 200)" --> EnrichData["สกัดข้อมูลใบสั่งงานและบันทึกสมบูรณ์"]
    
    CheckResp -- "Timeout / 500 / Down" --> SafeFallback["4. Graceful Fallback & Circuit Breaker<br>- ตั้ง Timeout: 6s (Alarms), 25s (TTS)<br>- ไม่ทำให้ Celery Worker หรือระบบหลัก Crash<br>- บันทึก Error Log และข้ามไปเคสถัดไป"]
    
    SafeFallback --> WaitingBadge["หน้าเว็บแสดง Badge 'Waiting TSS...' ตามปกติ<br>ฟังก์ชัน Core (Flapping, RCA, Downtime) ทำงานได้ 100%"]
    
    WaitingBadge --> RetryLater["รอบถัดไป (อีก 2 นาที) ระบบจะกลับมาลองเชื่อมต่อใหม่"]
```

### สรุป 5 เสาหลักด้านความปลอดภัยของ API Integration:
1. **Asynchronous Non-blocking Architecture**: กระบวนการรับ Webhook และการตรวจจับ Flapping จะไม่มีการเรียก Network I/O ไปยัง IPGET โดยเด็ดขาด ทำให้ Webhook ตอบสนองในเวลา $< 15$ ms เสมอ
2. **Strict Timeout Budgets**: กำหนด Timeout ไว้ที่ 6 วินาทีสำหรับ Interface/Node Alarm และ 25 วินาทีสำหรับ TTS API ป้องกันปัญหา Worker Thread ค้าง
3. **Graceful Degradation**: หาก IPGET หรือ TTS ล่ม ออฟไลน์ หรือส่ง HTTP 500 ระบบจะจับ Exception และทำงานต่อไปโดยไม่ทำให้ระบบ Incident หยุดชะงัก
4. **Polling Optimization**: เมื่อเคสใดได้รับการแมป Ticket ID สำเร็จแล้ว ระบบจะหยุดส่ง Query หาเคสนั้นใน Periodic Task ทันที ช่วยประหยัด Network Bandwidth
5. **No SLA/MTTR Dependency**: การคำนวณ Downtime ของระบบจะไม่ผูกติดกับเวลาปิดของ TTS ทำให้ข้อมูลเชิงเทคนิคของ Network ยังคงถูกต้องและเป็นอิสระ

---

## 7. ขั้นตอนที่ 6: การปรับปรุงการแสดงผลและ User Experience

การแสดงผลหน้า **Incidents Management View** ([`IncidentsView.tsx`](file:///root/container/event-analyzer/frontend/src/components/IncidentsView.tsx)) ได้รับการปรับปรุงเพื่อลดการกินพื้นที่แนวนอน และแสดงข้อมูลงานซ่อม TTS อย่างครบถ้วน:

```mermaid
flowchart TD
    subgraph OldDesign["ดีไซน์เดิม (กินพื้นที่ ~300px)"]
        OldRow["StatusBadge เดิม + Quick Action Select (จัดวางแนวนอน)"]
    end

    subgraph NewDesign["ดีไซน์ใหม่ (ประหยัดพื้นที่ เหลือ ~115px-125px)"]
        NewStack["StatusBadge (Compact)<br/>↕ (จัดวางแนวตั้ง Stacking)<br/>Quick Action Select (Compact)"]
    end

    OldDesign -->|"ลดพื้นที่แนวนอนลงกว่า 55%"| NewDesign
```

### 1. การปรับแต่งคอลัมน์ "Status & Action":
* **Vertical Stacking Layout**: เปลี่ยนการจัดวาง `StatusBadge` และเมนูเปลี่ยนสถานะด่วน (`<select>`) จากแนวนอนเป็นแนวตั้ง (`flex flex-col items-start gap-1`)
* **Compact StatusBadge**: ลดขนาด Padding เป็น `px-2 py-0.5` และตัวหนังสือ `text-[11px]` พร้อมย่อข้อความ เช่น `STABILIZING (SOAK)` $\rightarrow$ `STABILIZING`, `RECOVERY CHECK` $\rightarrow$ `RECOVERY`, `MANUAL REVIEW` $\rightarrow$ `MANUAL`
* **Compact Quick Action**: ปรับฟอนต์เป็น `text-[10px]` พร้อมตัวเลือกย่อ (`Set DOWN`, `Set FLAPPING`, `Set STABILIZING`, `Set RECOVERY`, `Set RECOVERED`, `Set MANUAL`)
* **ผลลัพธ์**: คอลัมน์ลดความกว้างลงจาก ~300px เหลือเพียง **~115px - 125px** (ประหยัดพื้นที่แนวนอนไปได้มากกว่า **55%**) ทำให้ตารางมีพื้นที่แสดง Device & Target และ Timelines กว้างขึ้นอย่างเห็นได้ชัด

### 2. Badge และข้อมูลที่แสดงเพิ่มเติมในตาราง:
* **Incident Type Badge**: แสดงแท็ก `LINK` (สีฟ้าอมเขียว) หรือ `DEVICE` (สีน้ำเงิน)
* **TSS Ticket Badge**: แสดงกล่องสีส้มทองพร้อมไอคอนตั๋ว (`ticket_id_tss`) และแท็กสถานะ TTS แบบ Real-time เช่น `WIP`, `Resolved` หากยังไม่มีจะแสดงเป็น Pulse `Waiting TSS...`
* **Site & Circuit Badges**: แสดงแท็ก `SITE` (ชื่อชุมสาย) และแท็ก `CKT` (รหัสวงจร) พร้อมอุปกรณ์ปลายทาง (`⇄ Remote Device`) และทีมช่างที่รับผิดชอบ

### 3. TTS Work Order Card ใน Incident Detail Modal:
เมื่อคลิกดูรายละเอียดของ Incident จะพบการ์ดข้อมูลการซ่อมบำรุง TTS ที่ครบถ้วน:
* สถานะงานแก้ (Work Order Status)
* ทีมช่างผู้รับผิดชอบ (`repair_team`) และหน่วยงานที่รับผิดชอบ (`response_department`)
* พิกัด GPS ต้นทางและปลายทาง (`source_gps`, `dest_gps`)
* การ์ดย่อยสรุป **สาเหตุจริงของปัญหา (Actual Cause)** และ **วิธีการแก้ไข (Resolution)**
* ปุ่ม **"Sync TSS"** สำหรับดึงข้อมูลล่าสุดจาก ITSM ได้ทันทีเพียงคลิกเดียว

---

## 8. โครงสร้างฐานข้อมูลและฟิลด์ที่ได้รับการขยาย

ตาราง `incidents_incident` ในโมเดล Django ([`incidents/models.py`](file:///root/container/event-analyzer/backend/incidents/models.py)) ได้รับการขยายฟิลด์ผ่าน Migration `0007_...`:

| ชื่อฟิลด์ใน Database | ชนิดข้อมูล (Data Type) | แหล่งที่มาของข้อมูล | คำอธิบายการใช้งาน |
| :--- | :--- | :--- | :--- |
| `incident_type` | `CharField(10)` | Normalizer / Engine | ประเภท Incident (`LINK` หรือ `DEVICE`) |
| `site_name` | `CharField(255)` | IPGET API 1 & 2 | ชื่อชุมสาย / สถานีฐาน หรือศูนย์โทรคมนาคม |
| `circuit_id` | `CharField(100)` | IPGET API 1 / Regex | รหัสวงจร NTID ของสายสัญญาณ (เช่น `TBB...`, `308...`) |
| `remote_device` | `CharField(255)` | IPGET API 1 | ชื่อเราเตอร์หรืออุปกรณ์ฝั่งปลายทาง (`destname`) |
| `remote_interface` | `CharField(100)` | IPGET API 1 | พอร์ตปลายทางของวงจร (`destport`) |
| `ticket_id_tss` | `CharField(100)` | IPGET API 1 & 3 | หมายเลขใบสั่งงานแจ้งซ่อมบำรุง (TTS / ITSM Incident ID) |
| `tts_status` | `CharField(100)` | IPGET API 3 | สถานะงานแก้ในระบบ TTS (เช่น `Work In Progress`, `Resolved`) |
| `repair_team` | `CharField(255)` | IPGET API 3 | ทีมช่างผู้รับผิดชอบงานแก้ (`REPAIRTEAM`) |
| `response_department` | `CharField(255)` | IPGET API 3 | หน่วยงานต้นสังกัดผู้รับผิดชอบ (`RESPONSE_DEPARTMENT`) |
| `actual_cause` | `TextField` | IPGET API 3 | สาเหตุจริงของปัญหาจากใบสั่งงาน (`CAUSE_DETAIL`) |
| `resolution` | `TextField` | IPGET API 3 | วิธีการแก้ไขปัญหา / ผลการซ่อมบำรุง (`RESOLUTION`) |
| `source_gps` | `CharField(100)` | IPGET API 3 Description | พิกัด GPS ต้นทาง (Latitude, Longitude) |
| `dest_gps` | `CharField(100)` | IPGET API 3 Description | พิกัด GPS ปลายทาง (Latitude, Longitude) |
| `flap_count` | `IntegerField` | Link Engine | จำนวนรอบการกระพริบสะสมภายในหน้าต่างเวลา 30 นาที |
| `soak_until` | `DateTimeField` | Link Engine | เวลาสิ้นสุดการรอดูอาการความเสถียร 45 นาที |
| `net_downtime_seconds` | `BigIntegerField` | Link Engine | เวลาที่ระบบดับจริงสะสม (ไม่นับช่วงรอดูอาการ) |

---

## 9. คู่มือการทดสอบ ตรวจสอบ และวินิจฉัยระบบ

### 9.1 การรันชุดทดสอบความถูกต้องทั้งระบบ (Automated E2E Test Suite)
ระบบมีชุดทดสอบอัตโนมัติ 20 รายการ ครอบคลุม Webhook, Engine, Verification, API, Cache และ Frontend Assets:
```bash
python3 /root/.gemini/antigravity-cli/brain/1bc19313-feed-448a-97cd-da4c638050af/scratch/test_all_systems.py
```
*ผลลัพธ์ที่ถูกต้อง: ทุกการทดสอบต้องขึ้น `[PASS]` รวม 20/20 รายการ (100% Pass)*

---

### 9.2 คำสั่งทดสอบจำลอง Webhook และ Event Ingestion

#### 1. ทดสอบส่งเหตุการณ์เราเตอร์หลักดับ (Device Down):
```bash
curl -s -X POST http://localhost:8089/api/v1/integrations/prtg/webhook/ \
  -H "Content-Type: application/json" \
  -d '{
    "sensor": "Ping",
    "status": "Down",
    "device": "BKK-CORE-R01",
    "ip": "10.0.1.1",
    "message": "Ping timeout"
  }' | python3 -m json.tool
```

#### 2. ทดสอบส่งเหตุการณ์สายสัญญาณ/พอร์ตดับ (Link Down):
```bash
curl -s -X POST http://localhost:8089/api/v1/integrations/prtg/webhook/ \
  -H "Content-Type: application/json" \
  -d '{
    "sensor": "Traffic (HundredGigE0/1/0/0) To_CNX_Core",
    "status": "Down",
    "device": "BKK-CORE-R01",
    "ip": "10.0.1.1",
    "message": "Link down on port HundredGigE0/1/0/0"
  }' | python3 -m json.tool
```

#### 3. ทดสอบส่งสัญญาณพอร์ตกลับมาติด (Link Up / เข้าสู่ Soak Period):
```bash
curl -s -X POST http://localhost:8089/api/v1/integrations/prtg/webhook/ \
  -H "Content-Type: application/json" \
  -d '{
    "sensor": "Traffic (HundredGigE0/1/0/0) To_CNX_Core",
    "status": "Up",
    "device": "BKK-CORE-R01",
    "ip": "10.0.1.1",
    "message": "Link restored"
  }' | python3 -m json.tool
```

---

### 9.3 คำสั่งทดสอบการเชื่อมต่อ IPGET & TTS ผ่าน Django Shell

ผู้ดูแลระบบสามารถทดสอบการเชื่อมต่อ API ของ IPGET ได้โดยตรงผ่าน Django Shell:

```bash
docker exec -it eventanalyzer-backend python manage.py shell -c "
from integrations.ipget import IPGETClient

client = IPGETClient()

# 1. ทดสอบ Query Interface Alarms
if_alarms = client.fetch_interface_alarms(interval_hour=24)
print(f'Fetched {len(if_alarms)} interface alarms')

# 2. ทดสอบ Query Node Ping Alarms
node_alarms = client.fetch_node_alarms(interval_hour=24)
print(f'Fetched {len(node_alarms)} node ping alarms')

# 3. ทดสอบ Query TTS ด้วย Circuit NTID
tts_sample = client.fetch_tts_by_ntids(['TBB001234'])
print(f'TTS response count: {len(tts_sample)}')
"
```

---

### 9.4 คำสั่งทดสอบ On-Demand Ticket Sync API
สั่ง Trigger ให้ระบบอัปเดตข้อมูลตั๋ว TTS ของ Incident ใดๆ แบบ Real-time:
```bash
curl -s -X POST http://localhost:8089/api/v1/incidents/1/sync-ticket/ \
  -H "Content-Type: application/json" | python3 -m json.tool
```

---

### 9.5 คำสั่ง Rebuild Frontend และ Reload Web Server
เมื่อมีการแก้ไขไฟล์หน้าบ้าน (`frontend/src/`):
```bash
cd /root/container/event-analyzer/frontend && npm run build
docker exec eventanalyzer-frontend nginx -s reload
```

---
*เอกสารนี้รวบรวมและจัดทำขึ้นเพื่อเป็นมาตรฐานการทำงานของระบบ Multi-Source Network Event & Incident Analysis Platform ประจำปี 2026*
