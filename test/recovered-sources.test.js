// v0.3.6 post-DONE source policy: a source linked after completion is an auditable
// "recovered source" — it never appears to have existed during the original execution,
// and the completed work's history is not rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const REASON = 'Original screenshot from the request was not captured during the work.';

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

async function boundedChange() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-recovered-'));
  run(root, ['init', '--type', 'greenfield']);
  const id = /Created (PF-\d+)/.exec(run(root, ['start', 'Move the attendance filter above the table']).stdout)[1];
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small UI change.']);
  await writeFile(path.join(root, 'during.png'), PNG);
  await writeFile(path.join(root, 'late.png'), Buffer.concat([PNG, Buffer.from('late')]));
  return { root, id, workDir: path.join(workspacePath(root), 'work', id) };
}

async function driveToDone(root, id) {
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'ok']);
  run(root, ['checkpoint', id, '--skill', 'implementation-planning', '--complete', '--summary', 'ok']);
  for (let i = 0; i < 6; i++) run(root, ['advance', id], false);
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  run(root, ['knowledge', 'review', id, '--none']);
  assert.match(run(root, ['advance', id]).stdout, /→ DONE/);
}

test('a source captured during active work is a work input with link timing', async () => {
  const { root, id, workDir } = await boundedChange();
  run(root, ['intake', 'add', id, 'during.png']);
  const [ref] = (await readYaml(path.join(workDir, 'meta.yaml'))).sources;
  assert.equal(ref.relationship, 'work-input');
  assert.equal(ref.workStatusAtLink, 'INTAKE');
  assert.match(ref.linkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(ref.reason, undefined);
  assert.match(await readFile(path.join(workDir, 'work.md'), 'utf8'), /## Source Added[\s\S]*SRC-0001/);
});

test('file intake that creates new work records its sources as pending work inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-recovered-'));
  run(root, ['init', '--type', 'greenfield']);
  await writeFile(path.join(root, 'req.md'), '# Export invoices\n');
  const id = /Work created: (PF-\d+)/.exec(run(root, ['intake', 'req.md']).stdout)[1];
  const [ref] = (await readYaml(path.join(workspacePath(root), 'work', id, 'meta.yaml'))).sources;
  assert.equal(ref.relationship, 'work-input');
  assert.equal(ref.workStatusAtLink, 'PENDING');
});

test('attaching a source to DONE work requires a reason and changes nothing when refused', async () => {
  const { root, id, workDir } = await boundedChange();
  await driveToDone(root, id);
  const metaBefore = await readFile(path.join(workDir, 'meta.yaml'), 'utf8');
  const refused = run(root, ['intake', 'add', id, 'late.png'], false);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, new RegExp(`${id} is DONE\\. Attaching a source now records it as a recovered source[\\s\\S]*requires --reason[\\s\\S]*No files were changed\\.`));
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false); // no orphan source
  assert.equal(await readFile(path.join(workDir, 'meta.yaml'), 'utf8'), metaBefore);
  assert.notEqual(run(root, ['intake', 'add', id, 'late.png', '--reason', '   '], false).status, 0);
});

test('a post-DONE link records timing/status/reason, keeps DONE, and does not rewrite work history', async () => {
  const { root, id, workDir } = await boundedChange();
  run(root, ['intake', 'add', id, 'during.png']);
  await driveToDone(root, id);
  const metaBefore = await readYaml(path.join(workDir, 'meta.yaml'));
  const workMdBefore = await readFile(path.join(workDir, 'work.md'), 'utf8');
  const progressBefore = await readFile(path.join(workDir, 'progress.md'), 'utf8');

  const added = run(root, ['intake', 'add', id, 'late.png', '--reason', REASON]);
  assert.match(added.stdout, new RegExp(`${id} remains DONE; recorded as recovered source`));

  const meta = await readYaml(path.join(workDir, 'meta.yaml'));
  assert.equal(meta.status, 'DONE');
  assert.deepEqual(meta.completionHistory, metaBefore.completionHistory);
  assert.deepEqual(meta.lifecycleHistory, metaBefore.lifecycleHistory);
  const late = meta.sources.find((ref) => ref.id === 'SRC-0002');
  assert.equal(late.relationship, 'recovered-source');
  assert.equal(late.workStatusAtLink, 'DONE');
  assert.equal(late.reason, REASON);
  assert.ok(late.linkedAt > meta.completionHistory.at(-1).completedAt);
  assert.equal(meta.sources.find((ref) => ref.id === 'SRC-0001').relationship, 'work-input');

  assert.equal(await readFile(path.join(workDir, 'work.md'), 'utf8'), workMdBefore); // historical record untouched
  const progress = await readFile(path.join(workDir, 'progress.md'), 'utf8');
  assert.ok(progress.startsWith(progressBefore)); // append-only ledger
  assert.match(progress.slice(progressBefore.length), /Recovered source attached after DONE: SRC-0002 \(late\.png\)/);

  assert.deepEqual(await readFile(path.join(workspacePath(root), 'sources', 'SRC-0002', 'late.png')), Buffer.concat([PNG, Buffer.from('late')]));
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('handoff, resume, and source show distinguish a recovered source from work inputs', async () => {
  const { root, id } = await boundedChange();
  run(root, ['intake', 'add', id, 'during.png']);
  await driveToDone(root, id);
  run(root, ['intake', 'add', id, 'late.png', '--reason', REASON]);

  for (const command of ['handoff', 'resume']) {
    const output = run(root, [command, id]).stdout;
    assert.match(output, /SRC-0001 — during\.png \(PNG, original preserved, no text extracted\)(?! \[recovered)/);
    assert.match(output, new RegExp(`SRC-0002 — late\\.png \\(PNG[^)]*\\) \\[recovered after DONE on \\S+: ${REASON.replace('.', '\\.')}\\]`));
    assert.match(output, /SRC-0002 — late\.png: \.yallaflow\/sources\/SRC-0002\/late\.png \(recovered after DONE — not available during the original execution\)/);
  }
  const lateShow = run(root, ['source', 'show', 'SRC-0002']).stdout;
  assert.match(lateShow, new RegExp(`${id}: RECOVERED SOURCE — linked \\S+ while DONE; not available during the original execution\\. Reason: ${REASON.replace('.', '\\.')}`));
  assert.match(run(root, ['source', 'show', 'SRC-0001']).stdout, new RegExp(`${id}: work input — linked \\S+ while INTAKE`));
});

test('recovered-source audit metadata and checksum immutability are enforced by doctor', async () => {
  const { root, id, workDir } = await boundedChange();
  await driveToDone(root, id);
  run(root, ['intake', 'add', id, 'late.png', '--reason', REASON]);
  const metaFile = path.join(workDir, 'meta.yaml');
  const meta = await readYaml(metaFile);
  delete meta.sources[0].reason;
  await writeYaml(metaFile, meta);
  assert.match(run(root, ['doctor'], false).stdout, /recovered source SRC-0001 is missing its audit metadata/);
  meta.sources[0].reason = REASON;
  await writeYaml(metaFile, meta);
  await writeFile(path.join(workspacePath(root), 'sources', 'SRC-0001', 'late.png'), 'tampered');
  assert.match(run(root, ['doctor'], false).stdout, /source SRC-0001's preserved original no longer matches its recorded checksum/);
});

test('summaries never copy source contents: secrets in a source stay out of handoff/resume/guide/status', async () => {
  const { root, id } = await boundedChange();
  await writeFile(path.join(root, 'ops-notes.txt'), 'Staging DB password: hunter2-SECRET-9f3a\n');
  run(root, ['intake', 'add', id, 'ops-notes.txt']);
  for (const args of [['handoff', id], ['resume', id], ['guide', id], ['status'], ['source', 'list'], ['source', 'show', 'SRC-0001']]) {
    assert.doesNotMatch(run(root, args).stdout, /hunter2-SECRET-9f3a/, args.join(' '));
  }
});

test('legacy work-level attachments/ directories stay readable and are ignored', async () => {
  const { root, id, workDir } = await boundedChange();
  await mkdir(path.join(workDir, 'attachments'));
  await writeFile(path.join(workDir, 'attachments', 'old-mockup.png'), PNG);
  run(root, ['intake', 'add', id, 'during.png']);
  for (const args of [['handoff', id], ['resume', id], ['status'], ['guide', id]]) run(root, args);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.deepEqual(await readdir(path.join(workDir, 'attachments')), ['old-mockup.png']);
  assert.deepEqual((await readYaml(path.join(workDir, 'meta.yaml'))).sources.map((ref) => ref.id), ['SRC-0001']);
});
