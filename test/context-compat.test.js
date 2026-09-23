// v0.3.6 compatibility with v0.3.5 workspaces: no migration on read, explicit
// `context adopt` upgrade, and coexistence of legacy sections with the managed block.
import test from 'node:test';
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
import { contextLedgerPath, loadContextLedger } from '../src/context/ledger.js';
import { factFreshness } from '../src/context/freshness.js';
import { exists } from '../src/utils/fs.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

// Byte-for-byte the section templates v0.3.5 appended (src/baseline/store.js
// factSection and src/knowledge/promotion.js contextSection at e15eb97).
function legacyBaselineSection(workId, fact, now) {
  const marker = `<!-- yallaflow-baseline:${workId}:${fact.id} -->`;
  const evidence = fact.evidence.map((entry) => `  - ${entry}`).join('\n');
  return `\n${marker}\n## ${fact.id} — ${fact.summary}\n\n- **Status:** ${fact.status}\n- **Source:** ${fact.source}\n- **From baseline:** ${workId}\n- **Recorded at:** ${now}\n${fact.note ? `- **Note:** ${fact.note}\n` : ''}- **Evidence:**\n${evidence}\n`;
}

function legacyKnowledgeSection(workId, candidate, now) {
  const marker = `<!-- yallaflow-knowledge:${workId}:${candidate.id} -->`;
  const evidence = candidate.evidence.map((entry) => `  - ${entry}`).join('\n');
  return `\n${marker}\n## ${candidate.id} — ${candidate.summary}\n\n- **Source work:** ${workId}\n- **Knowledge ID:** ${candidate.id}\n- **Promoted at:** ${now}\n- **Evidence:**\n${evidence}\n`;
}

// Reproduces the durable state a v0.3.5 workspace has after an approved baseline and
// one promoted knowledge candidate — without any v0.3.6 ledger.
async function legacyWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-compat-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'legacy' }));
  await writeFile(path.join(root, 'db.yml'), 'replica: false\n');
  await initWorkspace(root, 'legacy', 'brownfield');
  const base = workspacePath(root);
  const now = '2026-09-01T10:00:00.000Z';

  const { meta } = await startBaseline(root);
  await checkpointWork(root, meta.id, { skillId: 'repository-baseline', status: 'completed', summary: 'Discovered.', evidence: [] });
  await draftBaseline(root, meta.id, {
    facts: [
      { area: 'database', status: 'confirmed', summary: 'Read replica is configured but inactive.', evidence: ['db.yml'], source: 'repository' },
      { area: 'tech-stack', status: 'confirmed', summary: 'Node.js project.', evidence: ['package.json'], source: 'repository' }
    ]
  });
  const baselineFile = path.join(base, 'work', meta.id, 'baseline.yaml');
  const baseline = await readYaml(baselineFile);
  for (const fact of baseline.facts) {
    const target = { database: 'context/database.md', 'tech-stack': 'context/tech-stack.md' }[fact.area];
    await appendFile(path.join(base, target), legacyBaselineSection(meta.id, fact, now));
  }
  baseline.status = 'approved';
  baseline.approvedAt = now;
  baseline.history.push({ action: 'approved', at: now });
  await writeYaml(baselineFile, baseline);
  const metaFile = path.join(base, 'work', meta.id, 'meta.yaml');
  await writeYaml(metaFile, { ...(await readYaml(metaFile)), status: 'DONE' });
  await writeYaml(path.join(base, 'state', 'current.yaml'), { schemaVersion: 1, activeWork: null, stage: null, updatedAt: now });

  const pending = await createPendingIntake(root, 'Investigate queue');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  await proposeKnowledge(root, pending.id, { kind: 'architecture', source: 'implementation-runtime', summary: 'Jobs run through a DB-backed queue.', evidence: ['db.yml'] });
  const knowledgeFile = knowledgeFilePath(root, pending.id);
  const knowledge = await readYaml(knowledgeFile);
  Object.assign(knowledge.candidates[0], { status: 'promoted', promotedAt: now, target: 'context/architecture.md' });
  Object.assign(knowledge, { reviewStatus: 'reviewed', reviewedAt: now, updatedAt: now });
  await writeYaml(knowledgeFile, knowledge);
  await appendFile(path.join(base, 'context', 'architecture.md'), legacyKnowledgeSection(pending.id, knowledge.candidates[0], now));
  return { root, baselineId: meta.id, workId: pending.id };
}

async function snapshot(root) {
  const base = workspacePath(root);
  const files = ['PROJECT.md', 'context/database.md', 'context/tech-stack.md', 'context/architecture.md'];
  const work = [];
  for (const id of await readdir(path.join(base, 'work'))) {
    for (const name of await readdir(path.join(base, 'work', id))) {
      if (name.endsWith('.yaml') || name.endsWith('.md')) work.push(`work/${id}/${name}`);
    }
  }
  const all = [...files, ...work.sort()];
  return Object.fromEntries(await Promise.all(all.map(async (relative) => [relative, await readFile(path.join(base, relative), 'utf8')])));
}

test('a v0.3.5 workspace is fully readable and never migrated on read', async () => {
  const { root, baselineId, workId } = await legacyWorkspace();
  const before = await snapshot(root);
  for (const args of [['status'], ['resume', workId], ['handoff', workId], ['guide', workId], ['baseline', 'status', baselineId],
    ['baseline', 'show', baselineId], ['knowledge', 'list', workId], ['context', 'status'], ['context', 'list'], ['context', 'adopt', '--dry-run']]) {
    run(root, args);
  }
  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
  assert.match(doctor.stdout, /WARN 3 v0\.3\.5 append-only context section\(s\) are not yet governed/);
  assert.equal(await exists(contextLedgerPath(root)), false);
  assert.deepEqual(await snapshot(root), before);
});

test('context status explains unadopted legacy context without creating anything', async () => {
  const { root } = await legacyWorkspace();
  const status = run(root, ['context', 'status']);
  assert.match(status.stdout, /No canonical project-context ledger yet/);
  assert.match(status.stdout, /3 v0\.3\.5 context section\(s\) are not yet governed by the ledger/);
  const dryRun = run(root, ['context', 'adopt', '--dry-run']);
  assert.match(dryRun.stdout, /Would adopt 3 legacy fact\(s\)/);
  assert.match(dryRun.stdout, /PF-0001 BF-001 \[database\] Read replica is configured but inactive\./);
  assert.match(dryRun.stdout, /PF-0002 K-001 \[architecture\]/);
});

test('a new promotion in an unadopted v0.3.5 workspace creates the ledger lazily and leaves legacy sections intact', async () => {
  const { root } = await legacyWorkspace();
  const legacyDatabase = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  const pending = await createPendingIntake(root, 'Second investigation');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  const { candidate } = await proposeKnowledge(root, pending.id, { kind: 'database', source: 'implementation-runtime', summary: 'Nightly backups run at 02:00.', evidence: ['db.yml'] });
  await promoteKnowledge(root, pending.id, candidate.id);
  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.ok(database.startsWith(legacyDatabase));
  assert.match(database, /CTX-0001 — Nightly backups run at 02:00\./);
  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
});

test('context adopt imports legacy facts, replaces legacy sections, and never touches work records', async () => {
  const { root, baselineId, workId } = await legacyWorkspace();
  const base = workspacePath(root);
  const workFiles = ['baseline.yaml', 'meta.yaml'].map((name) => path.join(base, 'work', baselineId, name)).concat(knowledgeFilePath(root, workId));
  const workBefore = await Promise.all(workFiles.map((file) => readFile(file, 'utf8')));

  const adopt = run(root, ['context', 'adopt']);
  assert.match(adopt.stdout, /Adopted 3 legacy fact\(s\): CTX-0001, CTX-0002, CTX-0003/);
  assert.match(adopt.stdout, /Legacy Markdown sections replaced by the managed projection: 3/);

  const { ledger } = await loadContextLedger(root);
  assert.deepEqual(ledger.facts.map((fact) => [fact.id, fact.origin.workId, fact.origin.baselineFactId ?? fact.origin.candidateId, fact.origin.adopted]), [
    ['CTX-0001', baselineId, 'BF-001', true],
    ['CTX-0002', baselineId, 'BF-002', true],
    ['CTX-0003', workId, 'K-001', true]
  ]);
  assert.equal(ledger.facts[0].history[0].action, 'adopted');
  assert.equal(ledger.facts[0].verifiedAtCommit, null);
  assert.equal(ledger.facts[0].verifiedAt, '2026-09-01T10:00:00.000Z');
  assert.equal((await factFreshness(root, ledger.facts[0])).status, 'unknown');

  const database = await readFile(path.join(base, 'context', 'database.md'), 'utf8');
  assert.doesNotMatch(database, /yallaflow-baseline:/);
  assert.match(database, /CTX-0001 — Read replica is configured but inactive\./);
  assert.match(database, /Adopted from:\*\* v0\.3\.5 context/);
  const techStack = await readFile(path.join(base, 'context', 'tech-stack.md'), 'utf8');
  assert.match(techStack, /Deterministically discovered during YallaFlow bootstrap|# Tech Stack/);

  assert.deepEqual(await Promise.all(workFiles.map((file) => readFile(file, 'utf8'))), workBefore);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.match(run(root, ['context', 'adopt']).stdout, /Nothing to adopt \(3 legacy item\(s\) already adopted\)/);
});

test('adopt leaves a hand-edited legacy section in place and reports it', async () => {
  const { root } = await legacyWorkspace();
  const file = path.join(workspacePath(root), 'context', 'database.md');
  const content = await readFile(file, 'utf8');
  await writeFile(file, content.replace('- **Source:** repository', '- **Source:** repository (checked by hand)\nExtra human paragraph.'));
  const adopt = run(root, ['context', 'adopt']);
  assert.match(adopt.stdout, /Hand-edited legacy sections left in place/);
  assert.match(adopt.stdout, /context\/database\.md: <!-- yallaflow-baseline:PF-0001:BF-001 -->/);
  assert.match(await readFile(file, 'utf8'), /Extra human paragraph\./);
});

test('an adopted legacy fact can then be superseded through normal work', async () => {
  const { root } = await legacyWorkspace();
  run(root, ['context', 'adopt']);
  await writeFile(path.join(root, 'db.yml'), 'replica: true\n');
  const pending = await createPendingIntake(root, 'Replica check');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  for (let i = 0; i < 6; i++) await advanceActiveWork(root, pending.id);
  const { candidate } = await proposeKnowledge(root, pending.id, { kind: 'database', source: 'implementation-runtime', summary: 'Read replica is active for reporting.', evidence: ['db.yml'], supersedes: 'CTX-0001' });
  await promoteKnowledge(root, pending.id, candidate.id);
  const database = await readFile(path.join(workspacePath(root), 'context', 'database.md'), 'utf8');
  assert.doesNotMatch(database, /configured but inactive/);
  assert.match(database, /Read replica is active for reporting\./);
});

test('v0.3.5 knowledge candidates without v0.3.6 fields still validate and list', async () => {
  const { root, workId } = await legacyWorkspace();
  const list = run(root, ['knowledge', 'list', workId]);
  assert.match(list.stdout, /K-001 \[promoted\] architecture/);
});
