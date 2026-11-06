// Live updates: a recursive fs.watch on .yallaflow/ (Linux, macOS, Windows on Node ≥ 20),
// debounced, with a polling fallback where recursive watching is unavailable. The lock
// file and atomic-write temp files are ignored: they are not state.
import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEBOUNCE_MS = 250;
const POLL_MS = 2000;

function ignored(relative) {
  if (!relative) return false;
  const name = relative.split(path.sep).join('/');
  return name === 'local/lock' || name.startsWith('local/lock.') || name.endsWith('.tmp');
}

export function watchWorkspace(root, onChange, { poll = false } = {}) {
  const base = path.join(root, '.yallaflow');
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };
  if (!poll) {
    try {
      const watcher = watch(base, { recursive: true }, (_event, relative) => {
        if (!ignored(relative ? String(relative) : '')) fire();
      });
      watcher.on('error', () => {});
      return { mode: 'watch', close: () => { clearTimeout(timer); watcher.close(); } };
    } catch {
      // fall through to polling
    }
  }
  let last = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const signature = await workspaceSignature(base).catch(() => null);
    if (last !== null && signature !== last) fire();
    last = signature;
    if (!stopped) poller = setTimeout(tick, POLL_MS);
  };
  let poller = setTimeout(tick, 0);
  return { mode: 'poll', close: () => { stopped = true; clearTimeout(poller); clearTimeout(timer); } };
}

// Cheap change signature: size and mtime of every state file.
async function workspaceSignature(base) {
  const parts = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(base, full);
      if (ignored(relative)) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await stat(full);
        parts.push(`${relative}:${info.size}:${info.mtimeMs}`);
      }
    }
  }
  await walk(base);
  return parts.sort().join('|');
}
