// v0.3.10 storage/contract hardening: immutable pinned skill instructions (Skill
// Registry v6), the first-use Brownfield write gate, and knowledge-ledger schema
// integrity against the real frozen v0.3.9 reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { exists } from '../src/utils/fs.js';
import { REGISTRY_VERSION } from '../src/skills/constants.js';
import { SKILL_REGISTRY } from '../src/skills/registry.js';
import { validateSkillRegistry } from '../src/skills/validation.js';
import { loadSkillInstructions, pinnedInstructionVersion, SKILL_INSTRUCTION_VERSIONS } from '../src/skills/instructions.js';
import { validateKnowledgeLedger } from '../src/knowledge/store.js';
import { approveTeamBaseline, cli, commitAll, complete, developer, frozenCli, git, investigation, learn, mergeBranch, sharedTeam, writeTeamApp } from '../test-support/shared.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const body = (stdout) => stdout.slice(stdout.indexOf('\n\n') + 2);

async function workspaceWithPinnedWork(registryVersion) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pin-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const dir = path.join(workspacePath(root), 'work', 'PF-0001');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'meta.yaml'), JSON.stringify({
    id: 'PF-0001', type: 'investigation', scope: 'bounded', workflow: 'investigation', routingStatus: 'routed', readOnly: true, status: 'QUESTION',
    requiredCapabilities: ['discover', 'systematic-debugging', 'verify'],
    behaviorContract: { registryVersion, skills: ['context-discovery', 'systematic-debugging', 'verification'] },
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
  }, null, 2));
  return root;
}

// ---------------------------------------------------------------------------
// Skill Registry immutability

test('every released skill instruction version is immutable bytes with a recorded hash; the registry is v9', async () => {
  assert.equal(REGISTRY_VERSION, 9);
  assert.deepEqual(await validateSkillRegistry(), { registryVersion: 9, skillCount: 15 });
  for (const [skillId, versions] of Object.entries(SKILL_INSTRUCTION_VERSIONS)) {
    for (const [version, entry] of Object.entries(versions)) {
      assert.equal(sha(await readFile(path.join(repo, entry.path), 'utf8')), entry.sha256, `${skillId} v${version}`);
    }
  }
  for (const entry of SKILL_REGISTRY) {
    for (let registry = 1; registry <= 5; registry += 1) assert.equal(pinnedInstructionVersion(registry, entry.id), 1, `${entry.id} under registry v${registry}`);
  }
  assert.equal(pinnedInstructionVersion(6, 'repository-baseline'), 2);
  assert.equal(pinnedInstructionVersion(6, 'context-discovery'), 2);
  assert.equal(pinnedInstructionVersion(6, 'verification'), 1);
  assert.equal(pinnedInstructionVersion(7, 'repository-baseline'), 3, 'v7: conversational baseline approval');
  assert.equal(pinnedInstructionVersion(7, 'context-discovery'), 2);
});

test('editing a released instruction in place is detected (doctor / skill fail), never silently served', async () => {
  const copy = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pkg-'));
  await cp(path.join(repo, 'resources'), path.join(copy, 'resources'), { recursive: true });
  const archived = path.join(copy, 'resources', 'skills', 'archive', 'repository-baseline.v1.md');
  await writeFile(archived, `${await readFile(archived, 'utf8')}\n9. A silently added rule.\n`);
  await assert.rejects(validateSkillRegistry(SKILL_REGISTRY, { packageRoot: copy }), /repository-baseline instruction v1 .* no longer matches its released bytes[\s\S]*immutable/);
  await assert.rejects(loadSkillInstructions('repository-baseline', 1, copy), /no longer matches/);
});

test('work pinned under registry v5 resolves exactly the v0.3.9 instructions after upgrading; v6 work resolves v2', async (t) => {
  for (const skill of ['repository-baseline', 'context-discovery']) {
    const tagged = spawnSync('git', ['show', `v0.3.9-internal.1:resources/skills/${skill}.md`], { cwd: repo, encoding: 'utf8' });
    if (tagged.status === 0) assert.equal(sha(tagged.stdout), SKILL_INSTRUCTION_VERSIONS[skill][1].sha256, `${skill} v1 is the frozen v0.3.9 text`);
  }
  const v5 = await workspaceWithPinnedWork(5);
  const pinned = cli(v5, ['skill', 'context-discovery', '--work', 'PF-0001']).stdout;
  assert.match(pinned, /^Skill: context-discovery\nVersion: 1\nPinned by: PF-0001 \(Skill Registry v5\)/);
  assert.equal(pinned.split('Prerequisites:\n- none\n\n')[1], `${(await loadSkillInstructions('context-discovery', 1)).text.trim()}\n\n`);
  assert.doesNotMatch(pinned, /Know which discovery you are doing/, 'no v0.3.10 instruction leaks into v5 work');
  // The active work item's pin is the default.
  await writeFile(path.join(workspacePath(v5), 'state', 'current.yaml'), JSON.stringify({ schemaVersion: 1, activeWork: 'PF-0001', stage: 'QUESTION', updatedAt: null }));
  assert.match(cli(v5, ['skill', 'context-discovery']).stdout, /Version: 1\nPinned by: PF-0001 \(Skill Registry v5\)/);
  // A skill outside the pinned contract is refused for an explicit work item.
  assert.match(cli(v5, ['skill', 'repository-baseline', '--work', 'PF-0001'], false).stderr, /does not include repository-baseline/);

  const v6 = await workspaceWithPinnedWork(6);
  assert.match(cli(v6, ['skill', 'context-discovery', '--work', 'PF-0001']).stdout, /Version: 2\nPinned by: PF-0001 \(Skill Registry v6\)[\s\S]*Know which discovery you are doing/);

  const frozen = await frozenCli();
  if (!frozen) return t.diagnostic('frozen v0.3.9 tag unavailable; byte comparison against its CLI skipped');
  const old = frozen(v5, ['skill', 'context-discovery']);
  assert.equal(old.status, 0, old.stderr);
  assert.equal(old.stdout.split('Prerequisites:\n- none\n\n')[1], pinned.split('Prerequisites:\n- none\n\n')[1], 'identical instructions to what the frozen v0.3.9 CLI served');
});

// ---------------------------------------------------------------------------
// First-use Brownfield gate

async function brownfield() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-gate-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Dev']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  await writeTeamApp(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'app']);
  cli(root, ['init', '--name', 'Invoicing']);
  return root;
}

function toImplementationGate(root, id) {
  cli(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'Located totals.']);
  cli(root, ['checkpoint', id, '--skill', 'systematic-debugging', '--complete', '--summary', 'Root cause found.', '--evidence', 'backend/invoices/totals.js']);
  for (let i = 0; i < 6; i += 1) cli(root, ['advance', id]);
}

// Work an older YallaFlow (internal.1–.3) created before the baseline existed: those
// releases allowed creating work in an un-understood Brownfield project. Simulated by
// running the command while the project is recorded as Greenfield, then restoring.
async function preGateWork(root, args) {
  const file = path.join(workspacePath(root), 'config.yaml');
  const original = await readFile(file, 'utf8');
  const config = JSON.parse(original);
  await writeFile(file, JSON.stringify({ ...config, project: { ...config.project, kind: 'greenfield' } }, null, 2));
  try {
    return cli(root, args);
  } finally {
    await writeFile(file, original);
  }
}

test('first-use gate: an un-understood Brownfield project refuses normal work outright; the baseline is the next valid action, then work continues', async () => {
  const root = await brownfield();
  // v0.3.10-internal.4: no normal work item is created before understanding is approved.
  for (const args of [['start', 'Fix invoice totals'], ['bug', 'Invoice totals', '--scope', 'bounded'], ['investigate', 'Why are totals wrong?', '--scope', 'bounded']]) {
    const refused = cli(root, args, false);
    assert.equal(refused.status, 1, args.join(' '));
    assert.match(refused.stderr, /^PROJECT_UNDERSTANDING_REQUIRED: [\s\S]*No work item was created\.[\s\S]*NEXT VALID ACTION: yallaflow baseline start --objective '/);
  }
  await writeFile(path.join(root, 'notes.md'), '# Totals\n');
  assert.match(cli(root, ['intake', 'notes.md'], false).stderr, /PROJECT_UNDERSTANDING_REQUIRED/);
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false, 'a refused intake persists no source');
  assert.equal(await exists(path.join(workspacePath(root), 'work')), true);
  assert.equal(cli(root, ['status']).stdout.includes('Work items: 0'), true);

  // The Agent runs the baseline with the original request as its objective; while it
  // is in progress or awaiting review, normal work is still refused.
  cli(root, ['baseline', 'start', '--objective', 'Fix invoice totals']);
  assert.match(cli(root, ['start', 'Fix invoice totals'], false).stderr, /PROJECT_UNDERSTANDING_IN_PROGRESS[\s\S]*NEXT VALID ACTION: yallaflow checkpoint PF-0001 --skill repository-baseline/);
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Discovery complete.']);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: [{ area: 'business-rule', status: 'confirmed', summary: 'Invoice totals are the sum of line amounts.', evidence: ['backend/invoices/totals.js'], source: 'repository' }] }));
  cli(root, ['baseline', 'draft', 'PF-0001', '--file', 'b.json']);
  assert.match(cli(root, ['start', 'Fix invoice totals'], false).stderr, /PROJECT_UNDERSTANDING_AWAITING_REVIEW[\s\S]*NEXT VALID ACTION: yallaflow baseline show PF-0001/);

  // Human approval is the only way through; the original request then continues.
  const approved = cli(root, ['baseline', 'approve', 'PF-0001']).stdout;
  assert.match(approved, /Continue the original request now[\s\S]*Fix invoice totals[\s\S]*Next: yallaflow start 'Fix invoice totals'/);
  assert.match(cli(root, ['start', 'Fix invoice totals']).stdout, /Created PF-0002/);
  cli(root, ['route', 'PF-0002', '--type', 'bug', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Totals wrong.', '--title', 'Invoice totals']);
  toImplementationGate(root, 'PF-0002');
  assert.match(cli(root, ['advance', 'PF-0002']).stdout, /FIX_PLAN → IMPLEMENTATION/);
  assert.match(cli(root, ['guide', 'PF-0002']).stdout, /Application code modification: AUTHORIZED|Implementation is authorized/);
});

test('first-use gate: work created before the gate (an older YallaFlow) cannot write, reopen, or be routed; read-only work proceeds; Greenfield is never gated', async () => {
  const root = await brownfield();
  await preGateWork(root, ['bug', 'Totals', '--scope', 'bounded']);
  const metaFile = path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml');
  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  await preGateWork(root, ['checkpoint', 'PF-0001', '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  await preGateWork(root, ['checkpoint', 'PF-0001', '--skill', 'systematic-debugging', '--complete', '--summary', 'ok', '--evidence', 'backend/invoices/totals.js']);
  for (let i = 0; i < 6; i += 1) cli(root, ['advance', 'PF-0001']);
  assert.equal(JSON.parse(await readFile(metaFile, 'utf8')).status, 'FIX_PLAN', 'diagnosis stages are not gated');
  const before = await readFile(metaFile, 'utf8');
  const refused = cli(root, ['advance', 'PF-0001'], false);
  assert.match(refused.stderr, /Cannot advance from FIX_PLAN to IMPLEMENTATION: PROJECT_UNDERSTANDING_REQUIRED[\s\S]*Nothing was changed/);
  assert.equal(await readFile(metaFile, 'utf8'), before);
  const guide = cli(root, ['guide', 'PF-0001']).stdout;
  assert.match(guide, /BLOCKER:\nPROJECT_UNDERSTANDING_REQUIRED — establish and approve project understanding before application changes/);
  assert.match(guide, /NEXT VALID ACTION:\nyallaflow baseline start/);

  // In-flight writes (work already in IMPLEMENTATION) and reopen are closed too.
  await writeFile(metaFile, JSON.stringify({ ...meta, status: 'IMPLEMENTATION' }, null, 2));
  await writeFile(path.join(workspacePath(root), 'state', 'current.yaml'), JSON.stringify({ schemaVersion: 1, activeWork: 'PF-0001', stage: 'IMPLEMENTATION', updatedAt: null }));
  assert.match(cli(root, ['handoff', 'PF-0001']).stdout, /Application code modification: NOT AUTHORIZED\nReason: PROJECT_UNDERSTANDING_REQUIRED/);
  assert.match(cli(root, ['advance', 'PF-0001'], false).stderr, /Cannot advance from IMPLEMENTATION to VERIFICATION: PROJECT_UNDERSTANDING_REQUIRED/);
  await writeFile(metaFile, JSON.stringify({ ...meta, status: 'DONE' }, null, 2));
  assert.match(cli(root, ['reopen', 'PF-0001', '--to', 'implementation', '--reason', 'Regression'], false).stderr, /Cannot reopen PF-0001 into IMPLEMENTATION: PROJECT_UNDERSTANDING_REQUIRED[\s\S]*No files were changed/);

  // A pending intake an older YallaFlow created is not routed into normal work.
  await preGateWork(root, ['start', 'Refund rounding']);
  const pendingMeta = path.join(workspacePath(root), 'work', 'PF-0002', 'meta.yaml');
  const pending = await readFile(pendingMeta, 'utf8');
  assert.match(cli(root, ['route', 'PF-0002', '--type', 'bug', '--scope', 'bounded', '--confidence', 'high', '--reason', 'x'], false).stderr, /PROJECT_UNDERSTANDING_REQUIRED[\s\S]*Original request \(keep it[\s\S]*Refund rounding/);
  assert.equal(await readFile(pendingMeta, 'utf8'), pending, 'a refused route changes nothing');

  // A read-only investigation that already exists proceeds.
  const created = (await preGateWork(root, ['investigate', 'Why are totals wrong?', '--scope', 'bounded'])).stdout;
  const id = /Created (PF-\d+)/.exec(created)[1];
  for (let i = 0; i < 3; i += 1) cli(root, ['advance', id]);

  const green = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-gate-green-'));
  await initWorkspace(green, 'New', 'greenfield');
  cli(green, ['bug', 'Totals', '--scope', 'bounded']);
  toImplementationGate(green, 'PF-0001');
  assert.match(cli(green, ['advance', 'PF-0001']).stdout, /FIX_PLAN → IMPLEMENTATION/);
});

// ---------------------------------------------------------------------------
// Knowledge schema integrity (real frozen v0.3.9 reader)

test('knowledge schema: v1 stays v1 and readable by v0.3.9; Shared Project shapes are v2 and v0.3.9 refuses them without changing a byte', async (t) => {
  const v2only = { version: 1, reviewStatus: 'reviewed', reviewedAt: 'x', updatedAt: 'x', candidates: [{ id: 'K-001', kind: 'architecture', summary: 's', evidence: ['a'], status: 'staged', stagedAt: 'x', createdAt: 'x' }] };
  assert.throws(() => validateKnowledgeLedger(v2only, 'PF-0001'), /require knowledge schema v2, but declares v1/);
  assert.equal(validateKnowledgeLedger({ ...v2only, version: 2 }, 'PF-0001'), true);
  assert.throws(() => validateKnowledgeLedger({ ...v2only, version: 3 }, 'PF-0001'), /schema v3, written by a newer YallaFlow/);

  // Single-user promotion (with a relation) remains v1.
  const solo = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-k1-'));
  git(solo, ['init', '-q', '-b', 'main']);
  await writeTeamApp(solo);
  await initWorkspace(solo, 'Solo', 'brownfield');
  await approveTeamBaseline(solo);
  const soloWork = await investigation(solo, 'Refunds');
  await learn(solo, soloWork, { kind: 'business-rule', summary: 'Refunds are allowed within 30 days.', evidence: ['backend/refunds/policy.js'], reconfirms: 'CTX-0004' });
  const soloFile = path.join(workspacePath(solo), 'work', soloWork, 'knowledge.yaml');
  assert.equal(JSON.parse(await readFile(soloFile, 'utf8')).version, 1);

  // Shared feature branch: staged + fingerprinted relation → v2; integration keeps v2.
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/a');
  const work = await investigation(a, 'Refunds');
  await learn(a, work, { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  const sharedFile = path.join(workspacePath(a), 'work', work, 'knowledge.yaml');
  assert.equal(JSON.parse(await readFile(sharedFile, 'utf8')).version, 2);
  await complete(a, work);
  commitAll(a, 'A');
  git(a, ['push', '-q', 'origin', 'feature/a']);
  assert.equal(mergeBranch(team.maintainer, 'feature/a').status, 0);
  cli(team.maintainer, ['shared', 'integrate']);
  const integrated = JSON.parse(await readFile(path.join(workspacePath(team.maintainer), 'work', work, 'knowledge.yaml'), 'utf8'));
  assert.equal(integrated.version, 2);
  assert.equal(integrated.candidates[0].status, 'promoted');

  const frozen = await frozenCli();
  if (!frozen) return t.diagnostic('frozen v0.3.9 tag unavailable; mixed-version reader checks skipped');
  const readV1 = frozen(solo, ['knowledge', 'list', soloWork]);
  assert.equal(readV1.status, 0, readV1.stderr);
  assert.match(readV1.stdout, /K-001 \[promoted\] business-rule/);
  assert.match(frozen(solo, ['doctor']).stdout, /PASS work knowledge ledgers \(\d+ present\)/);

  const bytes = await readFile(sharedFile, 'utf8');
  // v0.3.9 already stops on a Shared Project's missing tracked state file; give it one so
  // the knowledge-ledger schema check itself is what is exercised.
  const legacyState = path.join(workspacePath(a), 'state', 'current.yaml');
  await (await import('node:fs/promises')).mkdir(path.dirname(legacyState), { recursive: true });
  await writeFile(legacyState, JSON.stringify({ schemaVersion: 1, activeWork: null, stage: null, updatedAt: null }));
  const refused = frozen(a, ['knowledge', 'list', work]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Knowledge ledger for PF-AAAAAAAAAA-0001 must use version 1/, 'v0.3.9 refuses; it never misreads');
  assert.notEqual(frozen(a, ['knowledge', 'propose', work, '--kind', 'architecture', '--source', 'implementation-runtime', '--summary', 'x', '--evidence', 'src/server.js']).status, 0);
  assert.equal(await readFile(sharedFile, 'utf8'), bytes, 'the old CLI wrote nothing');
  const { rm } = await import('node:fs/promises');
  await rm(legacyState);
  // The canonical ledger written by integration stays readable by v0.3.9.
  const list = frozen(team.maintainer, ['context', 'list']);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /CTX-0007/);
  // And v0.3.10 reads ledgers the frozen CLI wrote.
  const legacy = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-k0-'));
  await initWorkspace(legacy, 'L', 'greenfield');
  frozen(legacy, ['investigate', 'Q', '--scope', 'bounded']);
  for (let i = 0; i < 6; i += 1) frozen(legacy, ['advance', 'PF-0001']);
  await writeFile(path.join(legacy, 'x.js'), '1;\n');
  assert.equal(frozen(legacy, ['knowledge', 'propose', 'PF-0001', '--kind', 'architecture', '--source', 'implementation-runtime', '--summary', 'Old CLI fact.', '--evidence', 'x.js']).status, 0);
  const oldBytes = await readFile(path.join(workspacePath(legacy), 'work', 'PF-0001', 'knowledge.yaml'), 'utf8');
  assert.match(cli(legacy, ['knowledge', 'list', 'PF-0001']).stdout, /K-001 \[proposed\] architecture/);
  assert.equal(await readFile(path.join(workspacePath(legacy), 'work', 'PF-0001', 'knowledge.yaml'), 'utf8'), oldBytes);
});
