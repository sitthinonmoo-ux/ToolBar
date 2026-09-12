const { spawn } = require('child_process');
const { APP_CATALOG } = require('./appCatalog');

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
