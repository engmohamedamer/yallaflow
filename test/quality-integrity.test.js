// v1.1.0 evidence integrity (found in real-world acceptance, PF-0012): QC/demo media must
// never be overwritten across branches or by a repeated record ID, an overwritten file
// must not stay silent, and Shared Projects allocate branch-safe record IDs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { createRecordMedia, mediaDirPath } from '../src/quality/artifacts.js';
import { resolveQcEvidence } from '../src/quality/qc.js';
import { cliPath, freshProject, routedBoundedChange, run, writeJsonFile } from '../test-support/optional.js';

const git = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const quality = (root, id) => path.join(workspacePath(root), 'work', id, 'quality');
const ledger = async (root, id) => JSON.parse(await readFile(path.join(quality(root, id), 'qc.json'), 'utf8'));

async function gitProject() {
  const root = await freshProject('yallaflow-integrity-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  git(root, ['config', 'user.name', 'Dev']);
  return root;
}

async function record(root, id, dir, status, bytes) {
  await writeFile(path.join(dir, 'shot.png'), bytes);
  const result = { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status, steps: ['Open the booking'], actual: 'observed', artifacts: [path.join(dir, 'shot.png')] }] };
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'result.json', result)]);
}

test('a QC record on another branch never overwrites the first branch\'s git-ignored evidence', async () => {
  const root = await gitProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-integrity-in-'));
  const id = routedBoundedChange(root);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'Cancel a booking', rationale: 'Pilot flow.' }] })]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'plan']);

  git(root, ['checkout', '-qb', 'feature-a']);
  await record(root, id, dir, 'passed', 'BRANCH-A-EVIDENCE');
  const a = (await ledger(root, id)).runs[0].scenarios[0].artifacts[0];
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'a']);

  git(root, ['checkout', '-q', 'main']);
  git(root, ['checkout', '-qb', 'feature-b']);
  await record(root, id, dir, 'failed', 'BRANCH-B-EVIDENCE');
  const b = (await ledger(root, id)).runs[0].scenarios[0].artifacts[0];
  assert.equal((await ledger(root, id)).runs[0].id, 'QC-001', 'single-user IDs keep the short form');
  assert.notEqual(path.dirname(a.path), path.dirname(b.path), 'each record gets its own media folder');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'b']);

  git(root, ['checkout', '-q', 'feature-a']);
  assert.equal(await readFile(path.join(quality(root, id), a.path), 'utf8'), 'BRANCH-A-EVIDENCE', 'branch A keeps its own evidence');
  const doctor = run(root, ['doctor']);
  assert.doesNotMatch(doctor.stdout, /no longer matches its recorded SHA-256/);
  assert.match(git(root, ['check-ignore', path.join('.yallaflow', 'work', id, 'quality', a.path)]), /quality/, 'media stays git-ignored');
});

test('overwritten or edited evidence is reported by doctor and status, never silently trusted', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-integrity-in-'));
  const id = routedBoundedChange(root);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  await record(root, id, dir, 'passed', 'ORIGINAL');
  const artifact = (await ledger(root, id)).runs[0].scenarios[0].artifacts[0];
  await writeFile(path.join(quality(root, id), artifact.path), 'TAMPERED');
  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 0, 'a warning, not an integrity failure');
  assert.match(doctor.stdout, new RegExp(`WARN ${id}: QC-001 S-01 ${artifact.path.replace(/[.]/g, '\\.')} no longer matches its recorded SHA-256`));
  assert.match(run(root, ['qc', 'status', id]).stdout, /Warning: .*no longer matches its recorded SHA-256/);
});

test('a failed record removes only the media folder it created; identical files are stored once', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-integrity-in-'));
  const id = routedBoundedChange(root);
  await writeFile(path.join(dir, 'shot.png'), 'SAME-BYTES');
  const inspected = [{ raw: 'shot.png', absolute: path.join(dir, 'shot.png'), sizeBytes: 10 }];
  const first = await createRecordMedia(root, id, 'QC-001');
  const stored = await first.add(inspected);
  const second = await createRecordMedia(root, id, 'QC-001');
  await second.add(inspected);
  const folders = (await readdir(mediaDirPath(root, id))).filter((name) => name.startsWith('QC-001-'));
  assert.equal(folders.length, 2, 'the same record ID never shares a folder');
  await second.remove();
  assert.ok(existsSync(path.join(quality(root, id), stored[0].path)), 'removing one record leaves the other intact');

  // One screenshot attached to two scenarios: one stored file, two references.
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [
    { id: 'S-01', kind: 'functional', title: 'a', rationale: 'r' }, { id: 'S-02', kind: 'functional', title: 'b', rationale: 'r' }
  ] })]);
  const shot = path.join(dir, 'shot.png');
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [
    { id: 'S-01', status: 'passed', steps: ['a'], artifacts: [shot] }, { id: 'S-02', status: 'passed', steps: ['b'], artifacts: [shot] }
  ] })]);
  const [s1, s2] = (await ledger(root, id)).runs[0].scenarios;
  assert.equal(s1.artifacts[0].path, s2.artifacts[0].path);
  assert.deepEqual(await readdir(path.join(quality(root, id), path.dirname(s1.artifacts[0].path))), ['shot.png']);
});

test('Shared Projects allocate branch-safe QC and demo record IDs that citations accept', async () => {
  const root = await gitProject();
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  run(root, ['shared', 'enable']);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-integrity-in-'));
  const id = /Created (PF-[\w-]+)/.exec(run(root, ['start', 'Booking cancellation']).stdout)[1];
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  await record(root, id, dir, 'passed', 'SHARED');
  const qc = await ledger(root, id);
  assert.match(qc.plans[0].id, /^QP-[0-9A-Z]{10}-0001$/);
  assert.match(qc.runs[0].id, /^QC-[0-9A-Z]{10}-0001$/);
  const evidence = await resolveQcEvidence(root, id, qc.runs[0].id, 'S-01');
  assert.equal(evidence.qcStatus, 'passed');
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', { scenarios: [{ id: 'D-01', title: 'Cancel', audience: 'business', priority: 1, rationale: 'r', steps: ['s'] }] })]);
  assert.match(JSON.parse(await readFile(path.join(quality(root, id), 'demo.json'), 'utf8')).proposals[0].id, /^DP-[0-9A-Z]{10}-0001$/);
  assert.equal(run(root, ['doctor']).status, 0);
});

test('IDs duplicated by merging two branches\' ledgers are warned about, and citing them is refused', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-integrity-in-'));
  const id = routedBoundedChange(root);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  await record(root, id, dir, 'passed', 'ONE');
  // What a "keep both" merge resolution of two branches' qc.json produces.
  const merged = await ledger(root, id);
  merged.runs.push({ ...structuredClone(merged.runs[0]), recordedAt: new Date(Date.now() + 1000).toISOString() });
  await writeFile(path.join(quality(root, id), 'qc.json'), JSON.stringify(merged, null, 2));
  assert.match(run(root, ['doctor']).stdout, /WARN .*QC ledger has duplicate record IDs QC-001 \(merged from different branches\)/);
  await assert.rejects(resolveQcEvidence(root, id, 'QC-001', 'S-01'), /QC-001 is ambiguous: 2 runs share this ID/);
});

test('a reader that closes the pipe early no longer crashes the CLI (EPIPE)', () => {
  for (const command of [`"${process.execPath}" "${cliPath}" --help | head -c 1`, `"${process.execPath}" "${cliPath}" skill ai-qc | head -n 1`]) {
    const result = spawnSync('bash', ['-o', 'pipefail', '-c', `${command} >/dev/null`], { encoding: 'utf8' });
    assert.equal(result.stderr, '', `${command}: ${result.stderr}`);
    assert.equal(result.status, 0, command);
  }
});

// ---------------------------------------------------------------------------
// Approved independent-review findings (SRC-0007)

test('session start stays lightweight: brief and finish never read stored media; doctor and status verify it', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-integrity-in-'));
  const id = routedBoundedChange(root);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  await record(root, id, dir, 'passed', 'VIDEO-BYTES');
  const artifact = (await ledger(root, id)).runs[0].scenarios[0].artifacts[0];
  const file = path.join(quality(root, id), artifact.path);
  const { chmod } = await import('node:fs/promises');
  await chmod(file, 0o000); // any attempt to read it would now fail
  try {
    const brief = run(root, ['brief']);
    assert.doesNotMatch(brief.stdout + brief.stderr, /could not be read|SHA-256/);
    const doctor = run(root, ['doctor']);
    assert.equal(doctor.status, 0);
    if (process.getuid?.() !== 0) assert.match(doctor.stdout, /WARN .*exists but could not be read to check its SHA-256/);
    assert.equal(run(root, ['qc', 'status', id]).status, 0);
  } finally {
    await chmod(file, 0o644);
  }
});

test('a closed pipe never changes a command\'s exit code or cuts it short', async () => {
  const root = await freshProject();
  const id = routedBoundedChange(root);
  const pipe = (args) => spawnSync('bash', ['-o', 'pipefail', '-c', `"${process.execPath}" "${cliPath}" ${args} | head -c 1 >/dev/null`], { cwd: root, encoding: 'utf8' });
  const notReady = pipe(`finish ${id}`);
  assert.equal(notReady.status, 1, 'finish still reports not ready (exit 1) through a closed pipe');
  assert.equal(notReady.stderr, '');
  const ok = pipe(`guide ${id}`);
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, '');
  // A state-writing command completes even when nobody reads its output.
  const started = pipe('start "Plain request written through a closed pipe"');
  assert.equal(started.status, 0);
  assert.match(run(root, ['status']).stdout, /Plain request written through a closed pipe|Work items: 2/);
});

test('artifact paths cannot escape the media folder, on any platform', async () => {
  const { validateArtifactEntry, artifactState } = await import('../src/quality/artifacts.js');
  const base = { sizeBytes: 1, sha256: 'a'.repeat(64) };
  assert.deepEqual(validateArtifactEntry({ ...base, path: 'media/QC-001-ab12cd/shot.png' }, 'a'), []);
  assert.deepEqual(validateArtifactEntry({ ...base, path: 'media/QC-001/shot.png' }, 'a'), [], 'folders from earlier builds stay valid');
  assert.match(validateArtifactEntry({ ...base, path: 'media/QC-001/..\\..\\..\\secret' }, 'a').join(), /invalid path/);
  assert.match(validateArtifactEntry({ ...base, path: 'media/../config.yaml' }, 'a').join(), /invalid path/);
  const root = await freshProject();
  assert.equal(await artifactState(root, 'PF-0001', { ...base, path: 'media/../../../config.yaml' }), 'missing', 'never reads outside the media folder');
});

test('upgrade status names a same-version contract from an earlier build plainly', async () => {
  const { AGENT_CONTRACT_VERSION, renderAgentContractBlock } = await import('../src/agent/contract.js');
  const root = await freshProject();
  await writeFile(path.join(workspacePath(root), 'AGENT.md'), renderAgentContractBlock(AGENT_CONTRACT_VERSION, '# YallaFlow Agent Contract\n\nEarlier build.\n'));
  assert.match(run(root, ['upgrade', 'status']).stdout, new RegExp(`agent contract v${AGENT_CONTRACT_VERSION} from an earlier build of v${AGENT_CONTRACT_VERSION} \\(refresh to the final text\\)`));
});

test('a symbolic link inside media never makes doctor or a report read outside the media folder', async () => {
  const { symlink, unlink, mkdir } = await import('node:fs/promises');
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-integrity-in-'));
  const id = routedBoundedChange(root);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  await record(root, id, dir, 'passed', 'INSIDE');
  const artifact = (await ledger(root, id)).runs[0].scenarios[0].artifacts[0];
  const file = path.join(quality(root, id), artifact.path);
  // A file outside the workspace with the same size and bytes the ledger expects.
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'yallaflow-outside-')), 'secret.txt');
  await writeFile(outside, 'INSIDE');
  await unlink(file);
  await symlink(outside, file);
  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /WARN .*is a link to a location outside the media folder; it was not read/);
  assert.doesNotMatch(doctor.stdout, /no longer matches its recorded SHA-256/, 'the outside file was never hashed');
  // A symlinked record folder is refused the same way.
  await unlink(file);
  const folder = path.dirname(file);
  const { rm } = await import('node:fs/promises');
  await rm(folder, { recursive: true });
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-outside-dir-'));
  await writeFile(path.join(elsewhere, path.basename(file)), 'INSIDE');
  await symlink(elsewhere, folder);
  assert.match(run(root, ['qc', 'status', id]).stdout, /Warning: .*is a link to a location outside the media folder/);
  // A link that stays inside the media folder is fine.
  await unlink(folder);
  await mkdir(folder);
  const inner = path.join(folder, 'real.png');
  await writeFile(inner, 'INSIDE');
  await symlink(inner, file);
  assert.doesNotMatch(run(root, ['doctor']).stdout, /outside the media folder/);
});
