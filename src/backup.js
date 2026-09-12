const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function backupsRoot(app) {
  const root = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function dirSize(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try { total += fs.statSync(full).size; } catch {}
      }
    }
  }
  return total;
}

function moveRecursive(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.cpSync(src, dest, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

// Moves originalPath into the centralized backup store instead of deleting it,
// so any destructive plugin action can be undone from the history panel.
function backupPath(app, originalPath, label) {
  if (!fs.existsSync(originalPath)) return null;
  const id = crypto.randomUUID();
  const sizeBytes = dirSize(originalPath);
  const record = {
    id,
    label,
    originalPath,
    timestamp: new Date().toISOString(),
    sizeBytes,
  };
  const backupDir = path.join(backupsRoot(app), id);
  const payload = path.join(backupDir, 'payload');
  moveRecursive(originalPath, payload);
  try {
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(record, null, 2));
  } catch (err) {
    // The move already succeeded but the manifest didn't — without a manifest,
    // listBackups() can't see this folder, so the user's file would otherwise be
    // silently stranded (moved, but invisible to the restore UI). Move it back to
    // where it came from instead of leaving it orphaned.
    let rolledBack = false;
    try {
      moveRecursive(payload, originalPath);
      rolledBack = true;
    } catch {
      // Rollback also failed — leave the payload in backupDir rather than risk
      // deleting the user's only remaining copy of the file.
    }
    if (rolledBack) fs.rmSync(backupDir, { recursive: true, force: true });
    throw err;
  }
  return record;
}

function listBackups(app) {
  const root = backupsRoot(app);
  const ids = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  const records = [];
  for (const entry of ids) {
    const manifestPath = path.join(root, entry.name, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        records.push(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      } catch {}
    }
  }
  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return records;
}

function restoreBackup(app, id) {
  const backupDir = path.join(backupsRoot(app), id);
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('ไม่พบข้อมูลสำรองนี้');
  const record = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (fs.existsSync(record.originalPath)) {
    throw new Error('ตำแหน่งเดิมมีข้อมูลอยู่แล้ว กรุณาลบ/ย้ายออกก่อนกู้คืน');
  }
  moveRecursive(path.join(backupDir, 'payload'), record.originalPath);
  fs.rmSync(backupDir, { recursive: true, force: true });
  return record;
}

module.exports = { dirSize, backupPath, listBackups, restoreBackup, moveRecursive };
