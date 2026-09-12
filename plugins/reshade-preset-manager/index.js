const fs = require('fs');
const path = require('path');
const { backupPath } = require('../../src/backup');
const { detectFiveMAppDir, isFiveMAppDir } = require('../../src/fivem');

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

function targetIniPath(fivemAppDir) {
  return path.join(fivemAppDir, 'plugins', 'ReShade.ini');
}

function dryRun(params) {
  const fivemAppDir = params && params.fivemAppDir;
  const presetFile = params && params.presetFile;
  const warnings = [];

  if (!isFiveMAppDir(fivemAppDir)) {
    warnings.push(
      fivemAppDir
        ? `โฟลเดอร์ที่ระบุ (${fivemAppDir}) ไม่เหมือนโฟลเดอร์ FiveM จริง — เช็คอีกครั้งหรือกด "ค้นหา FiveM อัตโนมัติ"`
        : 'ยังไม่ได้ระบุโฟลเดอร์ FiveM.app — กด "ค้นหา FiveM อัตโนมัติ" หรือเลือกเองก่อน'
    );
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }
  if (!presetFile || !fs.existsSync(presetFile)) {
    warnings.push('เลือกไฟล์พรีเซ็ต .ini ก่อน');
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }
  const pluginsDir = path.join(fivemAppDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    warnings.push('ยังไม่พบโฟลเดอร์ plugins ของ FiveM — ติดตั้ง ReShade ก่อนอย่างน้อยหนึ่งครั้ง');
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }

  const dest = targetIniPath(fivemAppDir);
  const items = [
    { path: presetFile, sizeBytes: fs.statSync(presetFile).size, action: 'คัดลอกไปเป็น ReShade.ini' },
  ];
  if (fs.existsSync(dest)) {
    items.unshift({ path: dest, sizeBytes: fs.statSync(dest).size, action: 'สำรองไฟล์เดิมก่อน (กู้คืนได้)' });
  }
  return { items, totalSizeBytes: 0, warnings, blocked: false };
}

function run(params, context) {
  const fivemAppDir = params && params.fivemAppDir;
  const presetFile = params && params.presetFile;
  if (!isFiveMAppDir(fivemAppDir)) {
    return { success: false, message: 'ไม่พบโฟลเดอร์ FiveM ที่ระบุ' };
  }
  if (!presetFile || !fs.existsSync(presetFile)) {
    return { success: false, message: 'ไม่พบไฟล์พรีเซ็ตที่เลือก' };
  }
  const pluginsDir = path.join(fivemAppDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    return { success: false, message: 'ยังไม่พบโฟลเดอร์ plugins ของ FiveM — ติดตั้ง ReShade ก่อน' };
  }

  const dest = targetIniPath(fivemAppDir);
  const backups = [];
  if (fs.existsSync(dest)) {
    const record = backupPath(context.app, dest, 'ReShade.ini ก่อนเปลี่ยนพรีเซ็ต');
    if (record) backups.push(record);
  }
  fs.copyFileSync(presetFile, dest);

  return {
    success: true,
    message: `ใช้พรีเซ็ต ${path.basename(presetFile)} แล้ว — เปิดเกมเพื่อดูผล (กู้คืนพรีเซ็ตเดิมได้จากประวัติ)`,
    backups,
  };
}

module.exports = { dryRun, run, detect };
