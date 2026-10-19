// Shared helpers for the v1.1.0 optional-capability tests (Connected Requirements,
// AI QC, Smart Demo). Kept outside test/ so the runner does not load it as a test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

export const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
export const noNetworkPreload = fileURLToPath(new URL('./no-network.js', import.meta.url));
export const ticketFixture = (name) => fileURLToPath(new URL(`../test/fixtures/tickets/${name}`, import.meta.url));

export function run(root, args, { ok = true, env = {}, preload = null } = {}) {
  const argv = preload ? ['--import', preload, cliPath, ...args] : [cliPath, ...args];
  const result = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  if (ok) assert.equal(result.status, 0, `${args.join(' ')}:\n${result.stderr || result.stdout}`);
  return result;
}

export async function freshProject(prefix = 'yallaflow-optional-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  run(root, ['init', '--type', 'greenfield', '--name', 'demo']);
  return root;
}

export function createdWork(stdout) {
  return /(?:Created|Work created:) (PF-[\w-]+)/.exec(stdout)?.[1];
}

export function routedBoundedChange(root, request = 'Move the attendance filter above the table') {
  const id = createdWork(run(root, ['start', request]).stdout);
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small UI change.']);
  return id;
}

export function driveChangeToDone(root, id) {
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'ok']);
  run(root, ['checkpoint', id, '--skill', 'implementation-planning', '--complete', '--summary', 'ok']);
  for (let i = 0; i < 6; i++) run(root, ['advance', id], { ok: false });
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  run(root, ['knowledge', 'review', id, '--none']);
  assert.match(run(root, ['advance', id]).stdout, /→ DONE/);
}

export async function writeJsonFile(dir, name, value) {
  const file = path.join(dir, name);
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

export async function readWorkspaceText(root) {
  const chunks = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else chunks.push(await readFile(full, 'utf8'));
    }
  }
  await walk(path.join(root, '.yallaflow'));
  return chunks.join('\n');
}

export async function workspaceHash(root) {
  const base = path.join(root, '.yallaflow');
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else { hash.update(path.relative(base, full)); hash.update(await readFile(full)); }
    }
  }
  await walk(base);
  return hash.digest('hex');
}
