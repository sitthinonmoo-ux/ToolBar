const fs = require('fs');
const path = require('path');
const { detectFiveMAppDir, isFiveMAppDir } = require('../../src/fivem');
const { citizenFxIniPath, upsertAddonLine, reshadeAckLine } = require('../../src/citizenfxIni');

// FiveM prints a full, specific acknowledgment line — not just a bare ID — e.g.
// "ReShade5=ID:420eb310 acknowledged that ReShade 5.x has a bug that will lead to
// game crashes". We can compute that exact line ourselves (see src/citizenfxIni.js),
// so pasting from F8 is only needed as a manual override/fallback.
function extractAddonLine(raw) {
  if (!raw || !raw.trim()) return reshadeAckLine();
  const cleaned = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\[[^\]]*\]\s*/, '')) // strip "[script:reshade] " style console prefixes
    .join('\n');
  const fullLine = cleaned.match(/ReShade\d*\s*=\s*ID:[0-9a-fA-F]+[^\r\n]*/i);
  if (fullLine) return fullLine[0].trim();
  const idOnly = raw.trim().match(/^(?:ID:)?([0-9a-fA-F]{4,})$/i);
  return idOnly ? `ReShade5=ID:${idOnly[1]} acknowledged that ReShade 5.x has a bug that will lead to game crashes` : null;
}

async function detect() {
  const found = await detectFiveMAppDir({ forceRescan: true });
  if (!found) {
    return {
      path: null,
      message: 'ไม่พบโฟลเดอร์ FiveM ที่ตำแหน่งมาตรฐาน (%localappdata%\\FiveM\\FiveM.app) — เลือกเองถ้าเคยติดตั้งไว้ที่อื่น',
    };
  }
  return { path: found, message: `พบโฟลเดอร์ FiveM ที่ ${found}` };
}

function dryRun(params) {
  const fivemAppDir = params && params.fivemAppDir;
  const warnings = [];
  if (!isFiveMAppDir(fivemAppDir)) {
    warnings.push(
      fivemAppDir
        ? `โฟลเดอร์ที่ระบุ (${fivemAppDir}) ไม่เหมือนโฟลเดอร์ FiveM จริง — เช็คอีกครั้งหรือกด "ค้นหา FiveM อัตโนมัติ"`
        : 'ยังไม่ได้ระบุโฟลเดอร์ FiveM.app — กด "ค้นหา FiveM อัตโนมัติ" หรือเลือกเอง'
    );
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }
  const iniPath = citizenFxIniPath(fivemAppDir);
  if (!fs.existsSync(iniPath)) {
    warnings.push('ไม่พบ CitizenFX.ini ในโฟลเดอร์นี้ — เปิด FiveM อย่างน้อย 1 ครั้งก่อน');
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }
  const line = extractAddonLine(params && params.addonId);
  if (!line) {
    warnings.push('หาบรรทัด ReShade5=ID:... ในข้อความที่วางไม่เจอ — วางทั้งบล็อกตั้งแต่ [Addons] ที่เห็นใน F8 มาเลย หรือเว้นว่างไว้ให้คำนวณอัตโนมัติ');
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }
  const content = fs.readFileSync(iniPath, 'utf8');
  const hasSection = /\[Addons\]/i.test(content);
  const auto = !(params && params.addonId && params.addonId.trim());
  return {
    items: [
      { path: iniPath, sizeBytes: fs.statSync(iniPath).size, action: 'สำรองไฟล์เดิมเป็น .bak ก่อนแก้ไข' },
      {
        path: '[Addons]',
        sizeBytes: 0,
        action: `${hasSection ? 'อัปเดตบรรทัดเป็น' : 'เพิ่มหัวข้อ [Addons] ใหม่พร้อม'} ${line}${auto ? ' (คำนวณอัตโนมัติจากชื่อเครื่องนี้)' : ''}`,
      },
    ],
    totalSizeBytes: 0,
    warnings: [],
    blocked: false,
  };
}

function run(params) {
  const fivemAppDir = params && params.fivemAppDir;
  if (!isFiveMAppDir(fivemAppDir)) {
    return { success: false, message: 'ไม่พบโฟลเดอร์ FiveM ที่ระบุ' };
  }
  const iniPath = citizenFxIniPath(fivemAppDir);
  if (!fs.existsSync(iniPath)) {
    return { success: false, message: 'ไม่พบ CitizenFX.ini — เปิด FiveM อย่างน้อย 1 ครั้งก่อน' };
  }
  const line = extractAddonLine(params && params.addonId);
  if (!line) {
    return { success: false, message: 'หาบรรทัด ReShade5=ID:... ในข้อความที่วางไม่เจอ ลองวางทั้งบล็อกจาก F8 อีกครั้ง หรือเว้นว่างไว้ให้คำนวณอัตโนมัติ' };
  }

  const original = fs.readFileSync(iniPath, 'utf8');
  const bakPath = `${iniPath}.bak-${Date.now()}`;
  fs.writeFileSync(bakPath, original, 'utf8');

  const updated = upsertAddonLine(original, line);
  fs.writeFileSync(iniPath, updated, 'utf8');

  return {
    success: true,
    message: `เขียน "${line}" ลง CitizenFX.ini แล้ว (สำรองไฟล์เดิมไว้ที่ ${path.basename(bakPath)}) — เข้าเกมได้เลย`,
  };
}

module.exports = { dryRun, run, detect };
