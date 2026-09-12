const fs = require('fs');

// Maps an elevated task name (written by src/elevate.js's runElevatedTask) to the
// privileged function that actually performs it. Lazily require()'d so this file has no
// hard dependency on every plugin that happens to use elevation.
const TASKS = {
  'reshade-install': () => require('../plugins/reshade-installer').installAndRelocate,
  'reshade-uninstall': () => require('../plugins/reshade-uninstaller').performUninstall,
};

// Runs one privileged task headlessly inside an elevated relaunch of this app (see
// main.js's --elevated-worker flag), then writes the result to `${argsPath}.result.json`
// for the unelevated process that spawned us to read back once we exit.
async function run(app, argsPath) {
  const resultPath = `${argsPath}.result.json`;
  const progressPath = `${argsPath}.progress.json`;
  // Overwritten (not appended) on every tick — src/elevate.js's runElevatedTask polls
  // this file from the unelevated parent process to keep the UI's progress bar moving
  // across the process boundary a UAC elevation creates.
  const onProgress = (evt) => {
    try {
      fs.writeFileSync(progressPath, JSON.stringify(evt), 'utf8');
    } catch {
      // best effort — losing a progress tick isn't worth failing the whole task over
    }
  };
  let result;
  try {
    const { task, params } = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
    const getHandler = TASKS[task];
    if (!getHandler) throw new Error(`unknown elevated task: ${task}`);
    result = await getHandler()(params, { app, onProgress });
  } catch (err) {
    result = { success: false, message: err.stack || err.message };
  }
  fs.writeFileSync(resultPath, JSON.stringify(result), 'utf8');
}

module.exports = { run };
