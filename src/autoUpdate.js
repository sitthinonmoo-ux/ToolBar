const { autoUpdater } = require('electron-updater');
const debugLog = require('./debugLog');

// Wires electron-updater to the renderer via a plain IPC status push — no built-in
// dialog, so the renderer decides how to show it (a toast, matching the rest of the
// app's UI, with a "restart to update" button once the download finishes).
function setupAutoUpdate(app, mainWindow) {
  const log = (msg) => debugLog.log(app, `[autoUpdate] ${msg}`);
  const send = (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:status', status);
  };

  autoUpdater.on('update-available', (info) => {
    log(`update available: ${info.version}`);
    send({ state: 'available', version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    send({ state: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log(`update downloaded: ${info.version}`);
    send({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    log(`error: ${err.stack || err.message}`);
  });

  autoUpdater.checkForUpdates().catch((err) => log(`checkForUpdates FAILED: ${err.message}`));
}

module.exports = { setupAutoUpdate, autoUpdater };
