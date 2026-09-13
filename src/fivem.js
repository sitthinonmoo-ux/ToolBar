const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { scanDrives, listDrives } = require('./scan');

// FiveM's data folder is USUALLY %localappdata%\FiveM\FiveM.app, but it is not
// guaranteed: if FiveM.exe is first launched from an otherwise-empty folder, it
// stores everything next to itself instead (portable-style, e.g. "F:\MyFiveM\FiveM.app").
// Always verify the folder actually looks like a FiveM data folder before trusting it.
function defaultFiveMAppDir() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'FiveM', 'FiveM.app');
}

// A portable install (the common workaround for "OS drive full") almost always keeps
// FiveM's own top-level folder name, just moved to a different drive root, e.g.
// "F:\Fivem\FiveM.app" or "D:\FiveM\FiveM.app". Checking every drive for that exact
// shape is a handful of fs.existsSync calls, not a directory walk — cheap enough for
// the periodic health-check poll (unlike scanForFiveMAppDir's full recursive scan)
// and, unlike a saved path, works the same on any machine this app runs on.
function findInDriveRoots() {
  // Windows filesystems are case-insensitive, so "FiveM" here matches a "Fivem" or
  // "fivem" folder on disk too — no need to check case variants separately.
  for (const drive of listDrives()) {
    const candidate = path.join(drive, 'FiveM', 'FiveM.app');
    if (isFiveMAppDir(candidate)) return candidate;
  }
  return null;
}

function isFiveMAppDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return fs.existsSync(path.join(dir, 'CitizenFX.ini')) || fs.existsSync(path.join(dir, 'FiveM_GTAProcess.exe'));
}

function scanForFiveMAppDir() {
  return scanDrives((full, entry) => entry.isDirectory() && entry.name.toLowerCase() === 'fivem.app' && isFiveMAppDir(full));
}

// See gta5.js's findGTA5Exe for why calls are gated with allowScan/forceRescan and
// cached: a full-drive scan is real disk I/O, and health checks run every 6s in the
// background plus on every "Home" click, so scanning fresh each time (or even once per
// poll) was freezing the app whenever FiveM isn't in the default AppData path.
let cachedFiveMAppDir = null;
let hasScannedOnce = false;

// Try the well-known location first (fast), then fall back to a bounded scan of every
// drive for a portable install before giving up and asking the user to browse. Pass
// `allowScan: false` for cheap-only lookups (periodic health checks); a full scan only
// ever runs from an explicit user action, and only once per process lifetime unless
// `forceRescan` is set.
async function detectFiveMAppDir({ allowScan = true, forceRescan = false } = {}) {
  if (cachedFiveMAppDir && isFiveMAppDir(cachedFiveMAppDir)) return cachedFiveMAppDir;
  const def = defaultFiveMAppDir();
  if (isFiveMAppDir(def)) {
    cachedFiveMAppDir = def;
    return def;
  }
  const driveRoot = findInDriveRoots();
  if (driveRoot) {
    cachedFiveMAppDir = driveRoot;
    return driveRoot;
  }
  if (!allowScan) return null;
  if (hasScannedOnce && !forceRescan) return null;
  hasScannedOnce = true;
  const found = await scanForFiveMAppDir();
  cachedFiveMAppDir = found;
  return found;
}

// FiveM keeps its proxy DLL (dxgi.dll etc.) and ReShade.ini open/locked in its plugins
// folder for as long as it's running. Any plugin that backs up or replaces files there
// (reshade-installer, reshade-uninstaller) needs to check this first — moveRecursive's
// cross-drive fallback (copy then delete the original) fails with EPERM on the delete
// step if the original is locked, which is exactly what happens when the user leaves
// FiveM open while clicking install/uninstall.
//
// This used to pass TWO `/FI "IMAGENAME eq ..."` filters in one tasklist call — but
// Windows combines multiple /FI filters with AND, not OR, so "name is X AND name is Y"
// can never match any single process; the check silently always returned false no
// matter what was running. It also only ever matched the literal name
// "FiveM_GTAProcess.exe", while current FiveM builds name that process
// "FiveM_b<buildnumber>_GTAProcess.exe" (e.g. FiveM_b3258_GTAProcess.exe) — a moving
// target that would keep breaking an exact-name check anyway. A single wildcard filter
// fixes both problems at once and also catches FiveM's other subprocesses (ROS
// launcher, chrome browser helpers), which is the safer direction to err in here.
function isFiveMRunning() {
  return new Promise((resolve) => {
    const child = spawn('tasklist', ['/FI', 'IMAGENAME eq FiveM*'], { windowsHide: true });
    let out = '';
    child.stdout && child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve(false));
    child.on('exit', () => resolve(out.toLowerCase().includes('fivem')));
  });
}

// FiveM is documented and confirmed (see cfx.re forum reports of this exact crash) to
// actively detect and refuse being launched by a third-party tool — no amount of
// spawn/cwd/timing trickery from this app's side reliably gets past that check, since
// it's a deliberate anti-custom-launcher measure, not a bug. The one thing that IS a
// genuine, fixable bug (not something FiveM intentionally blocks) is a broken fivem://
// protocol registration: on this machine HKCU\Software\Classes\fivem\shell\open\command
// was completely empty, so Windows had no idea what to run for that URI at all — likely
// left in that state by an install that got interrupted. Repairing just that registry
// value, then launching via shell.openExternal (the same path a real browser link click
// uses), is the one approach that doesn't look like a custom launcher to FiveM at all.
function repairProtocolHandler(fivemExePath) {
  return new Promise((resolve) => {
    const command = `"${fivemExePath}" "%1"`;
    const child = spawn('reg', ['add', 'HKCU\\Software\\Classes\\fivem\\shell\\open\\command', '/ve', '/d', command, '/f'], {
      windowsHide: true,
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

module.exports = { defaultFiveMAppDir, isFiveMAppDir, detectFiveMAppDir, isFiveMRunning, repairProtocolHandler };
