// PF-0112 M3: Review & Merge end to end on real temporary repositories (a Shared Project, a
// YallaFlow lane, real knowledge): readiness, approval bound to the plan hash, the in-memory
// merge with fast-forward-only checkouts, checks on the exact merged tree, knowledge
// integration, the durable record and the knowledge commit — and the stop conditions:
// main moved (fresh approval), staged home changes, conflicts, failing checks, and a resumed
// journal repeating no step. Git configuration isolated; no hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = await mkdtemp(path.join(os.tmpdir(), 'yf-merge-'));
await mkdir(path.join(BASE, 'home'), { recursive: true });
await writeFile(path.join(BASE, 'gitconfig'), '[user]\n\tname = Test Dev\n\temail = dev@example.invalid\n');
process.env.GIT_CONFIG_GLOBAL = path.join(BASE, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.HOME = path.join(BASE, 'home');
const helpers = await import('../test-support/shared.js');
const { initWorkspace } = await import('../src/core/workspace.js');
const { writeLocalIdentity } = await import('../src/shared/identity.js');
const lanes = await import('../src/execution/lanes.js');
const gitops = await import('../src/execution/git-ops.js');
const { MergeService, listJournals } = await import('../src/execution/merge.js');
const platformOk = gitops.platformCheck().ok;

const raw = (cwd, args) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: process.env });
const ok = (result) => { assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const cli = (root, args) => spawnSync(process.execPath, [helpers.cliPath, ...args], { cwd: root, encoding: 'utf8', env: process.env });
let counter = 0;

async function scenario({ moveMain = true, learn = true } = {}) {
  const parent = path.join(BASE, `s${++counter}`);
  const home = path.join(parent, 'shop');
  await mkdir(home, { recursive: true });
  ok(raw(home, ['init', '-q', '-b', 'main']));
  await helpers.writeTeamApp(home);
  ok(raw(home, ['add', '-A']));
  ok(raw(home, ['commit', '-qm', 'app']));
  await initWorkspace(home, 'Invoicing', 'brownfield');
  await helpers.approveTeamBaseline(home);
  ok(raw(home, ['add', '-A']));
  ok(raw(home, ['commit', '-qm', 'baseline']));
  helpers.cli(home, ['shared', 'enable', '--integration-branch', 'main']);
  await writeLocalIdentity(home, 'MMMMMMMMMM');
  // Only declared merge checks run (owner decision: agent-recorded commands never do).
  const checksFile = path.join(BASE, `declared${counter}.json`);
  await writeFile(checksFile, JSON.stringify([{ name: 'tests', argv: [process.execPath, '-e', 'process.exit(0)'] }]));
  helpers.cli(home, ['execution', 'checks', 'set', '--file', checksFile, '--accept-minimum-version', '1.5.0']);
  ok(raw(home, ['add', '-A']));
  ok(raw(home, ['commit', '-qm', 'shared']));
  const lane = await lanes.createLane(home, { slug: 'refunds' });
  await writeLocalIdentity(lane.path, 'AAAAAAAAAA');
  const workId = await helpers.investigation(lane.path, 'Who approves large refunds?');
  if (learn) await helpers.learn(lane.path, workId, { kind: 'business-rule', summary: 'Refunds above 1000 need a manager.', evidence: ['backend/refunds/policy.js'] });
  else helpers.cli(lane.path, ['knowledge', 'review', workId, '--none']);
  await writeFile(path.join(lane.path, 'backend', 'refunds', 'approvals.js'), 'export const LIMIT = 1000;\n');
  await helpers.complete(lane.path, workId);
  if (moveMain) {
    await writeFile(path.join(home, 'src', 'a.js'), '10;\n');
    ok(raw(home, ['commit', '-qam', 'main moved']));
  }
  const items = () => JSON.parse(cli(lane.path, ['snapshot', '--json']).stdout).items.filter((item) => item.id === workId);
  const service = new MergeService({ automatedMerge: true, cli: async (root, args) => cli(root, args), context: async () => ({ session: null, pending: 0, items: items() }), approverName: () => 'Test Dev' });
  return { home, lane, workId, service };
}
// The developer ticks the commands the lane's agent recorded (review H1: off by default).
async function ticked(service, home, laneId, options = {}) {
  const first = await service.prepare(home, laneId, options);
  const ticks = (first.agentChecks ?? []).map((check) => check.name);
  const review = await service.prepare(home, laneId, { ...options, checksInclude: ticks });
  return { ...review, ticks };
}
const settle = async (service, home) => { await service.chains.get(home); };
const count = (cwd) => Number(ok(raw(cwd, ['rev-list', '--count', 'HEAD'])));

test('Review & Merge: readiness, approval bound to the plan, merge commit tested in the lane, fast-forward, knowledge, record and knowledge commit → MERGED & VERIFIED; unrelated user files untouched', { skip: !platformOk && 'unverified platform (fails closed)' }, async () => {
  const { home, lane, workId, service } = await scenario();
  await writeFile(path.join(home, 'notes.txt'), 'my own untracked notes\n');
  await writeFile(path.join(home, 'src', 'b.js'), '2; // my unstaged edit\n');
  const before = { notes: await readFile(path.join(home, 'notes.txt')), b: await readFile(path.join(home, 'src', 'b.js')) };
  const review = await ticked(service, home, lane.id);
  assert.equal(review.ok, true, JSON.stringify(review.readiness.filter((entry) => !entry.ok)));
  assert.ok(review.changes.some((change) => change.path === 'backend/refunds/approvals.js' && change.approved));
  assert.deepEqual(review.plan.expectedKnowledge.map((entry) => entry.workId), [workId]);
  assert.ok(review.plan.checks.length >= 1 && review.plan.checks.every((check) => check.source === 'declared'), 'only the declared merge checks run on the merged result');
  await assert.rejects(service.approve(home, lane.id, { planHash: review.planHash }), /confirmation/);
  await assert.rejects(service.approve(home, lane.id, { planHash: 'f'.repeat(64), consentScripts: true, checksInclude: review.ticks ?? [] }), (error) => error.code === 'PLAN_CHANGED');
  const started = await service.approve(home, lane.id, { planHash: review.planHash, consentScripts: true, checksInclude: review.ticks ?? [], acceptMinimumVersion: '1.5.0' });
  await settle(service, home);
  const [journal] = await listJournals(home);
  assert.equal(journal.id, started.id);
  assert.equal(journal.state, 'verified', `${journal.reason ?? ''} ${JSON.stringify(journal.steps.filter((step) => step.state !== 'done'))}`);
  const { merge, laneCommit, knowledgeCommit } = journal.results;
  assert.deepEqual(gitops.parentsOf(home, merge), [review.plan.target.head, laneCommit], 'one merge commit: target first, lane second');
  assert.equal(gitops.treeOf(home, merge), review.plan.mergedTree);
  assert.equal(gitops.treeOf(lane.path, laneCommit), review.plan.approvedTree, 'the lane commit is exactly the approved tree');
  assert.deepEqual(gitops.parentsOf(home, knowledgeCommit), [merge]);
  assert.equal(gitops.head(home), knowledgeCommit);
  assert.ok(gitops.changedBetween(home, merge, knowledgeCommit).every((entry) => entry.startsWith('.yallaflow/')), 'the knowledge commit touches only YallaFlow records');
  assert.equal(gitops.head(lane.path), merge, 'the lane was fast-forwarded to the tested merge commit');
  assert.deepEqual(await readFile(path.join(home, 'notes.txt')), before.notes);
  assert.deepEqual(await readFile(path.join(home, 'src', 'b.js')), before.b, 'unrelated uncommitted files are byte-identical');
  const record = JSON.parse(await readFile(path.join(home, '.yallaflow', 'work', workId, 'integration.yaml'), 'utf8'));
  assert.equal(record.integrations[0].state, 'verified');
  assert.equal(record.integrations[0].merge, merge);
  assert.equal(record.integrations[0].ci, 'not run by YallaFlow');
  const check = cli(home, ['shared', 'check']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // Continue on a finished journal changes nothing (idempotent steps).
  const commits = count(home);
  const journals = path.join(home, '.yallaflow', 'local', 'execution', 'merges', `${journal.id}.json`);
  await writeFile(journals, JSON.stringify({ ...journal, state: 'interrupted', steps: journal.steps.map((step) => ({ ...step, state: 'todo' })) }));
  await service.continue(home, journal.id);
  await settle(service, home);
  const again = (await listJournals(home)).find((entry) => entry.id === journal.id);
  assert.equal(again.state, 'verified', again.reason ?? '');
  assert.equal(count(home), commits, 'no step ran twice');
});

test('stop conditions: main moved after review needs a fresh approval; staged home changes block; a conflict blocks; nothing is changed', { skip: !platformOk && 'unverified platform' }, async () => {
  const { home, lane, service } = await scenario({ learn: false });
  const review = await ticked(service, home, lane.id);
  assert.equal(review.ok, true, JSON.stringify(review.readiness.filter((entry) => !entry.ok)));
  await writeFile(path.join(home, 'src', 'c.js'), '33;\n');
  ok(raw(home, ['commit', '-qam', 'main moved again']));
  const headBefore = gitops.head(home);
  await assert.rejects(service.approve(home, lane.id, { planHash: review.planHash, consentScripts: true, checksInclude: review.ticks ?? [] }), (error) => error.code === 'PLAN_CHANGED');
  assert.equal(gitops.head(home), headBefore);
  await writeFile(path.join(home, 'src', 'd.js'), '44;\n');
  ok(raw(home, ['add', 'src/d.js']));
  const staged = await ticked(service, home, lane.id);
  assert.ok(staged.readiness.some((entry) => entry.id === 'home' && !entry.ok && /staged/.test(entry.text)));
  ok(raw(home, ['reset', '-q', 'src/d.js']));
  await writeFile(path.join(home, 'backend', 'refunds', 'approvals.js'), 'export const LIMIT = 5;\n');
  ok(raw(home, ['add', 'backend/refunds/approvals.js']));
  ok(raw(home, ['commit', '-qm', 'conflicting change on main']));
  const conflicted = await ticked(service, home, lane.id);
  assert.ok(conflicted.readiness.some((entry) => entry.id === 'conflicts' && !entry.ok && /approvals\.js/.test(entry.text)), JSON.stringify(conflicted.readiness));
  assert.equal(raw(home, ['status', '--porcelain', '--untracked-files=no']).stdout.replace(/^.. src\/d\.js\n?/m, ''), '', 'the preview changed nothing');
});

test('a failing check on the merged result blocks before main moves; Abandon changes nothing', { skip: !platformOk && 'unverified platform' }, async () => {
  const { home, lane, service } = await scenario({ learn: false });
  helpers.cli(home, ['execution', 'checks', 'set', '--file', await (async () => { const file = path.join(BASE, `checks${counter}.json`); await writeFile(file, JSON.stringify([{ name: 'always fails', argv: [process.execPath, '-e', 'process.exit(3)'] }])); return file; })(), '--accept-minimum-version', '1.5.0']);
  ok(raw(home, ['add', '-A', '.yallaflow/config.yaml']));
  ok(raw(home, ['commit', '-qm', 'declare checks']));
  const review = await ticked(service, home, lane.id);
  assert.equal(review.ok, true, JSON.stringify(review.readiness.filter((entry) => !entry.ok)));
  const target = gitops.head(home);
  const started = await service.approve(home, lane.id, { planHash: review.planHash, consentScripts: true, checksInclude: review.ticks ?? [], acceptMinimumVersion: '1.5.0' });
  await settle(service, home);
  const journal = (await listJournals(home)).find((entry) => entry.id === started.id);
  assert.equal(journal.state, 'blocked');
  assert.match(journal.reason, /always fails.*unchanged/);
  assert.equal(gitops.head(home), target, 'main did not move');
  const abandoned = await service.abandon(home, started.id);
  assert.equal(abandoned.state, 'abandoned');
  assert.equal(gitops.head(home), target);
});

test('AC-033/AC-041: a crash right after any step, then restart and Continue, completes the merge with no step repeated', { skip: !platformOk && 'unverified platform' }, async () => {
  const { STEPS } = await import('../src/execution/merge.js');
  for (const crashAfter of STEPS) {
    const { home, lane, service, workId } = await scenario({ learn: true });
    const homeCommits = count(home);
    const laneCommits = count(lane.path);
    let armed = true;
    const crashing = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'Test Dev', afterStep: async (name) => { if (armed && name === crashAfter) { armed = false; throw Object.assign(new Error('simulated crash'), { crash: true }); } } });
    const review = await ticked(crashing, home, lane.id);
    assert.equal(review.ok, true, `${crashAfter}: ${JSON.stringify(review.readiness.filter((entry) => !entry.ok))}`);
    const { id } = await crashing.approve(home, lane.id, { planHash: review.planHash, consentScripts: true, checksInclude: review.ticks ?? [], acceptMinimumVersion: '1.5.0' });
    await crashing.chains.get(home).catch(() => {});
    // A new console starts: the running merge is interrupted, never continued by itself.
    const restarted = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'Test Dev' });
    await restarted.recover(home);
    const interrupted = (await listJournals(home)).find((entry) => entry.id === id);
    assert.equal(interrupted.state, 'interrupted', crashAfter);
    if (['target-ff', 'post-merge', 'knowledge', 'record'].includes(crashAfter)) {
      // Main already contains the merge, but it is not shown as verified yet (AC-041).
      assert.notEqual(interrupted.state, 'verified');
    }
    await restarted.continue(home, id);
    await restarted.chains.get(home);
    const done = (await listJournals(home)).find((entry) => entry.id === id);
    assert.equal(done.state, 'verified', `${crashAfter}: ${done.reason ?? ''}`);
    assert.equal(count(home), homeCommits + 3, `${crashAfter}: main gained exactly the lane commit, the merge commit and the knowledge commit`);
    assert.equal(count(lane.path), laneCommits + 2 + (homeCommits - laneCommits), `${crashAfter}: the lane gained exactly its commit and the merge`);
    const record = JSON.parse(await readFile(path.join(home, '.yallaflow', 'work', workId, 'integration.yaml'), 'utf8'));
    assert.equal(record.integrations.length, 1, `${crashAfter}: recorded once`);
  }
});
