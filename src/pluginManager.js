const fs = require('fs');
const path = require('path');

// Runs at app startup, before the window opens and before debugLog has anywhere to
// write yet — a single corrupted plugin.json (partial sync, AV quarantine) or a syntax
// error in one plugin's index.js used to throw here uncaught, crashing the entire app
// with zero diagnostic trail before the user ever saw a window. One bad plugin folder
// shouldn't be able to take down every other tool in the app.
function loadPlugins(pluginsDir) {
  const plugins = new Map();
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(pluginsDir, entry.name);
    const manifestPath = path.join(dir, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const impl = require(path.join(dir, 'index.js'));
      plugins.set(manifest.id, { manifest, impl });
    } catch (err) {
      console.error(`[pluginManager] skipping "${entry.name}" — failed to load: ${err.stack || err.message}`);
    }
  }
  return plugins;
}

module.exports = { loadPlugins };
