const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Cheap admin-rights probe: try writing (and immediately removing) a marker file in
// `dir`. GTA5.exe's well-known install paths are almost all under Program Files, which a
// normal (non-admin) Windows account cannot write into — this is the #1 reason
// ReShade install/uninstall that works fine on a dev/admin account fails silently on a
// normal user's PC.
function isDirWritable(dir) {
  const probe = path.join(dir, `.toolbar-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// Relaunches this app elevated (same technique as src/regTweaks.js's runElevated: a
// single UAC prompt via `Start-Process -Verb RunAs -Wait`) so a privileged task can run
// with write access to an admin-protected folder. We can't elevate the already-running
// process in place, so instead we hand the task name + params to a fresh elevated
// instance of ourselves via main.js's --elevated-worker flag (see elevatedWorker.js) and
// read its result back from a temp file once it exits.
//
// The elevated instance is a SEPARATE OS process, so a plugin's onProgress calls inside
// it can't reach this process directly — same problem regTweaks.js solves by having its
// elevated script write partial output to a file and polling that file here. We do the
// same thing with a small progress file: elevatedWorker.js overwrites it with the latest
// {done,total} on every onProgress call, and we poll it here and forward each new value
// to `context.onProgress`, so the UI's progress bar keeps moving through the UAC prompt
// and the privileged work instead of sitting frozen until the whole thing finishes.
function runElevatedTask(taskName, params, context) {
  return new Promise((resolve) => {
    const argsPath = path.join(os.tmpdir(), `toolbar-elevate-${taskName}-${Date.now()}.json`);
    const resultPath = `${argsPath}.result.json`;
    const progressPath = `${argsPath}.progress.json`;
    fs.writeFileSync(argsPath, JSON.stringify({ task: taskName, params }), 'utf8');

    const projectRoot = path.join(__dirname, '..');
    const argsList = context.app.isPackaged
      ? `--elevated-worker="${argsPath}"`
      : `"${projectRoot}" --elevated-worker="${argsPath}"`;

    const onProgress = context && context.onProgress;
    let lastProgress = null;
    const poll = onProgress
      ? setInterval(() => {
          try {
            const raw = fs.readFileSync(progressPath, 'utf8');
            if (raw !== lastProgress) {
              lastProgress = raw;
              onProgress(JSON.parse(raw));
            }
          } catch {
            // no progress file yet (UAC prompt still up, or task hasn't started) — fine, retry next tick
          }
        }, 300)
      : null;

    const launcher = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', `Start-Process -FilePath "${process.execPath}" -ArgumentList '${argsList}' -Verb RunAs -Wait`],
      { windowsHide: true }
    );
    launcher.on('error', (err) => {
      if (poll) clearInterval(poll);
      resolve({ success: false, message: `เปิดสิทธิ์ Administrator ไม่สำเร็จ: ${err.message}` });
    });
    launcher.on('exit', () => {
      if (poll) clearInterval(poll);
      let output;
      try {
        output = fs.readFileSync(resultPath, 'utf8');
      } catch {
        // No result file means the elevated instance never ran the task — the user
        // most likely clicked "No" on the UAC prompt.
        resolve({ success: false, message: 'ไม่ได้รับสิทธิ์ Administrator (ยกเลิก UAC หรือปิดหน้าต่างไป) — ลองใหม่แล้วกด "ใช่"' });
        return;
      } finally {
        fs.rm(argsPath, { force: true }, () => {});
        fs.rm(resultPath, { force: true }, () => {});
        fs.rm(progressPath, { force: true }, () => {});
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({ success: false, message: 'อ่านผลลัพธ์จากการทำงานแบบ Administrator ไม่สำเร็จ' });
      }
    });
  });
}

module.exports = { isDirWritable, runElevatedTask };
