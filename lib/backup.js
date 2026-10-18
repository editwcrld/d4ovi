'use strict';
// Backups of what you made yourself – settings, builds and the map progress –
// into a folder of your choice (e.g. one OneDrive syncs). Each backup is a folder of its own,
// named by date and time; the oldest go once there are more than `keep`. The login is left out.
const fs = require('fs');
const path = require('path');

const FILES = ['settings.json', 'builds.json', 'map-progress.json'];
const PREFIX = 'D4-Overlay-Backup-';

const stamp = (d) => d.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');   // 2026-10-11_14-05-09

/** The backups in a folder, oldest first. */
function list(target) {
  try {
    return fs.readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX)).map((e) => e.name).sort();
  } catch (_) { return []; }
}

/**
 * Copies the files that exist from dataDir into a new folder under target.
 * -> { dir, files } – throws when the target cannot be written.
 */
function run(dataDir, target, { keep = 10, now = new Date() } = {}) {
  if (!target) throw new Error('no backup folder chosen');
  const dir = path.join(target, PREFIX + stamp(now));
  fs.mkdirSync(dir, { recursive: true });
  const files = FILES.filter((f) => {
    try { fs.copyFileSync(path.join(dataDir, f), path.join(dir, f)); return true; } catch (_) { return false; }   // not made yet
  });
  const all = list(target);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    try { fs.rmSync(path.join(target, old), { recursive: true, force: true }); } catch (_) { /* in use – next time */ }
  }
  return { dir, files };
}

/** When the last backup was made (from its folder name), 0 without one. */
function lastAt(target) {
  const last = list(target).pop();
  if (!last) return 0;
  const m = last.slice(PREFIX.length).match(/^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)-(\d\d)$/);
  return m ? Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + 'Z') : 0;
}

module.exports = { run, list, lastAt, FILES, PREFIX };
