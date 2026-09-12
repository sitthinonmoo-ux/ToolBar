const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { APP_CATALOG } = require('./appCatalog');

async function fetchWithTimeout(url, ms = 60000) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(ms) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`เชื่อมต่อ ${new URL(url).hostname} ไม่สำเร็จภายใน ${ms / 1000} วินาที — เช็คอินเทอร์เน็ต/ไฟร์วอลล์`);
    }
    throw err;
  }
}

// Downloads a vendor's own installer and opens it — used instead of winget for a
// catalog entry that sets `directUrl` (see appCatalog.js's fivem entry for why: a
// stale hash in winget's community manifest, not something fixable from here).
//
// Opened via shell.openPath (the same mechanism as double-clicking the file in
// Explorer), NOT child_process.spawn. FiveM.exe doubles as both installer and game
// client, and it actively refuses to run when it detects it was launched as a bare
// child process — "This application should be launched directly from the shell or a
// web browser." spawn() is exactly that bare-child-process case; shell.openPath goes
// through the OS shell (ShellExecute on Windows), which is what satisfies the check.
async function installDirect(app) {
  const res = await fetchWithTimeout(app.directUrl, 60000);
  if (!res.ok) throw new Error(`ดาวน์โหลดตัวติดตั้ง ${app.name} ไม่สำเร็จ (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tempPath = path.join(os.tmpdir(), `${app.id}-installer-${Date.now()}.exe`);
  fs.writeFileSync(tempPath, buf);
  const openError = await shell.openPath(tempPath);
  if (openError) {
    return { success: false, message: `เปิดตัวติดตั้ง ${app.name} ไม่สำเร็จ: ${openError}` };
  }
  return {
    success: true,
    message: `ดาวน์โหลดตัวติดตั้ง ${app.name} เสร็จแล้ว — ทำตามขั้นตอนในหน้าต่างที่เปิดขึ้นมาให้จบการติดตั้ง`,
  };
}

function runWinget(args) {
  return new Promise((resolve) => {
    const child = spawn('winget', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ code: -1, stdout: '', stderr: err.message }));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function isInstalled(wingetId) {
  const result = await runWinget(['list', '--id', wingetId, '-e', '--accept-source-agreements']);
  return result.code === 0 && result.stdout.includes(wingetId);
}

// Read-only; runs every app's check in parallel since each is an independent winget
// query (no shared state to race on) — sequentially this would take 15-30s for the
// full catalog, one winget process spin-up at a time.
async function checkInstalledAll() {
  const entries = await Promise.all(APP_CATALOG.map(async (app) => [app.id, await isInstalled(app.wingetId)]));
  return Object.fromEntries(entries);
}

// winget's output for a failed install is typically: boilerplate (license notice,
// "Found X [id] Version Y", "Downloading ...") followed by the ACTUAL failure reason at
// the very end ("An unexpected error occurred while downloading...", a specific exit
// code, etc). Slicing from the START (the old behavior) showed only the boilerplate and
// cut the real reason off mid-sentence — showing the tail instead surfaces the part that
// actually explains what went wrong.
function tailMessage(text, max = 500) {
  const trimmed = (text || '').trim();
  if (trimmed.length <= max) return trimmed;
  return `...${trimmed.slice(-max)}`;
}

async function installApp(appId) {
  const app = APP_CATALOG.find((a) => a.id === appId);
  if (!app) return { success: false, message: 'ไม่พบโปรแกรมนี้ในรายการ' };
  if (app.directUrl) {
    try {
      return await installDirect(app);
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
  const result = await runWinget([
    'install',
    '--id',
    app.wingetId,
    '-e',
    '--silent',
    '--accept-package-agreements',
    '--accept-source-agreements',
  ]);
  if (result.code === 0) return { success: true, message: `ติดตั้ง ${app.name} สำเร็จ` };
  return {
    success: false,
    message: `ติดตั้ง ${app.name} ไม่สำเร็จ (โค้ด ${result.code}): ${tailMessage(result.stderr || result.stdout) || 'ไม่ทราบสาเหตุ'}`,
  };
}

module.exports = { checkInstalledAll, installApp };
