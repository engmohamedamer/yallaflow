// PF-0151: the Project Brief is an optional, plain-language VIEW of a baseline draft. Every
// line cites facts (or, under worthKnowing, limitations) of the same draft; Core validates
// the references and the shape, and only facts ever become project memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { checkpointWork } from '../src/core/progress.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { approveBaseline, baselineReviewDigest, draftBaseline, loadBaseline, startBaseline } from '../src/baseline/store.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const FACTS = [
  { area: 'project', status: 'confirmed', summary: 'A booking app for one clinic.', evidence: ['README.md'], source: 'repository' },
  { area: 'architecture', status: 'inferred', summary: 'Staff confirm bookings from an admin page.', evidence: ['routes.php'], source: 'repository' },
  { area: 'database', status: 'unresolved', summary: 'The production database cannot be established.', evidence: ['compose.yaml'], source: 'repository' }
];
const LIMITS = [{ type: 'not-inspected', area: 'environment', summary: 'Deployment scripts were not read.', reason: 'outside the repository' }];
const BRIEF = {
  summary: { text: '  A booking app   for one clinic. ', facts: ['BF-001'] },
  users: [{ text: 'Patients and clinic staff.', facts: ['BF-001', 'BF-002'] }],
  capabilities: [{ text: 'Staff confirm bookings.', facts: ['BF-002'] }],
  worthKnowing: [{ text: 'The production database is unknown.', facts: ['BF-003'] }, { text: 'Deployment was not looked at.', limitations: ['DL-001'] }]
};

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-brief-'));
  await initWorkspace(root, 'Clinic', 'brownfield');
  for (const name of ['README.md', 'routes.php', 'compose.yaml']) await writeFile(path.join(root, name), '#\n');
  const { meta } = await startBaseline(root);
  await checkpointWork(root, meta.id, { skillId: 'repository-baseline', status: 'completed', summary: 'done', evidence: [] });
  return { root, id: meta.id };
}
const rejected = async (root, id, brief) => { try { await draftBaseline(root, id, { facts: FACTS, limitations: LIMITS, brief }); return null; } catch (error) { return error.message; } };

test('a valid brief is stored with the draft, normalized, and never becomes project memory', async () => {
  const { root, id } = await project();
  const { ledger } = await draftBaseline(root, id, { facts: FACTS, limitations: LIMITS, brief: BRIEF });
  assert.deepEqual(ledger.brief.summary, { text: 'A booking app for one clinic.', facts: ['BF-001'] });
  assert.deepEqual(ledger.brief.worthKnowing[1], { text: 'Deployment was not looked at.', facts: [], limitations: ['DL-001'] });
  assert.deepEqual(Object.keys(ledger.brief), ['summary', 'users', 'capabilities', 'worthKnowing'], 'only what was given');
  const digest = baselineReviewDigest(ledger);
  await approveBaseline(root, id, 'ok');
  const context = await readYaml(path.join(workspacePath(root), 'context', 'index.yaml'));
  assert.equal(context.facts.length, 3, 'the three facts are promoted');
  assert.equal(JSON.stringify(context).includes('Patients and clinic staff'), false, 'no brief text in project memory');
  const { readdir } = await import('node:fs/promises');
  const projected = [path.join(workspacePath(root), 'PROJECT.md'), ...(await readdir(path.join(workspacePath(root), 'context'))).filter((name) => name.endsWith('.md')).map((name) => path.join(workspacePath(root), 'context', name))];
  assert.ok(projected.length > 1);
  for (const file of projected) assert.equal((await readFile(file, 'utf8')).includes('Patients and clinic staff'), false, file);
  assert.equal((await loadBaseline(root, id)).ledger.brief.users[0].text, 'Patients and clinic staff.', 'it stays with the baseline');
  // each cited fact can be found in project memory through its origin
  assert.deepEqual(context.facts.map((fact) => fact.origin.baselineFactId).sort(), ['BF-001', 'BF-002', 'BF-003']);
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test('a draft without a brief is exactly as valid as before, and a redraft can add, change or drop it', async () => {
  const { root, id } = await project();
  const plain = (await draftBaseline(root, id, { facts: FACTS })).ledger;
  assert.equal('brief' in plain, false);
  const withBrief = (await draftBaseline(root, id, { facts: FACTS, brief: { summary: BRIEF.summary } })).ledger;
  assert.notEqual(baselineReviewDigest(withBrief), baselineReviewDigest(plain), 'the brief is part of what is reviewed');
  assert.equal('brief' in (await draftBaseline(root, id, { facts: FACTS })).ledger, false);
  assert.equal('brief' in (await draftBaseline(root, id, { facts: FACTS, brief: null })).ledger, false);
});

test('every line must cite this draft: unknown ids, no citation and wrong shapes are rejected, and nothing is written', async () => {
  const { root, id } = await project();
  const file = path.join(workspacePath(root), 'work', id, 'baseline.yaml');
  const cases = [
    [{ summary: { text: 'A clinic app.', facts: [] } }, /brief\.summary: every brief line must cite at least one fact of this draft; a claim without evidence does not belong in the brief/],
    [{ summary: { text: 'A clinic app.' } }, /brief\.summary: every brief line must cite/],
    [{ summary: { text: 'A clinic app.', facts: ['BF-009'] } }, /brief\.summary: facts cites BF-009, which is not in this draft/],
    [{ summary: { text: 'A clinic app.', facts: ['CTX-0001'] } }, /cites CTX-0001, which is not in this draft/],
    [{ users: [{ text: 'Staff.', facts: ['BF-001'] }] }, /brief\.summary is required/],
    [{ summary: { text: '', facts: ['BF-001'] } }, /brief\.summary: text must be a non-empty string/],
    [{ summary: { text: 'x'.repeat(281), facts: ['BF-001'] } }, /text is limited to 280 characters \(it has 281\)/],
    [{ summary: BRIEF.summary, users: Array.from({ length: 7 }, () => ({ text: 'Staff.', facts: ['BF-001'] })) }, /brief\.users must be a list of at most 6 lines/],
    [{ summary: BRIEF.summary, capabilities: [{ text: 'It uses a managed database.', facts: ['BF-003'] }] }, /brief\.capabilities\[1\]: BF-003 is unresolved; what is not established is said under worthKnowing/],
    [{ summary: { text: 'A clinic app.', facts: ['BF-003'] } }, /brief\.summary: BF-003 is unresolved/],
    [{ summary: BRIEF.summary, users: [{ text: 'Staff.', limitations: ['DL-001'] }] }, /brief\.users\[1\] has unknown field\(s\): limitations/],
    [{ summary: BRIEF.summary, worthKnowing: [{ text: 'Unknown deploy.', limitations: ['DL-007'] }] }, /limitations cites DL-007, which is not in this draft/],
    [{ summary: BRIEF.summary, worthKnowing: [{ text: 'Something risky.' }] }, /must cite at least one fact of this draft or one discovery limitation/],
    [{ summary: BRIEF.summary, technologies: ['Laravel'] }, /brief has unknown field\(s\): technologies[\s\S]*Technologies and coverage are not written in the brief/],
    [{ summary: BRIEF.summary, coverage: 'all' }, /unknown field\(s\): coverage/],
    [{ summary: { text: 'A clinic app.', facts: ['BF-001'], evidence: ['x'] } }, /brief\.summary has unknown field\(s\): evidence/],
    [{ summary: { text: 'A clinic app.', facts: 'BF-001' } }, /facts must be a list of at most 8 ids like BF-001/],
    [['A clinic app.'], /brief must be an object/],
    ['A clinic app.', /brief must be an object/]
  ];
  for (const [brief, expected] of cases) {
    const message = await rejected(root, id, brief);
    assert.ok(message, `accepted: ${JSON.stringify(brief).slice(0, 80)}`);
    assert.match(message, expected);
    assert.match(message, /^Baseline draft for PF-\d+ is invalid:/);
  }
  assert.equal(await readFile(file, 'utf8').catch(() => null), null, 'no draft was written by any rejected attempt');
});

test('CLI: the agent is told how to write the brief; baseline show prints it first with its citations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-brief-cli-'));
  await initWorkspace(root, 'Clinic', 'brownfield');
  for (const name of ['README.md', 'routes.php', 'compose.yaml']) await writeFile(path.join(root, name), '#\n');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  const started = run(['baseline', 'start']);
  const id = /^(PF-\d+)/.exec(started.stdout)[1];
  assert.match(started.stdout, /Add a Project Brief to the draft[\s\S]*Every line cites at least one; a line without evidence is rejected[\s\S]*never a place for new claims/);
  run(['checkpoint', id, '--skill', 'repository-baseline', '--complete', '--summary', 'x']);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: FACTS, limitations: LIMITS }));
  const bare = run(['baseline', 'draft', id, '--file', 'b.json']);
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /No Project Brief in this draft\. The developer then reviews the fact list only\./);
  assert.doesNotMatch(run(['baseline', 'show', id]).stdout, /Project Brief/);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: FACTS, limitations: LIMITS, brief: BRIEF }));
  const drafted = run(['baseline', 'draft', id, '--file', 'b.json']);
  assert.match(drafted.stdout, /Project Brief: recorded \(5 line\(s\), each citing this draft's facts\)\./);
  const shown = run(['baseline', 'show', id]).stdout;
  assert.ok(shown.indexOf('Project Brief') < shown.indexOf('BF-001 [project]'), 'the brief comes before the facts');
  assert.match(shown, /A booking app for one clinic\. \[BF-001\]/);
  assert.match(shown, /Worth knowing:\n\s+- The production database is unknown\. \[BF-003\]\n\s+- Deployment was not looked at\. \[DL-001\]/);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: FACTS, brief: { summary: { text: 'It is fast.', facts: [] } } }));
  const bad = run(['baseline', 'draft', id, '--file', 'b.json']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /every brief line must cite at least one fact/);
  assert.equal(run(['doctor']).status, 0);
});

// ---- PF-0152: after approval the brief is read through project memory ----
test('the Overview carries the approved brief with the current facts it cites; a changed file marks its line', async () => {
  const { collectOverview } = await import('../src/overview/collect.js');
  const { collectWorkDetail } = await import('../src/flow/snapshot.js');
  const { root, id } = await project();
  await draftBaseline(root, id, { facts: FACTS, limitations: LIMITS, brief: BRIEF, coverage: { inspected: ['README.md'], sampled: ['routes.php'] } });
  assert.equal((await collectOverview(root)).brief, undefined, 'a draft is not project memory: no brief on the Overview yet');
  assert.deepEqual((await collectWorkDetail(root, id)).baseline.brief.summary, { text: 'A booking app for one clinic.', facts: ['BF-001'] }, 'the review page gets the draft brief');
  await approveBaseline(root, id, 'ok');
  const brief = (await collectOverview(root)).brief;
  assert.equal(brief.baselineId, id);
  assert.match(brief.summary.facts[0], /^CTX-\d+$/, 'lines cite project-memory facts now');
  assert.equal(brief.summary.care, undefined);
  assert.deepEqual(brief.coverage, { declared: true, inspected: 1, sampled: 1, notInspected: 1 });
  assert.deepEqual(brief.worthKnowing.at(-1), { text: 'Deployment was not looked at.', facts: [], limitations: 1 });
  // the file behind the first fact changes: its lines are marked, the others are not
  await writeFile(path.join(root, 'README.md'), '# changed\n');
  const later = (await collectOverview(root)).brief;
  assert.equal(later.summary.care, 'may-be-stale');
  assert.equal(later.users[0].care, 'may-be-stale', 'a line citing two facts is marked when one needs care');
  assert.equal(later.capabilities[0].care, undefined);
  assert.equal(later.summary.text, 'A booking app for one clinic.', 'the text itself is never rewritten');
});

test('a baseline approved without a brief adds nothing to the Overview', async () => {
  const { collectOverview } = await import('../src/overview/collect.js');
  const { root, id } = await project();
  await draftBaseline(root, id, { facts: FACTS });
  await approveBaseline(root, id, 'ok');
  assert.equal('brief' in (await collectOverview(root)), false);
});

// ---- PF-0153: suggested first tasks ----
const SUGGEST = [
  { title: 'Find out which database production uses', why: 'It could not be established from the repository.', type: 'investigation', facts: ['BF-003'] },
  { title: ' Document   the deployment ', why: 'Deployment scripts were not read.', limitations: ['DL-001'] }
];
test('suggestions are stored with the draft only when each one cites the draft and says why', async () => {
  const { root, id } = await project();
  const { ledger } = await draftBaseline(root, id, { facts: FACTS, limitations: LIMITS, suggestions: SUGGEST });
  assert.deepEqual(ledger.suggestions, [
    { title: 'Find out which database production uses', why: 'It could not be established from the repository.', type: 'investigation', facts: ['BF-003'] },
    { title: 'Document the deployment', why: 'Deployment scripts were not read.', facts: [], limitations: ['DL-001'] }
  ]);
  assert.equal('suggestions' in (await draftBaseline(root, id, { facts: FACTS, suggestions: [] })).ledger, false, 'none is fine');
  const refuse = async (suggestions) => { try { await draftBaseline(root, id, { facts: FACTS, limitations: LIMITS, suggestions }); return null; } catch (error) { return error.message; } };
  const cases = [
    [[{ title: 'Add tests', why: 'Tests are good.' }], /suggestions\[1\]: a suggested task must cite at least one fact or discovery limitation of this draft; a task that nothing in the project supports is not suggested/],
    [[{ title: 'Add tests', why: 'Tests are good.', facts: [] }], /must cite at least one fact/],
    [[{ title: 'Add tests', why: 'x', facts: ['BF-042'] }], /facts cites BF-042, which is not in this draft/],
    [[{ title: 'Add tests', facts: ['BF-001'] }], /suggestions\[1\]: why must be a non-empty string/],
    [[{ why: 'x', facts: ['BF-001'] }], /title must be a non-empty string/],
    [[{ title: 't'.repeat(101), why: 'x', facts: ['BF-001'] }], /title is limited to 100 characters/],
    [[{ title: 'A', why: 'y'.repeat(241), facts: ['BF-001'] }], /why is limited to 240 characters/],
    [[{ title: 'A', why: 'x', type: 'epic', facts: ['BF-001'] }], /type must be one of: feature, bug, change, investigation/],
    [[{ title: 'A', why: 'x', facts: ['BF-001'], priority: 1 }], /unknown field\(s\): priority/],
    [[{ title: 'Same', why: 'x', facts: ['BF-001'] }, { title: 'same', why: 'y', facts: ['BF-002'] }], /the same title is suggested twice/],
    [Array.from({ length: 4 }, (_, i) => ({ title: `T${i}`, why: 'x', facts: ['BF-001'] })), /at most 3 first tasks[\s\S]*rather than padding the list/],
    [{ title: 'A' }, /suggestions must be a list/]
  ];
  for (const [suggestions, expected] of cases) assert.match(await refuse(suggestions) ?? 'accepted', expected);
});

test('after approval: the own request first, suggestions through current facts, nothing in project memory, and it ends once work exists', async () => {
  const { collectOverview } = await import('../src/overview/collect.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-first-'));
  await initWorkspace(root, 'Clinic', 'brownfield');
  for (const name of ['README.md', 'routes.php', 'compose.yaml']) await writeFile(path.join(root, name), '#\n');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  const id = /^(PF-\d+)/.exec(run(['baseline', 'start', '--objective', 'Add online payment for bookings']).stdout)[1];
  run(['checkpoint', id, '--skill', 'repository-baseline', '--complete', '--summary', 'x']);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: FACTS, limitations: LIMITS, suggestions: SUGGEST }));
  assert.equal(run(['baseline', 'draft', id, '--file', 'b.json']).status, 0);
  assert.equal((await collectOverview(root)).firstTasks, undefined, 'nothing is offered before approval');
  assert.equal(run(['baseline', 'approve', id, '--note', 'ok']).status, 0);
  const before = (await readFile(path.join(workspacePath(root), 'context', 'index.yaml'), 'utf8'));
  assert.equal(before.includes('Document the deployment'), false, 'suggestions are not project memory');
  const first = (await collectOverview(root)).firstTasks;
  assert.equal(first.request, 'Add online payment for bookings');
  assert.deepEqual(first.suggestions.map((entry) => [entry.title, entry.type, entry.facts.length, entry.limitations ?? 0]), [['Find out which database production uses', 'investigation', 1, 0], ['Document the deployment', null, 0, 1]]);
  assert.match(first.suggestions[0].facts[0], /^CTX-/);
  const work = async () => (await (await import('node:fs/promises')).readdir(path.join(workspacePath(root), 'work'))).length;
  assert.equal(await work(), 1, 'reading suggestions creates no work item');
  // the developer creates work: the own request is no longer pending
  assert.equal(run(['start', 'Add online payment for bookings']).status, 0);
  assert.equal((await collectOverview(root)).firstTasks.request, null);
});
