# วิธี Deploy: GitHub Pages + Google Sheets (ฟรีทั้งหมด)

สถาปัตยกรรม:

```
มือถือนักศึกษา (สแกน QR)
   │
   ▼
GitHub Pages  ──── โฮสต์หน้าเว็บ (โฟลเดอร์ docs/)
   │  fetch
   ▼
Google Apps Script Web App ──── API (apps-script/Code.gs)
   │
   ▼
Google Sheets ──── ฐานข้อมูล (เห็น/แก้รายการจองใน Sheet ได้เลย)
```

## ขั้นที่ 1 — สร้างฐานข้อมูล Google Sheets + API

1. สร้าง Google Sheet ใหม่ที่ https://sheets.new ตั้งชื่อ เช่น "Lab Booking DB"
2. เมนู **Extensions → Apps Script**
3. ลบโค้ดเดิม แล้ววางโค้ดทั้งหมดจากไฟล์ [`apps-script/Code.gs`](apps-script/Code.gs)
   — **อย่าลืมเปลี่ยน `ADMIN_PIN` (บรรทัดบนสุดๆ ของไฟล์) จาก `000000` เป็นรหัสของคุณเอง**
4. ไปที่ **Project Settings (ไอคอนเฟือง) → Time zone** เลือก **(GMT+07:00) Bangkok**
5. กด **Deploy → New deployment**
   - ประเภท: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** ← สำคัญ ไม่งั้นนักศึกษาเรียกไม่ได้
6. กด Authorize ตามขั้นตอน แล้ว**คัดลอก Web app URL** (ลงท้ายด้วย `/exec`)

> ทดสอบได้ทันที: เปิด `<URL>?action=config` ในเบราว์เซอร์ ต้องเห็น JSON

แถว (row) แรกของชีต `Bookings` จะถูกสร้างอัตโนมัติเมื่อมีการเรียกครั้งแรก
คอลัมน์: `id, code, date, seat, startSlot, endSlot, name, createdAt`
(slot 0 = 13:00–13:30, slot 7 = 16:30–17:00 — ลบแถวใน Sheet = ยกเลิกการจองได้เลย)

## ขั้นที่ 2 — ใส่ URL ลงหน้าเว็บ

เปิดไฟล์ [`docs/config.js`](docs/config.js) วาง URL จากขั้นที่ 1:

```js
window.API_BASE = 'https://script.google.com/macros/s/AKfycb.../exec';
```

## ขั้นที่ 3 — Deploy ขึ้น GitHub Pages

**ทางเลือก A: repo ใหม่**

```bash
cd lab-booking
git init && git add . && git commit -m "Lab booking system"
gh repo create lab-booking --public --source=. --push
```

จากนั้นใน GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch: `main`, Folder: `/docs`** → Save
รอสักครู่ เว็บจะอยู่ที่ `https://<username>.github.io/lab-booking/`

**ทางเลือก B: ใช้ repo `oakabc.github.io` ที่มีอยู่แล้ว**

คัดลอกไฟล์ในโฟลเดอร์ `docs/` ไปไว้ที่ `oakabc.github.io/lab-booking/` แล้ว push
เว็บจะอยู่ที่ `https://oakabc.github.io/lab-booking/`

## ขั้นที่ 4 — พิมพ์โปสเตอร์ QR

เปิด `https://<โดเมนจริง>/lab-booking/qr.html` แล้วกด **Cmd/Ctrl+P**
ได้โปสเตอร์ QR เดียวลิงก์ไปหน้าผังที่นั่ง — นักศึกษาสแกนแล้วเห็นผังทั้งห้อง
เลือกเครื่อง เลือกเวลา แล้วกดจอง
(QR ฝัง URL ตามโดเมนที่เปิดหน้าโดยอัตโนมัติ — ต้องเปิดจากโดเมนจริง ไม่ใช่ localhost)

---

## หน้าผู้ดูแล (admin)

เปิด `https://<โดเมนจริง>/lab-booking/admin.html` แล้วใส่รหัส PIN
(ค่าที่ตั้งไว้ใน `ADMIN_PIN` ของ `Code.gs`) ทำได้:

- **ปิดเครื่องไม่ให้จอง** — แตะเครื่องในผัง ใส่เหตุผล (เช่น ส่งซ่อม)
  เครื่องจะขึ้นสีเทา 🔧 ในหน้านักศึกษาและจองไม่ได้ / แตะซ้ำเพื่อเปิดกลับ
- **ดูรายการจองชื่อเต็ม + ยกเลิกการจองของใครก็ได้** (ไม่ต้องใช้รหัส 6 หลักของผู้จอง)

การปิดเครื่องไม่ลบการจองเดิมที่มีอยู่ — ถ้าเครื่องเสียก่อนวันศุกร์
ให้กดยกเลิกการจองจากรายการด้านล่างแล้วแจ้งผู้จอง
(รายการเครื่องที่ปิดอยู่ดูได้ในชีต `Blocked` ของ Google Sheet ด้วย)

## คำถามที่พบบ่อย

**ดูรายการจองทั้งหมดที่ไหน?** — เปิด Google Sheet ดูชีต `Bookings` ได้เลย
ลบแถว = ยกเลิกการจอง

**แก้จำนวนเครื่อง/เวลาได้ที่ไหน?** — ค่าคงที่ด้านบนของ `Code.gs`

**ถ้าอยากใช้ Node server เดิม (โฟลเดอร์ public/ + server.js)?** —
GitHub Pages รัน Node ไม่ได้ ต้อง deploy ที่ Render / Railway / Fly.io แทน
(มี free tier แต่เครื่องอาจหลับเมื่อไม่มีคนใช้) — เวอร์ชัน Google Sheets
เหมาะกับงานนี้มากกว่าเพราะฟรีถาวรและดูข้อมูลง่าย

**ข้อจำกัดของ Apps Script?** — รองรับโหลดระดับห้องเรียนสบายๆ
(โควตาฟรี ~20,000 requests/วัน) แต่ตอบช้ากว่า server จริงเล็กน้อย (~1-2 วินาที)
