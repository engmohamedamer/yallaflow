// v0.3.7 upgrade intelligence and fresh-agent bootstrap: read-only, deterministic
// aggregation of doctor / agent-contract / project-memory / reconciliation state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { cli, legacyWorkspace, planReconciliation, snapshotWorkspace, yaschoolsWorkspace } from '../test-support/legacy-context.js';

const fixture = (name) => readFile(fileURLToPath(new URL(`./fixtures/agent-contract/${name}`, import.meta.url)), 'utf8');
const git = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

async function gitRepo(root) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
}

async function withAgent(root, content) {
  await writeFile(path.join(workspacePath(root), 'AGENT.md'), content);
}

test('46. upgrade status, upgrade plan, and brief are strictly read-only', async () => {
  const { root } = await yaschoolsWorkspace();
  await withAgent(root, await fixture('v2-managed.md'));
  const before = await snapshotWorkspace(root);
  for (const args of [['upgrade', 'status'], ['upgrade', 'plan'], ['brief'], ['upgrade', '--help'], ['brief', '--help']]) cli(root, args);
  assert.deepEqual(await snapshotWorkspace(root), before);
});

test('47. a v0.3.5 workspace: refresh the unversioned agent guidance, then reconcile legacy context', async () => {
  const { root } = await legacyWorkspace();
  await gitRepo(root);
  await withAgent(root, await fixture('v0.3.5.md'));
  const status = cli(root, ['upgrade', 'status']).stdout;
  assert.match(status, /Installed package: 0\.3\.7-internal\.1/);
  assert.match(status, /Workspace: legacy structures present\n  - unversioned AGENT\.md \(pre-v0\.3\.6 agent guidance\)\n  - v0\.3\.5 append-only project context \(3 item\(s\) not yet reconciled\)/);
  assert.match(status, /Agent contract: predates versioned agent contracts \(unmodified v0\.3\.5 template\)/);
  assert.match(status, /no canonical ledger yet\n  3 legacy fact\(s\) pending reconciliation/);
  assert.match(status, /Recommended next action:\n  yallaflow agent refresh\n/);
  assert.match(status, /Warnings:\n  \.yallaflow exists but is neither tracked by Git nor gitignored/);
  const plan = cli(root, ['upgrade', 'plan']).stdout;
  assert.match(plan, /1\. Refresh the Agent Contract\n   yallaflow agent refresh[\s\S]*2\. Reconcile legacy project context\n   yallaflow context reconcile start[\s\S]*3\. Review Git durability of \.yallaflow[\s\S]*4\. Confirm workspace health\n   yallaflow doctor/);
  assert.doesNotMatch(plan, /upgrade everything|--all/);
});

test('48. a v0.3.6 workspace (v2 contract, one CTX fact, legacy facts pending): refresh → reconcile', async () => {
  const { root } = await yaschoolsWorkspace();
  await withAgent(root, await fixture('v2-managed.md'));
  const status = cli(root, ['upgrade', 'status']).stdout;
  assert.match(status, /  - agent contract v2 \(installed v3\)/);
  assert.match(status, /Agent contract: outdated \(v2 → v3\); run `yallaflow agent refresh`/);
  assert.match(status, /1 canonical current fact\(s\) · 0 disputed · 0 superseded\n  10 legacy fact\(s\) pending reconciliation/);
  assert.match(status, /Work history: 3 item\(s\) · healthy/);
  assert.match(status, /Integrity: doctor healthy/);
  cli(root, ['agent', 'refresh']);
  assert.match(cli(root, ['upgrade', 'status']).stdout, /Recommended next action:\n  yallaflow context reconcile start/);
  await planReconciliation(root, [{ candidate: 'RC-0004', action: 'new' }]);
  const during = cli(root, ['upgrade', 'plan']).stdout;
  assert.match(during, /1\. Continue legacy context reconciliation\n   Human review: yallaflow context reconcile preview PF-0004/);
  assert.match(during, /PF-0004: 1\/10 decided, 0 applied, review awaiting-review/);
});

test('49. a fully current workspace reports no upgrade action', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-current-'));
  await gitRepo(root);
  await initWorkspace(root, 'fresh', 'greenfield');
  await writeFile(path.join(root, '.gitignore'), '.yallaflow\n');
  const status = cli(root, ['upgrade', 'status']).stdout;
  assert.match(status, /Workspace: current structures/);
  assert.match(status, /Agent contract: v3 \/ current/);
  assert.match(status, /Recommended next action:\n  none — the workspace is current/);
  assert.doesNotMatch(status, /Warnings:/);
  assert.match(cli(root, ['upgrade', 'plan']).stdout, /No upgrade actions required\. The workspace is current\./);
});

test('50 + 52. brief is a concise orientation: no context dump, sources surfaced', async () => {
  const { root } = await yaschoolsWorkspace();
  await writeFile(path.join(root, 'request.txt'), 'Add a school calendar export.\n');
  cli(root, ['intake', 'request.txt']);
  const brief = cli(root, ['brief']).stdout;
  const lines = brief.trim().split('\n');
  assert.ok(lines.length <= 16, `brief stays short (${lines.length} lines)`);
  assert.match(brief, /^YallaFlow Brief — legacy \(brownfield\)/);
  assert.match(brief, /Agent contract: v3 current/);
  assert.match(brief, /Project memory: 1 current \(1 fresh\) · 0 disputed · 0 to revalidate/);
  assert.match(brief, /Legacy context: 10 fact\(s\) pending reconciliation/);
  assert.match(brief, /Sources: 1 \(latest SRC-0001\)/);
  assert.doesNotMatch(brief, /Root codeception\.yml enables only the api and apps/, 'never dumps project facts');
  assert.match(brief, /never edit \.yallaflow structured state by hand/);
});

test('51. brief surfaces the active work item and points to resume', async () => {
  const { root } = await yaschoolsWorkspace();
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /Active work: PF-0003 — Investigation work \(CONCLUSION\)/);
  assert.match(brief, /Most recent work: PF-0002 CONCLUSION/);
  assert.match(brief, /Primary next concern: continue PF-0003\nNext: yallaflow resume PF-0003/);
});

test('53. brief and handoff/resume surface reconciliation progress and blockers without dumping candidates', async () => {
  const { root } = await legacyWorkspace({ baseline: [], knowledge: [[
    { kind: 'architecture', summary: 'A.', evidence: ['db.yml'] }, { kind: 'architecture', summary: 'B.', evidence: ['db.yml'] },
    { kind: 'database', summary: 'C.', evidence: ['db.yml'] }, { kind: 'database', summary: 'D.', evidence: ['db.yml'] },
    { kind: 'environment', summary: 'E.', evidence: ['db.yml'] }
  ]] });
  const state = path.join(workspacePath(root), 'state', 'current.yaml');
  await writeFile(state, JSON.stringify({ schemaVersion: 1, activeWork: null, stage: null, updatedAt: 'x' }));
  const rid = await planReconciliation(root, [{ candidate: 'RC-0001', action: 'new' }]);
  cli(root, ['question', 'add', rid, '--category', 'architecture', '--text', 'RC-0002 vs RC-0003: same fact?']);

  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, new RegExp(`Active work: ${rid} — Legacy Context Reconciliation \\(INTAKE\\)`));
  assert.match(brief, new RegExp(`Reconciliation: ${rid} — 1/5 decided, 0 applied, review awaiting-review; blockers: 4 candidate\\(s\\) without a decision; 1 open reconciliation question\\(s\\); review awaiting-review`));
  assert.match(brief, /Primary next concern: reconcile legacy project context/);

  const handoff = cli(root, ['handoff']).stdout;
  assert.match(handoff, /PRIMARY UNRESOLVED OBJECTIVE:\nReconcile legacy project context\./);
  assert.match(handoff, /Progress: 1\/5 decided, 0 applied · 1 new · 0 merged · 0 reconfirming · 0 superseding · 0 disputing · 0 skipped · 0 limitation\(s\) · 4 pending/);
  assert.match(handoff, /- RC-0002 \[architecture\] requires a decision/);
  assert.match(handoff, /- … 1 more \(yallaflow context reconcile status/);
  assert.match(handoff, /- Q-001 open: RC-0002 vs RC-0003: same fact\?/);
  assert.match(handoff, /Blockers: 1 open question\(s\) \(1 material\); review gate\(s\) not approved: reconciliation \(awaiting_review\); 4 candidate\(s\) without a decision/);
  assert.match(handoff, new RegExp(`Next objective:\\nHuman review: yallaflow context reconcile preview ${rid}`));
  assert.doesNotMatch(handoff, /RC-0005 \[environment\]/, 'never lists every candidate');

  const resume = cli(root, ['resume']).stdout;
  assert.match(resume, /PRIMARY UNRESOLVED OBJECTIVE:\nReconcile legacy project context\./);
  assert.match(resume, /Blockers: 4 candidate\(s\) without a decision/);

  // Other work's handoff mentions legacy context once, compactly.
  const other = cli(root, ['handoff', 'PF-0001']).stdout;
  assert.match(other, new RegExp(`Legacy context: reconciliation ${rid} in progress \\(5 legacy item\\(s\\) not yet reconciled; not current truth until applied\\)\\.`));
});

test('brief outside a workspace explains that YallaFlow is not initialized', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-none-'));
  assert.match(cli(root, ['brief']).stdout, /No \.yallaflow workspace in this directory or any parent/);
});
