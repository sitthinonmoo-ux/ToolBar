const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolbarApi', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  pickFile: (filters) => ipcRenderer.invoke('dialog:pick-file', filters),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  detect: (pluginId, inputKey, params) => ipcRenderer.invoke('plugins:detect', pluginId, inputKey, params),
  checkStatus: (pluginId) => ipcRenderer.invoke('plugins:checkStatus', pluginId),
  onPluginProgress: (callback) => {
    const handler = (_event, pluginId, evt) => callback(pluginId, evt);
    ipcRenderer.on('plugins:progress', handler);
    return () => ipcRenderer.removeListener('plugins:progress', handler);
  },
  dryRun: (pluginId, params) => ipcRenderer.invoke('plugins:dryrun', pluginId, params),
  run: (pluginId, params) => ipcRenderer.invoke('plugins:run', pluginId, params),
  healthCheck: () => ipcRenderer.invoke('health:check'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  restoreBackup: (id) => ipcRenderer.invoke('backups:restore', id),
  listServers: () => ipcRenderer.invoke('servers:list'),
  saveServer: (server) => ipcRenderer.invoke('servers:save', server),
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),
  reorderServers: (orderedIds) => ipcRenderer.invoke('servers:reorder', orderedIds),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  getSysStats: () => ipcRenderer.invoke('sysmonitor:stats'),
  checkAppsInstalled: () => ipcRenderer.invoke('apps:checkInstalled'),
  installApp: (appId) => ipcRenderer.invoke('apps:install', appId),
  launchServer: (server) => ipcRenderer.invoke('servers:launch', server),
  serverStatus: (address) => ipcRenderer.invoke('servers:status', address),
  pickImage: () => ipcRenderer.invoke('dialog:pick-image'),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
  restartToUpdate: () => ipcRenderer.invoke('updater:restart'),
});
