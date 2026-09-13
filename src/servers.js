const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { detectFiveMAppDir, repairProtocolHandler, isFiveMRunning } = require('./fivem');
const { extractJoinCode, parseDirectEndpoint, fetchPureLevel } = require('./serverStatus');

function psEscape(s) {
  return String(s).replace(/'/g, "''");
}

// Builds a real Windows shortcut (.lnk) pointing at FiveM.exe with launch arguments
// baked in, then opens it via shell.openPath — the same thing a user creating a
// desktop shortcut per FiveM's own documented "-pure_X" launch argument feature would
// do, and functionally identical to double-clicking that shortcut in Explorer. This
// matters because a bare FiveM.exe process spawned with arguments crashes (see the
// launchServer comment below); a .lnk opened through the shell doesn't put this app
// anywhere in the resulting process's ancestry, unlike any direct spawn.
function createShortcut(lnkPath, targetPath, args, workingDir) {
  return new Promise((resolve, reject) => {
    const script = [
      '$ws = New-Object -ComObject WScript.Shell',
      `$sc = $ws.CreateShortcut('${psEscape(lnkPath)}')`,
      `$sc.TargetPath = '${psEscape(targetPath)}'`,
      `$sc.Arguments = '${psEscape(args)}'`,
      `$sc.WorkingDirectory = '${psEscape(workingDir)}'`,
      '$sc.Save()',
    ].join('; ');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`powershell exited with code ${code}`))));
  });
}

// FiveM's `+connect` argument wants a bare host:port or a "cfx.re/join/<code>" — not
// the full fivem:// URI buildConnectUri produces for the protocol-handler path.
function connectTarget(rawAddress) {
  const code = extractJoinCode(rawAddress);
  if (code) return `cfx.re/join/${code}`;
  const direct = parseDirectEndpoint(rawAddress);
  if (direct) return `${direct.host}:${direct.port}`;
  return (rawAddress || '').trim();
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

  // FiveM officially documents launching straight into a specific "-pure_X" level via
  // a Windows shortcut (see docs.fivem.net's Shortcut page) — combined with a
  // "+connect" argument, this launches already at the level the server requires
  // instead of connecting and getting prompted to change level + restart mid-connect.
  // Building that as a real .lnk and opening it via the shell (not spawning FiveM.exe
  // directly, which crashes regardless of how carefully it's invoked — see git
  // history) should also sidestep the cold-boot problem entirely, since it's the same
  // path a user's own desktop shortcut would take.
  if (fivemExe) {
    try {
      const pureLevel = await fetchPureLevel(server.address);
      const lnkPath = path.join(os.tmpdir(), `toolbar-fivem-connect-${Date.now()}.lnk`);
      await createShortcut(lnkPath, fivemExe, `-pure_${pureLevel} +connect ${connectTarget(server.address)}`, path.dirname(fivemExe));
      shell.openPath(lnkPath);
      setTimeout(() => fs.rm(lnkPath, { force: true }, () => {}), 30000);
      return { success: true, message: `กำลังเปิด FiveM ที่ Pure Level ${pureLevel} แล้วเชื่อมต่อ ${server.name}...` };
    } catch {
      // Shortcut creation/launch failed (e.g. PowerShell unavailable) — fall through
      // to the older, confirmed-safe-but-slower chained approach below.
    }
  }

  // Fallback: the confirmed-safe chain from before the shortcut approach — opening
  // FiveM.exe plain always works, and connecting via shell.openExternal while FiveM is
  // already running always works, but combining them into one instant (a cold boot
  // carrying a connect argument from the first moment) always crashes. Chain the two
  // safe halves ourselves: open plain, poll isFiveMRunning() until it's actually up,
  // then connect.
  const running = await isFiveMRunning();
  const connectNow = async () => {
    if (fivemExe) await repairProtocolHandler(fivemExe);
    shell.openExternal(uri);
  };

  if (running) {
    await connectNow();
    return { success: true, message: `กำลังเชื่อมต่อ ${server.name}...` };
  }

  if (!fivemExe) {
    shell.openExternal(uri);
    return { success: true, message: `กำลังเชื่อมต่อ ${server.name}...` };
  }

  shell.openPath(fivemExe);
  (async () => {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await isFiveMRunning()) {
        await connectNow();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  })();
  return { success: true, message: `กำลังเปิด FiveM แล้วเชื่อมต่อ ${server.name} ให้อัตโนมัติเมื่อพร้อม...` };
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
