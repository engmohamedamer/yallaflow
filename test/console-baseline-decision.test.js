// PF-0147: the project understanding (the Brownfield baseline) is approved, or sent back with
// requested changes, from the console. The decision is Core's own `baseline approve|feedback`;
// it carries the draft's digest, says in its note that it came from the console (identity not
// verified; structured provenance stays off the baseline gate, as Core and older versions
// require), and is refused with nothing recorded when the draft changed or was decided elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import '../test-support/agent-fixtures.js'; // isolated user config for every console in this file

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (root, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const reviews = (root, id) => readJson(path.join(root, '.yallaflow', 'work', id, 'reviews.yaml'));
const baseline = (root, id) => readJson(path.join(root, '.yallaflow', 'work', id, 'baseline.yaml'));
const context = (root) => readJson(path.join(root, '.yallaflow', 'context', 'index.yaml'));

const COMPLETE = {
  facts: [
    { area: 'tech-stack', status: 'confirmed', summary: 'Node.js project.', evidence: ['package.json'], source: 'repository' },
    { area: 'project', status: 'confirmed', summary: 'A small booking app for one clinic.', evidence: ['README.md'], source: 'repository' }
  ],
  coverage: { inspected: ['package.json', 'README.md'] }
};
const WITH_GAPS = {
  facts: [...COMPLETE.facts, { area: 'database', status: 'unresolved', summary: 'The production database cannot be established.', evidence: ['compose.yaml'], source: 'repository' }],
  limitations: [{ type: 'not-inspected', area: 'environment', summary: 'Deployment scripts were not read.', reason: 'outside the repository' }]
};

async function draftedProject(draft = COMPLETE) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-bdecide-'));
  await initWorkspace(root, 'Clinic', 'brownfield');
  for (const name of ['package.json', 'README.md', 'compose.yaml']) await writeFile(path.join(root, name), name === 'package.json' ? '{"name":"clinic"}' : '# clinic\n');
  const id = /^(PF-\d+)/.exec(run(root, ['baseline', 'start']).stdout)[1];
  assert.equal(run(root, ['checkpoint', id, '--skill', 'repository-baseline', '--complete', '--summary', 'Discovery complete.']).status, 0);
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-bdraft-')), 'baseline.json');
  await writeFile(file, JSON.stringify(draft));
  const drafted = run(root, ['baseline', 'draft', id, '--file', file]);
  assert.equal(drafted.status, 0, drafted.stderr);
  return { root, id, file };
}

async function consoleOn(root, options = {}) {
  const server = await startConsoleServer({ roots: [root], port: 0, ...options });
  const origin = server.url.replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${server.token}` };
  const pid = (await (await fetch(`${server.url}api/projects`, { headers: auth })).json()).projects[0].id;
  const post = async (pathName, body, headers = {}) => { const r = await fetch(`${server.url}api/p/${pid}/${pathName}`, { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const get = async (pathName) => { const r = await fetch(`${server.url}api/p/${pid}/${pathName}`, { headers: auth }); return { status: r.status, body: await r.json().catch(() => null) }; };
  return { server, pid, post, get, close: () => server.close() };
}
let request = 0;
const decision = (material, over = {}) => ({ decision: 'approve', note: 'Matches the project.', confirmed: true, digest: material.digest, requestId: `req-${String(++request).padStart(6, '0')}`, ...over });

test('approve from the console: Core records it, the facts become project memory, and the note says where it came from', async () => {
  const { root, id } = await draftedProject();
  const c = await consoleOn(root);
  try {
    const material = (await c.get(`work/${id}/gates/baseline`)).body;
    assert.deepEqual([material.status, material.step, material.facts.length], ['draft', 'awaiting-review', 2]);
    assert.deepEqual(material.gaps, { notInspected: 0, unresolved: 0, coverageDeclared: true });
    assert.match(material.digest, /^[0-9a-f]{64}$/);
    assert.equal((await c.get(`work/${id}`)).body.baseline.digest, material.digest, 'the item page shows the same digest it will send');
    const approved = await c.post(`work/${id}/gates/baseline/decision`, decision(material));
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.recorded, 'console, identity not verified');
    assert.match(approved.body.output.join('\n'), /baseline approved and promoted \(2 fact\(s\)/);
    assert.equal((await baseline(root, id)).status, 'approved');
    const gate = (await reviews(root, id)).gates.baseline;
    assert.equal(gate.status, 'approved');
    assert.match(gate.note, /^Matches the project\.\n\nDecided in the YallaFlow console by the local user \(identity not verified; host [^;)]+(; claimed Git name [^)]+)?\)\.$/);
    assert.equal(gate.provenance, undefined, 'no structured provenance on the baseline gate');
    assert.match((await baseline(root, id)).history.at(-1).note, /Decided in the YallaFlow console/);
    assert.equal((await context(root)).facts.filter((fact) => fact.state === 'current').length, 2, 'project memory holds the approved facts');
    assert.equal(run(root, ['doctor']).status, 0, 'the records validate');
    // nothing left to decide
    const again = await c.post(`work/${id}/gates/baseline/decision`, decision(material));
    assert.deepEqual([again.status, again.body.error.code], [409, 'STALE']);
  } finally {
    await c.close();
  }
});

test('request changes from the console, then a revised draft needs a fresh review', async () => {
  const { root, id, file } = await draftedProject();
  const c = await consoleOn(root);
  try {
    const material = (await c.get(`work/${id}/gates/baseline`)).body;
    const sent = await c.post(`work/${id}/gates/baseline/decision`, decision(material, { decision: 'request_changes', note: 'It is two clinics, not one.' }));
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const gate = (await reviews(root, id)).gates.baseline;
    assert.equal(gate.status, 'changes_requested');
    assert.match(gate.note, /^It is two clinics, not one\.\n\nDecided in the YallaFlow console by the local user \(identity not verified/);
    assert.equal((await baseline(root, id)).status, 'draft');
    assert.equal((await c.get(`work/${id}`)).body.item.baselineStep, 'changes-requested');
    // while the agent revises it there is nothing to approve
    const early = await c.post(`work/${id}/gates/baseline/decision`, decision(material));
    assert.deepEqual([early.status, early.body.error.code], [409, 'STALE']);
    // the agent redrafts: the old digest no longer matches, the new one does
    await writeFile(file, JSON.stringify({ ...COMPLETE, facts: [COMPLETE.facts[0], { ...COMPLETE.facts[1], summary: 'A booking app for two clinics.' }] }));
    assert.equal(run(root, ['baseline', 'draft', id, '--file', file]).status, 0);
    const stale = await c.post(`work/${id}/gates/baseline/decision`, decision(material));
    assert.deepEqual([stale.status, stale.body.error.code], [409, 'STALE']);
    assert.match(stale.body.error.message, /changed since you reviewed it/);
    const fresh = (await c.get(`work/${id}/gates/baseline`)).body;
    assert.notEqual(fresh.digest, material.digest);
    assert.equal((await c.post(`work/${id}/gates/baseline/decision`, decision(fresh))).status, 200);
  } finally {
    await c.close();
  }
});

test('refused with nothing recorded: no confirmation, no note, a CLI decision in between, a double submit, read-only', async () => {
  const { root, id } = await draftedProject();
  const c = await consoleOn(root);
  const before = JSON.stringify(await reviews(root, id).catch(() => null));
  try {
    const material = (await c.get(`work/${id}/gates/baseline`)).body;
    assert.equal((await c.post(`work/${id}/gates/baseline/decision`, decision(material, { confirmed: false }))).status, 422);
    assert.equal((await c.post(`work/${id}/gates/baseline/decision`, decision(material, { note: '   ' }))).status, 422);
    assert.equal((await c.post(`work/${id}/gates/baseline/decision`, decision(material, { decision: 'merge' }))).status, 422);
    assert.equal((await c.post(`work/${id}/gates/baseline/decision`, decision(material, { digest: '0'.repeat(64) }))).status, 409);
    assert.equal(JSON.stringify(await reviews(root, id).catch(() => null)), before, 'nothing was recorded');
    assert.equal((await baseline(root, id)).status, 'draft');
    // an agent (or the developer in a terminal) approves first: the console decision is stale
    assert.equal(run(root, ['baseline', 'approve', id, '--note', 'Approved in the agent session.']).status, 0);
    assert.equal((await reviews(root, id)).gates.baseline.note, 'Approved in the agent session.', 'a CLI decision is recorded exactly as before');
    const late = await c.post(`work/${id}/gates/baseline/decision`, decision(material, { decision: 'request_changes' }));
    assert.deepEqual([late.status, late.body.error.code], [409, 'STALE']);
    assert.equal((await reviews(root, id)).gates.baseline.status, 'approved', 'the earlier decision stands');
  } finally {
    await c.close();
  }
  // a double submit records once
  const second = await draftedProject();
  const c2 = await consoleOn(second.root);
  try {
    const material = (await c2.get(`work/${second.id}/gates/baseline`)).body;
    const body = decision(material);
    const [a, b] = await Promise.all([c2.post(`work/${second.id}/gates/baseline/decision`, body), c2.post(`work/${second.id}/gates/baseline/decision`, body)]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.equal([a.body.duplicate, b.body.duplicate].filter(Boolean).length, 1);
    assert.equal((await reviews(second.root, second.id)).gates.baseline.history.length, 1);
  } finally {
    await c2.close();
  }
  // a read-only console decides nothing
  const third = await draftedProject();
  const ro = await consoleOn(third.root, { readOnly: true });
  try {
    const material = (await ro.get(`work/${third.id}/gates/baseline`)).body;
    assert.ok((await ro.post(`work/${third.id}/gates/baseline/decision`, decision(material))).status >= 400);
    assert.equal((await baseline(third.root, third.id)).status, 'draft');
  } finally {
    await ro.close();
  }
});

test('a draft with gaps is approved only with the second acknowledgment; it is never blocked', async () => {
  const { root, id } = await draftedProject(WITH_GAPS);
  const c = await consoleOn(root);
  try {
    const material = (await c.get(`work/${id}/gates/baseline`)).body;
    assert.deepEqual(material.gaps, { notInspected: 1, unresolved: 1, coverageDeclared: false });
    const plain = await c.post(`work/${id}/gates/baseline/decision`, decision(material));
    assert.deepEqual([plain.status, plain.body.error.code], [422, 'GAPS']);
    assert.equal((await baseline(root, id)).status, 'draft');
    assert.equal((await c.post(`work/${id}/gates/baseline/decision`, decision(material, { acknowledgedGaps: true }))).status, 200);
    assert.equal((await baseline(root, id)).status, 'approved');
  } finally {
    await c.close();
  }
});

test('structured console provenance stays off the baseline gate, and is refused before anything is promoted', async () => {
  const { root, id } = await draftedProject();
  const env = { YALLAFLOW_DECISION_PROVENANCE: JSON.stringify({ via: 'console', host: 'h' }) };
  const generic = run(root, ['approve', id, '--stage', 'baseline', '--note', 'x'], env);
  assert.notEqual(generic.status, 0);
  assert.match(generic.stderr, /does not apply to the baseline gate/);
  for (const value of ['{not json', JSON.stringify({ via: 'console', host: 'h' })]) {
    const refused = run(root, ['baseline', 'approve', id, '--note', 'x'], { YALLAFLOW_DECISION_PROVENANCE: value });
    assert.notEqual(refused.status, 0, value);
    assert.equal((await baseline(root, id)).status, 'draft', 'refused before anything is promoted');
    assert.equal(existsSync(path.join(root, '.yallaflow', 'context', 'index.yaml')) ? (await context(root)).facts.length : 0, 0);
  }
  assert.equal(run(root, ['baseline', 'approve', id, '--note', 'ok']).status, 0);
  assert.equal(run(root, ['doctor']).status, 0);
});

// ---------------------------------------------------------------- the page
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function form({ lang = 'en', gaps = { notInspected: 0, unresolved: 0, coverageDeclared: true }, agentsOn = false, state = null } = {}) {
  const sandbox = vm.createContext({ A: (ar, en) => (lang === 'ar' ? ar : en), esc, agentsOn, newRequestId: () => 'req-00000001' });
  vm.runInContext(`${cut('  let bdecide = null;', '  // Typing and ticking keep their state')}\n${state ? `bdecide = ${JSON.stringify({ id: 'PF-0001', requestId: 'r', busy: false, error: null, stale: false, ...state })};` : ''}\nthis.html = baselineDecision({ id: 'PF-0001' }, ${JSON.stringify({ digest: 'd'.repeat(64), gaps })});`, sandbox);
  return sandbox.html;
}

test('the review form: both actions wait for the note and the tick; gaps add a named second tick', () => {
  const empty = form();
  assert.match(empty, /data-baseline-form data-baseline-item="PF-0001" data-digest="d{64}" >/);
  assert.match(empty, /data-baseline-decide="approve" disabled>Approve understanding</);
  assert.match(empty, /data-baseline-decide="request_changes" disabled>Request changes</);
  assert.doesNotMatch(empty, /name="ack"|bdgaps|discuss it with the agent/);
  assert.match(empty, /identity not verified/);
  const ready = form({ state: { note: 'ok', confirmed: true, ack: false } });
  assert.match(ready, /data-baseline-decide="approve" >Approve understanding</);
  assert.match(ready, /data-baseline-decide="request_changes" >Request changes</);
  const gaps = { notInspected: 2, unresolved: 1, coverageDeclared: false };
  const gapped = form({ gaps, state: { note: 'ok', confirmed: true, ack: false } });
  assert.match(gapped, /This draft is not complete: 2 area\(s\) were not inspected, and 1 fact\(s\) are not settled, and the agent did not declare what it read\./);
  assert.match(gapped, /name="ack" > I approve knowing that 2 area\(s\) were not inspected/);
  assert.match(gapped, /data-baseline-decide="approve" disabled>/, 'approve waits for the acknowledgment');
  assert.match(gapped, /data-baseline-decide="request_changes" >/, 'request changes does not');
  assert.match(form({ gaps, state: { note: 'ok', confirmed: true, ack: true } }), /data-baseline-decide="approve" >/);
  const stale = form({ state: { note: 'ok', confirmed: true, ack: false, error: 'The draft changed.', stale: true } });
  assert.match(stale, /role="alert"><pre>The draft changed\.<\/pre><button type="button" class="btn sm" data-baseline-reload>Reload the draft</);
  assert.match(form({ agentsOn: true }), /data-chat-item="PF-0001">Or discuss it with the agent</);
  const ar = form({ lang: 'ar', gaps, state: { note: 'تمام', confirmed: true, ack: true } });
  assert.match(ar, />وافق على فهم المشروع</);
  assert.match(ar, />اطلب تعديلات</);
  assert.match(ar, /هذه المسودة غير مكتملة: 2 جزء لم يُفحص، و1 معلومة غير محسومة/);
});

test('the page sends the digest it showed, and never decides in a read-only console', () => {
  assert.match(app, /const decide = waiting && !readOnly \? baselineDecision\(it, b\) : '';/);
  assert.match(app, /gates\/baseline\/decision`, JSON\.stringify\(\{ decision, note: st\.note, confirmed: true, acknowledgedGaps: st\.ack, digest: form\.dataset\.digest, requestId: st\.requestId \}\)/);
});
