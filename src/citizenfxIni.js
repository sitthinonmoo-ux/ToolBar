const fs = require('fs');
const path = require('path');

// Reproduces citizenfx/fivem's own HashString (code/client/shared/Utils.h) —
// a Jenkins one-at-a-time hash over the lowercased input.
function hashString(str) {
  let hash = 0;
  const lower = str.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    hash = (hash + lower.charCodeAt(i)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash >>> 0;
}

// Reproduces ReShadeFixups.cpp exactly: the "ID" FiveM shows in its F8 block message
// is HashString(%COMPUTERNAME%) — not random, not per-launch — so we can compute the
// required [Addons] line ourselves instead of making the user copy it out of a console.
function reshadeAckLine() {
  const computerName = process.env.COMPUTERNAME || 'a';
  const hex = hashString(computerName).toString(16).padStart(8, '0');
  return `ReShade5=ID:${hex} acknowledged that ReShade 5.x has a bug that will lead to game crashes`;
}

function citizenFxIniPath(fivemAppDir) {
  if (!fivemAppDir) return null;
  return path.join(fivemAppDir, 'CitizenFX.ini');
}

function getAddonLine(content) {
  const lines = content.split(/\r?\n/);
  const addonsIdx = lines.findIndex((l) => l.trim().toLowerCase() === '[addons]');
  if (addonsIdx === -1) return null;
  for (let i = addonsIdx + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break;
    if (/^\s*ReShade5\s*=/i.test(lines[i])) return lines[i].trim();
  }
  return null;
}

// Only ever touches the [Addons] section; everything else is left byte-for-byte untouched.
function upsertAddonLine(content, line) {
  const lines = content.split(/\r?\n/);
  const addonsIdx = lines.findIndex((l) => l.trim().toLowerCase() === '[addons]');
  if (addonsIdx === -1) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push('[Addons]', line);
    return lines.join('\r\n');
  }
  let end = lines.length;
  for (let i = addonsIdx + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let reshadeIdx = -1;
  for (let i = addonsIdx + 1; i < end; i++) {
    if (/^\s*ReShade5\s*=/i.test(lines[i])) {
      reshadeIdx = i;
      break;
    }
  }
  if (reshadeIdx !== -1) lines[reshadeIdx] = line;
  else lines.splice(addonsIdx + 1, 0, line);
  return lines.join('\r\n');
}

// Writes/updates the acknowledgment line in CitizenFX.ini, keeping a sibling .bak copy.
// { wrote:false, reason:'no-ini' } — FiveM hasn't been launched once yet, ini doesn't exist.
// { wrote:false, reason:'already-set' } — nothing to do, it's already correct.
function writeReShadeAck(fivemAppDir) {
  const iniPath = citizenFxIniPath(fivemAppDir);
  if (!fs.existsSync(iniPath)) return { wrote: false, reason: 'no-ini' };
  const line = reshadeAckLine();
  const original = fs.readFileSync(iniPath, 'utf8');
  if (getAddonLine(original) === line) return { wrote: false, reason: 'already-set', line };
  const bakPath = `${iniPath}.bak-${Date.now()}`;
  fs.writeFileSync(bakPath, original, 'utf8');
  fs.writeFileSync(iniPath, upsertAddonLine(original, line), 'utf8');
  return { wrote: true, bakPath, line };
}

// Drops just the ReShade5=... line out of [Addons], leaving everything else untouched.
function removeAddonLine(content) {
  const lines = content.split(/\r?\n/);
  const addonsIdx = lines.findIndex((l) => l.trim().toLowerCase() === '[addons]');
  if (addonsIdx === -1) return content;
  let end = lines.length;
  for (let i = addonsIdx + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  for (let i = addonsIdx + 1; i < end; i++) {
    if (/^\s*ReShade5\s*=/i.test(lines[i])) {
      lines.splice(i, 1);
      break;
    }
  }
  return lines.join('\r\n');
}

// Undo counterpart to writeReShadeAck — removes the acknowledgment line, keeping a
// sibling .bak copy of the file as it was before.
// { removed:false, reason:'no-ini' } — nothing to clean up, the ini doesn't exist.
// { removed:false, reason:'not-set' } — the line wasn't there to begin with.
function clearReShadeAck(fivemAppDir) {
  const iniPath = citizenFxIniPath(fivemAppDir);
  if (!fs.existsSync(iniPath)) return { removed: false, reason: 'no-ini' };
  const original = fs.readFileSync(iniPath, 'utf8');
  if (!getAddonLine(original)) return { removed: false, reason: 'not-set' };
  const bakPath = `${iniPath}.bak-${Date.now()}`;
  fs.writeFileSync(bakPath, original, 'utf8');
  fs.writeFileSync(iniPath, removeAddonLine(original), 'utf8');
  return { removed: true, bakPath };
}

module.exports = {
  hashString,
  reshadeAckLine,
  citizenFxIniPath,
  getAddonLine,
  upsertAddonLine,
  writeReShadeAck,
  removeAddonLine,
  clearReShadeAck,
};
