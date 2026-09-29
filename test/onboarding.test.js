// v0.3.9 Frictionless Project Onboarding & Context UX: `yallaflow inspect`, Brownfield
// onboarding through the existing baseline lifecycle, the project-first brief with
// mechanical NEEDS CARE, contextual non-Git freshness, and v0.3.8 read compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { proposeKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import { renderAgentContractBlock, agentContractBody } from '../src/agent/contract.js';
import { BRIEF_MAX_LINES } from '../src/commands/brief.js';
import { oneLine } from '../src/context/summary.js';
import { apdFixture } from '../test-support/apd-fixture.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `yallaflow ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

async function treeHash(root) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      hash.update(path.relative(root, full));
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) hash.update(await readFile(full));
    }
  }
  await walk(root);
  return hash.digest('hex');
}

async function jsonFile(dir, name, value) {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

test('AC-007/AC-008: inspect on an APD-shaped repository without a workspace — text only, zero bytes, next: init', async () => {
  const root = await apdFixture();
  const before = await treeHash(root);
  const out = run(root, ['inspect']).stdout;
  assert.equal(await treeHash(root), before, 'inspect writes nothing');
  assert.match(out, /^YallaFlow Inspect — yallaflow-apd-/);
  assert.match(out, /Classification: brownfield\n {2}- 8 recognized manifest\(s\) with 9 recognized source file\(s\)/);
  assert.match(out, /Git: no \.git at the inspected root/);
  assert.match(out, /Workspace: not initialized/);
  assert.match(out, /frontend-beneficiary\/package\.json — Angular 16 \(@angular\/core \^16\.2\.12\)/);
  assert.match(out, /frontend-corporate\/package\.json — Angular 8 \(@angular\/core \^8\.0\.3\)/);
  assert.match(out, /backend\/shared-services\/pom\.xml — Spring Boot 2 \(spring-boot-starter-parent 2\.1\.3\.RELEASE\)/);
  assert.match(out, /backend\/corporate\/pom\.xml — Spring Boot 2 \(spring-boot-dependencies 2\.7\.2\)/);
  assert.match(out, /backend\/beneficiary\/pom\.xml — Spring Boot \(version not declared in this manifest\)/);
  assert.match(out, /Source files: 9 recognized — \.ts 5 · \.java 4/);
  assert.match(out, /Documentation candidates \(5\) — listed, never read/);
  assert.match(out, /docs\/APD_LLD\.pdf — pdf, text extraction on intake/);
  assert.match(out, /docs\/context-diagram\.odg — odg, preserve-only, no text extraction/);
  assert.match(out, /Container\/CI configuration \(2, 2 meaningful\)/);
  assert.match(out, /\nNext: yallaflow init\n {2}this repository would be initialized as brownfield/);
  assert.doesNotMatch(out, /microservice/i);
  assert.ok(!out.includes(root), 'no absolute machine paths in output');
  assert.deepEqual(await readdir(root).then((names) => names.includes('.yallaflow')), false);
});

test('AC-007: inspect exposes no --json (text only) and its help is non-mutating', async () => {
  const root = await apdFixture();
  const before = await treeHash(root);
  const json = run(root, ['inspect', '--json'], false);
  assert.equal(json.status, 1);
  assert.match(json.stderr, /Usage: yallaflow inspect|Unknown option/);
  const help = run(root, ['inspect', '--help']);
  assert.match(help.stdout, /yallaflow inspect/);
  assert.equal(await treeHash(root), before);
});

// ---------------------------------------------------------------------------
// init classification and tech-stack snapshot
// ---------------------------------------------------------------------------

test('AC-006: init classifies an APD-shaped tree as brownfield and writes a labelled init-time snapshot of nested hints', async () => {
  const root = await apdFixture();
  const init = run(root, ['init']).stdout;
  assert.match(init, /Project kind: brownfield \(8 recognized manifest\(s\) with 9 recognized source file\(s\)\)/);
  assert.match(init, /Next: run `yallaflow inspect` .* then `yallaflow baseline start`/);
  const techStack = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.match(techStack, /## Nested manifest framework hints\n\n> Init-time deterministic bootstrap snapshot of manifest declarations — NOT approved project memory\./);
  assert.match(techStack, /- Angular 16 \(@angular\/core \^16\.2\.12\) — frontend-beneficiary\/package\.json/);
  assert.match(techStack, /- Angular 8 \(@angular\/core \^8\.0\.3\) — frontend-corporate\/package\.json/);
  assert.match(techStack, /- Spring Boot 2 \(spring-boot-starter-parent 2\.1\.3\.RELEASE\) — backend\/shared-services\/pom\.xml/);
  assert.match(techStack, /## Detected stack\n\n- No framework marker detected yet\./, 'root-level lines unchanged (no root manifest)');
});

test('AC-005/AC-006: init boundaries — bare git and npm-init are greenfield, --type still overrides', async () => {
  const bare = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-bare-git-'));
  git(bare, ['init', '-q']);
  assert.match(run(bare, ['init']).stdout, /Project kind: greenfield \(0 recognized source file\(s\) \(< 10\)\)/);

  const npm = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-npm-init-'));
  await writeFile(path.join(npm, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
  assert.match(run(npm, ['init']).stdout, /Project kind: greenfield \(1 recognized manifest\(s\) but no recognized source file/);
  assert.equal(await readFile(path.join(workspacePath(npm), 'context', 'tech-stack.md'), 'utf8'), '# Tech Stack\n\n', 'greenfield init writes no discovery');

  const forced = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-forced-'));
  assert.match(run(forced, ['init', '--type', 'brownfield']).stdout, /Project kind: brownfield \(explicit --type\)/);
});

// ---------------------------------------------------------------------------
// Onboarding dogfood: init → inspect → baseline → documents → checkpoint → draft → human approval
// ---------------------------------------------------------------------------

test('AC-009/AC-011: APD-shaped onboarding through the existing baseline lifecycle ends at human approval', async () => {
  const root = await apdFixture();
  run(root, ['init']);
  let brief = run(root, ['brief']).stdout;
  assert.match(brief, /Project memory: no canonical ledger yet\nRepository: brownfield by inventory — 8 manifest\(s\), 9 recognized source file\(s\), 5 documentation candidate\(s\) \(details: yallaflow inspect\)/);
  assert.match(brief, /Primary next concern: no project memory yet — establish an evidence-backed Brownfield baseline .*\nNext: yallaflow baseline start/);
  assert.match(run(root, ['inspect']).stdout, /\nNext: yallaflow baseline start\n/);

  const start = run(root, ['baseline', 'start']).stdout;
  assert.match(start, /PF-0001 — Repository Baseline started \(read-only: no application code changes\)/);
  assert.match(start, /yallaflow intake add PF-0001 <document>/);
  assert.match(start, /A human then reviews \(yallaflow baseline show PF-0001\) and approves/);
  brief = run(root, ['brief']).stdout;
  assert.match(brief, /Baseline: baseline PF-0001 in progress — complete repository discovery/);
  assert.match(brief, /Next: yallaflow checkpoint PF-0001 --skill repository-baseline --complete/);
  assert.match(run(root, ['inspect']).stdout, /Next: yallaflow checkpoint PF-0001 --skill repository-baseline --complete/);

  // Material documentation becomes a registered source the Agent can read back.
  const intake = run(root, ['intake', 'add', 'PF-0001', 'docs/architecture-overview.md']).stdout;
  assert.match(intake, /SRC-0001/);
  assert.match(run(root, ['source', 'show', 'SRC-0001', '--content']).stdout, /Two Angular portals call Spring Boot services/);

  run(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Inventory, manifests, and the architecture overview reviewed.']);
  assert.match(run(root, ['baseline', 'status']).stdout, /Next: yallaflow baseline draft PF-0001 --file <baseline\.json>/);
  const draftFile = await jsonFile(os.tmpdir(), `apd-baseline-${path.basename(root)}.json`, {
    facts: [
      { area: 'project', status: 'confirmed', summary: 'APD consists of two Angular portals (beneficiary, corporate) and Spring Boot backend modules.', evidence: ['frontend-beneficiary/package.json', 'frontend-corporate/package.json', 'backend/shared-services/pom.xml'], source: 'repository' },
      { area: 'tech-stack', status: 'confirmed', summary: 'The beneficiary portal declares Angular ^16.2.12; the corporate portal declares Angular ^8.0.3.', evidence: ['frontend-beneficiary/package.json', 'frontend-corporate/package.json'], source: 'repository' },
      { area: 'architecture', status: 'inferred', summary: 'Portals call backend services through a gateway, per the architecture overview.', evidence: ['docs/architecture-overview.md'], source: 'repository' },
      { area: 'environment', status: 'confirmed', summary: 'docker/docker-compose.yml declares the shared-services container build.', evidence: ['docker/docker-compose.yml'], source: 'repository' }
    ],
    limitations: [{ type: 'not-inspected', area: 'architecture', summary: 'docs/APD_LLD.pdf was not read in this session.', reason: 'Fixture bytes are not a real PDF.' }]
  });
  const draft = run(root, ['baseline', 'draft', 'PF-0001', '--file', draftFile]).stdout;
  assert.match(draft, /a human reviews the draft .* The Agent never approves a baseline\./);
  brief = run(root, ['brief']).stdout;
  assert.match(brief, /Baseline: baseline PF-0001 draft \(4 fact\(s\)\) awaits human review — a human approves it; the Agent never does/);
  assert.match(brief, /Next: yallaflow baseline show PF-0001 {3}\(then, by a human: yallaflow baseline approve PF-0001/);
  assert.match(run(root, ['baseline', 'status']).stdout, /Baseline status: draft/, 'nothing approves automatically');
  assert.match(run(root, ['context', 'status']).stdout, /No canonical project-context ledger yet/, 'an unapproved draft is not project memory');

  // The human approves; the brief now explains the project from memory.
  run(root, ['baseline', 'approve', 'PF-0001']);
  brief = run(root, ['brief']).stdout;
  assert.match(brief, /Project memory: 4 current \(4 fresh\) · 0 disputed · 0 to revalidate/);
  assert.match(brief, /Project \(1\):\n {2}- CTX-0001 APD consists of two Angular portals/);
  assert.match(brief, /Tech Stack \(1\):\n {2}- CTX-0002 The beneficiary portal declares Angular \^16\.2\.12/);
  assert.match(brief, /NEEDS CARE: none/);
  assert.match(run(root, ['inspect']).stdout, /Next: yallaflow brief\n {2}project memory exists/);
  assert.equal(run(root, ['doctor']).status, 0);
});

// ---------------------------------------------------------------------------
// Project-first brief with a large baseline
// ---------------------------------------------------------------------------

const LONG = `${'Ünïcödé-aware summary '.repeat(12)}end`;

async function largeBaselineWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-large-baseline-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  for (let index = 0; index < 12; index++) await writeFile(path.join(root, 'src', `m${index}.js`), `export const m${index} = ${index};\n`);
  await initWorkspace(root, 'large', 'brownfield');
  const areas = [['project', 5], ['tech-stack', 6], ['architecture', 7], ['database', 5], ['integration', 4], ['environment', 4], ['convention', 5], ['business-rule', 4]];
  const facts = [];
  let n = 0;
  for (const [area, count] of areas) {
    for (let index = 0; index < count; index++) {
      const file = `src/m${n % 12}.js`;
      facts.push({ area, status: n === 3 ? 'unresolved' : 'confirmed', summary: `${area} fact ${index + 1}${n === 0 ? ` ${LONG}` : ''}${n === 1 ? ' spans\n  two lines\tand tabs' : ''}`, evidence: [n === 9 ? 'src/gone.js' : file], source: 'repository' });
      n += 1;
    }
  }
  await writeFile(path.join(root, 'src', 'gone.js'), 'export {};\n');
  run(root, ['baseline', 'start']);
  run(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Large baseline fixture.']);
  const file = await jsonFile(root, 'baseline.json', { facts });
  run(root, ['baseline', 'draft', 'PF-0001', '--file', file]);
  run(root, ['baseline', 'approve', 'PF-0001']);
  await rm(file);
  // Evidence drift: one file changes (MAY_BE_STALE for every fact citing it), one disappears (STALE_EVIDENCE).
  await writeFile(path.join(root, 'src', 'm5.js'), 'export const m5 = "changed";\n');
  await rm(path.join(root, 'src', 'gone.js'));
  // One fact disputed through ordinary knowledge work.
  const pending = await createPendingIntake(root, 'Investigate integrations');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only question.' });
  for (let index = 0; index < 6; index++) await advanceActiveWork(root, pending.id);
  const { candidate } = await proposeKnowledge(root, pending.id, { source: 'implementation-runtime', kind: 'integration', summary: 'Runtime shows a different gateway.', evidence: ['runtime:gateway responded from host B'], disputes: 'CTX-0026' });
  await promoteKnowledge(root, pending.id, candidate.id);
  await writeFile(path.join(workspacePath(root), 'state', 'current.yaml'), JSON.stringify({ schemaVersion: 1, activeWork: null, stage: null, updatedAt: 'x' }));
  return root;
}

test('AC-012/AC-013: the project-first brief explains the project with fixed per-area caps and a bounded, mechanical NEEDS CARE', async () => {
  const root = await largeBaselineWorkspace();
  const before = await treeHash(root);
  const brief = run(root, ['brief']).stdout;
  assert.equal(await treeHash(root), before, 'brief is strictly read-only');
  const lines = brief.trimEnd().split('\n');
  assert.ok(lines.length <= BRIEF_MAX_LINES, `hard cap: ${lines.length} ≤ ${BRIEF_MAX_LINES}`);

  // Fixed order and caps; fact-ID order within an area.
  const order = ['Project memory:', 'Project (5, showing 3):', 'Tech Stack (6, showing 3):', 'Architecture (7, showing 3):', 'Database (5, showing 2):',
    'Integrations (3, showing 2):', 'Environments (4, showing 2):', 'Conventions (5):', 'Business Rules (4):', 'NEEDS CARE (', 'Active work:', 'Package:', 'Primary next concern:'];
  let cursor = -1;
  for (const marker of order) {
    const at = brief.indexOf(marker);
    assert.ok(at > cursor, `${marker} appears in order`);
    cursor = at;
  }
  const projectBlock = brief.slice(brief.indexOf('Project (5'), brief.indexOf('Tech Stack ('));
  assert.deepEqual(projectBlock.match(/CTX-\d{4}/g), ['CTX-0001', 'CTX-0002', 'CTX-0003']);
  assert.match(brief, /Conventions \(5\): CTX-0032 convention fact 1 \(\+4 more\)/);
  assert.match(brief, /Business Rules \(4\): CTX-0037 business-rule fact 1 \(\+3 more\)/);

  // One-line rendering: whitespace normalized, 160 code points with an ellipsis only when truncated.
  assert.match(brief, /- CTX-0002 project fact 2 spans two lines and tabs\n/);
  const long = /- CTX-0001 \[needs care\] (.*)\n/.exec(brief)?.[1] ?? /- CTX-0001 (.*)\n/.exec(brief)[1];
  assert.equal(Array.from(long).length, 160);
  assert.ok(long.endsWith('…'));
  assert.match(brief, /- CTX-0003 project fact 3\n/, 'short summaries are unmodified');

  // NEEDS CARE: exactly unresolved, disputed, MAY_BE_STALE, STALE_EVIDENCE — at most 5 shown.
  assert.match(brief, /NEEDS CARE \(6, showing 5; all: yallaflow context status\) — recorded state or evidence freshness mechanically needs attention; not a risk assessment:/);
  const care = brief.slice(brief.indexOf('NEEDS CARE ('), brief.indexOf('Active work:'));
  assert.match(care, /CTX-0004 \[project\] UNRESOLVED — project fact 4/);
  assert.match(care, /CTX-0006 \[tech-stack\] MAY_BE_STALE \(src\/m5\.js changed\)/);
  assert.match(care, /CTX-0010 \[tech-stack\] STALE_EVIDENCE \(src\/gone\.js missing\)/);
  assert.match(care, /CTX-0018 \[architecture\] MAY_BE_STALE/);
  assert.match(care, /CTX-0026 \[integration\] DISPUTED — integration fact 3/);
  assert.doesNotMatch(care, /CTX-0030/, 'sixth entry is behind the cap');
  assert.doesNotMatch(care, /risk:|HIGH|CRITICAL/);
  // The disputed fact is no longer "current": it leaves its area sample and appears only under NEEDS CARE.
  assert.doesNotMatch(brief.slice(brief.indexOf('Integrations ('), brief.indexOf('Environments (')), /CTX-0026/);
  assert.match(run(root, ['context', 'status']).stdout, /CTX-0030 \[environment\] MAY_BE_STALE/);
  // The area entry carries the mechanical marker too.
  assert.match(brief, /- CTX-0004 \[needs care\] project fact 4|Project \(5, showing 3\)/);
  assert.match(brief, /- CTX-0006 \[needs care\] tech-stack fact 1/);
});

test('oneLine: code-point truncation, whitespace normalization, short text untouched', () => {
  assert.equal(oneLine('short'), 'short');
  assert.equal(oneLine('a\n  b\tc'), 'a b c');
  const emoji = '😀'.repeat(200);
  const cut = oneLine(emoji);
  assert.equal(Array.from(cut).length, 160);
  assert.ok(cut.endsWith('…'));
  assert.equal(oneLine('x'.repeat(160)), 'x'.repeat(160), 'exactly 160 code points is not truncated');
});

// ---------------------------------------------------------------------------
// Fresh session / context reuse
// ---------------------------------------------------------------------------

test('fresh-session context reuse: a new session learns the project from brief, and changed evidence surfaces as NEEDS CARE', async () => {
  const root = await apdFixture();
  run(root, ['init']);
  run(root, ['baseline', 'start']);
  run(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Reviewed.']);
  const file = await jsonFile(os.tmpdir(), `apd-fresh-${path.basename(root)}.json`, { facts: [
    { area: 'tech-stack', status: 'confirmed', summary: 'The corporate portal declares Angular ^8.0.3.', evidence: ['frontend-corporate/package.json'], source: 'repository' },
    { area: 'environment', status: 'confirmed', summary: 'docker/docker-compose.yml declares the shared-services build.', evidence: ['docker/docker-compose.yml'], source: 'repository' }
  ] });
  run(root, ['baseline', 'draft', 'PF-0001', '--file', file]);
  run(root, ['baseline', 'approve', 'PF-0001']);

  // "New session": nothing but the repository and the workspace.
  const brief = run(root, ['brief']).stdout;
  assert.match(brief, /Tech Stack \(1\):\n {2}- CTX-0001 The corporate portal declares Angular \^8\.0\.3\./);
  assert.match(brief, /Primary next concern: none — ready for new work/);

  // The corporate portal is upgraded: the fact is mechanically flagged, not rewritten.
  await writeFile(path.join(root, 'frontend-corporate', 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '^17.0.0' } }));
  const after = run(root, ['brief']).stdout;
  assert.match(after, /- CTX-0001 \[needs care\] The corporate portal declares Angular \^8\.0\.3\./);
  assert.match(after, /NEEDS CARE \(1\) — .*\n {2}- CTX-0001 \[tech-stack\] MAY_BE_STALE \(frontend-corporate\/package\.json changed\)/);
  assert.match(after, /Primary next concern: 1 project fact\(s\) may be stale or disputed\nNext: yallaflow context status/);
  assert.match(run(root, ['inspect']).stdout, /frontend-corporate\/package\.json — Angular 17/);
});

// ---------------------------------------------------------------------------
// Contextual non-Git freshness (AC-014)
// ---------------------------------------------------------------------------

async function memoryWorkspace(withGit) {
  const root = await mkdtemp(path.join(os.tmpdir(), `yallaflow-fresh-${withGit ? 'git' : 'nogit'}-`));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config', 'db.yml'), 'driver: pg\n');
  await writeFile(path.join(root, 'config', 'cache.yml'), 'driver: redis\n');
  if (withGit) {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 't@example.com']);
    git(root, ['config', 'user.name', 'T']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
  }
  await initWorkspace(root, 'fresh', 'brownfield');
  run(root, ['baseline', 'start']);
  run(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'x']);
  const file = await jsonFile(os.tmpdir(), `fresh-${path.basename(root)}.json`, { facts: [
    { area: 'database', status: 'confirmed', summary: 'PostgreSQL is configured.', evidence: ['config/db.yml'], source: 'repository' },
    { area: 'environment', status: 'confirmed', summary: 'Configuration lives under config/.', evidence: ['config'], source: 'repository' },
    { area: 'integration', status: 'confirmed', summary: 'Redis is the cache.', evidence: ['config/cache.yml'], source: 'repository' }
  ] });
  run(root, ['baseline', 'draft', 'PF-0001', '--file', file]);
  run(root, ['baseline', 'approve', 'PF-0001']);
  return root;
}

test('AC-014: without Git, context status explains hash freshness; changed files MAY_BE_STALE, missing STALE_EVIDENCE, directories UNKNOWN', async () => {
  const root = await memoryWorkspace(false);
  await writeFile(path.join(root, 'config', 'db.yml'), 'driver: mysql\n');
  await rm(path.join(root, 'config', 'cache.yml'));
  const out = run(root, ['context', 'status']).stdout;
  assert.match(out, /Freshness: 0 fresh · 1 may be stale · 1 stale evidence · 1 unknown \(no verification point\)/);
  assert.match(out, /This workspace is not Git-backed \(no Git commit to compare evidence against\):/);
  assert.match(out, /repository file evidence is still checked by SHA-256 content hash: a changed file becomes MAY_BE_STALE, a missing file STALE_EVIDENCE/);
  assert.match(out, /directory evidence has no content hash, so without Git it is UNKNOWN \(no verification point\) — UNKNOWN does not mean stale/);
  const brief = run(root, ['brief']).stdout;
  assert.match(brief, /NEEDS CARE \(2\)/, 'UNKNOWN is not NEEDS CARE');
  assert.doesNotMatch(brief.slice(brief.indexOf('NEEDS CARE')), /CTX-0002/);
});

test('AC-014: a Git-backed workspace keeps the v0.3.8 context status output (no extra note)', async () => {
  const root = await memoryWorkspace(true);
  const out = run(root, ['context', 'status']).stdout;
  assert.match(out, /Freshness: 3 fresh · 0 may be stale · 0 stale evidence · 0 unknown/);
  assert.doesNotMatch(out, /not Git-backed/);
});

// ---------------------------------------------------------------------------
// v0.3.8 compatibility: reads mutate zero bytes (AC-016)
// ---------------------------------------------------------------------------

test('AC-016: every read command on a v0.3.8-shaped workspace (contract v4, pending work) mutates zero bytes', async () => {
  const root = await apdFixture('yallaflow-v038-');
  await initWorkspace(root, 'apd', 'greenfield'); // the v0.3.8 mis-classification, recorded
  await writeFile(path.join(workspacePath(root), 'AGENT.md'), renderAgentContractBlock(4, agentContractBody()));
  const pending = await createPendingIntake(root, 'Understand the project');
  await routeWorkItem(root, pending.id, { work_type: 'investigation', scope: 'bounded', confidence: 'high', reason: 'Read-only.' });
  const before = await treeHash(root);
  const reads = [['inspect'], ['brief'], ['status'], ['doctor'], ['guide', pending.id], ['resume', pending.id], ['handoff', pending.id],
    ['context', 'status'], ['upgrade', 'status'], ['upgrade', 'plan'], ['agent', 'status'], ['baseline', 'status', pending.id], ['--version']];
  for (const args of reads) run(root, args, false);
  assert.equal(await treeHash(root), before, 'v0.3.9 reads never mutate a v0.3.8 workspace');
  const inspect = run(root, ['inspect']).stdout;
  assert.match(inspect, /Workspace: \.yallaflow present \(recorded kind: greenfield — differs from this classification; the recorded kind is never rewritten automatically\)/);
  const config = JSON.parse(await readFile(path.join(workspacePath(root), 'config.yaml'), 'utf8'));
  assert.equal(config.project.kind, 'greenfield');
  const brief = run(root, ['brief']).stdout;
  assert.match(brief, /Repository: brownfield by inventory .*; recorded kind greenfield/);
  assert.match(brief, /Agent contract: outdated \(v4 → v5\); run `yallaflow agent refresh`/);
});

// ---------------------------------------------------------------------------
// Package-owned guidance (AC-011, AC-014): the repository-baseline skill text
// ---------------------------------------------------------------------------

test('AC-011/AC-014: the repository-baseline skill guides inspect, material documents, durable vs transient state, and Git-free freshness', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-skill-'));
  await initWorkspace(root, 'demo', 'brownfield');
  const skill = run(root, ['skill', 'repository-baseline']).stdout;
  assert.match(skill, /Version: 1/, 'skill version unchanged (Skill Registry v5)');
  assert.match(skill, /Start from `yallaflow inspect`/);
  assert.match(skill, /register it with `yallaflow intake add <baseline-work-id> <path>` and read the extracted text with `yallaflow source show SRC-#### --content`/);
  assert.match(skill, /Cite a document inside the repository by its path \(repository evidence\)/);
  assert.match(skill, /A document is evidence of what it says, not proof of what the code does/);
  assert.match(skill, /Record material documents you did not read as `not-inspected` limitations/);
  assert.match(skill, /Record durable truth, not transient runtime state/);
  assert.match(skill, /re-checked by SHA-256 content hash .* directory evidence needs a Git commit and is otherwise UNKNOWN, which is not stale/);
  assert.match(skill, /if the user asked for a completely read-only \/ no-write operation, make none of them/);
  assert.match(skill, /Never approve the baseline: a human runs `yallaflow baseline approve`/);
});

// --- Independent-review regressions (pre-freeze) ---------------------------------

test('review: the 45-line cap counts physical lines — multi-line titles are collapsed and the next command is never dropped', async () => {
  const root = await largeBaselineWorkspace();
  const pending = await createPendingIntake(root, 'line one\nline two\nline three\nline four\nline five\nline six');
  await writeFile(path.join(workspacePath(root), 'state', 'current.yaml'), JSON.stringify({ schemaVersion: 1, activeWork: null, stage: null, updatedAt: 'x' }));
  const brief = run(root, ['brief']).stdout;
  const lines = brief.trimEnd().split('\n');
  assert.ok(lines.length <= BRIEF_MAX_LINES, `${lines.length} physical lines`);
  assert.match(brief, new RegExp(`Most recent work: ${pending.id} PENDING — line one line two line three line four line five line six\\n`));
  assert.match(brief, /\nPrimary next concern: .*\nNext: .*\nRead \.yallaflow\/AGENT\.md/);
});

test('review: a malformed baseline ledger never crashes brief or inspect — they point to doctor', async () => {
  const root = await apdFixture();
  run(root, ['init']);
  run(root, ['baseline', 'start']);
  await writeFile(path.join(workspacePath(root), 'work', 'PF-0001', 'progress.yaml'), 'garbage: [\n');
  const brief = run(root, ['brief']);
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /Next: yallaflow doctor/);
  const inspect = run(root, ['inspect']);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.match(inspect.stdout, /Next: yallaflow doctor\n {2}baseline PF-0001 state could not be read/);
});

test('review: nested hints written into tech-stack.md at init are bounded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-many-apps-'));
  for (let index = 0; index < 60; index++) {
    await mkdir(path.join(root, `apps`, `a${index}`), { recursive: true });
    await writeFile(path.join(root, 'apps', `a${index}`, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }));
  }
  await writeFile(path.join(root, 'index.js'), 'x\n');
  run(root, ['init']);
  const techStack = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.equal((techStack.match(/^- React 18/gm) ?? []).length, 40);
  assert.match(techStack, /^- … \+20 more — run `yallaflow inspect`$/m);
});

// --- Pre-freeze: container/CI hints use the classification's inventory truth -------

test('pre-freeze: a meaningful root Dockerfile that classifies Brownfield is also surfaced in the tech-stack snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-dockerfile-only-'));
  await writeFile(path.join(root, 'Dockerfile'), '# app image\nFROM node:20\n');
  const init = run(root, ['init']).stdout;
  assert.match(init, /Project kind: brownfield \(meaningful container\/CI configuration \(Dockerfile\)\)/);
  const techStack = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  assert.match(techStack, /## Repository hints\n\n- Dockerfile detected \(Dockerfile\)\n/);
  assert.doesNotMatch(techStack, /No CI\/container marker detected yet/);
  assert.match(run(root, ['inspect']).stdout, /\n {2}Dockerfile — Dockerfile\n/);
});

test('pre-freeze: every recognized container/CI kind is hinted with its paths; empty or comment-only files are not', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ci-kinds-'));
  const files = {
    'docker/api.Dockerfile': 'FROM node\n',
    'docker/Dockerfile.prod': 'FROM nginx\n',
    'compose.yaml': 'services: {}\n',
    '.github/workflows/ci.yml': 'on: push\n',
    '.gitlab-ci.yml': 'test:\n  script: make\n',
    'azure-pipelines.yml': 'trigger: [main]\n',
    'bitbucket-pipelines.yml': 'pipelines: {}\n',
    'Jenkinsfile': 'pipeline { agent any }\n',
    '.circleci/config.yml': 'version: 2.1\n',
    'ops/Dockerfile': '# placeholder\n// nothing yet\n'
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  run(root, ['init']);
  const techStack = await readFile(path.join(workspacePath(root), 'context', 'tech-stack.md'), 'utf8');
  const hints = /## Repository hints\n\n([\s\S]*?)\n(?:\n|$)/.exec(techStack)[1];
  assert.deepEqual(hints.split('\n'), [
    '- Dockerfile detected (docker/Dockerfile.prod, docker/api.Dockerfile)',
    '- Docker Compose detected (compose.yaml)',
    '- GitHub Actions detected (.github/workflows/ci.yml)',
    '- GitLab CI detected (.gitlab-ci.yml)',
    '- Azure Pipelines detected (azure-pipelines.yml)',
    '- Bitbucket Pipelines detected (bitbucket-pipelines.yml)',
    '- Jenkins detected (Jenkinsfile)',
    '- CircleCI detected (.circleci/config.yml)'
  ]);
  assert.doesNotMatch(techStack, /ops\/Dockerfile/, 'comment-only file is not a hint');
});
