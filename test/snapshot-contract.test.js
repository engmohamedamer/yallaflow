// v1.2.0 read contract: `yallaflow snapshot --json` and `yallaflow work show <id> --json`
// validate against their schemas, report who is waited on, and never write anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { loadSchema, validate } from '../test-support/schema.js';
import { MINIMAL_INTENT, cliRecordIntent } from '../test-support/delivery.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const SNAPSHOT = loadSchema('snapshot-1.schema.json');
const WORK = loadSchema('work-1.schema.json');

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}
const json = (root, args) => JSON.parse(run(root, args).stdout);
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

async function project(mode = 'adaptive') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-snapshot-'));
  await initWorkspace(root, 'demo', 'greenfield', mode);
  return root;
}

function created(result) {
  return /Created (PF-\d+)/.exec(result.stdout)[1];
}

test('snapshot --json validates and places each item in the flow', async () => {
  const root = await project();
  const pending = created(run(root, ['start', 'Something unclassified']));
  const feature = created(run(root, ['start', 'Add CSV export']));
  run(root, ['route', feature, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  await cliRecordIntent(root, feature, MINIMAL_INTENT, run);
  run(root, ['advance', feature]);
  run(root, ['advance', feature]);

  const snapshot = json(root, ['snapshot', '--json']);
  assert.deepEqual(validate(SNAPSHOT, snapshot), []);
  assert.equal(snapshot.schema, 'yallaflow.snapshot/1');
  const byId = Object.fromEntries(snapshot.items.map((item) => [item.id, item]));
  assert.equal(byId[pending].state, 'new');
  assert.equal(byId[pending].completion, 0);
  assert.match(byId[pending].nextAction, /yallaflow route/);
  assert.equal(byId[feature].stage, 'CLARIFICATION');
  assert.equal(byId[feature].currentStation, 'understand');
  assert.ok(byId[feature].completion > 0 && byId[feature].completion < 20);
  assert.equal(snapshot.counts.new, 1);
});

test('a requested human review gate is reported as waiting for you', async () => {
  const root = await project('gated');
  const id = created(run(root, ['start', 'Billing redesign']));
  run(root, ['route', id, '--type', 'feature', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Big.']);
  run(root, ['advance', id]);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);

  const item = json(root, ['snapshot', '--json']).items.find((entry) => entry.id === id);
  assert.equal(item.state, 'you');
  assert.equal(item.waitingFor.kind, 'review');
  assert.equal(item.waitingFor.gate, 'discovery');
  assert.match(item.waitingFor.action, new RegExp(`yallaflow approve ${id} --stage discovery`));
});

test('an open material question is reported as waiting for you', async () => {
  const root = await project();
  const id = created(run(root, ['start', 'Refund policy']));
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  run(root, ['advance', id]);
  run(root, ['question', 'add', id, '--category', 'business', '--text', 'Can refunds be partial?']);
  const item = json(root, ['snapshot', '--json']).items.find((entry) => entry.id === id);
  assert.equal(item.state, 'you');
  assert.deepEqual(item.waitingFor.questions, ['Q-001']);
});

test('work show --json returns every section and validates', async () => {
  const root = await project();
  const id = created(run(root, ['start', 'Add CSV export']));
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  const brd = path.join(root, 'brd.md');
  await writeFile(brd, '# Export\nUsers can export orders as CSV.\n');
  run(root, ['intake', 'add', id, brd]);
  await cliRecordIntent(root, id, MINIMAL_INTENT, run);
  run(root, ['advance', id]);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'Found the orders module.']);

  const detail = json(root, ['work', 'show', id, '--json']);
  assert.deepEqual(validate(WORK, detail), []);
  assert.equal(detail.item.id, id);
  assert.equal(detail.request.raw, 'Add CSV export');
  assert.equal(detail.sources.length, 1);
  assert.equal(detail.sources[0].name, 'brd.md');
  assert.equal(detail.sources[0].available, true);
  assert.ok(detail.requirements.length >= 1);
  assert.ok(detail.criteria.every((entry) => entry.convergence === 'not-assessed'));
  const discovery = detail.checkpoints.find((entry) => entry.skill === 'context-discovery');
  assert.equal(discovery.status, 'completed');
  assert.equal(discovery.summary, 'Found the orders module.');
});

test('errors are one JSON document with a code and exit status 1', async () => {
  const root = await project();
  const result = run(root, ['work', 'show', 'PF-9999', '--json'], false);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: { code: 'WORK_NOT_FOUND', message: 'Work item PF-9999 was not found.' } });
});

test('read commands never modify .yallaflow, the working tree, or .git/index', async () => {
  const root = await project('gated');
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A']);
  git(root, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  const id = created(run(root, ['start', 'Billing redesign']));
  run(root, ['route', id, '--type', 'feature', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Big.']);
  run(root, ['advance', id]);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);

  const before = await treeHash(root);
  run(root, ['snapshot', '--json']);
  run(root, ['snapshot']);
  run(root, ['work', 'show', id, '--json']);
  run(root, ['work', 'show', id]);
  assert.equal(await treeHash(root), before);
});

// Hash of every file under the root (including .git/index), with content and mtime.
async function treeHash(root) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === path.join(root, '.git', 'objects')) continue;
        await walk(full);
      } else if (entry.isFile()) {
        hash.update(path.relative(root, full));
        hash.update(await readFile(full));
        hash.update(String((await stat(full)).mtimeMs));
      }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

test('snapshot reads a legacy v0.3.6 workspace fixture without writing to it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-snapshot-legacy-'));
  spawnSync('cp', ['-a', `${fileURLToPath(new URL('./fixtures/v0.3.6-workspace/', import.meta.url))}.`, root]);
  const before = await treeHash(root);
  const snapshot = json(root, ['snapshot', '--json']);
  assert.deepEqual(validate(SNAPSHOT, snapshot), []);
  for (const item of snapshot.items) assert.deepEqual(validate(WORK, json(root, ['work', 'show', item.id, '--json'])), [], item.id);
  assert.equal(await treeHash(root), before);
});

test('work show reports convergence evidence as stable references (run, path)', async () => {
  const root = await project();
  const id = created(run(root, ['start', 'Add CSV export']));
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  await cliRecordIntent(root, id, MINIMAL_INTENT, run);
  await writeFile(path.join(root, 'export.js'), 'export const csv = 1;\n');
  run(root, ['advance', id]);
  for (const skill of ['context-discovery', 'requirement-clarification']) run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']);
  for (let i = 0; i < 4; i++) run(root, ['advance', id], false);
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  const file = path.join(root, 'conv.json');
  const criterion = json(root, ['work', 'show', id, '--json']).criteria[0].id;
  await writeFile(file, JSON.stringify({ findings: [{ criterion, status: 'satisfied', reason: 'seen', evidence: ['export.js', 'verification:V-001'] }] }));
  run(root, ['convergence', 'record', id, '--file', file]);
  const detail = json(root, ['work', 'show', id, '--json']);
  assert.deepEqual(validate(WORK, detail), []);
  assert.deepEqual(detail.criteria[0].evidence.map((entry) => entry.ref), ['export.js', 'V-001']);
  assert.ok(detail.criteria[0].evidence.every((entry) => typeof entry.text === 'string'));
});
