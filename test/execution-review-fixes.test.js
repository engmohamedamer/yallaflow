// PF-0112 Phase 1 (owner Checkpoint D, SRC-0060): regression tests for the findings of the
// independent review of Review & Merge, the Git layer and lanes (work.md "Independent Review
// Findings"). Each test reproduces the reviewer's scenario and asserts the fixed behaviour.
// Real temporary repositories; Git configuration, HOME and agents isolated; no hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = await mkdtemp(path.join(os.tmpdir(), 'yf-review-fixes-'));
await mkdir(path.join(BASE, 'home'), { recursive: true });
await writeFile(path.join(BASE, 'gitconfig'), '[user]\n\tname = Test Dev\n\temail = dev@example.invalid\n');
process.env.GIT_CONFIG_GLOBAL = path.join(BASE, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.HOME = path.join(BASE, 'home');
delete process.env.XDG_CONFIG_HOME;
const helpers = await import('../test-support/shared.js');
const { initWorkspace } = await import('../src/core/workspace.js');
const { writeLocalIdentity } = await import('../src/shared/identity.js');
const lanes = await import('../src/execution/lanes.js');
const gitops = await import('../src/execution/git-ops.js');
const { MergeService, listJournals } = await import('../src/execution/merge.js');
const { recordIntegration } = await import('../src/execution/integration.js');
const { lockRecord } = await import('../src/utils/lock.js');
const platformOk = gitops.platformCheck().ok;
const skip = !platformOk && 'unverified platform (fails closed by design)';

const raw = (cwd, args) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: process.env });
const ok = (result) => { assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const cli = (root, args) => spawnSync(process.execPath, [helpers.cliPath, ...args], { cwd: root, encoding: 'utf8', env: process.env });
const exists = (file) => readFile(file).then(() => true, () => false);
let counter = 0;

// A Shared Project with one lane whose investigation is DONE, plus a declared, passing merge check.
async function scenario({ moveMain = true, learn = false } = {}) {
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
  const checks = path.join(BASE, `checks${counter}.json`);
  await writeFile(checks, JSON.stringify([{ name: 'tests', argv: [process.execPath, '-e', 'process.exit(0)'] }]));
  helpers.cli(home, ['execution', 'checks', 'set', '--file', checks, '--accept-minimum-version', '1.5.0']);
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
  return { home, lane, workId, service, parent };
}
const settle = async (service, home) => { await service.chains.get(home)?.catch?.(() => {}); };
const journalOf = async (home, id) => (await listJournals(home)).find((entry) => entry.id === id);
const approve = (service, home, lane, review, extra = {}) => service.approve(home, lane.id, { planHash: review.planHash, consentScripts: true, acceptMinimumVersion: '1.5.0', ...extra });

// A plain repository (not a Shared Project) for Git-layer tests.
async function repo() {
  const dir = path.join(BASE, `r${++counter}`);
  await mkdir(dir, { recursive: true });
  ok(raw(dir, ['init', '-q', '-b', 'main']));
  await writeFile(path.join(dir, 'f.txt'), 'one\n');
  ok(raw(dir, ['add', '-A']));
  ok(raw(dir, ['commit', '-qm', 'one']));
  return dir;
}

test('review H1 / owner decision: commands the lane agent recorded never run, and are shown with their full program path', { skip }, async () => {
  const { home, lane, workId, service } = await scenario();
  const marker = path.join(BASE, `pwned${counter}`);
  const evil = path.join(BASE, `evil${counter}`);
  await mkdir(evil, { recursive: true });
  await writeFile(path.join(evil, 'node'), `#!/bin/sh\ntouch ${marker}\n`);
  await chmod(path.join(evil, 'node'), 0o755);
  const ledgerFile = path.join(lane.path, '.yallaflow', 'work', workId, 'evidence', 'verification.json');
  const ledger = JSON.parse(await readFile(ledgerFile, 'utf8'));
  ledger.runs = ledger.runs.map((run) => (run.success && run.executionMode === 'argv' ? { ...run, executable: path.join(evil, 'node') } : run));
  await writeFile(ledgerFile, JSON.stringify(ledger));
  const review = await service.prepare(home, lane.id, { checksInclude: ['anything', 'PF-AAAAAAAAAA-0001 V-001'] });
  assert.equal(review.ok, true, JSON.stringify(review.readiness.filter((entry) => !entry.ok)));
  assert.ok(review.agentChecks.length >= 1);
  assert.ok(review.agentChecks.every((check) => !check.included && check.shown.startsWith(path.join(evil, 'node'))), 'the full path is shown');
  assert.ok(review.plan.checks.every((check) => check.source === 'declared'), 'only the declared check is planned');
  const { id } = await approve(service, home, lane, review, { checksInclude: review.agentChecks.map((check) => check.name) });
  await settle(service, home);
  assert.equal((await journalOf(home, id)).state, 'verified');
  assert.equal(await exists(marker), false, 'the agent-recorded program never ran, even when a request names it');
});

test('review H2: a lane whose .git was replaced is refused before any Git runs there; its filter never runs', { skip }, async () => {
  const { home, lane, service } = await scenario({ moveMain: false });
  const marker = path.join(BASE, `filter-ran${counter}`);
  await rm(path.join(lane.path, '.git'));
  ok(raw(lane.path, ['init', '-q', '-b', 'x']));
  ok(raw(lane.path, ['config', 'filter.evil.clean', `touch ${marker}; cat`]));
  await writeFile(path.join(lane.path, '.git', 'info', 'attributes'), '* filter=evil\n');
  await assert.rejects(gitops.assertLaneOf(home, lane.path), (error) => error.code === 'LANE_NOT_WORKTREE');
  await assert.rejects(service.prepare(home, lane.id), (error) => error.code === 'LANE_NOT_WORKTREE');
  await assert.rejects(gitops.approvedTree({ home, lane: lane.path, paths: ['backend/refunds/approvals.js'] }), (error) => error.code === 'LANE_NOT_WORKTREE');
  const check = await lanes.cleanupCheck(home, (await lanes.readLanes(home))[0]);
  assert.ok(check.blockers.some((entry) => entry.code === 'LANE_NOT_WORKTREE'));
  assert.equal(await exists(marker), false);
});

test('review H3: filters referenced from an ignored .gitattributes, the index only, or the default global file are detected', { skip }, async () => {
  const dir = await repo();
  ok(raw(dir, ['config', 'filter.evil.clean', 'cat']));
  // 1. an ignored .gitattributes
  await writeFile(path.join(dir, '.gitignore'), '.gitattributes\n');
  await writeFile(path.join(dir, '.gitattributes'), '* filter=evil\n');
  assert.deepEqual((await gitops.externalDrivers(dir)).filters, ['evil']);
  await rm(path.join(dir, '.gitattributes'));
  await rm(path.join(dir, '.gitignore'));
  assert.deepEqual((await gitops.externalDrivers(dir)).filters, []);
  // 2. staged, then deleted from the work tree (Git reads the index copy)
  await writeFile(path.join(dir, '.gitattributes'), '*.txt filter=evil\n');
  ok(raw(dir, ['add', '.gitattributes']));
  await rm(path.join(dir, '.gitattributes'));
  assert.deepEqual((await gitops.externalDrivers(dir)).filters, ['evil']);
  ok(raw(dir, ['rm', '-q', '--cached', '.gitattributes']));
  // 3. the default global attributes file (core.attributesFile unset)
  await mkdir(path.join(process.env.HOME, '.config', 'git'), { recursive: true });
  await writeFile(path.join(process.env.HOME, '.config', 'git', 'attributes'), '*.txt filter=evil\n');
  try {
    assert.deepEqual((await gitops.externalDrivers(dir)).filters, ['evil']);
  } finally {
    await rm(path.join(process.env.HOME, '.config', 'git', 'attributes'));
  }
});

test('review H3/H4: configured filters and merge drivers can never run through git-ops, even where detection is bypassed', { skip }, async () => {
  const dir = await repo();
  const marks = { clean: path.join(BASE, `c${counter}`), process: path.join(BASE, `p${counter}`), driver: path.join(BASE, `d${counter}`) };
  ok(raw(dir, ['branch', 'other']));
  ok(raw(dir, ['checkout', '-q', 'other']));
  await writeFile(path.join(dir, 'f.txt'), 'other\n');
  ok(raw(dir, ['commit', '-qam', 'other']));
  ok(raw(dir, ['checkout', '-q', 'main']));
  await writeFile(path.join(dir, 'f.txt'), 'main\n');
  ok(raw(dir, ['commit', '-qam', 'main']));
  ok(raw(dir, ['config', 'filter.evil.clean', `touch ${marks.clean}; cat`]));
  ok(raw(dir, ['config', 'filter.evil.process', `touch ${marks.process}`]));
  ok(raw(dir, ['config', 'merge.evil.driver', `touch ${marks.driver}; false`]));
  await writeFile(path.join(dir, '.git', 'info', 'attributes'), '* filter=evil merge=evil\n');
  await writeFile(path.join(dir, 'f.txt'), 'edited\n');
  gitops.statusEntries(dir);
  const main = gitops.head(dir);
  const other = ok(raw(dir, ['rev-parse', 'other']));
  gitops.previewMerge(dir, main, other);
  for (const [name, file] of Object.entries(marks)) assert.equal(await exists(file), false, `the ${name} command never ran`);
  // And automated writes refuse outright (A4).
  await assert.rejects(gitops.stageApproved({ home: dir, cwd: dir, paths: ['f.txt'] }), (error) => error.code === 'GIT_EXTERNAL_DRIVERS');
});

test('review H5: Clean up refuses a lane with skip-worktree or assume-unchanged edits instead of deleting them', { skip }, async () => {
  const { home, lane } = await scenario({ moveMain: false });
  ok(raw(lane.path, ['add', '-A']));
  ok(raw(lane.path, ['commit', '-qm', 'lane work']));
  ok(raw(lane.path, ['update-index', '--skip-worktree', 'backend/refunds/approvals.js']));
  await writeFile(path.join(lane.path, 'backend', 'refunds', 'approvals.js'), 'my hidden local edit\n');
  const record = (await lanes.readLanes(home))[0];
  const check = await lanes.cleanupCheck(home, record);
  assert.ok(check.blockers.some((entry) => entry.code === 'HIDDEN_CHANGES'), JSON.stringify(check.blockers));
  await assert.rejects(gitops.removeLaneWorktree({ home, lane: lane.path }), (error) => error.code === 'SCOPE_CHANGED');
  assert.equal(await readFile(path.join(lane.path, 'backend', 'refunds', 'approvals.js'), 'utf8'), 'my hidden local edit\n');
});

test('review H6: an approved staged deletion is part of the approved tree and is merged', { skip }, async () => {
  const { home, lane, service } = await scenario();
  ok(raw(lane.path, ['rm', '-q', 'backend/invoices/tax.js']));
  const review = await service.prepare(home, lane.id);
  assert.equal(review.ok, true, JSON.stringify(review.readiness.filter((entry) => !entry.ok)));
  assert.ok(review.changes.some((change) => change.path === 'backend/invoices/tax.js' && change.approved && change.status === 'deleted'));
  assert.equal(raw(lane.path, ['ls-tree', review.plan.approvedTree, 'backend/invoices/tax.js']).stdout, '', 'the approved tree omits the deleted file');
  const { id } = await approve(service, home, lane, review);
  await settle(service, home);
  const journal = await journalOf(home, id);
  assert.equal(journal.state, 'verified', journal.reason ?? '');
  assert.notEqual(raw(home, ['cat-file', '-e', 'HEAD:backend/invoices/tax.js']).status, 0, 'the deletion reached main');
});

test('review H6: a file name that is not valid UTF-8 stops the review instead of being dropped silently', { skip }, async () => {
  const dir = await repo();
  await writeFile(Buffer.concat([Buffer.from(`${dir}/bad-`), Buffer.from([0xff, 0xfe]), Buffer.from('.txt')]), 'x\n');
  assert.throws(() => gitops.statusEntries(dir), (error) => error.code === 'GIT_PATH_ENCODING');
});

test('review H8: files left out of the commit block the merge, because the checks would not see exactly what is merged', { skip }, async () => {
  const { home, lane, service } = await scenario();
  await writeFile(path.join(lane.path, 'backend', 'refunds', 'helper.js'), 'export const h = 1;\n');
  const review = await service.prepare(home, lane.id, { exclude: ['backend/refunds/helper.js'] });
  assert.equal(review.ok, false);
  assert.ok(review.readiness.some((entry) => entry.id === 'unticked' && !entry.ok && /helper\.js/.test(entry.text)));
});

test('review H9: a secret-looking file the agent committed in the lane is merged only when ticked', { skip }, async () => {
  const { home, lane, service } = await scenario();
  await writeFile(path.join(lane.path, '.env'), 'DB_PASSWORD=hunter2hunter2\n');
  ok(raw(lane.path, ['add', '-f', '.env']));
  ok(raw(lane.path, ['commit', '-qm', 'agent commits env']));
  const review = await service.prepare(home, lane.id);
  assert.equal(review.ok, false);
  assert.ok(review.readiness.some((entry) => entry.id === 'secrets' && !entry.ok && /\.env/.test(entry.text)));
  const ticked = await service.prepare(home, lane.id, { include: ['.env'] });
  assert.equal(ticked.ok, true, JSON.stringify(ticked.readiness.filter((entry) => !entry.ok)));
  assert.deepEqual(ticked.plan.secretsAccepted, ['.env'], 'the tick is part of what you approve');
});

test('review H10: Continue checks the main checkout again; an ignored file at a path the merge adds is never overwritten', { skip }, async () => {
  const { home, lane, service } = await scenario();
  let armed = true;
  const crashing = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'T', afterStep: async (name) => { if (armed && name === 'integration-preview') { armed = false; throw Object.assign(new Error('crash'), { crash: true }); } } });
  const review = await crashing.prepare(home, lane.id);
  const { id } = await approve(crashing, home, lane, review);
  await crashing.chains.get(home).catch(() => {});
  const target = gitops.head(home);
  await writeFile(path.join(home, 'backend', 'refunds', '.gitignore'), 'approvals.js\n');
  await writeFile(path.join(home, 'backend', 'refunds', 'approvals.js'), 'MY LOCAL WORK\n');
  const restarted = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'T' });
  await restarted.recover(home);
  await restarted.continue(home, id);
  await settle(restarted, home);
  const journal = await journalOf(home, id);
  assert.equal(journal.state, 'blocked', journal.reason ?? '');
  assert.match(journal.reason, /approvals\.js exists in your main checkout/);
  assert.equal(gitops.head(home), target, 'main did not move');
  assert.equal(await readFile(path.join(home, 'backend', 'refunds', 'approvals.js'), 'utf8'), 'MY LOCAL WORK\n');
});

test('review H10: a fast-forward never overwrites an ignored file', { skip }, async () => {
  const dir = await repo();
  ok(raw(dir, ['checkout', '-q', '-b', 'next']));
  await writeFile(path.join(dir, '.env'), 'API=public-template\n');
  ok(raw(dir, ['add', '-f', '.env']));
  ok(raw(dir, ['commit', '-qm', 'template']));
  const to = gitops.head(dir);
  ok(raw(dir, ['checkout', '-q', 'main']));
  await writeFile(path.join(dir, '.gitignore'), '.env\n');
  await writeFile(path.join(dir, '.env'), 'SECRET=mine\n');
  await assert.rejects(gitops.fastForward({ cwd: dir, to }), (error) => error.code === 'GIT_FAILED');
  assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), 'SECRET=mine\n');
});

test('review M2/M13: a held merge lock leaves the merge interrupted (never stuck), recover never touches a live lock holder\'s merge, and a second approval waits', { skip }, async () => {
  const { home, lane, service } = await scenario();
  const lock = path.join(home, '.yallaflow', 'local', 'execution', 'merge.lock');
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, lockRecord('other console', 'abcd'));
  const review = await service.prepare(home, lane.id);
  const { id } = await approve(service, home, lane, review);
  await settle(service, home);
  assert.equal((await journalOf(home, id)).state, 'interrupted');
  const journalFile = path.join(home, '.yallaflow', 'local', 'execution', 'merges', `${id}.json`);
  const merging = { ...JSON.parse(await readFile(journalFile, 'utf8')), state: 'merging' };
  await writeFile(journalFile, JSON.stringify(merging));
  await new MergeService({ automatedMerge: true, cli: service.cli, context: service.context }).recover(home);
  assert.equal((await journalOf(home, id)).state, 'merging', 'a live lock holder may be merging: recover leaves it');
  await writeFile(journalFile, JSON.stringify({ ...merging, state: 'interrupted' }));
  await assert.rejects(approve(service, home, lane, await service.prepare(home, lane.id)), (error) => error.code === 'ALREADY_MERGING');
  await rm(lock);
  await service.continue(home, id);
  await settle(service, home);
  assert.equal((await journalOf(home, id)).state, 'verified');
});

test('review M8: G2 lists the lane again just before removal; an ignored file that appeared is never deleted', { skip }, async () => {
  const { home, lane } = await scenario({ moveMain: false });
  ok(raw(lane.path, ['add', '-A']));
  ok(raw(lane.path, ['commit', '-qm', 'lane work']));
  await writeFile(path.join(lane.path, '.gitignore'), '.env\n');
  ok(raw(lane.path, ['add', '.gitignore']));
  ok(raw(lane.path, ['commit', '-qm', 'ignore env']));
  await writeFile(path.join(lane.path, '.env'), 'SECRET=keep\n');
  await assert.rejects(gitops.removeLaneWorktree({ home, lane: lane.path, ignoredAllowed: [] }), (error) => error.code === 'SCOPE_CHANGED' && /\.env/.test(error.message));
  assert.equal(await readFile(path.join(lane.path, '.env'), 'utf8'), 'SECRET=keep\n');
});

test('review M11/M14: the knowledge step integrates only this lane\'s knowledge, and a crash after it still records what was integrated', { skip }, async () => {
  const { home, lane, service, workId } = await scenario({ learn: true, moveMain: false });
  const other = await lanes.createLane(home, { slug: 'other' });
  await writeLocalIdentity(other.path, 'BBBBBBBBBB');
  const otherWork = await helpers.investigation(other.path, 'Who signs invoices?');
  await helpers.learn(other.path, otherWork, { kind: 'business-rule', summary: 'Invoices are signed by finance.', evidence: ['backend/invoices/totals.js'] });
  await helpers.complete(other.path, otherWork);
  ok(raw(other.path, ['add', '-A']));
  ok(raw(other.path, ['commit', '-qm', 'other work']));
  ok(raw(home, ['merge', '--no-ff', '-q', '-m', 'manual merge of other', other.branch]));
  let armed = true;
  const crashing = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'T', afterStep: async (name) => { if (armed && name === 'knowledge') { armed = false; throw Object.assign(new Error('crash'), { crash: true }); } } });
  const review = await crashing.prepare(home, lane.id);
  assert.equal(review.ok, true, JSON.stringify(review.readiness.filter((entry) => !entry.ok)));
  const { id } = await approve(crashing, home, lane, review);
  await crashing.chains.get(home).catch(() => {});
  const restarted = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'T' });
  await restarted.recover(home);
  await restarted.continue(home, id);
  await settle(restarted, home);
  const journal = await journalOf(home, id);
  assert.equal(journal.state, 'verified', journal.reason ?? '');
  const record = JSON.parse(await readFile(path.join(home, '.yallaflow', 'work', workId, 'integration.yaml'), 'utf8'));
  assert.deepEqual(record.integrations[0].knowledge.map((entry) => entry.candidate), journal.results.knowledgePreview.map((entry) => entry.candidateId), 'the record names the integrated knowledge');
  assert.equal(record.integrations[0].knowledge.length, 1);
  const ledger = await readFile(path.join(home, '.yallaflow', 'context', 'index.yaml'), 'utf8');
  assert.match(ledger, /Refunds above 1000 need a manager/);
  assert.doesNotMatch(ledger, /Invoices are signed by finance/, 'the other work\'s staged knowledge was not integrated by this merge');
  assert.equal(raw(home, ['status', '--porcelain', '--untracked-files=no']).stdout, '', 'nothing of the other work is left half-integrated');
});

test('review M12: an edit to a YallaFlow file during the merge stops it before main moves; nothing of it is committed', { skip }, async () => {
  const { home, lane, service } = await scenario({ learn: true });
  const project = path.join(home, '.yallaflow', 'PROJECT.md');
  const editing = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'T', afterStep: async (name) => { if (name === 'checks') await writeFile(project, `${await readFile(project, 'utf8')}\nUSER DRAFT\n`); } });
  const review = await editing.prepare(home, lane.id);
  const target = gitops.head(home);
  const { id } = await approve(editing, home, lane, review);
  await settle(editing, home);
  const journal = await journalOf(home, id);
  assert.notEqual(journal.state, 'verified');
  assert.equal(gitops.head(home), target, 'main did not move');
  assert.match(await readFile(project, 'utf8'), /USER DRAFT/, 'the draft is still the developer\'s, uncommitted');
});

test('review L7: a rename reported in the work-tree column keeps both paths', { skip }, async () => {
  const dir = await repo();
  ok(raw(dir, ['mv', 'f.txt', 'g.txt']));
  ok(raw(dir, ['reset', '-q']));
  ok(raw(dir, ['add', '-N', 'g.txt']));
  const entries = gitops.statusEntries(dir);
  assert.ok(entries.some((entry) => entry.path === 'g.txt' && entry.from === 'f.txt'), JSON.stringify(entries));
  assert.ok(!entries.some((entry) => entry.path === 'ol' || entry.path === '.txt'));
});

test('review L14: an integration record must name a real merge on the target branch', { skip }, async () => {
  const { lane, workId } = await scenario({ moveMain: false });
  const home = lane.path; // the work item lives in the lane; its base commit is on main
  const head = gitops.head(home);
  const entry = { merge: 'a'.repeat(40), tree: 'b'.repeat(40), base: head, target: 'main', lane: 'yf/x', planHash: 'p', approvedBy: 'me', state: 'verified', checks: [], postMerge: { doctor: 'pass' }, knowledge: [] };
  await assert.rejects(recordIntegration(home, workId, entry, { acceptMinimumVersion: '1.5.0' }), /Invalid integration record/);
  await assert.rejects(recordIntegration(home, workId, { ...entry, merge: head, tree: 'b'.repeat(40) }, { acceptMinimumVersion: '1.5.0' }), /does not carry tree/);
  await assert.rejects(recordIntegration(home, workId, { ...entry, merge: head, tree: gitops.treeOf(home, head), target: '--evil' }, { acceptMinimumVersion: '1.5.0' }), /plain branch name/);
});

test('review M5: lane creation is serialised — concurrent requests never exceed the limit or lose a record', { skip }, async () => {
  const { home } = await scenario({ moveMain: false });
  const results = await Promise.allSettled(['b1', 'b2', 'b3'].map((slug) => lanes.createLane(home, { slug })));
  const listed = (await lanes.readLanes(home)).filter((entry) => entry.state !== 'removed');
  assert.equal(listed.length, 2, 'the default limit of 2 lanes holds (one lane existed)');
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const worktrees = ok(raw(home, ['worktree', 'list', '--porcelain'])).split('\n').filter((line) => line.startsWith('worktree ')).length;
  assert.equal(worktrees, 1 + listed.length, 'every worktree is recorded');
});

// ----- Re-verification of the fixes (2026-11-10) -----
test('re-verification: a lane whose .git was replaced runs no repository-configured program, even through YallaFlow\'s own reads', { skip }, async () => {
  const { home, lane } = await scenario({ moveMain: false });
  const marker = path.join(BASE, `fsm-ran${counter}`);
  await rm(path.join(lane.path, '.git'));
  ok(raw(lane.path, ['init', '-q', '-b', 'x']));
  ok(raw(lane.path, ['config', 'core.fsmonitor', `touch ${marker}; true`]));
  ok(raw(lane.path, ['config', 'filter.evil.clean', `touch ${marker}; cat`]));
  await writeFile(path.join(lane.path, '.git', 'info', 'attributes'), '* filter=evil\n');
  // Identity (the home lists this lane) is not validity: the console's runner checks the lane is
  // still a worktree of its home before it starts anything there.
  const { createRunner } = await import('../src/console/runner.js');
  const runner = createRunner();
  runner.guard = async (root) => { if (root === lane.path) await gitops.assertLaneOf(home, root); };
  await assert.rejects(runner.get(lane.path, 'snapshot', ['snapshot', '--json']), (error) => error.code === 'LANE_NOT_WORKTREE');
  const check = await lanes.cleanupCheck(home, (await lanes.readLanes(home))[0]);
  assert.ok(check.blockers.some((entry) => entry.code === 'LANE_NOT_WORKTREE'));
  const { personalLocalFile } = await import('../src/agents/settings.js');
  await personalLocalFile(lane.path, path.join(lane.path, 'backend', 'refunds', 'approvals.js')).catch(() => {});
  const core = await import('../src/core/git.js');
  for (const name of Object.keys(core)) if (typeof core[name] === 'function' && core[name].length <= 1) { try { core[name](lane.path); } catch { /* shape differs */ } }
  assert.equal(await exists(marker), false, 'no fsmonitor or filter command ran');
});

test('re-verification: a submodule whose own config names a filter never runs it; lanes with submodules are refused', { skip }, async () => {
  const { home, lane, service } = await scenario({ moveMain: false });
  const marker = path.join(BASE, `sub-ran${counter}`);
  const sub = path.join(lane.path, 'sub');
  await mkdir(sub);
  ok(raw(sub, ['init', '-q', '-b', 'main']));
  await writeFile(path.join(sub, 'a.txt'), 'a\n');
  ok(raw(sub, ['add', 'a.txt']));
  ok(raw(sub, ['commit', '-qm', 'a']));
  ok(raw(lane.path, ['add', 'sub']));
  ok(raw(lane.path, ['commit', '-qm', 'gitlink']));
  ok(raw(sub, ['config', 'filter.y.clean', `touch ${marker}; cat`]));
  ok(raw(sub, ['config', 'core.fsmonitor', `touch ${marker}; true`]));
  await writeFile(path.join(sub, '.gitattributes'), '* filter=y\n');
  await writeFile(path.join(sub, 'a.txt'), 'a\n');
  gitops.statusEntries(lane.path);
  gitops.statusEntries(lane.path, { ignored: true });
  const review = await service.prepare(home, lane.id);
  assert.ok(review.readiness.some((entry) => entry.id === 'drivers' && !entry.ok && /submodules/.test(entry.text)));
  const check = await lanes.cleanupCheck(home, (await lanes.readLanes(home))[0]);
  assert.ok(check.blockers.some((entry) => entry.code === 'GIT_SUBMODULES'));
  await assert.rejects(gitops.assertAutomationAllowed(lane.path), (error) => error.code === 'GIT_SUBMODULES');
  const core = await import('../src/core/git.js');
  for (const name of Object.keys(core)) if (typeof core[name] === 'function' && core[name].length <= 1) { try { core[name](lane.path); } catch { /* shape differs */ } }
  assert.equal(await exists(marker), false, 'the submodule\'s filter and fsmonitor never ran');
});

test('re-verification: a secret added in one lane commit and removed in a later one still needs a tick', { skip }, async () => {
  const { home, lane, service } = await scenario();
  await writeFile(path.join(lane.path, 'config.txt'), 'DB_PASSWORD=hunter2hunter2\n');
  ok(raw(lane.path, ['add', 'config.txt']));
  ok(raw(lane.path, ['commit', '-qm', 'oops']));
  ok(raw(lane.path, ['rm', '-q', 'config.txt']));
  ok(raw(lane.path, ['commit', '-qm', 'remove it']));
  const review = await service.prepare(home, lane.id);
  assert.ok(review.readiness.some((entry) => entry.id === 'secrets' && !entry.ok && /config\.txt/.test(entry.text)), JSON.stringify(review.readiness));
  assert.deepEqual(review.historySecrets.map((entry) => entry.path), ['config.txt']);
  const ticked = await service.prepare(home, lane.id, { include: ['config.txt'] });
  assert.equal(ticked.ok, true, JSON.stringify(ticked.readiness.filter((entry) => !entry.ok)));
  assert.deepEqual(ticked.plan.secretsAccepted, ['config.txt']);
});

test('re-verification: a committed file name that is not valid UTF-8 stops the review', { skip }, async () => {
  const { home, lane, service } = await scenario({ moveMain: false });
  await writeFile(Buffer.concat([Buffer.from(`${lane.path}/cr`), Buffer.from([0xff]), Buffer.from('eds.txt')]), 'DB_PASSWORD=x\n');
  ok(raw(lane.path, ['add', '-A']));
  ok(raw(lane.path, ['commit', '-qm', 'odd name']));
  await assert.rejects(service.prepare(home, lane.id), (error) => error.code === 'GIT_PATH_ENCODING');
});

test('re-verification: the names of files Git ignores in the lane are shown and bound to the approval', { skip }, async () => {
  const { home, lane, service } = await scenario();
  await writeFile(path.join(lane.path, '.gitignore'), 'build/\n');
  await mkdir(path.join(lane.path, 'build'));
  await writeFile(path.join(lane.path, 'build', 'out.js'), '1\n');
  const blocked = await service.prepare(home, lane.id);
  assert.ok(blocked.readiness.some((entry) => entry.id === 'checks-safety' && !entry.ok && /build\//.test(entry.text)), 'Automated Merge is off while ignored files are in the lane');
  assert.ok(blocked.manual.some((line) => /git merge --no-ff yf\/refunds/.test(line)), 'the manual fallback is shown');
  await assert.rejects(approve(service, home, lane, blocked), (error) => error.code === 'NOT_READY');
  await rm(path.join(lane.path, 'build', 'out.js'));
  await (await import('node:fs/promises')).rmdir(path.join(lane.path, 'build'));
  const review = await service.prepare(home, lane.id);
  assert.equal(review.ok, true, JSON.stringify(review.readiness.filter((entry) => !entry.ok)));
  const planting = new MergeService({ automatedMerge: true, cli: service.cli, context: service.context, approverName: () => 'T', afterStep: async (name) => { if (name === 'lane-ff') { await mkdir(path.join(lane.path, 'node_modules', '.bin'), { recursive: true }); await writeFile(path.join(lane.path, '.gitignore'), 'build/\nnode_modules/\n'); } } });
  const { id } = await approve(planting, home, lane, review);
  await settle(planting, home);
  const journal = await journalOf(home, id);
  assert.notEqual(journal.state, 'verified');
});

test('re-verification: a file name with invisible direction characters blocks the review', { skip }, async () => {
  const { home, lane, service } = await scenario({ moveMain: false });
  await writeFile(path.join(lane.path, 'invoice‮txt.js'), 'x\n');
  const review = await service.prepare(home, lane.id);
  assert.ok(review.readiness.some((entry) => entry.id === 'changes' && !entry.ok && /invisible/.test(entry.text)));
});

// ----- Re-verification round 2 (2026-11-10) -----
test('re-verification 2: a .gitmodules "ignore = none" cannot make any YallaFlow read recurse into a submodule', { skip }, async () => {
  const { home, lane, service } = await scenario({ moveMain: false });
  const marker = path.join(BASE, `sub2-ran${counter}`);
  const sub = path.join(lane.path, 'sub');
  await mkdir(sub);
  ok(raw(sub, ['init', '-q', '-b', 'main']));
  await writeFile(path.join(sub, 'a.txt'), 'a\n');
  ok(raw(sub, ['add', 'a.txt']));
  ok(raw(sub, ['commit', '-qm', 'a']));
  ok(raw(lane.path, ['add', 'sub']));
  ok(raw(lane.path, ['commit', '-qm', 'gitlink']));
  await writeFile(path.join(lane.path, '.gitmodules'), '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tignore = none\n');
  ok(raw(sub, ['config', 'filter.y.clean', `touch ${marker}; cat`]));
  await writeFile(path.join(sub, '.gitattributes'), '* filter=y\n');
  await writeFile(path.join(sub, 'a.txt'), 'a\n');
  gitops.statusEntries(lane.path);
  gitops.statusEntries(lane.path, { ignored: true });
  const review = await service.prepare(home, lane.id);
  assert.equal(review.ok, false);
  await lanes.cleanupCheck(home, (await lanes.readLanes(home))[0]);
  const { changedFiles } = await import('../src/console/worktrees.js');
  await changedFiles(lane.path);
  const core = await import('../src/core/git.js');
  for (const name of Object.keys(core)) if (typeof core[name] === 'function') { try { await core[name](lane.path, 'HEAD'); } catch { /* shape differs */ } }
  const shared = await import('../src/shared/git.js');
  for (const name of Object.keys(shared)) if (typeof shared[name] === 'function') { try { await shared[name](lane.path); } catch { /* shape differs */ } }
  assert.equal(await exists(marker), false, 'the submodule\'s filter never ran');
});

test('re-verification 2: a lane is known from its home\'s lane list; deleting or forging the marker inside it changes nothing', { skip }, async () => {
  const { home, lane } = await scenario({ moveMain: false });
  await rm(path.join(lane.path, '.yallaflow', 'local', 'execution', 'lane.json'));
  const identity = await lanes.laneIdentity(lane.path);
  assert.equal(identity?.id, lane.id);
  assert.equal(identity.home, path.dirname(path.dirname(lane.path)) + path.sep + 'shop');
  // A folder that only claims to be a lane is not one.
  const fake = path.join(BASE, `fake${counter}`);
  await mkdir(path.join(fake, '.yallaflow', 'local', 'execution'), { recursive: true });
  await writeFile(path.join(fake, '.yallaflow', 'local', 'execution', 'lane.json'), JSON.stringify({ schema: lanes.MARKER_SCHEMA, id: 'l-00000000', home, slug: 'x', createdBy: 'yallaflow' }), { mode: 0o600 });
  assert.equal(await lanes.laneIdentity(fake), null);
  void home;
});

test('re-verification 2: every version the lane adds to history is scanned — uncommitted later edits, merge commits, binary content', { skip }, async () => {
  // (a) committed with a secret, then edited without committing
  {
    const { home, lane, service } = await scenario({ moveMain: false });
    await writeFile(path.join(lane.path, 'config.txt'), 'DB_PASSWORD=hunter2hunter2\n');
    ok(raw(lane.path, ['add', 'config.txt']));
    ok(raw(lane.path, ['commit', '-qm', 'secret']));
    await writeFile(path.join(lane.path, 'config.txt'), 'nothing here\n');
    const review = await service.prepare(home, lane.id);
    assert.ok(review.readiness.some((entry) => entry.id === 'secrets' && !entry.ok && /config\.txt/.test(entry.text)), JSON.stringify(review.readiness));
  }
  // (b) a merge commit that adds the secret itself, removed later
  {
    const { home, lane, service } = await scenario({ moveMain: false });
    ok(raw(lane.path, ['checkout', '-q', '-b', 'side']));
    await writeFile(path.join(lane.path, 'side.txt'), 'side\n');
    ok(raw(lane.path, ['add', 'side.txt']));
    ok(raw(lane.path, ['commit', '-qm', 'side']));
    ok(raw(lane.path, ['checkout', '-q', lane.branch]));
    ok(raw(lane.path, ['merge', '-q', '--no-ff', '--no-commit', 'side']));
    await writeFile(path.join(lane.path, 'evil.txt'), 'AWS_SECRET_ACCESS_KEY=AKIAABCDEFGHIJKLMNOP1234567890abcdefgh\n');
    ok(raw(lane.path, ['add', 'evil.txt']));
    ok(raw(lane.path, ['commit', '-qm', 'merge side']));
    ok(raw(lane.path, ['rm', '-q', 'evil.txt']));
    ok(raw(lane.path, ['commit', '-qm', 'remove']));
    const review = await service.prepare(home, lane.id);
    assert.ok(review.readiness.some((entry) => entry.id === 'secrets' && !entry.ok && /evil\.txt/.test(entry.text)), JSON.stringify(review.readiness));
  }
  // (c) content that starts with a NUL byte
  {
    const { home, lane, service } = await scenario({ moveMain: false });
    await writeFile(path.join(lane.path, 'blob.bin'), Buffer.concat([Buffer.from([0]), Buffer.from('\nDB_PASSWORD=hunter2hunter2\n')]));
    ok(raw(lane.path, ['add', 'blob.bin']));
    ok(raw(lane.path, ['commit', '-qm', 'bin']));
    ok(raw(lane.path, ['rm', '-q', 'blob.bin']));
    ok(raw(lane.path, ['commit', '-qm', 'rm']));
    const review = await service.prepare(home, lane.id);
    assert.ok(review.readiness.some((entry) => entry.id === 'secrets' && !entry.ok && /blob\.bin/.test(entry.text)), JSON.stringify(review.readiness));
  }
});

test('re-verification 2: names with the Arabic letter mark, zero-width or C1 characters block the review, ignored ones too', { skip }, async () => {
  for (const name of ['a؜b.js', 'a​b.js', 'a\u0085b.js']) {
    const { home, lane, service } = await scenario({ moveMain: false });
    await writeFile(path.join(lane.path, name), 'x\n');
    const review = await service.prepare(home, lane.id);
    assert.ok(review.readiness.some((entry) => entry.id === 'changes' && !entry.ok && /invisible/.test(entry.text)), `${JSON.stringify(name)} ${JSON.stringify(review.readiness)}`);
  }
  const { home, lane, service } = await scenario({ moveMain: false });
  await writeFile(path.join(lane.path, '.gitignore'), '*.log\n');
  ok(raw(lane.path, ['add', '.gitignore']));
  ok(raw(lane.path, ['commit', '-qm', 'ignore logs']));
  await writeFile(path.join(lane.path, 'x‮txt.log'), 'x\n');
  const review = await service.prepare(home, lane.id);
  assert.ok(review.readiness.some((entry) => entry.id === 'changes' && !entry.ok && /invisible/.test(entry.text)), JSON.stringify(review.readiness));
});

// ----- Re-verification round 3 (2026-11-10) -----
test('re-verification 3: a lane pointing its .git at a repository of its own runs nothing — not the Team view, not the CLI the console starts', { skip }, async () => {
  const { home, lane } = await scenario({ moveMain: false });
  const marker = path.join(BASE, `team-ran${counter}`);
  const evil = path.join(lane.path, 'evil');
  await mkdir(evil);
  ok(raw(evil, ['init', '-q', '-b', 'x']));
  await writeFile(path.join(evil, 'f.txt'), 'one\n');
  ok(raw(evil, ['add', 'f.txt']));
  ok(raw(evil, ['commit', '-qm', 'f']));
  ok(raw(evil, ['config', 'filter.x.clean', `touch ${marker}; cat`]));
  await writeFile(path.join(evil, '.gitattributes'), '* filter=x\n');
  await writeFile(path.join(evil, 'f.txt'), 'two, changed\n');
  const { startConsoleServer } = await import('../src/console/server.js');
  const server = await startConsoleServer({ roots: [home, lane.path], port: 0 });
  try {
    const H = { Authorization: `Bearer ${server.token}` };
    const projects = (await (await fetch(`${server.url}api/projects`, { headers: H })).json()).projects;
    const laneProject = projects.find((project) => project.root === lane.path);
    assert.equal(laneProject?.kind, 'lane', 'the lane is known from its home, not from files inside it');
    await writeFile(path.join(lane.path, '.git'), 'gitdir: evil/.git\n');
    await fetch(`${server.url}api/p/${laneProject.id}/worktrees`, { headers: H });
    await fetch(`${server.url}api/p/${laneProject.id}/snapshot`, { headers: H });
  } finally {
    await server.close();
  }
  assert.equal(await exists(marker), false, 'no filter of the lane\'s planted repository ran');
});

test('re-verification 3: secrets in uncommitted binary-looking or large files, under a second name, and in commit messages are caught', { skip }, async () => {
  // uncommitted, NUL in the first bytes
  {
    const { home, lane, service } = await scenario({ moveMain: false });
    await writeFile(path.join(lane.path, 'settings.cfg'), Buffer.from('#\u0000\nDB_PASSWORD=hunter2hunter2\n'));
    const review = await service.prepare(home, lane.id);
    assert.ok(review.changes.find((change) => change.path === 'settings.cfg')?.secret, JSON.stringify(review.changes));
    assert.equal(review.ok, false);
  }
  // the same content committed as .env and under another name
  {
    const { home, lane, service } = await scenario({ moveMain: false });
    await writeFile(path.join(lane.path, '.a'), 'STRIPE=rk_live_x\n');
    await writeFile(path.join(lane.path, '.env'), 'STRIPE=rk_live_x\n');
    ok(raw(lane.path, ['add', '-f', '.a', '.env']));
    ok(raw(lane.path, ['commit', '-qm', 'both']));
    const review = await service.prepare(home, lane.id);
    assert.ok(review.readiness.some((entry) => entry.id === 'secrets' && !entry.ok && /\.env/.test(entry.text)), JSON.stringify(review.readiness));
  }
  // a commit message
  {
    const { home, lane, service } = await scenario({ moveMain: false });
    await writeFile(path.join(lane.path, 'x.txt'), 'x\n');
    ok(raw(lane.path, ['add', 'x.txt']));
    ok(raw(lane.path, ['commit', '-qm', 'AWS_SECRET_ACCESS_KEY=AKIAABCDEFGHIJKLMNOP1234567890abcdefgh']));
    const review = await service.prepare(home, lane.id);
    assert.ok(review.readiness.some((entry) => entry.id === 'secrets' && !entry.ok && /commit messages/.test(entry.text)), JSON.stringify(review.readiness));
  }
});

test('re-verification 3: tag characters, variation selectors and space look-alikes in names block the review; tracked .yallaflow/local files too', { skip }, async () => {
  for (const name of ['a\u{E0041}b.js', 'a️b.js', 'a b.js', 'aㅤb.js']) {
    const { home, lane, service } = await scenario({ moveMain: false });
    await writeFile(path.join(lane.path, name), 'x\n');
    const review = await service.prepare(home, lane.id);
    assert.ok(review.readiness.some((entry) => entry.id === 'changes' && !entry.ok && /invisible/.test(entry.text)), JSON.stringify(name));
  }
  const { home, lane, service } = await scenario({ moveMain: false });
  await writeFile(path.join(lane.path, '.yallaflow', 'local', 'note.txt'), 'x\n');
  ok(raw(lane.path, ['add', '-f', '.yallaflow/local/note.txt']));
  ok(raw(lane.path, ['commit', '-qm', 'track local']));
  await writeFile(path.join(lane.path, '.yallaflow', 'local', 'note.txt'), 'changed\n');
  const review = await service.prepare(home, lane.id);
  assert.ok(review.readiness.some((entry) => entry.id === 'changes' && !entry.ok && /\.yallaflow\/local/.test(entry.text)), JSON.stringify(review.readiness));
});

// ----- Final focused review (2026-11-10): Automated Merge off; Clean up and nested .git -----
test('final review: Automated Merge is off by default — Review shows why and the manual steps; approve and continue refuse; nothing is committed', { skip }, async () => {
  const { home, lane, service } = await scenario();
  const shipped = new MergeService({ cli: service.cli, context: service.context });
  const target = gitops.head(home);
  const laneHead = gitops.head(lane.path);
  const review = await shipped.prepare(home, lane.id);
  assert.equal(review.ok, false);
  assert.ok(review.readiness.some((entry) => entry.id === 'checks-safety' && !entry.ok && /turned off/.test(entry.text)));
  assert.ok(review.manual.length >= 4);
  await assert.rejects(shipped.approve(home, lane.id, { planHash: review.planHash, consentScripts: true, acceptMinimumVersion: '1.5.0' }), (error) => error.code === 'AUTOMATED_MERGE_OFF');
  await assert.rejects(shipped.continue(home, 'm-00000000'), (error) => error.code === 'AUTOMATED_MERGE_OFF');
  assert.equal(gitops.head(home), target);
  assert.equal(gitops.head(lane.path), laneHead);
  assert.deepEqual(await listJournals(home), []);
});

test('final review M1: a folder named .git inside the lane blocks Clean up, so its files are never deleted unseen', { skip }, async () => {
  const { home, lane } = await scenario({ moveMain: false });
  ok(raw(lane.path, ['add', '-A']));
  ok(raw(lane.path, ['commit', '-qm', 'lane work']));
  await mkdir(path.join(lane.path, 'lib', '.git'), { recursive: true });
  await writeFile(path.join(lane.path, 'lib', '.git', 'notes.txt'), 'mine\n');
  const check = await lanes.cleanupCheck(home, (await lanes.readLanes(home))[0]);
  assert.ok(check.blockers.some((entry) => entry.code === 'NESTED_GIT'), JSON.stringify(check.blockers));
  assert.equal(await readFile(path.join(lane.path, 'lib', '.git', 'notes.txt'), 'utf8'), 'mine\n');
});

test('release rule: the CLI cannot record MERGED & VERIFIED while Automated Merge is off', { skip }, async () => {
  const { lane, workId } = await scenario({ moveMain: false });
  const file = path.join(BASE, `record${counter}.json`);
  await writeFile(file, '{}');
  const result = cli(lane.path, ['integration', 'record', workId, '--file', file, '--accept-minimum-version', '1.5.0']);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /turned off in YallaFlow 1\.5\.0/);
  await assert.rejects(readFile(path.join(lane.path, '.yallaflow', 'work', workId, 'integration.yaml')), /ENOENT/);
});
