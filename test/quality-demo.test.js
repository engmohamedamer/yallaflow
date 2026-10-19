// v1.1.0 optional Smart Demo: independent of QC, scope prioritized and approved by the
// developer before anything is recorded, video optional, local hashed media, and never
// presented as test evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { DEMO_DISCLAIMER } from '../src/quality/constants.js';
import {
  createdWork, driveChangeToDone, freshProject, noNetworkPreload, routedBoundedChange, run, workspaceHash, writeJsonFile
} from '../test-support/optional.js';

const quality = (root, id) => path.join(workspacePath(root), 'work', id, 'quality');

async function scratch() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-demo-input-'));
  await writeFile(path.join(dir, 'demo.webm'), Buffer.from('\u001aEß£webm-bytes'));
  await writeFile(path.join(dir, 'approved.png'), Buffer.from('\u0089PNG-bytes'));
  return dir;
}

async function featureWithCriteria(root, dir) {
  const id = createdWork(run(root, ['start', 'Refund approval']).stdout);
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Feature.']);
  run(root, ['requirement', 'record', id, '--file', await writeJsonFile(dir, 'req.json', {
    requirements: [{ id: 'REQ-001', statement: 'Large refunds need approval.', provenance: [{ type: 'request' }] }],
    acceptanceCriteria: [
      { id: 'AC-001', requirement: 'REQ-001', statement: 'A refund above 100 waits for approval.', provenance: [{ type: 'request' }] },
      { id: 'AC-002', requirement: 'REQ-001', statement: 'A manager can approve it.', provenance: [{ type: 'request' }] }
    ]
  })]);
  return id;
}

const SCOPE = {
  target: { baseUrl: 'http://localhost:3000' },
  scenarios: [
    { id: 'D-02', title: 'Refund under the limit goes straight through', audience: 'developer', priority: 2, rationale: 'Shows the rule boundary.', steps: ['Create refund of 50'] },
    { id: 'D-01', title: 'Manager approves a large refund', audience: 'business', priority: 1, criteria: ['AC-001', 'AC-002'], rationale: 'The new approval rule is the business change.', steps: ['Create refund of 500', 'Sign in as the test manager', 'Approve'], record: true, data: 'Seeded test refunds' }
  ],
  excluded: [{ title: 'Settings page', reason: 'Unchanged by this work.' }]
};

const approve = (root, id, extra = []) => run(root, ['demo', 'approve', id, '--note', 'Approved by the developer in the agent session: "yes, show those"', ...extra]);

test('a demo needs no QC: scope is prioritized, traced to criteria, and nothing is recorded at proposal time', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  const proposed = run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', SCOPE)]);
  assert.match(proposed.stdout, /1\. D-01 \[business, recorded\] Manager approves a large refund — AC-001, AC-002\n\s+why: The new approval rule/);
  assert.match(proposed.stdout, /2\. D-02 \[developer\]/);
  assert.match(proposed.stdout, /excluded: Settings page — Unchanged by this work\./);
  assert.match(proposed.stdout, /Nothing was recorded\. Present this scope to the developer/);
  assert.equal(existsSync(path.join(quality(root, id), 'qc.json')), false, 'Smart Demo works without any QC record');
  assert.equal(existsSync(path.join(quality(root, id), 'media')), false);
  assert.match(run(root, ['demo', 'status', id]).stdout, /awaiting the developer's approval/);

  const before = await workspaceHash(root);
  const bad = { scenarios: [{ id: 'D-01', title: 'x', audience: 'manager', priority: 0, criteria: ['AC-404'], steps: [] }] };
  const rejected = run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'bad.json', bad)], { ok: false });
  for (const pattern of [/audience must be one of business, developer/, /priority must be a positive integer/, /requires a rationale/, /requires the steps to demonstrate/, /AC-404" is not an active acceptance criterion/]) assert.match(rejected.stderr, pattern);
  assert.equal(await workspaceHash(root), before);
});

test('recording is refused until the developer approves this exact proposal, with their words', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', SCOPE)]);
  const result = await writeJsonFile(dir, 'result.json', { tool: 'playwright-cli', scenarios: [{ id: 'D-01', status: 'shown' }] });
  const before = await workspaceHash(root);
  assert.match(run(root, ['demo', 'record', id, '--file', result], { ok: false }).stderr, /DP-001 has not been approved by the developer/);
  assert.match(run(root, ['demo', 'approve', id], { ok: false }).stderr, /Never approve a demo scope on the developer's behalf/);
  assert.equal(await workspaceHash(root), before);

  approve(root, id);
  run(root, ['demo', 'record', id, '--file', result]);
  // A changed scope needs a new approval before the next recording.
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope2.json', { ...SCOPE, excluded: [] })]);
  assert.match(run(root, ['demo', 'record', id, '--file', result], { ok: false }).stderr, /DP-002 has not been approved/);
  approve(root, id, ['--only', 'D-02']);
  assert.match(run(root, ['demo', 'record', id, '--file', result], { ok: false }).stderr, /D-01 is not in the approved scope of DP-002 \(D-02\)/);

  // A hand-edited approval no longer matches its proposal and fails doctor.
  const file = path.join(quality(root, id), 'demo.json');
  const ledger = JSON.parse(await readFile(file, 'utf8'));
  ledger.approvals[0].sha256 = '0'.repeat(64);
  await writeFile(file, JSON.stringify(ledger));
  assert.match(run(root, ['doctor'], { ok: false }).stdout, /demo approval of DP-001 does not match the proposal it approved/);
});

test('video is optional; a recorded video and screenshots are stored locally with hashes; a missing video is refused', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', SCOPE)]);
  approve(root, id);
  const noVideo = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r1.json', { tool: 'playwright-cli', audience: 'developer', scenarios: [{ id: 'D-02', status: 'shown' }] })]);
  assert.match(noVideo.stdout, /No video recorded \(recording is optional\)\./);
  const missing = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r2.json', { tool: 'playwright-cli', video: path.join(dir, 'never-written.webm'), scenarios: [{ id: 'D-01', status: 'shown' }] })], { ok: false });
  assert.match(missing.stderr, /video not found/, 'a recorder that claimed a video it never wrote is caught');
  const withVideo = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r3.json', {
    tool: 'playwright-cli', audience: 'business', video: path.join(dir, 'demo.webm'),
    scenarios: [{ id: 'D-01', status: 'shown', artifacts: [path.join(dir, 'approved.png')] }, { id: 'D-02', status: 'skipped', notes: 'Shown in DM-001.' }]
  })]);
  assert.match(withVideo.stdout, /Video: \.yallaflow\/work\/PF-0001\/quality\/media\/DM-002-[0-9a-f]{6}\/demo\.webm \(local; sha256/);
  const ledger = JSON.parse(await readFile(path.join(quality(root, id), 'demo.json'), 'utf8'));
  const run2 = ledger.runs[1];
  assert.equal(run2.video.kind, 'video');
  assert.match(run2.video.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await readFile(path.join(quality(root, id), run2.video.path)), await readFile(path.join(dir, 'demo.webm')));
  assert.match(await readFile(path.join(quality(root, id), '.gitignore'), 'utf8'), /^media\/$/m);

  const notes = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r4.json', { tool: 'playwright-cli', scenarios: [{ id: 'D-01', status: 'failed' }] })], { ok: false });
  assert.match(notes.stderr, /failed requires notes/);
});

test('every demo summary says it is not test evidence, and convergence refuses demo citations', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  run(root, ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'ok']);
  for (let i = 0; i < 5; i++) run(root, ['advance', id], { ok: false });
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', SCOPE)]);
  approve(root, id);
  const recorded = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', video: path.join(dir, 'demo.webm'), scenarios: [{ id: 'D-01', status: 'shown' }] })]);
  assert.ok(recorded.stdout.includes(DEMO_DISCLAIMER));
  const ledger = JSON.parse(await readFile(path.join(quality(root, id), 'demo.json'), 'utf8'));
  assert.equal(ledger.runs[0].disclaimer, DEMO_DISCLAIMER);
  const md = await readFile(path.join(quality(root, id), 'report.md'), 'utf8');
  assert.ok(md.includes(`> ${DEMO_DISCLAIMER}`));
  for (const [, link] of md.matchAll(/\]\(([^)]+)\)/g)) assert.ok(existsSync(path.join(quality(root, id), decodeURI(link))), `${link} resolves locally`);
  const html = await readFile(path.join(quality(root, id), 'report.html'), 'utf8');
  assert.ok(html.includes(DEMO_DISCLAIMER));
  assert.match(html, /<video controls preload="metadata" src="media\/DM-001-[0-9a-f]{6}\/demo\.webm"><\/video>/);
  assert.doesNotMatch(html, /<script/i);

  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'done']);
  run(root, ['advance', id]);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'ok']);
  const cited = run(root, ['convergence', 'record', id, '--file', await writeJsonFile(dir, 'c.json', {
    findings: [{ criterion: 'AC-001', status: 'satisfied', reason: 'Shown in the demo.', evidence: ['demo:DM-001#D-01'] }]
  })], { ok: false });
  assert.match(cited.stderr, /a demo shows a scenario once and is not acceptance evidence/);
});

test('privacy: non-local targets need --allow-remote, credentials in URLs are refused, and secrets in notes are redacted', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = routedBoundedChange(root);
  driveChangeToDone(root, id);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', {
    target: { baseUrl: 'https://staging.example.com' },
    scenarios: [{ id: 'D-01', title: 'Filter above the table', audience: 'business', priority: 1, rationale: 'The requested change.', steps: ['Open attendance'] }]
  })]);
  approve(root, id);
  const result = await writeJsonFile(dir, 'r.json', { tool: 'playwright-mcp', scenarios: [{ id: 'D-01', status: 'shown', notes: 'Used token ghp_abcdefghijklmnopqrstuvwxyz0123456789 from the seed.' }] });
  assert.match(run(root, ['demo', 'record', id, '--file', result], { ok: false }).stderr, /needs an explicit --allow-remote/);
  const recorded = run(root, ['demo', 'record', id, '--file', result, '--allow-remote']);
  assert.match(recorded.stdout, /stays DONE; demos never change the lifecycle/);
  for (const file of ['demo.json', 'report.md', 'report.html']) {
    const text = await readFile(path.join(quality(root, id), file), 'utf8');
    assert.doesNotMatch(text, /ghp_abcdefghijklmnopqrstuvwxyz0123456789/, `${file} never keeps the secret value`);
  }
  const creds = await writeJsonFile(dir, 'c.json', { tool: 'playwright-cli', target: { baseUrl: 'http://admin:pw@localhost:3000' }, scenarios: [{ id: 'D-01', status: 'shown' }] });
  assert.match(run(root, ['demo', 'record', id, '--file', creds], { ok: false }).stderr, /must not embed credentials/);
  const finish = run(root, ['finish', id]);
  assert.match(finish.stdout, /Smart Demo DM-001: 1 scenario\(s\) shown\. A demo is not test evidence\./);
  assert.match(finish.stdout, /Ready to push\./);
});

test('demo help and status never write, and demo commands make no network call', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const marker = path.join(dir, 'network-marker');
  const opts = { preload: noNetworkPreload, env: { YALLAFLOW_TEST_NETWORK_MARKER: marker } };
  const id = await featureWithCriteria(root, dir);
  const before = await workspaceHash(root);
  for (const args of [['demo', '--help'], ['demo', 'approve', id, '--note', 'x', '--help'], ['demo', 'record', id, '--file', 'r.json', '-h']]) assert.match(run(root, args).stdout, /Usage:/);
  assert.match(run(root, ['demo', 'status', id]).stdout, /no demo requested/);
  assert.equal(await workspaceHash(root), before);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', SCOPE)], opts);
  approve(root, id);
  run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', scenarios: [{ id: 'D-01', status: 'shown' }] })], opts);
  run(root, ['demo', 'status', id], opts);
  assert.equal(existsSync(marker), false);
  assert.equal(run(root, ['doctor']).status, 0);
});

test('an approval is bound to the proposal content: a hand-edited proposal loses it', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', SCOPE)]);
  approve(root, id);
  const file = path.join(quality(root, id), 'demo.json');
  const ledger = JSON.parse(await readFile(file, 'utf8'));
  ledger.proposals[0].scenarios[0].steps.push('Also open the admin console');
  await writeFile(file, JSON.stringify(ledger));
  const result = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', scenarios: [{ id: 'D-01', status: 'shown' }] })], { ok: false });
  assert.match(result.stderr, /DP-001 no longer matches its recorded sha256/);
  assert.match(run(root, ['doctor'], { ok: false }).stdout, /DP-001 no longer matches its recorded sha256/);
});

test('a secret-like value in a demo step is redacted and the ledger stays valid', async () => {
  const root = await freshProject();
  const dir = await scratch();
  const id = await featureWithCriteria(root, dir);
  const scope = { scenarios: [{ id: 'D-01', title: 'Sign in', audience: 'developer', priority: 1, rationale: 'Entry point.', steps: ['Log in with PASSWORD=demo123'] }] };
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', scope)]);
  const text = await readFile(path.join(quality(root, id), 'demo.json'), 'utf8');
  assert.doesNotMatch(text, /demo123/);
  approve(root, id);
  run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r.json', { tool: 'playwright-cli', scenarios: [{ id: 'D-01', status: 'shown' }] })]);
  assert.equal(run(root, ['doctor']).status, 0);
});
