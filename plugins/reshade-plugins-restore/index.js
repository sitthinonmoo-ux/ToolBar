const fs = require('fs');
const path = require('path');
const os = require('os');
const extractZip = require('extract-zip');
const { backupPath } = require('../../src/backup');
const { detectFiveMAppDir, isFiveMAppDir, isFiveMRunning } = require('../../src/fivem');
const debugLog = require('../../src/debugLog');

// Public release asset — the actual bytes (ReShade + FiveM's own shader library plus a
// personally-added addon pack) are too big to ship inside the app installer itself
// (~93MB), so they're fetched on demand instead. Anyone with this URL can download it;
// see the repo's own README for the licensing note about the bundled third-party addon.
const PLUGINS_PACK_URL = 'https://github.com/sitthinonmoo-ux/toolbar-reshade-plugins/releases/download/v1/reshade-plugins.zip';

async function detect(inputKey) {
  if (inputKey !== 'fivemAppDir') {
    return { path: null, message: 'ช่องนี้ไม่รองรับการค้นหาอัตโนมัติ — เลือกโฟลเดอร์เอง' };
  }
  const found = await detectFiveMAppDir({ forceRescan: true });
  if (!found) {
    return {
      path: null,
      message: 'ไม่พบโฟลเดอร์ FiveM ที่ตำแหน่งมาตรฐาน (%localappdata%\\FiveM\\FiveM.app) — เลือกเองถ้าเคยติดตั้งไว้ที่อื่น',
    };
  }
  return { path: found, message: `พบโฟลเดอร์ FiveM ที่ ${found}` };
}

async function fetchWithTimeout(url, ms = 120000) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(ms) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`เชื่อมต่อ ${new URL(url).hostname} ไม่สำเร็จภายใน ${ms / 1000} วินาที — เช็คอินเทอร์เน็ต/ไฟร์วอลล์`);
    }
    throw err;
  }
}

// Downloads the pack zip and extracts it into a fresh temp folder, whose top-level
// entries mirror the plugins folder exactly (the zip was made from "plugins\*", no
// wrapper folder) — so callers can treat it the same way a manually-picked folder
// used to be treated before this plugin switched from a folder-picker to a fetch.
async function downloadPack(log) {
  log('downloading plugins pack from GitHub release');
  const res = await fetchWithTimeout(PLUGINS_PACK_URL, 120000);
  if (!res.ok) throw new Error(`ดาวน์โหลดชุด ReShade plugins ไม่สำเร็จ (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  log(`download complete, ${buf.length} bytes`);

  const tmpZip = path.join(os.tmpdir(), `reshade-plugins-${Date.now()}.zip`);
  const tmpExtract = path.join(os.tmpdir(), `reshade-plugins-extract-${Date.now()}`);
  fs.writeFileSync(tmpZip, buf);
  try {
    await extractZip(tmpZip, { dir: tmpExtract });
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }
  return tmpExtract;
}

function listSourceEntries(sourceFolder) {
  if (!sourceFolder || !fs.existsSync(sourceFolder)) return [];
  return fs.readdirSync(sourceFolder, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    src: path.join(sourceFolder, entry.name),
  }));
}

async function dryRun(params) {
  const fivemAppDir = params && params.fivemAppDir;
  const warnings = [];
  if (!isFiveMAppDir(fivemAppDir)) {
    warnings.push(
      fivemAppDir
        ? `โฟลเดอร์ที่ระบุ (${fivemAppDir}) ไม่เหมือนโฟลเดอร์ FiveM จริง — เช็คอีกครั้งหรือกด "ค้นหา FiveM อัตโนมัติ"`
        : 'ยังไม่ได้ระบุโฟลเดอร์ FiveM.app — กด "ค้นหา FiveM อัตโนมัติ" หรือเลือกเองก่อน'
    );
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }
  const pluginsDir = path.join(fivemAppDir, 'plugins');
  const items = [
    {
      path: pluginsDir,
      action: 'ดาวน์โหลดชุด ReShade plugins ที่เตรียมไว้จาก GitHub (~93MB) แล้วคัดลอกทับทั้งโฟลเดอร์ (ของเดิมที่ชื่อชนกันจะถูกสำรองไว้ก่อน)',
    },
  ];
  const running = await isFiveMRunning();
  if (running) warnings.push('FiveM กำลังทำงานอยู่ — ไฟล์ในโฟลเดอร์ plugins ถูกล็อกไว้ ปิดโปรแกรมก่อนแล้วลองใหม่');
  return { items, totalSizeBytes: 0, warnings, blocked: running };
}

async function run(params, context) {
  const fivemAppDir = params && params.fivemAppDir;
  if (!isFiveMAppDir(fivemAppDir)) {
    return { success: false, message: 'ไม่พบโฟลเดอร์ FiveM ที่ระบุ' };
  }
  if (await isFiveMRunning()) {
    return { success: false, message: 'ปิด FiveM ก่อนแล้วลองใหม่อีกครั้ง — ไฟล์ในโฟลเดอร์ plugins ถูกล็อกไว้ระหว่างเปิดโปรแกรมอยู่' };
  }

  const log = (msg) => debugLog.log(context.app, `[reshade-plugins-restore] ${msg}`);
  let extractedDir;
  try {
    extractedDir = await downloadPack(log);
  } catch (err) {
    log(`downloadPack FAILED: ${err.stack || err.message}`);
    return { success: false, message: err.message };
  }

  try {
    const entries = listSourceEntries(extractedDir);
    if (entries.length === 0) {
      return { success: false, message: 'ชุดที่ดาวน์โหลดมาว่างเปล่า — ลองใหม่อีกครั้ง' };
    }

    const pluginsDir = path.join(fivemAppDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const total = entries.length;
    const tick = (done) => context.onProgress && context.onProgress({ done, total });
    const backups = [];

    entries.forEach((entry, i) => {
      const dest = path.join(pluginsDir, entry.name);
      if (fs.existsSync(dest)) {
        const record = backupPath(context.app, dest, `ReShade plugins restore: เดิม ${entry.name}`);
        if (record) backups.push(record);
      }
      fs.cpSync(entry.src, dest, { recursive: true });
      tick(i + 1);
    });

    log(`copied ${entries.length} item(s) into ${pluginsDir}, ${backups.length} backed up`);
    return {
      success: true,
      message: `วางไฟล์ ReShade plugins ทับ ${pluginsDir} แล้ว (${entries.length} รายการ, ของเดิม ${backups.length} รายการสำรองไว้ กู้คืนได้จากประวัติ)`,
      backups,
    };
  } finally {
    fs.rmSync(extractedDir, { recursive: true, force: true });
  }
}

module.exports = { dryRun, run, detect };
