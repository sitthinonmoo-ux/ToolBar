const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { detectFiveMAppDir, repairProtocolHandler, isFiveMRunning } = require('./fivem');

// cwd matters here: a plain double-click from Explorer always runs with the target's
// own folder as the working directory, but our spawn() never set one — meaning FiveM
// launched via ToolBar could end up with the wrong cwd (wherever Electron's own process
// happens to be running from) instead of its own install folder. If FiveM resolves its
// config/profile relative to cwd rather than to its own exe path in some code paths,
// that alone could explain it silently falling back to defaults (and picking a
// different, broken game platform) even with zero connect arguments involved. Callers
// pass cwd explicitly rather than this deriving it — `target` can be a bare URI (the
// protocol-resolution fallback) where path.dirname() would produce nonsense.
function spawnViaStart(target, args = [], cwd = undefined) {
  const child = spawn('cmd.exe', ['/c', 'start', '""', target, ...args], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function serversFile(app) {
  return path.join(app.getPath('userData'), 'servers.json');
}

function listServers(app) {
  const file = serversFile(app);
  if (!fs.existsSync(file)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveServersList(app, list) {
  fs.mkdirSync(path.dirname(serversFile(app)), { recursive: true });
  fs.writeFileSync(serversFile(app), JSON.stringify(list, null, 2));
}

// Adds a new server (no id) or overwrites an existing one (id present).
function upsertServer(app, server) {
  const list = listServers(app);
  const clean = {
    id: server.id || crypto.randomUUID(),
    name: (server.name || '').trim() || 'FiveM Server',
    mode: server.mode === 'customLauncher' ? 'customLauncher' : 'quickconnect',
    address: (server.address || '').trim(),
    launcherPath: server.launcherPath || '',
    launchArgs: server.launchArgs || '',
    logo: server.logo || '',
  };
  const idx = list.findIndex((s) => s.id === clean.id);
  if (idx >= 0) list[idx] = clean;
  else list.push(clean);
  saveServersList(app, list);
  return clean;
}

function deleteServer(app, id) {
  const list = listServers(app).filter((s) => s.id !== id);
  saveServersList(app, list);
}

// Persists a drag-reordered card list: sorts the stored servers to match orderedIds,
// with anything not in that list (shouldn't normally happen) kept at the end.
function reorderServers(app, orderedIds) {
  const list = listServers(app);
  const byId = new Map(list.map((s) => [s.id, s]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  for (const s of list) if (!orderedIds.includes(s.id)) reordered.push(s);
  saveServersList(app, reordered);
  return reordered;
}

// Accepts a cfx.re join code/link, a raw ip:port, or an already-built fivem:// URI
// and normalizes it into the URI FiveM's protocol handler expects.
function buildConnectUri(rawAddress) {
  const address = (rawAddress || '').trim();
  if (!address) return 'fivem://';
  if (/^fivem:\/\//i.test(address)) return address;

  const cfxMatch = address.match(/cfx\.re\/join\/([a-z0-9]+)/i);
  if (cfxMatch) return `fivem://connect/${cfxMatch[1]}`;

  const stripped = address.replace(/^https?:\/\//i, '');
  return `fivem://connect/${stripped}`;
}

// FiveM's own installer creates "FiveM.exe" (the Squirrel-based launcher/updater) as a
// sibling of the "FiveM.app" data folder, e.g. "F:\Fivem\FiveM.exe" next to
// "F:\Fivem\FiveM.app\". Finding it directly lets us launch a fivem:// connect URI
// ourselves instead of depending on Windows having a correctly registered protocol
// handler for it — a registration that can end up broken (missing shell\open\command)
// from an install that got interrupted, with no in-app way to detect or repair it.
async function findFiveMExe() {
  const fivemAppDir = await detectFiveMAppDir({ allowScan: false });
  if (!fivemAppDir) return null;
  const candidate = path.join(path.dirname(fivemAppDir), 'FiveM.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

function splitArgs(argsString, address) {
  if (!argsString) return [];
  return argsString
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((arg) => arg.replace(/\{address\}/gi, address || ''));
}

async function launchServer(server) {
  if (!server) return { success: false, message: 'ไม่พบเซิร์ฟเวอร์นี้' };

  if (server.mode === 'customLauncher') {
    const launcherPath = server.launcherPath;
    if (!launcherPath || !fs.existsSync(launcherPath)) {
      return { success: false, message: 'ไม่พบไฟล์รันเชอร์ที่ตั้งไว้ — แก้ไขเซิร์ฟเวอร์นี้แล้วเลือกไฟล์ใหม่' };
    }
    const args = splitArgs(server.launchArgs, server.address);
    try {
      // FiveM.exe (a very common thing to point launcherPath at, since it's the
      // documented way to script "+connect ip:port") refuses to run when started as a
      // bare child process — "This application should be launched directly from the
      // shell or a web browser." A plain spawn() IS exactly that bare-child-process
      // case. Routing through `cmd /c start` invokes the same ShellExecute path a
      // double-click would, while still letting us pass launch arguments (which
      // shell.openPath can't — it takes no args at all).
      spawnViaStart(launcherPath, args, path.dirname(launcherPath));
    } catch (err) {
      return { success: false, message: `เปิดรันเชอร์ไม่สำเร็จ: ${err.message}` };
    }
    return { success: true, message: `กำลังเปิดรันเชอร์ของ ${server.name}...` };
  }

  const fivemExe = await findFiveMExe();
  const uri = buildConnectUri(server.address);

  // Every attempt at combining "open FiveM" + "connect" into a single cold action has
  // failed identically (spawn, shell.openPath, shell.openExternal, cmd/start, a
  // registry-repaired protocol, an official .lnk shortcut with -pure_X, pre-warming
  // Rockstar Games Launcher, setting SteamAppId — see git history for the full trail).
  // FiveM's own log traces the crash to right after its internal Rockstar Games
  // Launcher handshake completes, immediately after a cold boot — something about that
  // combination it refuses, regardless of invocation mechanism.
  //
  // What IS confirmed reliable, every single time: opening FiveM plain (no connect
  // argument) on its own, and connecting via shell.openExternal once FiveM is already
  // running. So this asks for a second Play click instead of ever combining them:
  // first click opens FiveM plain, second click (once it's up) connects.
  const running = await isFiveMRunning();

  if (running) {
    if (fivemExe) await repairProtocolHandler(fivemExe);
    shell.openExternal(uri);
    return { success: true, message: `กำลังเชื่อมต่อ ${server.name}...` };
  }

  if (!fivemExe) {
    shell.openExternal(uri);
    return { success: true, message: `กำลังเชื่อมต่อ ${server.name}...` };
  }

  shell.openPath(fivemExe);
  return {
    success: true,
    message: `FiveM ยังไม่ได้เปิด — เปิดให้แล้ว รอโหลดเสร็จแล้วกด Play ที่ ${server.name} อีกครั้งเพื่อเชื่อมต่อ`,
  };
}

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// Reads a picked logo image off disk and inlines it as a data URI so servers.json
// stays self-contained (no dangling references if the source file moves/is deleted).
function readImageAsDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error('รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, GIF, WEBP)');
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

module.exports = {
  listServers,
  upsertServer,
  deleteServer,
  reorderServers,
  launchServer,
  buildConnectUri,
  readImageAsDataUri,
};
