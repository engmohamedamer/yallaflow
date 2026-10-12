// v0.3.10 First-use project bootstrap and purpose-aware discovery: an existing project
// without approved understanding is reported as PROJECT_UNDERSTANDING_REQUIRED and the
// Agent is routed to the baseline before substantial work; an approved baseline unlocks
// normal work; Greenfield never triggers a repository scan; the discovery purpose and
// preservation intent stay work intent and never become project truth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { exists } from '../src/utils/fs.js';
import { contextLedgerPath, loadContextLedger } from '../src/context/ledger.js';
import { assessProjectUnderstanding, UNDERSTANDING } from '../src/baseline/understanding.js';
import { agentContractBody } from '../src/agent/contract.js';
import { BOOTSTRAP_PROVIDERS, bootstrapBody } from '../src/agent/bootstrap.js';
import { approveTeamBaseline, cli, git, writeTeamApp } from '../test-support/shared.js';

async function brownfield() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-understand-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  git(root, ['config', 'user.name', 'Dev']);
  await writeTeamApp(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'app']);
  cli(root, ['init', '--name', 'Invoicing']);
  return root;
}

test('1. an existing meaningful repository without an approved baseline reports PROJECT_UNDERSTANDING_REQUIRED', async () => {
  const root = await brownfield();
  assert.equal((await assessProjectUnderstanding(root, { kind: 'brownfield' })).state, UNDERSTANDING.REQUIRED);
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /^Project understanding: PROJECT_UNDERSTANDING_REQUIRED — an existing project with no approved project understanding yet/m);
  assert.match(brief, /Primary next concern: no project memory yet — establish an evidence-backed Brownfield baseline .*before substantial work, then continue with the request/);
  assert.match(brief, /Next: yallaflow baseline start/);
});

test('2. a real work request on an un-understood project routes the Agent to the baseline first — without the developer asking', async () => {
  const root = await brownfield();
  const start = cli(root, ['start', 'Fix invoice totals']).stdout;
  assert.match(start, /PROJECT_UNDERSTANDING_REQUIRED: this existing project has no approved project understanding yet\./);
  assert.match(start, /establish it once before substantial work — yallaflow baseline start.*continue with this request after approval\. The developer does not need to ask for it\./);
  const route = cli(root, ['route', 'PF-0001', '--type', 'bug', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Totals wrong.', '--title', 'Invoice totals']).stdout;
  assert.match(route, /PROJECT_UNDERSTANDING_REQUIRED/);
  assert.match(cli(root, ['guide', 'PF-0001']).stdout, /PROJECT_UNDERSTANDING_REQUIRED/);
  // Guidance, not a gate: work state is unchanged and the request is preserved.
  assert.match(cli(root, ['status']).stdout, /PF-0001/);
  // Once the baseline is in progress, the notice names where it stands instead.
  cli(root, ['baseline', 'start']);
  assert.match(cli(root, ['guide', 'PF-0001']).stdout, /PROJECT_UNDERSTANDING_IN_PROGRESS: baseline PF-0002 in progress/);
  // The baseline itself never gets the notice.
  assert.doesNotMatch(cli(root, ['guide', 'PF-0002']).stdout, /PROJECT_UNDERSTANDING_/);
});

test('3. an approved baseline unlocks normal work: no understanding notice, established state', async () => {
  const root = await brownfield();
  await approveTeamBaseline(root);
  const assessment = await assessProjectUnderstanding(root, { kind: 'brownfield' });
  assert.equal(assessment.state, UNDERSTANDING.ESTABLISHED);
  assert.match(cli(root, ['brief']).stdout, /^Project understanding: established — 6 current project fact\(s\), Brownfield baseline approved$/m);
  const start = cli(root, ['start', 'Fix invoice totals']).stdout;
  assert.doesNotMatch(start, /PROJECT_UNDERSTANDING/);
});

test('4. a fresh developer never re-baselines: understanding is read from approved memory and a second baseline is refused', async () => {
  const root = await brownfield();
  await approveTeamBaseline(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'baseline']);
  const clone = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-fresh-'));
  git(clone, ['clone', '-q', root, '.']);
  const brief = cli(clone, ['brief']).stdout;
  assert.match(brief, /Project understanding: established/);
  assert.doesNotMatch(brief, /baseline start/);
  assert.match(cli(clone, ['baseline', 'start'], false).stderr, /An approved Brownfield Baseline already exists/);
});

test('5. an empty Greenfield project never triggers a Brownfield repository scan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-green-'));
  git(root, ['init', '-q']);
  cli(root, ['init', '--name', 'NewProduct']);
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /^Project understanding: Greenfield — understanding comes from product intent, supplied requirements, and approved decisions \(no repository scan\)$/m);
  assert.doesNotMatch(brief, /baseline start|PROJECT_UNDERSTANDING_REQUIRED/);
  assert.doesNotMatch(cli(root, ['start', 'Build a booking app']).stdout, /PROJECT_UNDERSTANDING/);
  assert.equal((await assessProjectUnderstanding(root, { kind: 'greenfield' })).state, UNDERSTANDING.GREENFIELD);
});

test('6/7. a purpose-aware discovery lens and preservation intent are stored as work intent, never as project facts', async () => {
  const root = await brownfield();
  const out = cli(root, ['baseline', 'start', '--objective', 'Complete UI/UX redesign', '--preserve', 'business behavior', '--preserve', 'authorization semantics', '--focus', 'routes to screens']).stdout;
  assert.match(out, /Discovery lens: bootstrap discovery for: Complete UI\/UX redesign · preserve: business behavior, authorization semantics · deepen: routes to screens \(work intent — never promoted as project truth\)/);
  assert.match(out, /Canonical core coverage: purpose, architecture, .*discovery limitations/);
  const purpose = JSON.parse(await readFile(path.join(workspacePath(root), 'work', 'PF-0001', 'purpose.yaml'), 'utf8'));
  assert.equal(purpose.mode, 'bootstrap');
  assert.deepEqual(purpose.preservation, ['business behavior', 'authorization semantics']);
  assert.match(cli(root, ['purpose', 'show', 'PF-0001']).stdout, /Objective: Complete UI\/UX redesign/);
  assert.match(cli(root, ['brief']).stdout, /Discovery lens \(PF-0001\): bootstrap discovery for: Complete UI\/UX redesign/);
  assert.equal(await exists(contextLedgerPath(root)), false, 'recording a purpose writes no project memory');

  // Approve the baseline: the canonical facts carry no trace of the planned redesign.
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Discovery complete.']);
  const draft = path.join(root, 'baseline.json');
  await writeFile(draft, JSON.stringify({ facts: [{ area: 'architecture', status: 'confirmed', summary: 'Invoices live in backend/invoices.', evidence: ['backend/invoices/totals.js'], source: 'repository' }] }));
  cli(root, ['baseline', 'draft', 'PF-0001', '--file', draft]);
  cli(root, ['baseline', 'approve', 'PF-0001']);
  const { ledger } = await loadContextLedger(root);
  const memory = JSON.stringify(ledger) + await readFile(path.join(workspacePath(root), 'PROJECT.md'), 'utf8') + await readFile(path.join(workspacePath(root), 'context', 'architecture.md'), 'utf8');
  for (const intent of ['redesign', 'business behavior', 'authorization semantics', 'routes to screens']) assert.ok(!memory.includes(intent), `${intent} is not project truth`);

  // Purpose updates keep their history; intent discovery on other work is explicit.
  cli(root, ['start', 'Redesign the invoice screen']);
  cli(root, ['purpose', 'set', 'PF-0002', '--objective', 'Redesign invoice screen', '--preserve', 'totals']);
  cli(root, ['purpose', 'set', 'PF-0002', '--objective', 'Redesign invoice and refund screens', '--mode', 'intent']);
  const updated = JSON.parse(await readFile(path.join(workspacePath(root), 'work', 'PF-0002', 'purpose.yaml'), 'utf8'));
  assert.equal(updated.history.length, 2);
  assert.equal(updated.history[1].previous.objective, 'Redesign invoice screen');
  assert.match(cli(root, ['purpose', 'set', 'PF-0002', '--objective', 'x', '--mode', 'guess'], false).stderr, /--mode must be one of: bootstrap, intent, freshness/);
  assert.match(cli(root, ['baseline', 'start', '--preserve', 'x'], false).stderr, /Usage: yallaflow baseline start/);
});

test('the Agent Contract and adapters teach automatic orientation, understanding first, purpose-aware discovery, and the finish protocol', () => {
  const body = agentContractBody();
  assert.match(body, /Developers work with Git; agents work with YallaFlow/);
  assert.match(body, /Orient automatically\. At the start of every session .* run yallaflow brief yourself — the developer does not need to say "use YallaFlow" \(saying it explicitly still works\)/);
  assert.match(body, /## Project understanding sequence/);
  assert.match(body, /do not wait to be asked to "understand the project"/);
  assert.match(body, /never repeat a repository-wide scan/);
  assert.match(body, /For a Greenfield project, never scan an empty repository/);
  assert.match(body, /bootstrap discovery .*intent discovery .*freshness discovery/);
  assert.match(body, /Purpose and preservation intent are work intent, stored in work\/<id>\/purpose\.yaml: never promote them as project facts/);
  assert.match(body, /## Finish protocol and developer language/);
  assert.match(body, /yallaflow finish <work-id>/);
  assert.match(body, /do not narrate PF\/CTX\/K identifiers/);
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) {
    const block = bootstrapBody(provider);
    assert.match(block, /automatically, before handling the first request; the developer does not need to say "use YallaFlow"/);
    assert.match(block, /yallaflow finish <work-id>/);
  }
});
