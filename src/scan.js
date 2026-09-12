const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Folders that are huge, permission-locked, or never contain a game install — skipping
// them keeps a full-drive scan from taking forever or throwing EPERM everywhere.
const SKIP_DIR_NAMES = new Set([
  'windows',
  '$recycle.bin',
  'system volume information',
  'programdata',
  'node_modules',
  '.git',
  'appdata',
]);

const MAX_DEPTH = 6;

// Electron's main process is single-threaded — a synchronous recursive fs walk here
// used to block the ENTIRE app (all IPC, window redraws, everything) for as long as the
// scan took, which on a machine with a slow/large/network drive or a OneDrive-style
// cloud-placeholder folder could be minutes. That's what "app frozen during install"
// actually was: every readdir below now goes through fs.promises (libuv's threadpool),
// so the main thread's event loop stays free between each directory read.
const DEFAULT_SCAN_TIMEOUT_MS = 20000;

function listDrives() {
  const drives = [];
  for (let code = 67; code <= 90; code++) {
    // C..Z
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(drive)) drives.push(drive);
  }
  return drives;
}

async function scanDir(dir, predicate, depth) {
  if (depth > MAX_DEPTH) return null;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue;
    const full = path.join(dir, entry.name);
    try {
      if (predicate(full, entry)) return full;
    } catch {
      continue;
    }
    const nested = await scanDir(full, predicate, depth + 1);
    if (nested) return nested;
  }
  return null;
}

// Walks every local drive (bounded by depth + a denylist of noisy folders) looking for a
// directory that matches `predicate(fullPath, dirent)`. Returns the first match's full
// path, or null if nothing was found (including "gave up after timeoutMs" — a slow or
// unreachable network drive shouldn't make the "auto-detect" button hang indefinitely;
// the scan keeps running in the background and is simply ignored once it resolves).
// Used as the fallback when a well-known install location doesn't pan out (portable
// installs, custom install directories, etc).
function scanDrives(predicate, { timeoutMs = DEFAULT_SCAN_TIMEOUT_MS } = {}) {
  const walk = (async () => {
    for (const drive of listDrives()) {
      const found = await scanDir(drive, predicate, 0);
      if (found) return found;
    }
    return null;
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([walk, timeout]);
}

module.exports = { scanDrives, listDrives };
