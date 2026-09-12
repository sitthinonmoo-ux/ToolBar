const fs = require('fs');
const path = require('path');

// A persistent, plain-text log for diagnosing failures we can't reproduce locally —
// e.g. a plugin that fails only on a specific user's machine. Appends rather than
// overwrites so a support request can just ask "send us toolbar-debug.log".
function logPath(app) {
  return path.join(app.getPath('userData'), 'toolbar-debug.log');
}

function log(app, line) {
  try {
    const stamp = new Date().toISOString();
    fs.appendFileSync(logPath(app), `[${stamp}] ${line}\n`, 'utf8');
  } catch {
    // logging must never be the thing that breaks a plugin run
  }
}

module.exports = { logPath, log };
