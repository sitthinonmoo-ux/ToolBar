const fs = require('fs');
const path = require('path');
const { detectFiveMAppDir, isFiveMAppDir } = require('./fivem');
const { findGTA5Exe } = require('./gta5');
const { citizenFxIniPath, getAddonLine, reshadeAckLine } = require('./citizenfxIni');

const PROXY_DLLS = ['dxgi.dll', 'd3d9.dll', 'd3d10.dll', 'd3d11.dll', 'd3d12.dll', 'opengl32.dll'];

function reshadeInstalledInPlugins(fivemAppDir) {
  if (!isFiveMAppDir(fivemAppDir)) return false;
  const pluginsDir = path.join(fivemAppDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) return false;
  return PROXY_DLLS.some((name) => fs.existsSync(path.join(pluginsDir, name)));
}

function reshadeConfirmedInIni(fivemAppDir) {
  if (!fivemAppDir) return false;
  const iniPath = citizenFxIniPath(fivemAppDir);
  if (!fs.existsSync(iniPath)) return false;
  const content = fs.readFileSync(iniPath, 'utf8');
  return getAddonLine(content) === reshadeAckLine();
}

// Feeds the dashboard's overview panel + "next step" suggestion. Runs every time the
// Home tab is opened AND every 6s in the background (renderer.js) — allowScan:false
// keeps this to well-known-directory + cache checks only, never a full-drive scan, so
// this polling loop can't repeatedly hammer the disk / block the app while GTA5.exe or
// FiveM.app hasn't been found yet. The full scan only ever runs from the explicit
// "auto-detect" button in a plugin's detect().
async function runHealthCheck() {
  const gta5Path = await findGTA5Exe({ allowScan: false });
  const fivemPath = await detectFiveMAppDir({ allowScan: false });
  return {
    gta5: { ok: !!gta5Path, path: gta5Path },
    fivem: { ok: !!fivemPath, path: fivemPath },
    reshadeInstalled: { ok: reshadeInstalledInPlugins(fivemPath) },
    reshadeConfirmed: { ok: reshadeConfirmedInIni(fivemPath) },
  };
}

module.exports = { runHealthCheck };
