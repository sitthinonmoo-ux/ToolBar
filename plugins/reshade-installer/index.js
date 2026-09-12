const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const extractZip = require('extract-zip');
const { backupPath, moveRecursive } = require('../../src/backup');
const { detectFiveMAppDir, isFiveMAppDir, isFiveMRunning } = require('../../src/fivem');
const { findGTA5Exe } = require('../../src/gta5');
const { writeReShadeAck } = require('../../src/citizenfxIni');
const debugLog = require('../../src/debugLog');
const { isDirWritable, runElevatedTask } = require('../../src/elevate');

const PROXY_DLL = { dxgi: 'dxgi.dll', d3d9: 'd3d9.dll', opengl: 'opengl32.dll' };

// Steps: resolve installer URL, download it, run it, ensure standard shaders, then (only
// when relocating into FiveM) move files + write the CitizenFX.ini ack. Used to drive the
// UI's progress bar — without this the whole multi-step, often slow (network download +
// an external installer process) run() looked frozen until it resolved at the very end.
function totalSteps(forFiveM) {
  return forFiveM ? 6 : 4;
}

// FiveM's client only loads native plugins from its own "plugins" folder (with an
// explicit user opt-in via CitizenFX.ini) — it does NOT load a dxgi.dll dropped next
// to FiveM.exe/FiveM_GTAProcess.exe the way a normal single game would. The working
// community method is: install ReShade against the real GTA5.exe to generate the
// files, then move them into FiveM's plugins folder. writeReShadeAck below (src/
// citizenfxIni.js) handles the second half (the F8 / CitizenFX.ini [Addons] step)
// automatically — no separate manual card needed for it.
// User pressed the explicit "auto-detect" button — worth paying for a full-drive scan
// (forceRescan) if the well-known directories don't pan out, unlike the periodic
// health-check poll which only ever does the cheap check (see src/healthcheck.js).
async function detect(inputKey) {
  if (inputKey === 'fivemAppDir') {
    const found = await detectFiveMAppDir({ forceRescan: true });
    if (!found) {
      return {
        path: null,
        message: 'ไม่พบโฟลเดอร์ FiveM ที่ตำแหน่งมาตรฐาน (%localappdata%\\FiveM\\FiveM.app) — ถ้าคุณเคยเลือกตำแหน่งอื่นตอนติดตั้ง FiveM ครั้งแรก ให้กด "เลือกโฟลเดอร์" เอง',
      };
    }
    return { path: found, message: `พบโฟลเดอร์ FiveM ที่ ${found}` };
  }

  const found = await findGTA5Exe({ forceRescan: true });
  if (!found) {
    return { path: null, message: 'ไม่พบ GTA5.exe ที่ตำแหน่งมาตรฐาน กรุณาเลือกไฟล์เอง' };
  }
  return { path: found, message: `พบ ${found} — ใช้ตัวนี้ได้เลย` };
}

// Plain fetch() has no timeout of its own — on a restrictive network (corporate
// firewall, some ISPs) that silently drops packets instead of actively refusing the
// connection, that means hanging indefinitely with zero feedback until whatever
// outer safety net exists finally gives up. A short per-request timeout turns a
// network problem into a fast, clearly-labeled failure instead of a long silent hang.
async function fetchWithTimeout(url, ms = 15000) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(ms) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`เชื่อมต่อ ${new URL(url).hostname} ไม่สำเร็จภายใน ${ms / 1000} วินาที — เช็คอินเทอร์เน็ต/ไฟร์วอลล์`);
    }
    throw err;
  }
}

async function resolveLatestInstallerUrl() {
  const res = await fetchWithTimeout('https://reshade.me/');
  if (!res.ok) throw new Error('เชื่อมต่อ reshade.me ไม่สำเร็จ');
  const html = await res.text();
  const match = html.match(/downloads\/ReShade_Setup_[\d.]+\.exe/i);
  if (!match) throw new Error('หาลิงก์ดาวน์โหลด ReShade ล่าสุดไม่เจอ');
  return `https://reshade.me/${match[0]}`;
}

function findShaderDir(gameDir) {
  const entries = fs.readdirSync(gameDir, { withFileTypes: true });
  const found = entries.find((e) => e.isDirectory() && /reshade.*shader/i.test(e.name));
  return found ? found.name : null;
}

// FiveM's plugins folder can already hold a shader set from a previous install that the
// user has since filled out with extra/custom effects (addon packs, etc.) — re-running
// ensureStandardShaders would download the plain default set into gameDir and, once
// relocated, clobber that existing folder. If it's already there and populated, keep it
// as-is instead of replacing it with a fresh generic download.
function findExistingFiveMShaders(fivemAppDir) {
  const pluginsDir = path.join(fivemAppDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) return null;
  const name = findShaderDir(pluginsDir);
  if (!name) return null;
  const shadersSubdir = path.join(pluginsDir, name, 'Shaders');
  if (fs.existsSync(shadersSubdir) && fs.readdirSync(shadersSubdir).some((f) => f.toLowerCase().endsWith('.fx'))) {
    return name;
  }
  return null;
}

// Copies every file found anywhere under srcDir directly into destDir (no
// subfolders) — used instead of a straight recursive copy because the "legacy"
// reshade-shaders branch organizes effects into many category subfolders, and
// ReShade's own recursive "\**\**" search-path wildcard fails to resolve on this
// machine (see stripWildcardSearchPaths below). A flat folder needs no wildcard
// at all, so it sidesteps that bug entirely. First occurrence wins on name clashes.
function flattenCopyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const dest = path.join(destDir, entry.name);
    if (fs.existsSync(dest)) continue;
    const srcBase = entry.parentPath || entry.path;
    fs.copyFileSync(path.join(srcBase, entry.name), dest);
  }
}

// ReShade Setup.exe run with --headless skips the GUI step that normally lets the
// user pick "Standard effects" to download — so a headless install produces a working
// dxgi.dll but an EMPTY effect list (ReShade.ini points at a reshade-shaders\Shaders
// folder that never gets created). We fetch the same shader package the GUI installer
// would have offered and drop it in ourselves so the in-game menu isn't empty.
async function ensureStandardShaders(gameDir) {
  const shaderDir = path.join(gameDir, 'reshade-shaders');
  const shadersSubdir = path.join(shaderDir, 'Shaders');
  if (fs.existsSync(shadersSubdir) && fs.readdirSync(shadersSubdir).some((f) => f.toLowerCase().endsWith('.fx'))) {
    return { downloaded: false };
  }

  // "legacy" is the older, much larger community effect collection (SweetFX, MXAO,
  // etc.) — crosire/reshade-shaders' current default branch "slim" only ships 6
  // basic effects now, so we deliberately pin to legacy for a fuller out-of-the-box set.
  const branch = 'legacy';
  const zipUrl = `https://codeload.github.com/crosire/reshade-shaders/zip/refs/heads/${branch}`;
  const res = await fetchWithTimeout(zipUrl, 60000);
  if (!res.ok) throw new Error('ดาวน์โหลด shader มาตรฐานของ ReShade ไม่สำเร็จ');
  const buf = Buffer.from(await res.arrayBuffer());

  const tmpZip = path.join(os.tmpdir(), `reshade-shaders-${Date.now()}.zip`);
  const tmpExtract = path.join(os.tmpdir(), `reshade-shaders-extract-${Date.now()}`);
  fs.writeFileSync(tmpZip, buf);
  try {
    await extractZip(tmpZip, { dir: tmpExtract });
    const extractedRoot = path.join(tmpExtract, `reshade-shaders-${branch}`);
    fs.mkdirSync(shaderDir, { recursive: true });
    for (const name of ['Shaders', 'Textures']) {
      const src = path.join(extractedRoot, name);
      const dest = path.join(shaderDir, name);
      fs.rmSync(dest, { recursive: true, force: true });
      flattenCopyDir(src, dest);
    }
  } finally {
    fs.rmSync(tmpZip, { force: true });
    fs.rmSync(tmpExtract, { recursive: true, force: true });
  }

  // ReShade.fxh / ReShadeUI.fxh are shared headers nearly every effect #includes for
  // UI annotations and core helpers — they only ship in the "slim" branch's Shaders
  // folder, not in "legacy", so every legacy effect fails to compile without them.
  for (const header of ['ReShade.fxh', 'ReShadeUI.fxh']) {
    const headerRes = await fetchWithTimeout(`https://raw.githubusercontent.com/crosire/reshade-shaders/slim/Shaders/${header}`);
    if (!headerRes.ok) continue;
    fs.writeFileSync(path.join(shadersSubdir, header), Buffer.from(await headerRes.arrayBuffer()));
  }

  return { downloaded: true };
}

// ReShade Setup.exe writes EffectSearchPaths/TextureSearchPaths with a trailing
// "\**\**" (recurse-all-subfolders) glob. On some machines ReShade's own glob
// resolver fails on that pattern with Win32 error 123 (ERROR_INVALID_NAME) even
// though the path itself is fine — resulting in "No effect files found" despite
// the .fx files being right there. Our shader folder is always flat (no nested
// subfolders), so the wildcard buys nothing — write the plain directory instead,
// which every ReShade version resolves without going through the glob engine.
function stripWildcardSearchPaths(iniPath) {
  if (!fs.existsSync(iniPath)) return;
  let content = fs.readFileSync(iniPath, 'utf8');
  content = content.replace(/^(EffectSearchPaths=.*?)\\\*\*\\\*\*\s*$/m, '$1');
  content = content.replace(/^(TextureSearchPaths=.*?)\\\*\*\\\*\*\s*$/m, '$1');
  fs.writeFileSync(iniPath, content, 'utf8');
}

async function dryRun(params) {
  const gameExe = params && params.gameExe;
  const api = (params && params.api) || 'dxgi';
  const forFiveM = params ? params.forFiveM !== false : true;
  const fivemAppDir = params && params.fivemAppDir;
  const warnings = [];
  if (!gameExe || !fs.existsSync(gameExe)) {
    warnings.push('กรุณาเลือกไฟล์ .exe ของเกมก่อน (สำหรับ FiveM ให้เลือก GTA5.exe ตัวจริง ไม่ใช่ไฟล์ในโฟลเดอร์ FiveM)');
    return { items: [], totalSizeBytes: 0, warnings, blocked: true };
  }
  const gameDir = path.dirname(gameExe);
  const items = [
    { path: 'reshade.me', sizeBytes: 0, action: 'ตรวจสอบและดาวน์โหลดตัวติดตั้งเวอร์ชันล่าสุด' },
    { path: gameDir, sizeBytes: 0, action: `ติดตั้งไฟล์ ReShade แบบ ${api} ลงโฟลเดอร์นี้ก่อน` },
    { path: 'github.com/crosire/reshade-shaders', sizeBytes: 0, action: 'ดาวน์โหลดชุด shader มาตรฐานให้อัตโนมัติ (ตัวติดตั้งแบบ headless ไม่ดาวน์โหลดให้เอง)' },
  ];
  let blocked = false;
  if (forFiveM) {
    if (!isFiveMAppDir(fivemAppDir)) {
      warnings.push(
        fivemAppDir
          ? `โฟลเดอร์ที่ระบุ (${fivemAppDir}) ไม่เหมือนโฟลเดอร์ FiveM จริง (ไม่มี CitizenFX.ini) — เช็คอีกครั้งหรือกด "ค้นหา FiveM อัตโนมัติ"`
          : 'ยังไม่ได้ระบุโฟลเดอร์ FiveM.app — กด "ค้นหา FiveM อัตโนมัติ" หรือเลือกเองก่อน'
      );
      blocked = true;
    } else {
      items.push({
        path: path.join(fivemAppDir, 'plugins'),
        sizeBytes: 0,
        action: 'ย้ายไฟล์ ReShade เข้าโฟลเดอร์ plugins ของ FiveM ให้อัตโนมัติ',
      });
      items.push({
        path: path.join(fivemAppDir, 'CitizenFX.ini'),
        sizeBytes: 0,
        action: 'เขียนบรรทัดยืนยัน [Addons] ให้อัตโนมัติ (คำนวณจากชื่อเครื่องนี้ ไม่ต้องเปิดเกม/กด F8 เอง)',
      });
      if (await isFiveMRunning()) {
        warnings.push('FiveM กำลังทำงานอยู่ — ไฟล์ ReShade เดิมใน FiveM จะถูกล็อกไว้ ปิดโปรแกรมก่อนติดตั้งเพื่อความปลอดภัย');
        blocked = true;
      }
    }
  }
  const looksLikeFiveMFolder = /\\FiveM\\FiveM\.app\\/i.test(gameExe);
  if (looksLikeFiveMFolder) {
    warnings.push('ไฟล์ที่เลือกอยู่ในโฟลเดอร์ FiveM — สำหรับขั้นตอนนี้ต้องเลือก GTA5.exe ตัวจริงจาก Rockstar/Steam/Epic แทน (กด "ค้นหา GTA V อัตโนมัติ")');
  }
  if (forFiveM && (api === 'vulkan' || api === 'opengl')) {
    warnings.push('FiveM โหลดปลั๊กอินจากโฟลเดอร์ plugins เฉพาะไฟล์ตระกูล DirectX (dxgi/d3d9 เป็นต้น) เท่านั้น — OpenGL และ Vulkan ใช้กับวิธีนี้ไม่ได้ แนะนำเลือก DirectX 10/11/12 แทน');
  }
  warnings.push('ถ้าเกมติดตั้งอยู่ใต้ Program Files จะมีหน้าต่างขอสิทธิ์ Administrator (UAC) เด้งขึ้นมาให้กดยืนยันระหว่างติดตั้ง');
  return { items, totalSizeBytes: 0, warnings, blocked };
}

// GTA V is very commonly installed on a separate drive from the OS (a D:/E: game
// library) while FiveM's data folder always lives under %localappdata% (the OS drive) —
// a plain fs.renameSync() across drives throws EXDEV. moveRecursive (same helper
// backupPath uses) falls back to copy+delete in that case instead of throwing.
function relocateToFiveMPlugins(gameDir, proxyDll, fivemAppDir, context, keepExistingShaders) {
  const pluginsDir = path.join(fivemAppDir, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  const moved = [];

  for (const name of [proxyDll, 'ReShade.ini']) {
    const src = path.join(gameDir, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(pluginsDir, name);
    if (fs.existsSync(dest)) backupPath(context.app, dest, `ไฟล์ ReShade เดิมใน FiveM plugins: ${name}`);
    moveRecursive(src, dest);
    moved.push(dest);
  }

  const shaderDirName = findShaderDir(gameDir);
  if (shaderDirName) {
    const src = path.join(gameDir, shaderDirName);
    if (keepExistingShaders) {
      // Leave the existing (already fuller) FiveM-side folder untouched — drop the
      // freshly-downloaded one from gameDir since it's redundant now.
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      const dest = path.join(pluginsDir, shaderDirName);
      if (fs.existsSync(dest)) backupPath(context.app, dest, `โฟลเดอร์ shader เดิมใน FiveM plugins: ${shaderDirName}`);
      moveRecursive(src, dest);
      moved.push(dest);
    }
  }

  return { moved, pluginsDir };
}

async function run(params, context) {
  const gameExe = params && params.gameExe;
  const api = (params && params.api) || 'dxgi';
  const forFiveM = params ? params.forFiveM !== false : true;
  const fivemAppDir = params && params.fivemAppDir;
  if (!gameExe || !fs.existsSync(gameExe)) {
    return { success: false, message: 'ไม่พบไฟล์เกมที่เลือก' };
  }
  if (forFiveM && !isFiveMAppDir(fivemAppDir)) {
    return { success: false, message: 'ไม่พบโฟลเดอร์ FiveM ที่ระบุ — ตรวจสอบตำแหน่งหรือกดค้นหาอัตโนมัติอีกครั้ง' };
  }
  // relocateToFiveMPlugins backs up any EXISTING proxy dll/ReShade.ini already in FiveM's
  // plugins folder before dropping the new ones in — if FiveM is still running, it holds
  // those files locked (loaded into the process), so the backup's delete-the-original
  // step fails with EPERM (moveRecursive's cross-drive fallback surfaces this as
  // "unlink ... EPERM"). Same class of check fivem-cache-cleaner already does.
  if (forFiveM && (await isFiveMRunning())) {
    return { success: false, message: 'ปิด FiveM ก่อนติดตั้งแล้วลองใหม่อีกครั้ง — ไฟล์ ReShade เดิมใน FiveM ถูกล็อกไว้ระหว่างเปิดโปรแกรมอยู่' };
  }

  const log = (msg) => debugLog.log(context.app, `[reshade-installer] ${msg}`);
  const gameDir = path.dirname(gameExe);
  const total = totalSteps(forFiveM);
  const tick = (done) => context.onProgress && context.onProgress({ done, total });

  log('resolving latest installer URL from reshade.me');
  let installerUrl;
  try {
    installerUrl = await resolveLatestInstallerUrl();
    log(`resolved installer URL: ${installerUrl}`);
    tick(1);
  } catch (err) {
    log(`resolveLatestInstallerUrl FAILED: ${err.message}`);
    return { success: false, message: err.message };
  }

  const tempPath = path.join(os.tmpdir(), path.basename(installerUrl));
  log(`downloading installer to ${tempPath}`);
  try {
    const res = await fetchWithTimeout(installerUrl, 30000);
    if (!res.ok) throw new Error('ดาวน์โหลด ReShade ไม่สำเร็จ');
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tempPath, buf);
    log(`download complete, ${buf.length} bytes`);
    tick(2);
  } catch (err) {
    log(`download FAILED: ${err.stack || err.message}`);
    return { success: false, message: `ดาวน์โหลดล้มเหลว: ${err.message}` };
  }

  const installParams = { gameExe, api, forFiveM, fivemAppDir, tempPath };

  if (isDirWritable(gameDir)) {
    log('gameDir is writable without elevation, installing directly');
    return installAndRelocate(installParams, context);
  }

  log(`gameDir "${gameDir}" is not writable by this account — relaunching elevated (UAC)`);
  return runElevatedTask('reshade-install', installParams, context);
}

function installAndRelocate(params, context) {
  const { gameExe, api, forFiveM, fivemAppDir, tempPath } = params;
  const log = (msg) => debugLog.log(context.app, `[reshade-installer] ${msg}`);
  const gameDir = path.dirname(gameExe);
  const total = totalSteps(forFiveM);
  const tick = (done) => context.onProgress && context.onProgress({ done, total });
  const proxyDll = PROXY_DLL[api];
  let backupRecord = null;
  if (proxyDll) {
    const dllPath = path.join(gameDir, proxyDll);
    if (fs.existsSync(dllPath)) {
      log(`backing up existing ${proxyDll}`);
      backupRecord = backupPath(context.app, dllPath, `ReShade proxy dll เดิม: ${proxyDll}`);
    }
  }

  return new Promise((resolve) => {
    // windowsHide is deliberately NOT set here: if --headless isn't honored by this
    // ReShade version and it opens its GUI wizard instead, hiding that window would
    // leave the installer stuck waiting on input nobody can see or click — better to
    // let it show so the user notices and can click through it.
    log(`spawning installer: ${tempPath} --headless --api ${api} ${gameExe}`);
    const child = spawn(tempPath, ['--headless', '--api', api, gameExe]);
    let stderr = '';
    child.stderr && child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      log(`spawn ERROR: ${err.stack || err.message}`);
      resolve({ success: false, message: `รันตัวติดตั้งไม่สำเร็จ: ${err.message}` });
    });
    child.on('exit', async (code) => {
      log(`installer exited with code ${code}${stderr ? `, stderr: ${stderr.slice(0, 500)}` : ''}`);
      if (code !== 0) {
        resolve({
          success: false,
          message: `ตัวติดตั้งจบด้วยโค้ด ${code}${stderr ? ': ' + stderr.slice(0, 300) : ''}`,
        });
        return;
      }
      tick(3);

      // Everything past this point touches the filesystem (relocating files across
      // drives, writing ini files) — any of it throwing used to escape uncaught as an
      // unhandled rejection, leaving this Promise unresolved until the caller's 5-minute
      // timeout finally kicked in. Catching here means a real failure (e.g. a locked
      // file, a full disk) is reported immediately instead of after a 5-minute wait.
      try {
        const keepExistingShaders = Boolean(proxyDll && forFiveM && fivemAppDir && findExistingFiveMShaders(fivemAppDir));
        let shaderNote = '';
        if (keepExistingShaders) {
          log('FiveM plugins already has a populated shader folder — keeping it, skipping standard-shaders download');
          shaderNote = ' (พบชุด shader เดิมใน FiveM plugins อยู่แล้ว — ใช้ตัวเดิมต่อ ไม่ได้แทนที่)';
        } else {
          try {
            log('installer exited OK, ensuring standard shaders');
            const { downloaded } = await ensureStandardShaders(gameDir);
            if (downloaded) shaderNote = ' (ดาวน์โหลดชุด shader มาตรฐานให้อัตโนมัติแล้ว)';
            log(`ensureStandardShaders done, downloaded=${downloaded}`);
          } catch (err) {
            log(`ensureStandardShaders FAILED: ${err.stack || err.message}`);
            shaderNote = ` (ดาวน์โหลดชุด shader มาตรฐานไม่สำเร็จ: ${err.message} — เมนู ReShade ในเกมอาจว่างเปล่า ลองกดปุ่มติดตั้งซ้ำภายหลัง)`;
          }
        }
        tick(4);
        stripWildcardSearchPaths(path.join(gameDir, 'ReShade.ini'));

        if (!proxyDll || !forFiveM) {
          resolve({
            success: true,
            message: `ติดตั้ง ReShade (${api}) ให้ ${path.basename(gameExe)} สำเร็จ${shaderNote} — เปิดเกมแล้วกด Home เพื่อเปิดเมนู ReShade`,
            backups: backupRecord ? [backupRecord] : [],
          });
          return;
        }

        log('relocating files into FiveM plugins folder');
        const { moved, pluginsDir } = relocateToFiveMPlugins(gameDir, proxyDll, fivemAppDir, context, keepExistingShaders);
        log(`relocated ${moved.length} item(s) to ${pluginsDir}`);
        tick(5);
        const ack = writeReShadeAck(fivemAppDir);
        tick(6);

        let ackNote;
        if (ack.wrote) {
          ackNote = 'เขียนบรรทัดยืนยันใน CitizenFX.ini ให้อัตโนมัติแล้ว — เข้าเกมได้เลย ไม่ต้องกด F8 เอง';
        } else if (ack.reason === 'already-set') {
          ackNote = 'CitizenFX.ini มีบรรทัดยืนยันที่ถูกต้องอยู่แล้ว';
        } else {
          ackNote = 'ยังไม่พบ CitizenFX.ini (ต้องเปิด FiveM อย่างน้อย 1 ครั้งก่อน) — เปิด FiveM สักครั้งแล้วกดปุ่มนี้ซ้ำเพื่อเขียนบรรทัดยืนยันให้อัตโนมัติ';
        }

        resolve({
          success: true,
          message: `ย้ายไฟล์ ReShade เข้า ${pluginsDir} แล้ว (${moved.length} รายการ)${shaderNote} — ${ackNote}`,
          backups: backupRecord ? [backupRecord] : [],
        });
      } catch (err) {
        log(`post-install relocation FAILED: ${err.stack || err.message}`);
        resolve({
          success: false,
          message: `ติดตั้ง ReShade ลงเกมสำเร็จ แต่ย้ายไฟล์เข้า FiveM ไม่สำเร็จ: ${err.message}`,
          backups: backupRecord ? [backupRecord] : [],
        });
      }
    });
  });
}

module.exports = { dryRun, run, detect, installAndRelocate };
