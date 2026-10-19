// v1.1.0 optional AI QC: on request only, for routed work at any stage; honest,
// evidence-backed results in work/<id>/quality/, separate from verification; advisory
// (default) or strict policy; local hashed artifacts and Markdown/HTML reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { workspacePath } from '../src/core/workspace.js';
import {
  createdWork, driveChangeToDone, freshProject, noNetworkPreload, routedBoundedChange, run, workspaceHash, writeJsonFile
} from '../test-support/optional.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function scratch() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-qc-input-'));
  await writeFile(path.join(dir, 'export.png'), PNG);
  await writeFile(path.join(dir, 'trace.zip'), Buffer.from('PK\u0003\u0004trace'));
  return dir;
}

const quality = (root, id) => path.join(workspacePath(root), 'work', id, 'quality');

// A bounded feature with one recorded acceptance criterion, at IMPLEMENTATION.
async function featureWithCriteria(root, dir) {
  const id = createdWork(run(root, ['start', 'Calendar export']).stdout);
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Feature.']);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['requirement', 'record', id, '--file', await writeJsonFile(dir, 'req.json', {
    requirements: [{ id: 'REQ-001', statement: 'Staff export the calendar.', provenance: [{ type: 'request' }] }],
    acceptanceCriteria: [
      { id: 'AC-001', requirement: 'REQ-001', statement: 'The export is an ICS file.', provenance: [{ type: 'request' }] },
      { id: 'AC-002', requirement: 'REQ-001', statement: 'Only the selected term is exported.', provenance: [{ type: 'request' }] }
    ]
  })]);
  run(root, ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'ok']);
  for (let i = 0; i < 5; i++) run(root, ['advance', id], { ok: false });
  return id;
}

const PLAN = {
  target: { baseUrl: 'http://localhost:3000' },
  scenarios: [
    { id: 'S-01', kind: 'functional', title: 'Export downloads an ICS file', criteria: ['AC-001'] },
    { id: 'S-02', kind: 'exploratory', title: 'Empty term', charter: 'Probe empty and huge terms.' }
  ]
};

function passed(dir, id = 'S-01') {
  return { id, status: 'passed', steps: ['Opened /calendar', 'Clicked Export'], expected: 'ICS downloads', artifacts: [path.join(dir, 'export.png')] };
}

test('QC runs on DONE work without rerouting or reopening it, and never touches verification or the lifecycle', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  driveChangeToDone(root, id);
  const work = path.join(workspacePath(root), 'work', id);
  const untouched = ['meta.yaml', 'progress.yaml', 'evidence/verification.json'];
  const before = await Promise.all(untouched.map((file) => readFile(path.join(work, file), 'utf8')));

  // Work without recorded criteria: a functional scenario needs a rationale.
  const noRationale = run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'bad.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'Filter position' }] })], { ok: false });
  assert.match(noRationale.stderr, /needs a rationale/);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'Filter is above the table', rationale: 'The request moves the filter.' }] })]);
  const recorded = run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'result.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [passed(dir)] })]);
  assert.match(recorded.stdout, /stays DONE; QC never changes the lifecycle or the verification ledger/);
  const after = await Promise.all(untouched.map((file) => readFile(path.join(work, file), 'utf8')));
  assert.deepEqual(after, before);
  assert.equal(run(root, ['doctor']).status, 0);
});

test('QC is refused for unrouted work, and help never records anything', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const pending = createdWork(run(root, ['start', 'Not routed']).stdout);
  assert.match(run(root, ['qc', 'plan', pending, '--file', await writeJsonFile(dir, 'plan.json', PLAN)], { ok: false }).stderr, /awaiting routing/);
  const before = await workspaceHash(root);
  for (const args of [['qc', '--help'], ['qc', 'plan', pending, '--file', 'x.json', '--help'], ['qc', 'record', pending, '--file', 'x.json', '-h']]) {
    assert.match(run(root, args).stdout, /Usage:/);
  }
  assert.match(run(root, ['qc', 'status', pending]).stdout, /no QC requested\. QC is optional and runs only on request/);
  assert.equal(await workspaceHash(root), before);
});

test('functional scenarios trace to active acceptance criteria; uncovered criteria are reported', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  const unknownCriterion = run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'bad.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', criteria: ['AC-009'] }] })], { ok: false });
  assert.match(unknownCriterion.stderr, /AC-009" is not an active acceptance criterion/);
  const noCriteria = run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'bad2.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x' }] })], { ok: false });
  assert.match(noCriteria.stderr, /must cover at least one active acceptance criterion/);
  const noCharter = run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'bad3.json', { scenarios: [{ id: 'S-01', kind: 'exploratory', title: 'x' }] })], { ok: false });
  assert.match(noCharter.stderr, /requires a charter/);
  const plan = run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', PLAN)]);
  assert.match(plan.stdout, /Criteria covered: AC-001/);
  assert.match(plan.stdout, /Criteria with no scenario: AC-002/);
  assert.match(plan.stdout, /Nothing was run\./);
});

test('honesty rules: no pass without executed steps and evidence; failures need reproduction; nothing is written on rejection', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', PLAN)]);
  const before = await workspaceHash(root);
  const reject = async (scenario, pattern, extra = {}) => {
    const result = run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [scenario], ...extra })], { ok: false });
    assert.equal(result.status, 1);
    assert.match(result.stderr, pattern);
    assert.match(result.stderr, /No files were changed/);
  };
  await reject({ id: 'S-01', status: 'passed', artifacts: [path.join(dir, 'export.png')] }, /passed requires the steps that were actually executed/);
  await reject({ id: 'S-01', status: 'passed', steps: ['Clicked Export'] }, /passed requires execution evidence/);
  await reject({ id: 'S-01', status: 'failed', steps: ['Clicked Export'] }, /failed requires the actual behavior observed/);
  await reject({ id: 'S-01', status: 'failed', actual: '500' }, /failed requires reproducible steps/);
  await reject({ id: 'S-02', status: 'not-run' }, /not-run requires a reason/);
  await reject({ id: 'S-02', status: 'blocked' }, /blocked requires a reason/);
  await reject({ id: 'S-09', status: 'not-run', reason: 'x' }, /S-09 is not in plan QP-001/);
  await reject({ ...passed(dir), artifacts: [path.join(dir, 'missing.png')] }, /artifact not found/);
  await reject(passed(dir), /origin yallaflow-verified requires verificationRun/, { origin: 'yallaflow-verified' });
  assert.equal(await workspaceHash(root), before);
});

test('a scenario may pass on a YallaFlow verification run only when that run passed', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', PLAN)]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(1)'], { ok: false });
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  const steps = ['npx playwright test export.spec.ts'];
  const failedRun = run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r1.json', { tool: 'playwright-test', origin: 'yallaflow-verified', verificationRun: 'V-001', scenarios: [{ id: 'S-01', status: 'passed', steps }] })], { ok: false });
  assert.match(failedRun.stderr, /verification run V-001 failed/);
  const ok = run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r2.json', { tool: 'playwright-test', origin: 'yallaflow-verified', verificationRun: 'V-002', scenarios: [{ id: 'S-01', status: 'passed', steps }] })]);
  assert.match(ok.stdout, /1 passed/);
});

test('a non-local target needs --allow-remote; credentials in a target URL are refused', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { ...PLAN, target: undefined })]);
  const remote = { tool: 'playwright-cli', origin: 'agent-driven', target: { baseUrl: 'https://staging.example.com' }, scenarios: [passed(dir)] };
  assert.match(run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', remote)], { ok: false }).stderr, /needs an explicit --allow-remote/);
  run(root, ['qc', 'record', id, '--file', path.join(dir, 'r.json'), '--allow-remote']);
  const secret = { ...remote, target: { baseUrl: 'https://user:pass@staging.example.com' } };
  assert.match(run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 's.json', secret), '--allow-remote'], { ok: false }).stderr, /must not embed credentials/);
});

test('advisory policy: failures are reported by status and finish, and never block completion', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  driveChangeToDone(root, id);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'exploratory', title: 'Narrow screens', charter: 'Resize to 320px.' }] })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-mcp', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'failed', steps: ['Resize to 320px'], actual: 'Filter overlaps the table' }] })]);
  const finish = run(root, ['finish', id]);
  assert.match(finish.stdout, /AI QC \(advisory\) found 1 scenario\(s\) not passing: S-01 failed\. Reported only — completion is not blocked\./);
  assert.match(finish.stdout, /Quality report: \.yallaflow\/work\/PF-0001\/quality\/report\.md/);
  assert.match(finish.stdout, /Ready to push\./);
});

test('strict policy: quality approval needs every required scenario to pass, separately from DONE', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  driveChangeToDone(root, id);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', {
    policy: 'strict',
    scenarios: [
      { id: 'S-01', kind: 'functional', title: 'Filter above table', rationale: 'Requested.' },
      { id: 'S-02', kind: 'exploratory', title: 'Keyboard', charter: 'Tab order.' }
    ]
  })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r1.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'blocked', reason: 'Dev server would not start.' }] })]);
  let finish = run(root, ['finish', id]);
  assert.equal(finish.status, 0, 'quality approval never changes lifecycle readiness');
  assert.match(finish.stdout, /Quality approval \(strict QC\): not granted — S-01 blocked\. This is separate from the task being done\./);
  assert.match(run(root, ['qc', 'status', id]).stdout, /Quality approval \(strict policy\): NOT GRANTED/);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r2.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [passed(dir)] })]);
  finish = run(root, ['finish', id]);
  assert.match(finish.stdout, /Quality approval \(strict QC\): granted — every required scenario passed\./);
});

test('strict policy can be the project default; work that never used QC is untouched by it', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const configFile = path.join(workspacePath(root), 'config.yaml');
  await writeYaml(configFile, { ...(await readYaml(configFile)), quality: { ...(await readYaml(configFile)).quality, qc: { policy: 'strict' } } });
  const plain = routedBoundedChange(root, 'Unrelated copy fix');
  driveChangeToDone(root, plain);
  const finish = run(root, ['finish', plain]);
  assert.doesNotMatch(finish.stdout, /QC|Quality/);
  const id = routedBoundedChange(root);
  assert.match(run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]).stdout, /Policy: strict \(from config\)/);
});

test('convergence may cite a passed QC scenario; a failed one cannot support satisfied, and a later failure makes it stale', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', PLAN)]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r1.json', {
    tool: 'playwright-cli', origin: 'agent-driven',
    scenarios: [passed(dir), { id: 'S-02', status: 'failed', steps: ['Empty term', 'Export'], actual: 'HTTP 500' }]
  })]);
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  const failedCite = run(root, ['convergence', 'record', id, '--file', await writeJsonFile(dir, 'c0.json', {
    findings: [{ criterion: 'AC-002', status: 'satisfied', reason: 'x', evidence: ['qc:QC-001#S-02'] }]
  })], { ok: false });
  assert.match(failedCite.stderr, /satisfied cannot rest on QC QC-001 S-02, which was recorded failed/);
  run(root, ['convergence', 'record', id, '--file', await writeJsonFile(dir, 'c1.json', {
    findings: [
      { criterion: 'AC-001', status: 'satisfied', reason: 'Export observed.', evidence: ['qc:QC-001#S-01', 'verification:V-001'] },
      { criterion: 'AC-002', status: 'partial', reason: 'Empty term fails.', evidence: ['qc:QC-001#S-02'] }
    ]
  })]);
  assert.match(run(root, ['convergence', 'show', id, 'AC-001']).stdout, /QC QC-001 S-01 passed \(agent-driven via playwright-cli\)/);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r2.json', {
    tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-01', status: 'failed', steps: ['Export'], actual: 'Download is empty' }]
  })]);
  assert.match(run(root, ['convergence', 'status', id], { ok: false }).stdout, /QC S-01 was recorded failed by later run QC-002/);
});

test('artifacts: copied with hashes, git-excluded by default, opt-in commit; reports link locally and flag missing media', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', PLAN)]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', {
    tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ ...passed(dir), artifacts: [path.join(dir, 'export.png'), path.join(dir, 'trace.zip')] }]
  })]);
  const q = quality(root, id);
  const ignore = await readFile(path.join(q, 'media', '.gitignore'), 'utf8');
  assert.match(ignore, /^\*$/m);
  assert.match(ignore, /^!\.gitignore$/m);
  const ledger = JSON.parse(await readFile(path.join(q, 'qc.json'), 'utf8'));
  const [shot, trace] = ledger.runs[0].scenarios[0].artifacts;
  assert.deepEqual([shot.kind, trace.kind], ['screenshot', 'trace']);
  assert.equal(shot.sizeBytes, PNG.length);
  assert.match(shot.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await readFile(path.join(q, shot.path)), PNG);

  const md = await readFile(path.join(q, 'report.md'), 'utf8');
  for (const [, link] of md.matchAll(/\]\(([^)]+)\)/g)) assert.ok(existsSync(path.join(q, decodeURI(link))), `${link} resolves locally`);
  assert.match(md, /npx playwright show-trace media\/QC-001\/trace\.zip/);
  const html = await readFile(path.join(q, 'report.html'), 'utf8');
  assert.match(html, /<img alt="export\.png" src="media\/QC-001\/export\.png">/);
  assert.doesNotMatch(html, /<script|https?:\/\//i, 'standalone: no scripts and no external requests');

  await rm(path.join(q, shot.path));
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r3.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [{ id: 'S-02', status: 'not-run', reason: 'Out of time.' }] })]);
  assert.match(await readFile(path.join(q, 'report.md'), 'utf8'), /export\.png[^\n]*not on this machine/);
  assert.match(await readFile(path.join(q, 'report.html'), 'utf8'), /class="warn"[^\n]*export\.png/);

  const committed = await freshProject();
  const configFile = path.join(workspacePath(committed), 'config.yaml');
  await writeYaml(configFile, { ...(await readYaml(configFile)), quality: { ...(await readYaml(configFile)).quality, media: { commit: true } } });
  const other = await featureWithCriteria(committed, dir);
  run(committed, ['qc', 'plan', other, '--file', path.join(dir, 'plan.json')]);
  run(committed, ['qc', 'record', other, '--file', path.join(dir, 'r.json')]);
  assert.equal(existsSync(path.join(quality(committed, other), 'media', '.gitignore')), false);
});

test('doctor validates the QC ledger and its config; QC commands make no network call', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const marker = path.join(dir, 'network-marker');
  const opts = { preload: noNetworkPreload, env: { YALLAFLOW_TEST_NETWORK_MARKER: marker } };
  const id = await featureWithCriteria(root, dir);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'plan.json', PLAN)], opts);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [passed(dir)] })], opts);
  run(root, ['qc', 'status', id], opts);
  assert.equal(existsSync(marker), false);
  assert.equal(run(root, ['doctor']).status, 0);

  const file = path.join(quality(root, id), 'qc.json');
  const ledger = JSON.parse(await readFile(file, 'utf8'));
  ledger.runs[0].scenarios[0].status = 'great';
  await writeFile(file, JSON.stringify(ledger));
  const doctor = run(root, ['doctor'], { ok: false });
  assert.match(doctor.stdout, /QC ledger for PF-0001 is invalid/);

  const configFile = path.join(workspacePath(root), 'config.yaml');
  await writeYaml(configFile, { ...(await readYaml(configFile)), quality: { qc: { policy: 'sometimes' } } });
  assert.match(run(root, ['doctor'], { ok: false }).stdout, /quality\.qc\.policy must be advisory or strict/);
});

// ---------------------------------------------------------------------------
// Release-review regressions (PF-0011)

test('a result counts only for the scenario definition it was recorded against', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  driveChangeToDone(root, id);
  const scenario = { id: 'S-01', kind: 'functional', title: 'Login works', rationale: 'Core flow.' };
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p1.json', { policy: 'strict', scenarios: [scenario] })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r1.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [passed(dir)] })]);
  // Same definition re-planned: the earlier pass still counts.
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p2.json', { policy: 'strict', scenarios: [scenario] })]);
  assert.match(run(root, ['qc', 'status', id]).stdout, /GRANTED/);
  // Redefined under the same id: it has not been run, so approval is not granted.
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p3.json', { policy: 'strict', scenarios: [{ ...scenario, title: 'Refund flow works' }] })]);
  const status = run(root, ['qc', 'status', id]).stdout;
  assert.match(status, /S-01 \[functional, required\] Refund flow works — not run/);
  assert.match(status, /NOT GRANTED — S-01 has not been run/);
});

test('a project-wide strict policy cannot be weakened by a plan', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const configFile = path.join(workspacePath(root), 'config.yaml');
  await writeYaml(configFile, { ...(await readYaml(configFile)), quality: { qc: { policy: 'strict' } } });
  const id = routedBoundedChange(root);
  const plan = { policy: 'advisory', scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] };
  assert.match(run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p.json', plan)], { ok: false }).stderr, /cannot weaken it to advisory/);
});

test('a yallaflow-verified pass must rest on a verification run newer than the latest reopen', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  driveChangeToDone(root, id);
  run(root, ['reopen', id, '--to', 'verification', '--reason', 'Re-check after a dependency bump.']);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  const stale = { tool: 'playwright-test', origin: 'yallaflow-verified', verificationRun: 'V-001', scenarios: [{ id: 'S-01', status: 'passed', steps: ['npx playwright test'] }] };
  assert.match(run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r1.json', stale)], { ok: false }).stderr, /V-001 predates the latest reopen/);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r2.json', { ...stale, verificationRun: 'V-002' })]);
});

test('finish survives an unreadable quality ledger, and ledgers never record local source paths', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  driveChangeToDone(root, id);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  run(root, ['qc', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', origin: 'agent-driven', scenarios: [passed(dir)] })]);
  const file = path.join(quality(root, id), 'qc.json');
  const text = await readFile(file, 'utf8');
  assert.ok(!text.includes(dir), 'no absolute local path is written to the committed ledger');
  await writeFile(file, `<<<<<<< ours\n${text}=======\n>>>>>>> theirs\n`);
  const finish = run(root, ['finish', id], { ok: false });
  assert.equal(finish.status, 1, 'reported, not crashed');
  assert.match(finish.stdout, /Project state has an integrity problem I need to fix first\.[\s\S]*yallaflow doctor/);
  assert.equal(finish.stderr, '', 'no exception escapes finish');
});

test('a project that switches to strict judges an earlier advisory plan strictly', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'x', rationale: 'y' }] })]);
  assert.match(run(root, ['qc', 'status', id]).stdout, /Advisory policy/);
  const configFile = path.join(workspacePath(root), 'config.yaml');
  await writeYaml(configFile, { ...(await readYaml(configFile)), quality: { qc: { policy: 'strict' } } });
  assert.match(run(root, ['qc', 'status', id]).stdout, /Quality approval \(strict policy\): NOT GRANTED — S-01 has not been run/);
});
