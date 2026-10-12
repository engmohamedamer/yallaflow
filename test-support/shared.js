// Shared Project (v0.3.10) test fixtures: a bare "origin", a maintainer checkout with an
// approved Brownfield baseline and Shared Project Mode enabled, and developer clones
// with deterministic clone tags. Lives outside test/ because node --test loads every
// file under test/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startBaseline, draftBaseline, approveBaseline } from '../src/baseline/store.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { writeLocalIdentity } from '../src/shared/identity.js';

export const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

export function git(root, args, { ok = true } = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (ok) assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

export function cli(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `yallaflow ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

// A small three-area application: two backend areas and one frontend area.
export async function writeTeamApp(root) {
  const files = {
    'package.json': JSON.stringify({ name: 'invoicing', version: '1.0.0', dependencies: { express: '^4.19.0', react: '^18.2.0' } }, null, 2),
    'backend/refunds/refunds.js': 'export function refund(order) { return { ...order, status: "refunded" }; }\n',
    'backend/refunds/policy.js': 'export const REFUND_WINDOW_DAYS = 30;\n',
    'backend/invoices/totals.js': 'export function total(lines) { return lines.reduce((sum, line) => sum + line.amount, 0); }\n',
    'backend/invoices/tax.js': 'export const TAX_RATE = 0.15;\n',
    'frontend/ui/InvoiceView.jsx': 'export function InvoiceView({ invoice }) { return invoice.total; }\n',
    'frontend/ui/theme.css': 'body { font-family: sans-serif; }\n',
    'src/server.js': 'import express from "express";\nexport const app = express();\n',
    'src/routes.js': 'export const routes = ["/invoices", "/refunds"];\n',
    'src/db.js': 'export const db = { driver: "postgres" };\n',
    'src/auth.js': 'export const roles = ["admin", "clerk"];\n',
    'src/a.js': '1;\n', 'src/b.js': '2;\n', 'src/c.js': '3;\n', 'src/d.js': '4;\n'
  };
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
}

export const BASELINE_FACTS = [
  { area: 'project', status: 'confirmed', summary: 'Invoicing system for issuing invoices and refunds.', evidence: ['package.json'], source: 'repository' },
  { area: 'tech-stack', status: 'confirmed', summary: 'Backend is Express on Node.js; frontend is React 18.', evidence: ['package.json'], source: 'repository' },
  { area: 'architecture', status: 'confirmed', summary: 'Refunds live in backend/refunds and invoices in backend/invoices.', evidence: ['backend/refunds/refunds.js', 'backend/invoices/totals.js'], source: 'repository' },
  { area: 'business-rule', status: 'confirmed', summary: 'Refunds are allowed within 30 days.', evidence: ['backend/refunds/policy.js'], source: 'repository' },
  { area: 'business-rule', status: 'confirmed', summary: 'Invoice totals are the sum of line amounts.', evidence: ['backend/invoices/totals.js'], source: 'repository' },
  { area: 'convention', status: 'inferred', summary: 'UI components are function components in frontend/ui.', evidence: ['frontend/ui/InvoiceView.jsx'], source: 'repository' }
];

// Approves a Brownfield baseline (single-user, before sharing).
export async function approveTeamBaseline(root) {
  const { meta } = await startBaseline(root);
  cli(root, ['checkpoint', meta.id, '--skill', 'repository-baseline', '--complete', '--summary', 'Repository discovery complete.']);
  await draftBaseline(root, meta.id, { facts: BASELINE_FACTS });
  await approveBaseline(root, meta.id, 'Approved by the maintainer.');
  return meta.id;
}

function configureUser(root, name) {
  git(root, ['config', 'user.name', name]);
  git(root, ['config', 'user.email', `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`]);
}

// origin (bare) + maintainer checkout on main with an approved baseline, Claude
// adapter, and Shared Project Mode enabled and pushed.
export async function sharedTeam({ baseline = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-team-'));
  const origin = path.join(dir, 'origin.git');
  git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  const maintainer = path.join(dir, 'maintainer');
  git(dir, ['clone', '-q', origin, maintainer], { ok: false });
  git(maintainer, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  configureUser(maintainer, 'Maintainer');
  await writeTeamApp(maintainer);
  git(maintainer, ['add', '-A']);
  git(maintainer, ['commit', '-qm', 'app']);
  await initWorkspace(maintainer, 'Invoicing', 'brownfield');
  if (baseline) await approveTeamBaseline(maintainer);
  cli(maintainer, ['agent', 'setup', 'claude']);
  git(maintainer, ['add', '-A']);
  git(maintainer, ['commit', '-qm', 'yallaflow baseline']);
  cli(maintainer, ['shared', 'enable', '--integration-branch', 'main']);
  await writeLocalIdentity(maintainer, 'MMMMMMMMMM');
  git(maintainer, ['add', '-A']);
  git(maintainer, ['commit', '-qm', 'yallaflow shared']);
  git(maintainer, ['push', '-q', '-u', 'origin', 'main']);
  return { dir, origin, maintainer };
}

export async function developer(team, name, tag, branch = null) {
  const root = path.join(team.dir, name.toLowerCase().replace(/\s+/g, '-'));
  git(team.dir, ['clone', '-q', team.origin, root]);
  configureUser(root, name);
  await writeLocalIdentity(root, tag);
  if (branch) git(root, ['checkout', '-q', '-b', branch]);
  return root;
}

// An investigation parked at CONCLUSION: knowledge review is allowed there without
// verification evidence, keeping each scenario about shared memory.
export async function investigation(root, title) {
  const pending = await createPendingIntake(root, title);
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only question.', title });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  return pending.id;
}

export async function learn(root, workId, input) {
  const { candidate } = await proposeKnowledge(root, workId, { source: 'implementation-runtime', ...input });
  return promoteKnowledge(root, workId, candidate.id);
}

export function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
}

// "PR merge": the maintainer merges a pushed branch into main (no fast-forward).
export function mergeBranch(maintainer, branch) {
  git(maintainer, ['fetch', '-q', 'origin']);
  return git(maintainer, ['merge', '--no-ff', '-q', '-m', `Merge ${branch}`, `origin/${branch}`], { ok: false });
}

// CONCLUSION → DONE once knowledge review is complete: recorded proof, the
// verification checkpoint, then the final transition.
export async function complete(root, workId) {
  cli(root, ['verify', workId, '--', process.execPath, '-e', 'process.exit(0)']);
  cli(root, ['checkpoint', workId, '--skill', 'verification', '--complete', '--summary', 'Findings reproduced.']);
  return advanceActiveWork(root, workId);
}

// The real frozen v0.3.9 CLI, extracted from its Git tag (node_modules linked), or null
// when the tag is not available (e.g. a source tarball without Git history).
let frozenCache;
export async function frozenCli(tag = 'v0.3.9-internal.1') {
  if (frozenCache !== undefined) return frozenCache;
  const repo = fileURLToPath(new URL('../', import.meta.url));
  if (spawnSync('git', ['rev-parse', '--verify', '-q', `${tag}^{commit}`], { cwd: repo }).status !== 0) return (frozenCache = null);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-frozen-'));
  const archive = spawnSync('bash', ['-c', `git archive ${tag} | tar -x -C "${dir}"`], { cwd: repo });
  if (archive.status !== 0) return (frozenCache = null);
  const { symlink } = await import('node:fs/promises');
  await symlink(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
  frozenCache = (root, args) => spawnSync(process.execPath, [path.join(dir, 'src', 'cli.js'), ...args], { cwd: root, encoding: 'utf8' });
  return frozenCache;
}
