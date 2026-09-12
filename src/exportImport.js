const fs = require('fs');
const { listServers, upsertServer } = require('./servers');
const { checkStatus } = require('./regTweaks');

// Exports the two things a user actually wants to carry to a new machine: their saved
// server list, and which system-tweaks are currently applied here (so they know what
// to re-check on the new PC — see importSettings for why this isn't auto-applied).
async function exportSettings(app, filePath) {
  const servers = listServers(app);
  const status = await checkStatus();
  const appliedTweaks = Object.entries(status)
    .filter(([, applied]) => applied === true)
    .map(([key]) => key);
  const payload = { version: 1, exportedAt: new Date().toISOString(), servers, appliedTweaks };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

// Servers are merged in directly (matched by address so re-importing the same file
// twice updates instead of duplicating). Tweaks are NOT auto-applied here — that would
// mean silently modifying registry/services/boot config on import, which needs the
// user's explicit confirm (and UAC) through the system-tweaks plugin, not a file read.
function importSettings(app, filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!raw || !Array.isArray(raw.servers)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ตั้งค่า ToolBar ที่ถูกต้อง');

  const existing = listServers(app);
  let added = 0;
  let updated = 0;
  for (const server of raw.servers) {
    const match = existing.find((s) => s.address && server.address && s.address === server.address);
    upsertServer(app, { ...server, id: match ? match.id : undefined });
    if (match) updated++;
    else added++;
  }

  return { added, updated, appliedTweaks: Array.isArray(raw.appliedTweaks) ? raw.appliedTweaks : [] };
}

module.exports = { exportSettings, importSettings };
