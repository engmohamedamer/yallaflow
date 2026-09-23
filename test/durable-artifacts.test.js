// v0.3.6 Durable user-provided artifacts: material inputs (e.g. a UI screenshot) are
// preserved through the existing SRC-#### source model — never only in conversation —
// and stay distinct from verification evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
// A valid 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

// A bounded change requested with text + a screenshot, as in the YaSchools pilot.
async function boundedChangeWithScreenshot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-artifacts-'));
  run(root, ['init', '--type', 'greenfield']);
  const start = run(root, ['start', 'Move the attendance filter above the table, as in the screenshot']);
  const workId = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['route', workId, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small UI change.']);
  await writeFile(path.join(root, 'attendance-ui.png'), PNG);
  const added = run(root, ['intake', 'add', workId, 'attendance-ui.png']);
  return { root, workId, added };
}

test('an image source is linked to an existing (routed) work item', async () => {
  const { root, workId, added } = await boundedChangeWithScreenshot();
  assert.match(added.stdout, /Source captured: SRC-0001/);
  assert.match(added.stdout, new RegExp(`Attached to: ${workId}`));
  const meta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.deepEqual(meta.sources.map((source) => [source.id, source.name, source.detectedFormat, source.contentAvailability]), [['SRC-0001', 'attendance-ui.png', 'png', 'original-only']]);
  const record = await readYaml(path.join(workspacePath(root), 'sources', 'SRC-0001', 'source.json'));
  assert.deepEqual(record.linkedWork, [workId]);
  assert.deepEqual(await readFile(path.join(workspacePath(root), 'sources', 'SRC-0001', 'attendance-ui.png')), PNG);
  assert.equal(meta.routingStatus, 'routed'); // attaching never re-routes or rewrites the request
});

test('a source is immutable: re-capture never overwrites, and tampering is detected', async () => {
  const { root, workId } = await boundedChangeWithScreenshot();
  const original = path.join(workspacePath(root), 'sources', 'SRC-0001', 'attendance-ui.png');
  await writeFile(path.join(root, 'attendance-ui.png'), Buffer.concat([PNG, Buffer.from('v2')]));
  const again = run(root, ['intake', 'add', workId, 'attendance-ui.png']);
  assert.match(again.stdout, /Source captured: SRC-0002/);
  assert.deepEqual(await readFile(original), PNG);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);

  await writeFile(original, Buffer.from('edited in place'));
  const tampered = run(root, ['doctor'], false);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stdout, /FAIL PF-0001: source SRC-0001's preserved original no longer matches its recorded checksum/);

  await rm(original);
  assert.match(run(root, ['doctor'], false).stdout, /source SRC-0001's preserved original is missing/);
});

test('a dangling source reference is an integrity error', async () => {
  const { root } = await boundedChangeWithScreenshot();
  await rm(path.join(workspacePath(root), 'sources', 'SRC-0001'), { recursive: true });
  const doctor = run(root, ['doctor'], false);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /PF-0001: references source SRC-0001, which does not exist\./);
});

test('the source survives a fresh-agent handoff and resume, with the path to open', async () => {
  const { root, workId } = await boundedChangeWithScreenshot();
  for (const command of ['handoff', 'resume']) {
    const output = run(root, [command, workId]).stdout;
    assert.match(output, /Source: SRC-0001 — attendance-ui\.png \(PNG, original preserved, no text extracted\)/);
    assert.match(output, /Sources \(original user\/project inputs, immutable/);
    const [, relative] = /SRC-0001 — attendance-ui\.png: (\S+)/.exec(output);
    assert.equal(relative, '.yallaflow/sources/SRC-0001/attendance-ui.png');
    assert.deepEqual(await readFile(path.join(root, relative)), PNG);
  }
  assert.match(run(root, ['source', 'show', 'SRC-0001']).stdout, new RegExp(`Linked work: ${workId}`));
});

test('a source is distinguishable from verification evidence', async () => {
  const { root, workId } = await boundedChangeWithScreenshot();
  run(root, ['verify', workId, '--', process.execPath, '-e', 'console.log("ui ok")']);
  const workDir = path.join(workspacePath(root), 'work', workId);
  assert.deepEqual((await readdir(path.join(workDir, 'evidence'))).sort(), ['V-001-verification.log', 'verification.json']);
  assert.deepEqual(await readdir(path.join(workspacePath(root), 'sources')), ['SRC-0001']);
  const ledger = await readFile(path.join(workDir, 'evidence', 'verification.json'), 'utf8');
  assert.doesNotMatch(ledger, /SRC-0001|attendance-ui/);
  const list = run(root, ['source', 'list']).stdout;
  assert.doesNotMatch(list, /verification/);
  const meta = await readYaml(path.join(workDir, 'meta.yaml'));
  assert.equal(meta.sources.length, 1);
});

test('no parallel attachment system: capture goes through sources/, never work/<id>/attachments', async () => {
  const { root, workId } = await boundedChangeWithScreenshot();
  assert.equal(await exists(path.join(workspacePath(root), 'work', workId, 'attachments')), false);
  const offenders = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/['"`]attachments['"`/]/.test(await readFile(full, 'utf8'))) offenders.push(path.relative(srcDir, full));
    }
  };
  await walk(srcDir);
  assert.deepEqual(offenders, []);
});

test('an artifact the Agent could not access is recorded as uncaptured, never as a preserved source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-artifacts-'));
  run(root, ['init', '--type', 'greenfield']);
  const start = run(root, ['start', 'Match the layout in the screenshot I pasted']);
  const workId = /Created (PF-\d+)/.exec(start.stdout)[1];
  run(root, ['limitation', 'add', workId, '--type', 'uncaptured-artifact', '--area', 'requirement',
    '--summary', 'Pasted UI screenshot of the attendance screen could not be captured.',
    '--reason', 'Image was only available in the conversation; no file path was accessible.']);
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false);
  const list = run(root, ['limitation', 'list', workId]).stdout;
  assert.match(list, /DL-001 \[uncaptured-artifact\] requirement — Pasted UI screenshot/);
  run(root, ['route', workId, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'UI.']);
  assert.match(run(root, ['handoff', workId]).stdout, /DL-001 \[uncaptured-artifact\] requirement/);
});

test('artifact guidance is part of the generated Agent contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-artifacts-'));
  run(root, ['init', '--type', 'greenfield']);
  const contract = await readFile(path.join(workspacePath(root), 'AGENT.md'), 'utf8');
  assert.match(contract, /## Sources, evidence, and generated artifacts/);
  assert.match(contract, /yallaflow intake add <work-id> <file>/);
  assert.match(contract, /--type uncaptured-artifact/);
  assert.match(contract, /Not every request needs a file/);
});
