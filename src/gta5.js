const fs = require('fs');
const path = require('path');
const { scanDrives } = require('./scan');

// The handful of places GTA5.exe actually lands depending on which storefront
// installed it — checked in order before falling back to a full drive scan.
const WELL_KNOWN_DIRS = [
  'C:\\Program Files\\Rockstar Games\\Grand Theft Auto V',
  'C:\\Program Files (x86)\\Rockstar Games\\Grand Theft Auto V',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Grand Theft Auto V',
  'C:\\Program Files\\Steam\\steamapps\\common\\Grand Theft Auto V',
  'C:\\Program Files\\Epic Games\\GTAV',
];

function isGTA5Exe(fullPath) {
  return fs.existsSync(fullPath) && path.basename(fullPath).toLowerCase() === 'gta5.exe';
}

function findInWellKnownDirs() {
  for (const dir of WELL_KNOWN_DIRS) {
    const candidate = path.join(dir, 'GTA5.exe');
    if (isGTA5Exe(candidate)) return candidate;
  }
  return null;
}

async function scanForGTA5Exe() {
  const dir = await scanDrives(
    (full, entry) => entry.isDirectory() && entry.name.toLowerCase() === 'grand theft auto v' && isGTA5Exe(path.join(full, 'GTA5.exe'))
  );
  return dir ? path.join(dir, 'GTA5.exe') : null;
}

// A full-drive scan is expensive even now that it's non-blocking (see src/scan.js) — it
// still means several seconds of disk I/O. Health checks run on every "Home" click and
// every 6s background poll, so those pass `allowScan: false` to only ever check the cheap
// well-known-directory list; only an explicit "auto-detect" button click (allowScan
// defaults to true) pays for a full scan, and even then just once per process lifetime
// unless `forceRescan` is set — cache the last-found (or last-confirmed-absent) result
// instead of re-walking the filesystem on every call.
let cachedGTA5Path = null;
let hasScannedOnce = false;

async function findGTA5Exe({ allowScan = true, forceRescan = false } = {}) {
  if (cachedGTA5Path && isGTA5Exe(cachedGTA5Path)) return cachedGTA5Path;
  const known = findInWellKnownDirs();
  if (known) {
    cachedGTA5Path = known;
    return known;
  }
  if (!allowScan) return null;
  if (hasScannedOnce && !forceRescan) return null;
  hasScannedOnce = true;
  const found = await scanForGTA5Exe();
  cachedGTA5Path = found;
  return found;
}

module.exports = { findGTA5Exe, isGTA5Exe };
