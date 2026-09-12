const fs = require('fs');
const path = require('path');
const { backupPath } = require('../../src/backup');
const { detectFiveMAppDir, isFiveMAppDir, isFiveMRunning } = require('../../src/fivem');
const { findGTA5Exe } = require('../../src/gta5');
const { clearReShadeAck } = require('../../src/citizenfxIni');
const { isDirWritable, runElevatedTask } = require('../../src/elevate');

const PROXY_DLLS = ['dxgi.dll', 'd3d9.dll', 'd3d10.dll', 'd3d11.dll', 'd3d12.dll', 'opengl32.dll'];

async function detect(inputKey) {
  if (inputKey === 'gameExe') {
    const found = await findGTA5Exe({ forceRescan: true });
    if (!found) return { path: null, message: 'ไม่พบ GTA5.exe ที่ตำแหน่งมาตรฐาน กรุณาเลือกไฟล์เอง' };
    return { path: found, message: `พบ ${found} — ใช้ตัวนี้ได้เลย` };
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

// Finds ReShade's own files in a folder: any known proxy dll, ReShade.ini/.log, and the
// generated shader/texture folders — the same set the installer plugin creates/moves.
function findReShadeFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return { files: [], dirs: [] };
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  const dirs = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (PROXY_DLLS.includes(lower) || lower === 'reshade.ini' || lower === 'reshade.log') {
        files.push(entry.name);
      }
    } else if (entry.isDirectory() && /reshade.*(shader|texture)/i.test(entry.name)) {
      dirs.push(entry.name);
    }
  }
  return { files, dirs };
}

// Flags the exact case that caused confusion once already: the proxy dll (dxgi.dll
// etc.) is still sitting in a folder but its shader/texture folder isn't — meaning
// something removed it before this uninstall ever ran, so backupPath never saw it
// and it can't be offered for restore. Surfacing this explicitly turns a silent gap
// into a visible warning instead of the user only discovering it after reinstalling.
function findMissingShaderFolder(dir, label) {
  const { files, dirs } = findReShadeFiles(dir);
  const hasProxyDll = files.some((f) => PROXY_DLLS.includes(f.toLowerCase()));
  if (hasProxyDll && dirs.length === 0) {
    return `พบไฟล์ ReShade ใน ${label} แต่ไม่พบโฟลเดอร์ shader/texture (เช่น reshade-shaders) อยู่ข้างๆ — โฟลเดอร์นี้หายไปแล้วก่อนที่จะกดถอนครั้งนี้ (ไม่ได้ถูกสำรองไว้ กู้คืนจากประวัติไม่ได้)`;
  }
  return null;
}

function checkMissingShaderFolders(params) {
  const fivemAppDir = params && params.fivemAppDir;
  const gameExe = params && params.gameExe;
  const notes = [];
  if (isFiveMAppDir(fivemAppDir)) {
    const note = findMissingShaderFolder(path.join(fivemAppDir, 'plugins'), 'โฟลเดอร์ plugins ของ FiveM');
    if (note) notes.push(note);
  }
  if (gameExe && fs.existsSync(gameExe)) {
    const note = findMissingShaderFolder(path.dirname(gameExe), 'โฟลเดอร์เกม');
    if (note) notes.push(note);
  }
  return notes;
}

// Only the proxy dll/ini/log are removed on uninstall — the shader/texture folder
// (dirs from findReShadeFiles) is deliberately left in place. It's the user's effect
// library, not part of "being installed": dxgi.dll is what actually makes ReShade
// load, so removing just that is enough to turn ReShade off. Leaving the shaders
// folder behind means a future reinstall's findExistingFiveMShaders (in the installer
// plugin) finds it immediately and keeps it — including any manually-added effects
// like a custom addon pack — instead of it round-tripping through the backup store
// and coming back as a fresh, blank download.
function resolveTargets(params) {
  const fivemAppDir = params && params.fivemAppDir;
  const gameExe = params && params.gameExe;
  const targets = [];
  if (isFiveMAppDir(fivemAppDir)) {
    const pluginsDir = path.join(fivemAppDir, 'plugins');
    const { files } = findReShadeFiles(pluginsDir);
    for (const name of files) targets.push(path.join(pluginsDir, name));
  }
  if (gameExe && fs.existsSync(gameExe)) {
    const gameDir = path.dirname(gameExe);
    const { files } = findReShadeFiles(gameDir);
    for (const name of files) targets.push(path.join(gameDir, name));
  }
  return targets;
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
  const targets = resolveTargets(params);
  const items = targets.map((full) => ({
    path: full,
    action: 'ย้ายไปสำรอง แล้วลบต้นทาง (กู้คืนได้)',
  }));
  const pluginsDir = path.join(fivemAppDir, 'plugins');
  const { dirs: shaderDirs } = findReShadeFiles(pluginsDir);
  for (const name of shaderDirs) {
    items.push({ path: path.join(pluginsDir, name), action: 'ไม่แตะ — เก็บไว้ที่เดิม (ใช้ต่อได้ตอนติดตั้งใหม่)' });
  }
  items.push({ path: 'CitizenFX.ini', action: 'เอาบรรทัดยืนยัน [Addons] ของ ReShade ออก (สำรอง .bak ไว้)' });
  if (targets.length === 0) warnings.push('ไม่พบไฟล์ ReShade ในโฟลเดอร์ plugins ของ FiveM — อาจถอนไปแล้ว หรือไม่เคยติดตั้ง');
  warnings.push(...checkMissingShaderFolders(params));
  const gameExe = params && params.gameExe;
  if (gameExe && fs.existsSync(gameExe) && !isDirWritable(path.dirname(gameExe))) {
    warnings.push('เกมติดตั้งอยู่ใต้ Program Files — จะมีหน้าต่างขอสิทธิ์ Administrator (UAC) เด้งขึ้นมาให้กดยืนยันระหว่างถอน');
  }
  let blocked = false;
  if (targets.length > 0 && (await isFiveMRunning())) {
    warnings.push('FiveM กำลังทำงานอยู่ — ไฟล์ ReShade ที่จะถอนถูกล็อกไว้ ปิดโปรแกรมก่อนแล้วลองใหม่');
    blocked = true;
  }
  return { items, totalSizeBytes: 0, warnings, blocked };
}

// Removing ReShade's files out of the game's folder needs write access to that folder's
// directory entries, same as installing does — if GTA5.exe lives under Program Files
// (the common case), a normal Windows account can't do this without elevation. See
// plugins/reshade-installer's isDirWritable/runElevatedTask usage for the install-side
// half of this same bug.
async function run(params, context) {
  const fivemAppDir = params && params.fivemAppDir;
  if (!isFiveMAppDir(fivemAppDir)) {
    return { success: false, message: 'ไม่พบโฟลเดอร์ FiveM ที่ระบุ' };
  }
  // Backing up (moving) a file out of FiveM's plugins folder fails with EPERM on the
  // delete-the-original step if FiveM still has it open — same root cause as the
  // install-side check above resolveTargets.
  if (resolveTargets(params).length > 0 && (await isFiveMRunning())) {
    return { success: false, message: 'ปิด FiveM ก่อนถอนแล้วลองใหม่อีกครั้ง — ไฟล์ ReShade ถูกล็อกไว้ระหว่างเปิดโปรแกรมอยู่' };
  }
  const gameExe = params && params.gameExe;
  const gameDir = gameExe && fs.existsSync(gameExe) ? path.dirname(gameExe) : null;
  if (gameDir && !isDirWritable(gameDir)) {
    return runElevatedTask('reshade-uninstall', params, context);
  }
  return performUninstall(params, context);
}

function performUninstall(params, context) {
  const fivemAppDir = params && params.fivemAppDir;
  const missingShaderNotes = checkMissingShaderFolders(params);
  const targets = resolveTargets(params);
  const total = targets.length + 1; // +1 for the CitizenFX.ini ack cleanup step
  const tick = (done) => context.onProgress && context.onProgress({ done, total });
  const backups = [];
  for (const [i, full] of targets.entries()) {
    const record = backupPath(context.app, full, `ReShade: ${path.basename(full)}`);
    if (record) backups.push(record);
    tick(i + 1);
  }
  const ack = clearReShadeAck(fivemAppDir);
  tick(total);
  const ackNote = ack.removed
    ? 'เอาบรรทัดยืนยันออกจาก CitizenFX.ini แล้ว'
    : ack.reason === 'not-set'
      ? 'CitizenFX.ini ไม่มีบรรทัดยืนยัน ReShade อยู่แล้ว'
      : 'ไม่พบ CitizenFX.ini';

  const { dirs: keptShaderDirs } = isFiveMAppDir(fivemAppDir)
    ? findReShadeFiles(path.join(fivemAppDir, 'plugins'))
    : { dirs: [] };
  const keptNote = keptShaderDirs.length
    ? ` (เก็บโฟลเดอร์ ${keptShaderDirs.join(', ')} ไว้ที่เดิม ไม่ได้ถอน — ใช้ต่อได้ตอนติดตั้งใหม่)`
    : '';
  const shaderNote = missingShaderNotes.length ? ` — ⚠ ${missingShaderNotes.join(' ')}` : '';

  if (targets.length === 0 && !ack.removed) {
    return { success: true, message: `ไม่พบไฟล์ ReShade ให้ถอนแล้ว — ${ackNote}${shaderNote}` };
  }
  return {
    success: true,
    message: `ถอน ReShade แล้ว (${backups.length} รายการ, กู้คืนได้จากประวัติ)${keptNote} — ${ackNote}${shaderNote}`,
    backups,
  };
}

module.exports = { dryRun, run, detect, performUninstall };
