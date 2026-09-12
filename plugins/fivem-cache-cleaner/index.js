const fs = require('fs');
const path = require('path');
const { dirSize, backupPath } = require('../../src/backup');
const { detectFiveMAppDir, isFiveMAppDir, isFiveMRunning } = require('../../src/fivem');

const KNOWN_FOLDERS = ['cache', 'server-cache', 'server-cache-priv', 'nui-storage'];

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

function resolveTargets(params) {
  const fivemAppDir = params && params.fivemAppDir;
  if (!isFiveMAppDir(fivemAppDir)) return null;
  const selected = (params && params.folders) || KNOWN_FOLDERS.filter((f) => f !== 'nui-storage');
  const base = path.join(fivemAppDir, 'data');
  return selected
    .filter((name) => KNOWN_FOLDERS.includes(name))
    .map((name) => path.join(base, name))
    .filter((full) => fs.existsSync(full));
}

async function dryRun(params) {
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

  const running = await isFiveMRunning();
  const targets = resolveTargets(params) || [];
  const items = targets.map((full) => ({
    path: full,
    sizeBytes: dirSize(full),
    action: 'ย้ายไปสำรอง แล้วลบต้นทาง (กู้คืนได้)',
  }));
  const totalSizeBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  if (running) warnings.push('FiveM กำลังทำงานอยู่ — ปิดโปรแกรมก่อนล้างแคชเพื่อความปลอดภัย');
  if (items.length === 0) warnings.push('ไม่พบโฟลเดอร์แคชที่เลือก อาจยังไม่เคยรัน FiveM หรือเคลียร์ไปแล้ว');
  return { items, totalSizeBytes, warnings, blocked: running };
}

async function run(params, context) {
  const fivemAppDir = params && params.fivemAppDir;
  if (!isFiveMAppDir(fivemAppDir)) {
    return { success: false, message: 'ไม่พบโฟลเดอร์ FiveM ที่ระบุ' };
  }
  if (await isFiveMRunning()) {
    return { success: false, message: 'ปิด FiveM ก่อนแล้วลองใหม่อีกครั้ง' };
  }
  const targets = resolveTargets(params) || [];
  if (targets.length === 0) {
    return { success: false, message: 'ไม่พบโฟลเดอร์ที่จะล้าง' };
  }
  const backups = [];
  for (const full of targets) {
    const record = backupPath(context.app, full, `FiveM cache: ${path.basename(full)}`);
    if (record) backups.push(record);
  }
  return {
    success: true,
    message: `ล้างแคชสำเร็จ ${backups.length} โฟลเดอร์ (กู้คืนได้จากประวัติ)`,
    backups,
  };
}

module.exports = { dryRun, run, detect };
