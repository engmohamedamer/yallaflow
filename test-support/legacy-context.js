// Test-only helpers for v0.3.5-legacy project context and v0.3.7 reconciliation.
// Reproduces, byte-for-byte, the append-only sections v0.3.5 wrote (baseline
// factSection and knowledge contextSection at e15eb97) and the durable work records
// behind them — never through any v0.3.6+ writer. Lives outside test/ so Node's test
// discovery does not load it as a test module; not part of the published package.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { checkpointWork } from '../src/core/progress.js';
import { draftBaseline, startBaseline } from '../src/baseline/store.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { knowledgeFilePath, proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { CONTEXT_TARGETS } from '../src/knowledge/constants.js';

export const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
export const LEGACY_NOW = '2026-09-01T10:00:00.000Z';

export function cli(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

export function legacyBaselineSection(workId, fact, now) {
  const marker = `<!-- yallaflow-baseline:${workId}:${fact.id} -->`;
  const evidence = fact.evidence.map((entry) => `  - ${entry}`).join('\n');
  return `\n${marker}\n## ${fact.id} — ${fact.summary}\n\n- **Status:** ${fact.status}\n- **Source:** ${fact.source}\n- **From baseline:** ${workId}\n- **Recorded at:** ${now}\n${fact.note ? `- **Note:** ${fact.note}\n` : ''}- **Evidence:**\n${evidence}\n`;
}

export function legacyKnowledgeSection(workId, candidate, now) {
  const marker = `<!-- yallaflow-knowledge:${workId}:${candidate.id} -->`;
  const evidence = candidate.evidence.map((entry) => `  - ${entry}`).join('\n');
  return `\n${marker}\n## ${candidate.id} — ${candidate.summary}\n\n- **Source work:** ${workId}\n- **Knowledge ID:** ${candidate.id}\n- **Promoted at:** ${now}\n- **Evidence:**\n${evidence}\n`;
}

const DEFAULT_BASELINE = [
  { area: 'database', status: 'confirmed', summary: 'Read replica is configured but inactive.', evidence: ['db.yml'], source: 'repository' },
  { area: 'tech-stack', status: 'confirmed', summary: 'Node.js project.', evidence: ['package.json'], source: 'repository' }
];
const DEFAULT_KNOWLEDGE = [[{ kind: 'architecture', summary: 'Jobs run through a DB-backed queue.', evidence: ['db.yml'] }]];

// The durable state a v0.3.5 workspace has after an approved baseline and promoted
// knowledge — with no v0.3.6 ledger. `knowledge` is one array of candidates per
// investigation work item.
export async function legacyWorkspace({ baseline = DEFAULT_BASELINE, knowledge = DEFAULT_KNOWLEDGE, files = { 'package.json': JSON.stringify({ name: 'legacy' }), 'db.yml': 'replica: false\n' } } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-legacy-'));
  for (const [relative, content] of Object.entries(files)) {
    await writeFile(path.join(root, relative), content);
  }
  await initWorkspace(root, 'legacy', 'brownfield');
  const base = workspacePath(root);
  let baselineId = null;
  if (baseline.length) {
    const { meta } = await startBaseline(root);
    baselineId = meta.id;
    await checkpointWork(root, meta.id, { skillId: 'repository-baseline', status: 'completed', summary: 'Discovered.', evidence: [] });
    await draftBaseline(root, meta.id, { facts: baseline });
    const baselineFile = path.join(base, 'work', meta.id, 'baseline.yaml');
    const ledger = await readYaml(baselineFile);
    for (const fact of ledger.facts) await appendFile(path.join(base, CONTEXT_TARGETS[fact.area]), legacyBaselineSection(meta.id, fact, LEGACY_NOW));
    Object.assign(ledger, { status: 'approved', approvedAt: LEGACY_NOW });
    ledger.history.push({ action: 'approved', at: LEGACY_NOW });
    await writeYaml(baselineFile, ledger);
    const metaFile = path.join(base, 'work', meta.id, 'meta.yaml');
    await writeYaml(metaFile, { ...(await readYaml(metaFile)), status: 'DONE' });
    await writeYaml(path.join(base, 'state', 'current.yaml'), { schemaVersion: 1, activeWork: null, stage: null, updatedAt: LEGACY_NOW });
  }
  const workIds = [];
  for (const [index, candidates] of knowledge.entries()) workIds.push(await addLegacyKnowledge(root, candidates, `Legacy investigation ${index + 1}`));
  return { root, baselineId, workIds, workId: workIds[0] ?? null };
}

// One investigation whose knowledge candidates were promoted the v0.3.5 way (append-only
// Markdown sections, no CTX fact) — usable on any workspace, including the v0.3.6 fixture.
export async function addLegacyKnowledge(root, candidates, title = 'Legacy investigation') {
  const base = workspacePath(root);
  const pending = await createPendingIntake(root, title);
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  for (const candidate of candidates) await proposeKnowledge(root, pending.id, { source: 'implementation-runtime', ...candidate });
  const file = knowledgeFilePath(root, pending.id);
  const ledger = await readYaml(file);
  for (const candidate of ledger.candidates) {
    Object.assign(candidate, { status: 'promoted', promotedAt: LEGACY_NOW, target: CONTEXT_TARGETS[candidate.kind] });
    await appendFile(path.join(base, CONTEXT_TARGETS[candidate.kind]), legacyKnowledgeSection(pending.id, candidate, LEGACY_NOW));
  }
  Object.assign(ledger, { reviewStatus: 'reviewed', reviewedAt: LEGACY_NOW, updatedAt: LEGACY_NOW });
  await writeYaml(file, ledger);
  return pending.id;
}

// A v0.3.6-native CTX fact produced by ordinary work (the "CTX-0001 already exists"
// situation of an upgraded workspace).
export async function promoteCurrentFact(root, input) {
  const pending = await createPendingIntake(root, `Current work: ${input.summary}`);
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  const { candidate } = await proposeKnowledge(root, pending.id, { source: 'implementation-runtime', ...input });
  await promoteKnowledge(root, pending.id, candidate.id);
  return pending.id;
}

export async function writeDecisions(root, decisions, name = 'decisions.json') {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify({ decisions }, null, 2));
  return file;
}

// Agent side of a reconciliation: start (idempotent), record decisions, checkpoint.
export async function planReconciliation(root, decisions) {
  cli(root, ['context', 'reconcile', 'start']);
  const workId = (await readdir(path.join(workspacePath(root), 'work'))).sort().at(-1);
  cli(root, ['context', 'reconcile', 'plan', workId, '--file', await writeDecisions(root, decisions)]);
  cli(root, ['checkpoint', workId, '--skill', 'context-reconciliation', '--complete', '--summary', 'Every candidate related explicitly.']);
  return workId;
}

// Full flow: plan → human approval → apply.
export async function reconcile(root, decisions) {
  const workId = await planReconciliation(root, decisions);
  cli(root, ['context', 'reconcile', 'approve', workId, '--note', 'Reviewed.']);
  cli(root, ['context', 'reconcile', 'apply', workId]);
  return workId;
}

export async function snapshotWorkspace(root) {
  const base = workspacePath(root);
  const result = {};
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else result[path.relative(base, absolute)] = await readFile(absolute, 'utf8');
    }
  };
  await walk(base);
  return result;
}

// A YaSchools-shaped upgraded workspace (the v0.3.5 → v0.3.6 pilot finding): a
// v0.3.5 baseline (PF-0001) and a v0.3.5 investigation (PF-0002) whose promoted
// knowledge overlaps the baseline, then — after the v0.3.6 upgrade — one canonical
// CTX fact from new work (PF-0003). Candidate order (stable RC IDs):
//   RC-0001 PF-0001 BF-001  convention   root Codeception suites (duplicate of RC-0006, same truth as CTX-0001)
//   RC-0002 PF-0001 BF-002  environment  Azure pipeline runs no tests (refined by RC-0005)
//   RC-0003 PF-0001 BF-003  tech-stack   lockfile not inspected (really a discovery limitation)
//   RC-0004 PF-0001 BF-004  architecture Yii2 advanced template (unique)
//   RC-0005 PF-0002 K-001   environment  Azure production pipeline never ran Codeception (refinement)
//   RC-0006 PF-0002 K-002   convention   root codeception.yml suites (semantic duplicate of RC-0001)
//   RC-0007 PF-0002 K-003   database     MySQL 5.7 (superseded by RC-0008)
//   RC-0008 PF-0002 K-004   database     MySQL 8.0 upgrade (supersedes RC-0007)
//   RC-0009 PF-0002 K-005   business-rule tenant resolution by subdomain (ambiguous vs RC-0010)
//   RC-0010 PF-0002 K-006   business-rule tenant resolution by header (ambiguous vs RC-0009)
export const YASCHOOLS_FILES = {
  'codeception.yml': 'include:\n  - tests/api\n  - tests/apps\n#  - common\n#  - console\n#  - backend\n#  - frontend\n',
  'azure-pipelines.yml': 'trigger: [main]\nsteps:\n  - script: composer install\n',
  'composer.json': JSON.stringify({ name: 'yaschools/app', require: { 'yiisoft/yii2': '~2.0' } }),
  'docker-compose.yml': 'services:\n  db:\n    image: mysql:8.0\n',
  'tenant.php': '<?php // resolves the current school\n'
};

export async function yaschoolsWorkspace({ currentFact = true } = {}) {
  const workspace = await legacyWorkspace({
    files: YASCHOOLS_FILES,
    baseline: [
      { area: 'convention', status: 'confirmed', summary: 'Root Codeception configuration enables only tests/api and tests/apps; other suites are commented out.', evidence: ['codeception.yml'], source: 'repository' },
      { area: 'environment', status: 'confirmed', summary: 'Azure pipeline does not execute automated tests.', evidence: ['azure-pipelines.yml'], source: 'repository' },
      { area: 'tech-stack', status: 'unresolved', summary: 'Composer lockfile versions were not inspected.', evidence: ['composer.json'], source: 'repository' },
      { area: 'architecture', status: 'confirmed', summary: 'The application uses the Yii2 advanced template (common, console, backend, frontend, api, apps).', evidence: ['composer.json'], source: 'repository' }
    ],
    knowledge: [[
      { kind: 'environment', summary: 'The Azure production pipeline has never executed Codeception tests: it installs dependencies and deploys, with no test step or test artifacts.', evidence: ['azure-pipelines.yml'] },
      { kind: 'convention', summary: 'Root codeception.yml enables only tests/api and tests/apps; common/console/backend/frontend are commented out.', evidence: ['codeception.yml'] },
      { kind: 'database', summary: 'Production database is MySQL 5.7.', evidence: ['docker-compose.yml'] },
      { kind: 'database', summary: 'Production database was upgraded to MySQL 8.0.', evidence: ['docker-compose.yml'] },
      { kind: 'business-rule', summary: 'The current school is resolved from the request subdomain.', evidence: ['tenant.php'] },
      { kind: 'business-rule', summary: 'The current school is resolved from the X-School request header.', evidence: ['tenant.php'] }
    ]]
  });
  if (currentFact) {
    workspace.currentWorkId = await promoteCurrentFact(workspace.root, { kind: 'convention', summary: 'Root codeception.yml enables only the api and apps Codeception suites.', evidence: ['codeception.yml'] });
  }
  return workspace;
}
