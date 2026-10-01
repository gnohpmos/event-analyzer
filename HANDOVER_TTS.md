# เอกสารส่งมอบงานและสรุปความรู้ระบบ NT TTS (Trouble Ticket System)
> **สำหรับ AI Agent หรือนักพัฒนาที่จะเข้ามาทำงานต่อในโปรเจกต์นี้**  
> บันทึกข้อมูล ณ วันที่: 1 ตุลาคม 2026

---

## 1. ข้อมูลพื้นฐานของระบบ (System Overview)

- **ระบบ**: NT Trouble Ticket System (TTS) - ระบบรับแจ้งเหตุเสียและเปิดตั๋วงานของ บมจ. โทรคมนาคมแห่งชาติ (NT)
- **แพลตฟอร์มต้นทาง**: **Micro Focus / HP Service Manager (เวอร์ชัน 9.72.0026)**
- **URL เข้าใช้งาน**: `https://nttts.nc.ntplc.co.th/sm/ess.do?lang=en`
- **เทคโนโลยีฝั่ง Client**: Java Servlet Backend + ExtJS 3.x SPA + Multi-iframe Architecture
- **ไฟล์เก็บ Credentials**: [.env](file:///home/somphong/Projects/Test/TTS/.env)
  - `web: https://nttts.nc.ntplc.co.th/sm/ess.do?lang=en`
  - `User : catma`
  - `Password : Ait@1761@2`
- **Environment ในโปรเจกต์**:
  - Python 3.14 ติดตั้ง Virtual Environment อยู่ที่ `.venv/`
  - ไลบรารีหลัก: `playwright` (Chromium Headless), `fastapi`, `uvicorn`, `pydantic`, `httpx`, `beautifulsoup4`, `python-dotenv`

---

## 2. กฎเหล็กและข้อจำกัดทางเทคนิคที่ "ต้องระวังสูงสุด" (Critical Gotchas)

### ⚠️ กฎข้อที่ 1: จำกัด 1 บัญชีผู้ใช้ต่อ 1 Session เท่านั้น (Single-Session Concurrency)
- ระบบ Service Manager 9.72 ของ NT อนุญาตให้ผู้ใช้ `catma` ล็อกอินได้ครั้งละ **1 Session เท่านั้น**
- หากมี Session ค้างอยู่ หรือมี 2 Process พยายามล็อกอินพร้อมกัน Server จะดีด Error 403 / ปฏิเสธทันที:
  > `"Login failed. Maximum active logins for this user exceeded."`
- **สิ่งที่ต้องทำในโค้ดทุกครั้ง (Mandatory)**:
  1. ทุกสคริปต์ที่เปิดเบราว์เซอร์เข้าไปในระบบ **ต้องมีบล็อก `finally:`** สั่ง GET ไปที่ URL ปลดล็อกเสมอ:
     ```python
     await page.goto("https://nttts.nc.ntplc.co.th/sm/goodbye.jsp?lang=en", timeout=5000)
     ```
  2. หากจะทำ API หรือรันงานพร้อมกัน **ห้ามเปิดหลายเบราว์เซอร์พร้อมกันเด็ดขาด** ต้องวิ่งผ่านคิวหรือตัวล็อก (`asyncio.Lock()`) เพื่อต่อแถวเข้าทำทีละงาน (ดูตัวอย่างใน [queue_service.py](file:///home/somphong/Projects/Test/TTS/api/queue_service.py))

### ⚠️ กฎข้อที่ 2: โครงสร้าง Iframe ซ้อน Iframe
- หน้าเว็บหลัก (`ess.do`) เป็นเพียงกรอบนอก
- หน้าจอทำงานจริง (ตารางตั๋ว, แบบฟอร์มเปิดตั๋ว, Wizard ค้นหาวงจร) จะถูกโหลดใน iframe ชื่อขึ้นต้นด้วย `mif-comp-ext-gen-top...` (URL เช่น `/sm/detail.do?thread=...` หรือ `/sm/list.do?thread=...`)
- เวลาเขียน Playwright อย่าค้นหาใน `page` หลักอย่างเดียว ให้วนลูปหาใน `page.frames` โดยกรอง `f != page.main_frame`

### ⚠️ กฎข้อที่ 3: ExtJS 3.x DOM & Event Dispatching
- กล่องข้อความ `<textarea>` เช่น Description (`instance/action/action` หรือ `#X139`) อยู่ต่ำกว่าขอบหน้าจอ Playwright อาจมองว่า `visible=False`
- การส่ง Event ให้ ExtJS รับรู้ค่า ต้องใช้ `el.ownerDocument.createEvent('Event')` แทน `new Event('input')` เพื่อป้องกัน Error ข้าม Frame Context:
  ```javascript
  const el = document.querySelector("textarea[name='instance/action/action']") || document.getElementById('X139');
  if (el) {
      el.value = text;
      const ev = el.ownerDocument.createEvent('Event');
      ev.initEvent('input', true, true);
      el.dispatchEvent(ev);
  }
  ```

---

## 3. โครงสร้างข้อมูลและตารางตั๋ว (Ticket Data Structure)

### 3.1 หน้ารายการตั๋วหลัก (`list.do?thread=1`)
- อยู่ในแท็บ **"Incident Queue: Incidents Assign To My Group"**
- ตารางใช้ ExtJS Grid (`.x-grid3-row`, `.x-grid3-cell-inner`)
- แสดงผล 50 รายการต่อหน้า มีปุ่ม Pagination: `button.x-tbar-page-next`
- มี **23 คอลัมน์หลัก**:
  1. `Interaction ID` (เช่น `SD26094869`)
  2. `Incident ID` (เช่น `IM26112605`)
  3. `IS Parent Incident`
  4. `Alert SLA` (เช่น `over 100% SLA`, `Open`)
  5. `SLA` (เช่น `MTTR4`)
  6. `Status` (เช่น `Work In Progress`, `Complete`, `Open`)
  7. `IM Total Update` (ข้อความสรุปการดำเนินงานล่าสุด)
  8. `Repairteam` (ทีมช่างที่รับผิดชอบ เช่น ตป. บตป.2 (อุบลราชธานี))
  9. `Circuit ID` (รหัสวงจร เช่น `TBB145020`, `10.6.0.24`)
  10. `Source` (Node หรือสถานที่ต้นทาง)
  11. `Description` (รายละเอียดปัญหา)
  12. `Affected Service` (เช่น `Transmission Link Service`, `Link ID`)
  13. `Assignment Group`
  14. `Carrier Ticket`
  15. `Fault Time` (วันเวลาที่เกิดปัญหา เช่น `27/09/2026 16:25:30`)
  16. `IM Total Totaldown` (เวลารวมที่ดาวน์ เช่น `2 วัน 01:20:29`)
  17. `IM Total Updatetime`
  18. `IM Total Updateby`
  19. `Title` (ประเภทปัญหา เช่น `Down`, `Up-Down / Bouncing`)
  20. `Owner Group`
  21. `Endtoend Group`
  22. `Priority` (เช่น `1 - Critical`, `2 - High`, `3 - Average`)
  23. `Comment`

### 3.2 ไทม์ไลน์และประวัติการดำเนินงาน (Timeline / Activities)
เมื่อคลิกเปิดดูรายละเอียดตั๋ว (`SD...` หรือ `IM...`):
- มีแท็บย่อย: `Activities`, `Categorization`, `Proposed Solution`, `Tasks`, `Workflow`, `Assigned Flow`, `SLT View`
- **แท็บ `Activities`** คือตาราง Timeline ที่บันทึกประวัติการแก้ไขทั้งหมด มีคอลัมน์:
  - `Number`: ลำดับที่
  - `Date/Time`: วัน-เวลาที่อัปเดต
  - `Operator`: ชื่อผู้บันทึก/เจ้าหน้าที่
  - `Description`: ข้อความการประสานงาน, ผลการเทสสาย, สาเหตุ, การปิดงาน
  - `Type`: ประเภท (เช่น `Operator update`, `Complete`)
  - `Division`: แผนกของผู้บันทึก

---

## 4. ขั้นตอนการเปิด Ticket แจ้ง Link Down (SOP Workflow)

1. คลิกเมนูซ้ายมือ: `Miscellaneous` -> **`Open New Ticket`** (`[ext:tree-node-id='ROOT/Open New Ticket'] a`)
2. ระบบเปิดแท็บ **`Wizard: Search Circuit ID`** ใน Iframe
3. ช่องค้นหา Search By เลือก `Circuit ID` -> กรอกหมายเลข TBB (เช่น `TBB145014`) -> กดปุ่ม **`Search`**
4. ตารางผลลัพธ์จะแสดงวงจร ให้คลิกลิงก์ **`Open New Ticket`** ในคอลัมน์ SD Ticket
5. หน้าฟอร์มร่างตั๋ว (`Incident Form`) จะปรากฏขึ้น:
   - **ฟิลด์ผู้ติดต่อ**: `Information` (`CATMA`), `Source Contact` (`catma`), `Source Phone` (`0909070641`), `Source Email` (`catma@ait.co.th`) — ระบบจะ Autofill จากโปรไฟล์ให้
   - **Title**: ต้องเลือกค่าเป็น **`Down`**
   - **Description**: กรอกข้อความระบุปัญหา และข้อมูลพิกัด Node/IP/Interface ต้นทาง-ปลายทาง
6. **การส่งงาน**:
   - หากต้องการบันทึกจริง: กดปุ่ม **`Save & Exit`**
   - หากทดสอบ/ยกเลิก (Dry-run): กดปุ่ม **`Cancel`** ห้ามกด Save

---

## 5. แผนที่ซอร์สโค้ดและโครงสร้างโปรเจกต์ (Codebase Map)

```text
/home/somphong/Projects/Test/TTS/
├── .env                              # ข้อมูล URL และ Credentials (catma)
├── .venv/                            # Python Virtual Environment
├── HANDOVER_TTS.md                   # [เอกสารนี้] สรุปข้อมูลทั้งหมดสำหรับ AI ตัวถัดไป
├── README.md                         # เอกสารคู่มือสำหรับผู้ใช้งานทั่วไป
│
├── scraper.py                        # สคริปต์ดึงตั๋วทั้งหมดเป็น CSV/JSON (Auto-Pagination & Session Release)
├── search_ticket.py                  # สคริปต์ค้นหาตั๋วรายใบ (รองรับทั้ง Cache ท้องถิ่น และ Live Search + Timeline)
├── extract_tickets.py                # สคริปต์ต้นแบบสำหรับทดสอบการดึงข้อมูล
├── run_gateway.sh                    # สคริปต์สตาร์ท API Gateway Service (Port 8000)
├── test_api.py                       # ชุดทดสอบ API Gateway (Health check, Dry-run, Idempotency)
│
├── api/                              # ระบบ Centralized Ticket API Gateway
│   ├── app.py                        # FastAPI Server & Routes
│   ├── engine.py                     # Automation Worker ทำหน้าที่คุยกับ TTS (รองรับ Dry-Run และ Real Save)
│   ├── queue_service.py              # ตัวจัดการคิวและ Lock ป้องกัน Session ชน + Cooldown Timer
│   ├── schemas.py                    # Pydantic Request/Response Models
│   └── screenshots/                  # โฟลเดอร์เก็บภาพหลักฐานการทำงานของตั๋ว
│
├── tickets.csv                       # ตัวอย่างข้อมูลตั๋ว 50 รายการล่าสุด (UTF-8 BOM)
├── tickets.json                      # ตัวอย่างข้อมูลตั๋วรูปแบบ JSON
└── ขั้นตอนการเปิด link-down.pdf      # ไฟล์เอกสารคู่มือต้นฉบับจากผู้ใช้
```

---

## 6. สถานะปัจจุบันและคำแนะนำสำหรับงานถัดไป (Next Steps)

1. **สิ่งที่ทำเสร็จแล้ว**:
   - วิเคราะห์ระบบและเจาะลึก DOM/Iframe ของ Service Manager 9.72 เรียบร้อย
   - เขียนระบบ Scraper ดึงข้อมูลตารางและ Timeline ได้สมบูรณ์
   - ทดสอบ Flow การเปิด Ticket ตาม PDF บนหน้าเว็บจริงแล้ว (ยืนยันว่าทำได้จริง 100%)
   - พัฒนา Centralized API Gateway (FastAPI + Queue Lock + Dry-Run + Idempotency) ผ่านการทดสอบเรียบร้อย
2. **งานที่แนะนำให้ทำต่อ (หากต้องการขยายผล)**:
   - **Persistent Browser Context / Connection Pool**: ปัจจุบัน Worker เปิด-ปิดเบราว์เซอร์ใหม่ในแต่ละคำขอ หากต้องการให้ตอบสนองเร็วขึ้น (Latency ต่ำกว่า 3 วินาที) สามารถทำ Worker ที่ล็อกอินค้างไว้และคอย Heartbeat รักษาสภาพ Session ได้
   - **Webhook Callback**: เมื่อตั๋วถูกเปิดสำเร็จ หรือเมื่อตั๋วเดิมมีการอัปเดต Timeline ให้ยิง Webhook แจ้งเตือนไปยังระบบภายนอก (เช่น LINE Notify หรือ ChatOps ของทีมงาน)