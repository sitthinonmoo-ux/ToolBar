const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { detectFiveMAppDir, repairProtocolHandler, isFiveMRunning } = require('./fivem');
const { fetchServerStatus } = require('./serverStatus');

// explorer resolves the target (a fivem:// URI or a .lnk) and starts it as its own child,
// which is what satisfies FiveM's "launched from the shell or a web browser" check. Its
// exit code says nothing about that hand-off (explorer routinely returns 1 after a
// successful one), so there is deliberately nothing to wait on or inspect.
function openViaExplorer(target) {
  const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

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
// "F:\Fivem\FiveM.app\". Locating it is what makes the protocol registration repairable:
// that registration can end up broken (an empty shell\open\command, typically from an
// interrupted install) with no in-app way to detect or fix it, and writing the correct
// command back needs the exe's real path.
async function findFiveMExe() {
  const fivemAppDir = await detectFiveMAppDir({ allowScan: false });
  if (!fivemAppDir) return null;
  const candidate = path.join(path.dirname(fivemAppDir), 'FiveM.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

// FiveM restarts itself right after connecting whenever the client isn't already running
// the game build and pure level the server demands — the slow part of joining, and it
// happens on every single connect. Both values are published by the server, and FiveM's
// own documented shortcut method takes them as launch flags, so asking the server first
// and starting the client already in the right mode skips the restart entirely.
//
// A .lnk is the only shape that can carry those flags AND still satisfy FiveM's
// "launched from the shell" check: explorer resolves the shortcut and starts FiveM as its
// own child, so nothing of this app is in the process ancestry. (An earlier attempt at
// this same idea failed only because it opened the shortcut with shell.openPath, which
// leaves ToolBar.exe as the parent — the exact thing FiveM rejects.)
//
// One fixed filename, rewritten per launch: no temp litter, and nothing to clean up.
function connectShortcutPath() {
  return path.join(os.tmpdir(), 'toolbar-fivem-connect.lnk');
}

function buildLaunchFlags(profile, connectTarget) {
  const flags = [];
  if (profile && profile.gameBuild) flags.push(`-b${profile.gameBuild}`);
  // Level 0 means pure mode is off, which is the client's own default — passing
  // "-pure_0" would be inventing a flag FiveM doesn't document.
  if (profile && profile.pureLevel) flags.push(`-pure_${profile.pureLevel}`);
  flags.push('+connect', connectTarget);
  return flags;
}

// Best-effort by design: every failure here (server down, slow, private, no such field)
// just means launching without the flags, which still works — FiveM falls back to doing
// its own restart, exactly like before. Never let this stop a launch.
async function fetchLaunchProfile(address) {
  try {
    const status = await fetchServerStatus(address);
    if (!status || !status.online) return null;
    if (!status.pureLevel && !status.gameBuild) return null;
    return { pureLevel: status.pureLevel, gameBuild: status.gameBuild };
  } catch {
    return null;
  }
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

  // Two separate things were wrong here, which is why this took so many attempts.
  //
  // 1. The fivem:// registration was empty (HKCU\Software\Classes\fivem\shell\open\
  //    command had no value), so Windows had no handler for the URI at all. Repaired
  //    below, and re-repaired on every launch in case something clobbers it again.
  //
  // 2. FiveM refuses a cold boot whose PARENT PROCESS isn't the shell or a browser —
  //    that's the "This application should be launched directly from the shell or a web
  //    browser" dialog, and it's the anti-custom-launcher check, not a crash. It is also
  //    why the mechanism mattered so much: PowerShell's Start-Process on a URI gets
  //    routed through the shell, so FiveM ends up parented by explorer.exe and launches
  //    fine, while Electron's shell.openExternal creates the process directly and leaves
  //    ToolBar.exe as the parent, which FiveM rejects. Both were confirmed by hand on
  //    the same address, back to back.
  //
  // Both fixes live in openViaExplorer, which every launch below goes through.
  if (fivemExe) await repairProtocolHandler(fivemExe);

  // The build/pure flags only help on a cold start — they're what the client boots with.
  // If FiveM is already up, its mode is already fixed and a second FiveM.exe would just
  // hand off to the running instance anyway, so take the plain URI path there.
  if (fivemExe && !(await isFiveMRunning())) {
    const connectTarget = uri.replace(/^fivem:\/\/connect\//i, '');
    const profile = await fetchLaunchProfile(server.address);
    if (profile) {
      try {
        const lnkPath = connectShortcutPath();
        const flags = buildLaunchFlags(profile, connectTarget);
        shell.writeShortcutLink(lnkPath, 'create', {
          target: fivemExe,
          args: flags.join(' '),
          cwd: path.dirname(fivemExe),
          description: `ToolBar connect: ${server.name}`,
        });
        openViaExplorer(lnkPath);
        const modes = [profile.gameBuild ? `build ${profile.gameBuild}` : null, profile.pureLevel ? `pure ${profile.pureLevel}` : null]
          .filter(Boolean)
          .join(' · ');
        return { success: true, message: `กำลังเชื่อมต่อ ${server.name} (${modes}) — ไม่ต้องรอ FiveM restart` };
      } catch {
        // Shortcut creation is the only part that can fail outright; fall through to the
        // plain URI so a broken .lnk never costs the user the launch itself.
      }
    }
  }

  openViaExplorer(uri);
  return { success: true, message: `กำลังเชื่อมต่อ ${server.name}...` };
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
