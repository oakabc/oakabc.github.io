/**
 * ระบบจองคอมพิวเตอร์ห้อง Lab — backend บน Google Apps Script + Google Sheets
 *
 * วิธีติดตั้ง (ดู DEPLOY.md ประกอบ):
 * 1. สร้าง Google Sheet ใหม่ → Extensions → Apps Script → วางโค้ดนี้ทับทั้งหมด
 * 2. ตั้ง Timezone ของโปรเจกต์เป็น Asia/Bangkok (Project Settings)
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. คัดลอก URL ที่ลงท้าย /exec ไปวางใน config.js ของหน้าเว็บ
 */

const SHEET_NAME = 'Bookings';
const TOTAL_SEATS = 56;
const SEATS_PER_ROW = 7;   // [1,2,3, ทางเดิน ,4,5,6,7]
const AISLE_AFTER = 3;
const SLOT_START_HOUR = 13; // 13:00
const SLOT_MINUTES = 30;    // ขั้นต่ำ 30 นาที
const TOTAL_SLOTS = 8;      // 13:00–17:00 = 8 ช่อง
const FRIDAYS_AHEAD = 4;    // เปิดจองล่วงหน้า 4 ศุกร์
const ADMIN_PIN = '000000'; // ← เปลี่ยนรหัสผู้ดูแลก่อนใช้งานจริง!
const CODE_VERSION = 4;     // ตัวเลขเวอร์ชันโค้ด — ใช้เช็คว่า deployment รันโค้ดล่าสุดจริง

// ---------- helpers ----------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function slotLabel_(slot) {
  const mins = SLOT_START_HOUR * 60 + slot * SLOT_MINUTES;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
}

function toDateStr_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// แปลงค่าวันที่จากเซลล์กลับเป็นสตริง yyyy-MM-dd เสมอ
// สำคัญ: ถ้าเซลล์ถูก Sheets แปลงเป็น Date ต้อง format ด้วย timezone ของ "สเปรดชีต"
// (ไม่ใช่ของสคริปต์) จึงจะได้วันที่ตรงกับที่พิมพ์ลงไป ไม่เพี้ยนข้ามวัน
function normDate_(v) {
  if (v instanceof Date) {
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return String(v).trim();
}

function upcomingFridays_() {
  const out = [];
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (out.length < FRIDAYS_AHEAD) {
    if (d.getDay() === 5) {
      const isToday = toDateStr_(d) === toDateStr_(now);
      if (!isToday || now.getHours() < SLOT_START_HOUR + (TOTAL_SLOTS * SLOT_MINUTES) / 60) {
        out.push(toDateStr_(d));
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function maskName_(name) {
  const n = String(name).trim();
  if (n.length <= 3) return n.charAt(0) + '***';
  return n.slice(0, 3) + '***';
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['id', 'code', 'date', 'seat', 'startSlot', 'endSlot', 'name', 'createdAt']);
    // เก็บคอลัมน์วันที่เป็นข้อความ กัน Sheets แปลง "2026-08-07" เป็น Date อัตโนมัติ
    // (ตั้งครั้งเดียวตอนสร้างชีต — normDate_ ป้องกันเซลล์ Date เก่าอยู่แล้ว)
    sh.getRange('C:C').setNumberFormat('@');
  }
  return sh;
}

// ชีตเก็บเครื่องที่ปิดให้บริการ (ซ่อม ฯลฯ)
function getBlockedSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Blocked');
  if (!sh) {
    sh = ss.insertSheet('Blocked');
    sh.appendRow(['seat', 'reason', 'blockedAt']);
  }
  return sh;
}

function readBlocked_() {
  const rows = getBlockedSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === '' || rows[i][0] === null) continue;
    out.push({ row: i + 1, seat: Number(rows[i][0]), reason: String(rows[i][1] || '') });
  }
  return out;
}

function readBookings_(sh) {
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || String(r[0]) === 'id') continue; // ข้ามแถวว่างและแถวหัวตาราง
    out.push({
      row: i + 1, // แถวจริงใน Sheet (ไว้ใช้ตอนยกเลิก)
      id: String(r[0]),
      code: String(r[1]),
      date: normDate_(r[2]),
      seat: Number(r[3]),
      startSlot: Number(r[4]),
      endSlot: Number(r[5]),
      name: String(r[6]),
      createdAt: String(r[7]),
    });
  }
  return out;
}

function validate_(p) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.date || ''));
  if (!m) return 'รูปแบบวันที่ไม่ถูกต้อง';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return 'รูปแบบวันที่ไม่ถูกต้อง';
  if (d.getDay() !== 5) return 'จองได้เฉพาะวันศุกร์เท่านั้น';

  const todayStr = toDateStr_(new Date());
  if (String(p.date) < todayStr) return 'ไม่สามารถจองวันที่ผ่านมาแล้วได้';

  const seat = Number(p.seat), s = Number(p.startSlot), e = Number(p.endSlot);
  if (!(seat >= 1 && seat <= TOTAL_SEATS) || seat !== Math.floor(seat)) return 'หมายเลขเครื่องไม่ถูกต้อง';
  if (s !== Math.floor(s) || e !== Math.floor(e)) return 'ช่วงเวลาไม่ถูกต้อง';
  if (s < 0 || e > TOTAL_SLOTS || s >= e) return 'ช่วงเวลาไม่ถูกต้อง (13:00–17:00 ขั้นต่ำ 30 นาที)';

  if (String(p.date) === todayStr) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const slotStartMins = SLOT_START_HOUR * 60 + s * SLOT_MINUTES;
    if (slotStartMins + SLOT_MINUTES <= nowMins) return 'ช่วงเวลานี้ผ่านไปแล้ว';
  }

  if (!p.name || String(p.name).trim().length < 2) return 'กรุณากรอกชื่อผู้จอง (อย่างน้อย 2 ตัวอักษร)';
  return null;
}

// ---------- endpoints ----------
function doGet(e) {
  // e จะมีค่าก็ต่อเมื่อถูกเรียกผ่าน HTTP (เปิด URL) — กด Run ใน editor e จะเป็น undefined
  const action = e && e.parameter ? String(e.parameter.action || '') : '';

  if (action === 'config') {
    const labels = [];
    for (let i = 0; i <= TOTAL_SLOTS; i++) labels.push(slotLabel_(i));
    // ข้อมูลวินิจฉัยชั่วคราว: ดูว่าแถวแรกของชีตเก็บวันที่เป็นชนิดอะไร อ่านกลับได้ค่าอะไร
    let debug;
    try {
      const vals = getSheet_().getDataRange().getValues();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      debug = {
        totalRows: vals.length,
        sheetNames: ss.getSheets().map(function (s) { return s.getName() + ':' + s.getLastRow(); }),
        sheetTz: ss.getSpreadsheetTimeZone(),
        scriptTz: Session.getScriptTimeZone(),
      };
      for (let i = 0; i < vals.length && i < 4; i++) {
        const v = vals[i][2];
        debug['row' + (i + 1)] = {
          type: Object.prototype.toString.call(v),
          raw: String(v).slice(0, 60),
          norm: (function () { try { return normDate_(v); } catch (e) { return 'ERR: ' + e; } })(),
          colA: String(vals[i][0]).slice(0, 12),
        };
      }
    } catch (e) {
      debug = { err: String(e) };
    }
    return json_({
      version: CODE_VERSION,
      debug: debug,
      totalSeats: TOTAL_SEATS,
      seatsPerRow: SEATS_PER_ROW,
      aisleAfter: AISLE_AFTER,
      totalSlots: TOTAL_SLOTS,
      slotMinutes: SLOT_MINUTES,
      slotLabels: labels,
      fridays: upcomingFridays_(),
    });
  }

  if (action === 'bookings') {
    const date = String(e.parameter.date || '');
    const bookings = readBookings_(getSheet_())
      .filter(function (b) { return b.date === date; })
      .map(function (b) {
        return { id: b.id, date: b.date, seat: b.seat, startSlot: b.startSlot, endSlot: b.endSlot, name: maskName_(b.name) };
      });
    const blocked = readBlocked_().map(function (b) { return { seat: b.seat, reason: b.reason }; });
    return json_({ bookings: bookings, blocked: blocked });
  }

  return json_({ error: 'unknown action' });
}

function doPost(e) {
  if (!e || !e.postData) return json_({ error: 'ต้องเรียกผ่าน HTTP POST เท่านั้น' });
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  if (body.action === 'book') return bookSeat_(body);
  if (body.action === 'cancel') return cancelBooking_(body);
  // admin actions (ต้องแนบ pin ที่ตรงกับ ADMIN_PIN)
  if (body.action === 'adminlist') return adminGuard_(body, adminList_);
  if (body.action === 'block') return adminGuard_(body, adminBlock_);
  if (body.action === 'unblock') return adminGuard_(body, adminUnblock_);
  if (body.action === 'admincancel') return adminGuard_(body, adminCancel_);
  return json_({ error: 'unknown action' });
}

function adminGuard_(body, fn) {
  if (String(body.pin) !== ADMIN_PIN) return json_({ error: 'รหัสผู้ดูแลไม่ถูกต้อง' });
  return fn(body);
}

function adminList_(p) {
  const bookings = readBookings_(getSheet_())
    .filter(function (b) { return b.date === String(p.date); })
    .map(function (b) {
      return { id: b.id, date: b.date, seat: b.seat, startSlot: b.startSlot, endSlot: b.endSlot, name: b.name };
    })
    .sort(function (a, b) { return a.seat - b.seat || a.startSlot - b.startSlot; });
  const blocked = readBlocked_().map(function (b) { return { seat: b.seat, reason: b.reason }; });
  return json_({ ok: true, bookings: bookings, blocked: blocked });
}

function adminBlock_(p) {
  const seat = Number(p.seat);
  if (!(seat >= 1 && seat <= TOTAL_SEATS) || seat !== Math.floor(seat)) {
    return json_({ error: 'หมายเลขเครื่องไม่ถูกต้อง' });
  }
  const reason = String(p.reason || '').trim();
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json_({ error: 'ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง' }); }
  try {
    const sh = getBlockedSheet_();
    const existing = readBlocked_().filter(function (b) { return b.seat === seat; })[0];
    if (existing) sh.getRange(existing.row, 2).setValue(reason); // ปิดอยู่แล้ว → อัปเดตเหตุผล
    else sh.appendRow([seat, reason, new Date().toISOString()]);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function adminUnblock_(p) {
  const seat = Number(p.seat);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json_({ error: 'ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง' }); }
  try {
    const b = readBlocked_().filter(function (x) { return x.seat === seat; })[0];
    if (b) getBlockedSheet_().deleteRow(b.row);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function adminCancel_(p) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return json_({ error: 'ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง' }); }
  try {
    const sh = getSheet_();
    const b = readBookings_(sh).filter(function (x) { return x.id === String(p.id); })[0];
    if (!b) return json_({ error: 'ไม่พบรายการจอง' });
    sh.deleteRow(b.row);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function bookSeat_(p) {
  const err = validate_(p);
  if (err) return json_({ error: err });

  // LockService กันการจองพร้อมกันชนกัน (race condition)
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return json_({ error: 'ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง' });
  }
  try {
    const sh = getSheet_();
    const seat = Number(p.seat), s = Number(p.startSlot), en = Number(p.endSlot);
    const blocked = readBlocked_().filter(function (b) { return b.seat === seat; })[0];
    if (blocked) {
      return json_({ error: 'เครื่อง ' + seat + ' ปิดให้บริการชั่วคราว' + (blocked.reason ? ' (' + blocked.reason + ')' : '') });
    }
    const clash = readBookings_(sh).filter(function (b) {
      return b.date === p.date && b.seat === seat && s < b.endSlot && en > b.startSlot;
    })[0];
    if (clash) {
      return json_({ error: 'เครื่อง ' + seat + ' ถูกจองแล้วช่วง ' + slotLabel_(clash.startSlot) + '–' + slotLabel_(clash.endSlot) });
    }
    const id = Utilities.getUuid();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const name = String(p.name).trim();
    sh.appendRow([id, code, String(p.date), seat, s, en, name, new Date().toISOString()]);
    return json_({
      ok: true,
      booking: { id: id, code: code, date: String(p.date), seat: seat, start: slotLabel_(s), end: slotLabel_(en), name: name },
    });
  } finally {
    lock.releaseLock();
  }
}

function cancelBooking_(p) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return json_({ error: 'ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง' });
  }
  try {
    const sh = getSheet_();
    const b = readBookings_(sh).filter(function (x) { return x.id === String(p.id); })[0];
    if (!b) return json_({ error: 'ไม่พบรายการจอง' });
    if (b.code !== String(p.code)) return json_({ error: 'รหัสยกเลิกไม่ถูกต้อง' });
    sh.deleteRow(b.row);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
