const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadPlugins } = require('./src/pluginManager');
const { listBackups, restoreBackup } = require('./src/backup');
const { runHealthCheck } = require('./src/healthcheck');
const { listServers, upsertServer, deleteServer, reorderServers, launchServer, readImageAsDataUri } = require('./src/servers');
const { fetchServerStatus } = require('./src/serverStatus');
const { exportSettings, importSettings } = require('./src/exportImport');
const { APP_CATALOG } = require('./src/appCatalog');
const { checkInstalledAll, installApp } = require('./src/appInstaller');
const { getStats } = require('./src/sysMonitor');
const { setupAutoUpdate, autoUpdater } = require('./src/autoUpdate');
const debugLog = require('./src/debugLog');

let mainWindow;
const plugins = loadPlugins(path.join(__dirname, 'plugins'));

// A plugin that needs to write into an admin-protected folder (e.g. ReShade installing
// into a game under Program Files) relaunches this same exe elevated with this flag
// instead of trying to elevate a single child process — Electron/UAC has no clean way to
// hand admin rights to an already-running process. The elevated instance runs the one
// task headlessly (see src/elevatedWorker.js) and exits without ever opening a window.
const elevatedWorkerFlag = process.argv.find((a) => a.startsWith('--elevated-worker='));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: '#05070d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
}

// Dev-only hot reload: watches source files and reacts without a manual `npm start`
// restart. Renderer-only files (HTML/CSS/JS under renderer/) just reload the window's
// contents — cheap and instant. Anything the main process loads once at startup
// (main.js, preload.js, plugin code, src/) needs a real process relaunch, since Node's
// require() cache can't be un-required — app.relaunch() queues a fresh process start
// and app.exit() ends this one, so the switch is closer to a fast auto-restart than a
// true reload but still means no console command from you.
function watchDir(dir, onChange, debounceMs = 200) {
  let timer = null;
  try {
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
  } catch (err) {
    console.log(`[dev-reload] could not watch ${dir}: ${err.message}`);
  }
}

function setupDevReload() {
  watchDir(path.join(__dirname, 'renderer'), () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[dev-reload] renderer changed, reloading window');
      mainWindow.webContents.reload();
    }
  });
  const restartOnChange = () => {
    console.log('[dev-reload] main-process file changed, relaunching');
    app.relaunch();
    app.exit(0);
  };
  for (const dir of ['main.js', 'preload.js', 'src', 'plugins']) {
    const full = path.join(__dirname, dir);
    if (fs.statSync(full).isDirectory()) watchDir(full, restartOnChange);
    else fs.watch(full, () => restartOnChange());
  }
}

app.whenReady().then(async () => {
  if (elevatedWorkerFlag) {
    const argsPath = elevatedWorkerFlag.slice('--elevated-worker='.length);
    await require('./src/elevatedWorker').run(app, argsPath);
    app.exit(0);
    return;
  }
  createWindow();
  if (!app.isPackaged) setupDevReload();
  // Only a packaged install has an app-update.yml pointing at a real feed — running
  // from source has nothing to check against and would just log a harmless error.
  if (app.isPackaged) setupAutoUpdate(app, mainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Catches anything that would otherwise crash the main process silently — a plugin's
// run() can spawn external processes / do network I/O, and a failure there that
// escapes every try/catch would previously just orphan the pending IPC reply with no
// trace at all. This can't fix the underlying issue, but it means "send us
// toolbar-debug.log" is possible instead of guessing blind about a machine we can't see.
process.on('uncaughtException', (err) => {
  debugLog.log(app, `UNCAUGHT EXCEPTION: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  debugLog.log(app, `UNHANDLED REJECTION: ${reason && reason.stack ? reason.stack : reason}`);
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('window:close', () => mainWindow && mainWindow.close());

ipcMain.handle('updater:restart', () => autoUpdater.quitAndInstall());

ipcMain.handle('plugins:list', () => {
  return Array.from(plugins.values()).map((p) => p.manifest);
});

ipcMain.handle('dialog:pick-file', async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters && filters.length ? filters : undefined,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function getPlugin(pluginId) {
  const plugin = plugins.get(pluginId);
  if (!plugin) throw new Error(`ไม่พบปลั๊กอิน: ${pluginId}`);
  return plugin;
}

ipcMain.handle('plugins:dryrun', async (_event, pluginId, params) => {
  const plugin = getPlugin(pluginId);
  return plugin.impl.dryRun(params, { app });
});

// A plugin's run()/detect() can spawn an external process (ReShade Setup.exe, winget,
// etc.) or walk the filesystem — if that hangs, the promise never settles and
// ipcMain.handle never gets to reply, surfacing to the renderer as the opaque "reply was
// never sent" instead of a real error message. Racing against a timeout guarantees SOME
// reply always goes back, with a message that actually explains what to check. Note this
// only helps for a genuinely async hang (network stall, a subprocess never exiting) — a
// *synchronous* block of the main thread (the full-drive-scan bug this was added
// alongside — see src/scan.js) prevents even this timer from firing, which is why the
// real fix there was making the scan itself non-blocking, not just adding a timeout.
const PLUGIN_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const PLUGIN_DETECT_TIMEOUT_MS = 30 * 1000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ success: false, message }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

ipcMain.handle('plugins:detect', async (_event, pluginId, inputKey, params) => {
  const plugin = getPlugin(pluginId);
  if (typeof plugin.impl.detect !== 'function') {
    return { path: null, message: 'เครื่องมือนี้ไม่รองรับการค้นหาอัตโนมัติ' };
  }
  try {
    return await withTimeout(
      plugin.impl.detect(inputKey, params, { app }),
      PLUGIN_DETECT_TIMEOUT_MS,
      { path: null, message: 'ค้นหาไม่สำเร็จภายในเวลาที่กำหนด — ลองเลือกไฟล์/โฟลเดอร์เอง' }
    );
  } catch (err) {
    return { path: null, message: err.message };
  }
});

ipcMain.handle('plugins:checkStatus', async (_event, pluginId) => {
  const plugin = getPlugin(pluginId);
  if (typeof plugin.impl.checkStatus !== 'function') return {};
  return plugin.impl.checkStatus({ app });
});

ipcMain.handle('plugins:run', async (_event, pluginId, params) => {
  const plugin = getPlugin(pluginId);
  const onProgress = (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('plugins:progress', pluginId, evt);
  };
  const runId = Date.now();
  debugLog.log(app, `[${runId}] plugins:run START pluginId=${pluginId} params=${JSON.stringify(params)}`);
  try {
    const result = await withTimeout(
      plugin.impl.run(params, { app, onProgress }),
      PLUGIN_RUN_TIMEOUT_MS,
      'หมดเวลารอ (5 นาที) — ถ้าเครื่องมือนี้เปิดหน้าต่างขอสิทธิ์ Administrator (UAC) ให้เช็คว่ามีหน้าต่างซ่อนอยู่หลังแอปนี้ไหม แล้วลองใหม่'
    );
    debugLog.log(app, `[${runId}] plugins:run DONE result=${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    debugLog.log(app, `[${runId}] plugins:run THREW: ${err.stack || err.message}`);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('health:check', () => runHealthCheck());

ipcMain.handle('sysmonitor:stats', () => getStats());

ipcMain.handle('shell:open-external', (_event, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('servers:list', () => listServers(app));

ipcMain.handle('servers:save', (_event, server) => {
  try {
    return { success: true, server: upsertServer(app, server) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('servers:delete', (_event, id) => {
  deleteServer(app, id);
  return { success: true };
});

ipcMain.handle('apps:list', () => APP_CATALOG);

ipcMain.handle('apps:checkInstalled', () => checkInstalledAll());

ipcMain.handle('apps:install', (_event, appId) => installApp(appId));

ipcMain.handle('settings:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export ToolBar settings',
    defaultPath: 'toolbar-settings.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };
  try {
    await exportSettings(app, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('settings:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import ToolBar settings',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
  try {
    const summary = importSettings(app, result.filePaths[0]);
    return { success: true, ...summary };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('servers:reorder', (_event, orderedIds) => {
  try {
    return { success: true, servers: reorderServers(app, orderedIds) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('servers:launch', (_event, server) => launchServer(server));

ipcMain.handle('servers:status', (_event, address) => fetchServerStatus(address));

ipcMain.handle('dialog:pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    return readImageAsDataUri(result.filePaths[0]);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('backups:list', () => listBackups(app));

ipcMain.handle('backups:restore', (_event, id) => {
  try {
    restoreBackup(app, id);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});
