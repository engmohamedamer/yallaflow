// 1.4.0 console work management (PF-0043): work-item actions run the canonical CLI
// commands; review-gate decisions are explicit local-user decisions recorded as
// "console, identity not verified" (owner decision SRC-0032, Option B).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startConsoleServer } from '../src/console/server.js';
import { createdWork, freshProject, routedBoundedChange, run, writeJsonFile } from '../test-support/optional.js';
import '../test-support/agent-fixtures.js'; // isolated user config for every console in this file

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const reviews = (root, id) => readJson(path.join(root, '.yallaflow', 'work', id, 'reviews.yaml'));
const meta = (root, id) => readJson(path.join(root, '.yallaflow', 'work', id, 'meta.yaml'));

async function consoleOn(root, options = {}) {
  const server = await startConsoleServer({ roots: [root], port: 0, ...options });
  const origin = server.url.replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${server.token}` };
  const pid = (await (await fetch(`${server.url}api/projects`, { headers: auth })).json()).projects[0].id;
  const post = (pathName, body, headers = {}) => fetch(`${server.url}api/p/${pid}/${pathName}`, { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
  const get = (pathName, headers = auth) => fetch(`${server.url}api/p/${pid}/${pathName}`, { headers });
  return { server, origin, pid, post, get, close: () => server.close() };
}

// An architectural feature whose specification gate awaits review.
async function featureAtSpecReview(root) {
  const id = createdWork(run(root, ['start', 'Customer loyalty points']).stdout);
  run(root, ['route', id, '--type', 'feature', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Loyalty rules across billing.']);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-actions-req-'));
  run(root, ['requirement', 'record', id, '--file', await writeJsonFile(dir, 'req.json', {
    requirements: [{ id: 'REQ-001', statement: 'Customers earn points.', provenance: [{ type: 'request' }] }],
    acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'One point per currency unit.', provenance: [{ type: 'request' }] }]
  })]);
  for (const skill of ['context-discovery', 'requirement-clarification', 'design-exploration', 'specification']) {
    run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', `${skill} done`]);
  }
  const workMd = path.join(root, '.yallaflow', 'work', id, 'work.md');
  await writeFile(workMd, (await readFile(workMd, 'utf8')).replace('## Specification\n', '## Specification\n\nPoints are earned per paid invoice and never expire.\n'));
  for (let index = 0; index < 6; index++) run(root, ['advance', id], { ok: false });
  assert.equal((await reviews(root, id)).gates.specification.status, 'awaiting_review');
  return id;
}

test('work-item actions run the canonical commands: same records as the CLI, Core refusals passed through', async () => {
  const root = await freshProject('yf-actions-');
  const id = routedBoundedChange(root, 'Add CSV export of orders');
  const c = await consoleOn(root);
  try {
    assert.equal((await c.post(`work/${id}/actions/activate`)).status, 200);
    assert.equal(JSON.parse(await readFile(path.join(root, '.yallaflow', 'state', 'current.yaml'), 'utf8')).activeWork, id);
    const advanced = await c.post(`work/${id}/actions/advance`);
    assert.equal(advanced.status, 200, await advanced.clone().text());
    assert.match((await advanced.json()).output.join('\n'), new RegExp(`${id}: `));
    // A Core blocker comes back as Core's own text.
    let blocked;
    for (let index = 0; index < 8; index++) {
      blocked = await c.post(`work/${id}/actions/advance`);
      if (blocked.status !== 200) break;
    }
    assert.equal(blocked.status, 409);
    const refusal = await blocked.json();
    assert.equal(refusal.error.code, 'REFUSED');
    assert.match(refusal.error.message, /checkpoint|blocker|Cannot/i);
    // A stale edit is refused once work has left INTAKE.
    const routedRevise = await c.post(`work/${id}/actions/revise`, { text: 'Add CSV and Excel export of orders', reason: 'The client also needs Excel.' });
    assert.equal(routedRevise.status, 409);
    assert.match((await routedRevise.json()).error.message, /already started/);
    const pending = createdWork(run(root, ['start', 'Dark mode for the storefront']).stdout);
    assert.equal((await c.post(`work/${pending}/actions/revise`, { text: 'Dark mode for the storefront and the admin', reason: 'Admin too.' })).status, 200);
    assert.match(JSON.stringify(await meta(root, pending)), /admin/);
    run(root, ['question', 'add', id, '--category', 'business', '--text', 'Which date format?']);
    assert.equal((await c.post(`work/${id}/actions/answer`, { question: 'Q-001', answer: 'ISO 8601.' })).status, 200);
    // Hold needs the version confirmation first; nothing changes until confirmed.
    const unconfirmed = await c.post(`work/${id}/actions/hold`, { reason: 'Waiting for the client.' });
    assert.equal(unconfirmed.status, 409);
    const confirmBody = await unconfirmed.json();
    assert.equal(confirmBody.error.code, 'CONFIRM_MINIMUM_VERSION');
    assert.match(confirmBody.error.message, /1\.3\.x and older/);
    assert.equal((await meta(root, id)).lifecycle, undefined);
    assert.equal((await c.post(`work/${id}/actions/hold`, { reason: 'Waiting for the client.', confirmMinimumVersion: true })).status, 200);
    assert.equal((await meta(root, id)).lifecycle.state, 'on_hold');
    // The lifecycle guard applies to console actions too.
    const guarded = await c.post(`work/${id}/actions/advance`);
    assert.equal(guarded.status, 409);
    assert.match((await guarded.json()).error.message, /on hold[\s\S]*work resume/);
    assert.equal((await c.post(`work/${id}/actions/resume`)).status, 200);
    assert.equal((await c.post(`work/${id}/actions/close`, { outcome: 'cancelled', reason: 'Dropped.' })).status, 200);
    assert.equal((await meta(root, id)).lifecycle.state, 'closed');
    assert.equal((await c.post(`work/${id}/actions/reopen`, { reason: 'Back on.' })).status, 200);
    assert.equal((await meta(root, id)).lifecycle, undefined);
  } finally {
    await c.close();
  }
});

test('request edits use full text before work starts and refuse stale or invalid saves', async () => {
  const root = await freshProject('yf-edit-request-');
  const original = 'Full request\n' + 'Detailed requirement. '.repeat(600);
  const id = routedBoundedChange(root, original);
  const c = await consoleOn(root);
  try {
    const before = await meta(root, id);
    const shown = await (await c.get(`work/${id}`)).json();
    assert.equal(shown.item.requestEditable, true);
    assert.equal(shown.request.raw, original);
    assert.notEqual(shown.item.title, original);
    const snapshot = await (await c.get('snapshot')).json();
    assert.equal(snapshot.items.find((item) => item.id === id).requestEditable, true);
    for (const text of ['', '   ', 'x'.repeat(20001)]) {
      assert.equal((await c.post(`work/${id}/actions/revise`, { text, reason: 'Correction.' })).status, 422);
      assert.deepEqual(await meta(root, id), before);
    }
    const revised = original + '\nAnother detail.';
    assert.equal((await c.post(`work/${id}/actions/revise`, { text: revised, reason: 'Added detail.' })).status, 200);
    assert.equal((await meta(root, id)).requestHistory[0].previousRequest, original);
    assert.equal((await (await c.get(`work/${id}`)).json()).request.raw, revised);
    assert.equal((await c.post(`work/${id}/actions/advance`)).status, 200);
    assert.equal((await (await c.get(`work/${id}`)).json()).item.requestEditable, false);
    assert.equal((await c.post(`work/${id}/actions/revise`, { text: 'Stale edit', reason: 'Opened before advance.' })).status, 409);
    assert.equal((await meta(root, id)).rawRequest, revised);
  } finally { await c.close(); }
});

test('action input is validated and values never become options', async () => {
  const root = await freshProject('yf-actions-validate-');
  const id = routedBoundedChange(root, 'Something');
  const c = await consoleOn(root);
  try {
    assert.equal((await c.post(`work/${id}/actions/explode`)).status, 404);
    assert.equal((await c.post(`work/${id}/actions/close`, { outcome: 'done', reason: 'x' })).status, 422);
    assert.equal((await c.post(`work/${id}/actions/hold`, { reason: '' })).status, 422);
    assert.equal((await c.post(`work/${id}/actions/answer`, { question: '--id=Q-001', answer: 'x' })).status, 422);
    assert.equal((await c.post(`work/${id}/actions/reopen`, { to: 'anywhere', reason: 'x' })).status, 422);
    // A reason that looks like an option stays a value: the hold is refused for the version, not parsed as a flag.
    const flagLike = await c.post(`work/${id}/actions/hold`, { reason: '--accept-minimum-version 1.4.0' });
    assert.equal(flagLike.status, 409);
    assert.equal((await flagLike.json()).error.code, 'CONFIRM_MINIMUM_VERSION');
    assert.equal((await meta(root, id)).lifecycle, undefined);
  } finally {
    await c.close();
  }
});

test('security: token, Origin, content type and read-only consoles guard every action and decision', async () => {
  const root = await freshProject('yf-actions-security-');
  const id = routedBoundedChange(root, 'Something');
  const c = await consoleOn(root);
  const url = (p) => `${c.server.url}api/p/${c.pid}/${p}`;
  try {
    for (const target of [`work/${id}/actions/advance`, `work/${id}/gates/specification/decision`]) {
      assert.equal((await fetch(url(target), { method: 'POST', headers: { Origin: c.origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401, `${target} without the token`);
      assert.equal((await fetch(url(target), { method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403, `${target} without an Origin`);
      assert.equal((await fetch(url(target), { method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403, `${target} from a foreign Origin`);
      assert.equal((await c.post(target, {}, { 'Content-Type': 'text/plain' })).status, 415, `${target} with a wrong content type`);
    }
    assert.equal((await c.get(`work/${id}/gates/specification`, {})).status, 401, 'the review material needs the token');
  } finally {
    await c.close();
  }
  const ro = await consoleOn(root, { readOnly: true });
  try {
    assert.equal((await ro.post(`work/${id}/actions/advance`)).status, 405);
    assert.equal((await ro.post(`work/${id}/gates/specification/decision`, {})).status, 405);
  } finally {
    await ro.close();
  }
});

test('gate decisions: material shown first, exact confirmation, stale and duplicate protection, console provenance', async () => {
  const root = await freshProject('yf-gates-');
  const id = await featureAtSpecReview(root);
  const c = await consoleOn(root);
  try {
    const shown = await (await c.get(`work/${id}/gates/specification`)).json();
    assert.equal(shown.gateStatus, 'awaiting_review');
    assert.match(shown.sections.map((entry) => entry.text).join('\n'), /never expire/, 'the specification text is shown');
    assert.deepEqual(shown.criteria.map((entry) => entry.id), ['AC-001']);
    assert.match(shown.digest, /^[0-9a-f]{64}$/);
    const base = { decision: 'approve', confirmGate: 'specification', note: 'Looks right to me.', requestedAt: shown.requestedAt, digest: shown.digest };
    const before = await reviews(root, id);

    // Incorrect confirmations and missing notes record nothing.
    for (const [body, status] of [[{ ...base, confirmGate: 'Specification' }, 422], [{ ...base, confirmGate: 'plan' }, 422], [{ ...base, note: '   ' }, 422], [{ ...base, decision: 'maybe' }, 422]]) {
      assert.equal((await c.post(`work/${id}/gates/specification/decision`, { ...body, requestId: `req-${Math.random().toString(36).slice(2, 12)}` })).status, status);
    }
    assert.deepEqual(await reviews(root, id), before);
    // Baseline and reconciliation keep their own commands.
    assert.equal((await c.post(`work/${id}/gates/baseline/decision`, { ...base, confirmGate: 'baseline', requestId: 'req-baseline-1' })).status, 422);

    // The material changed after it was shown: stale, nothing recorded.
    const workMd = path.join(root, '.yallaflow', 'work', id, 'work.md');
    const original = await readFile(workMd, 'utf8');
    await writeFile(workMd, original.replace('never expire', 'expire after a year'));
    const stale = await c.post(`work/${id}/gates/specification/decision`, { ...base, requestId: 'req-stale-0001' });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, 'STALE');
    assert.deepEqual(await reviews(root, id), before);
    await writeFile(workMd, original);

    // The decision: recorded once by the unchanged CLI command, as a console decision.
    const ok = await c.post(`work/${id}/gates/specification/decision`, { ...base, requestId: 'req-approve-01' });
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal((await ok.json()).recorded, 'console, identity not verified');
    const after = await reviews(root, id);
    assert.equal(after.gates.specification.status, 'approved');
    assert.deepEqual(Object.keys(after.gates.specification.provenance).sort(), ['claimedGitName', 'host', 'identity', 'via']);
    assert.equal(after.gates.specification.provenance.via, 'console');
    assert.equal(after.gates.specification.provenance.identity, 'not verified');
    assert.equal(after.gates.specification.history.at(-1).provenance.via, 'console', 'the audit history carries the provenance');
    assert.doesNotMatch(JSON.stringify(after), /verified":\s*true|authenticated|identity":\s*"verified/, 'never claims a verified identity');

    // Duplicate submissions never record twice.
    const again = await c.post(`work/${id}/gates/specification/decision`, { ...base, requestId: 'req-approve-01' });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).duplicate, true);
    const second = await c.post(`work/${id}/gates/specification/decision`, { ...base, requestId: 'req-approve-02' });
    assert.equal(second.status, 409, 'a second request for a decided gate is stale');
    assert.equal((await reviews(root, id)).gates.specification.history.filter((entry) => entry.status === 'approved').length, 1);

    // The read contract and the CLI show the provenance; doctor stays healthy.
    const detail = JSON.parse(run(root, ['work', 'show', id, '--json']).stdout);
    assert.equal(detail.gates.find((entry) => entry.gate === 'specification').provenance.identity, 'not verified');
    assert.equal(run(root, ['doctor'], { ok: false }).status, 0, run(root, ['doctor'], { ok: false }).stdout);
  } finally {
    await c.close();
  }
});

test('CLI decisions are recorded exactly as before (no provenance), and a bad provenance channel records nothing', async () => {
  const root = await freshProject('yf-gates-cli-');
  const id = await featureAtSpecReview(root);
  const bad = run(root, ['approve', id, '--stage', 'specification', '--note', 'x'], { ok: false, env: { YALLAFLOW_DECISION_PROVENANCE: '{"via":"agent"}' } });
  assert.notEqual(bad.status, 0);
  assert.equal((await reviews(root, id)).gates.specification.status, 'awaiting_review');
  run(root, ['approve', id, '--stage', 'specification', '--note', 'Approved by the owner in the CLI.']);
  const gate = (await reviews(root, id)).gates.specification;
  assert.equal(gate.status, 'approved');
  assert.equal('provenance' in gate, false);
  assert.equal('provenance' in gate.history.at(-1), false);
  assert.doesNotMatch(run(root, ['approve', id, '--stage', 'specification', '--note', 'again']).stdout, /console/);
});

test('the Agent Workspace never reaches gate decisions, and agents never inherit the provenance channel', async () => {
  const { readFile: read } = await import('node:fs/promises');
  const server = await read(new URL('../src/console/server.js', import.meta.url), 'utf8');
  const agentRoute = /const AGENT_ROUTE = (.*);/.exec(server)[1];
  assert.doesNotMatch(agentRoute, /gates|approve|feedback|decision/);
  const bridge = await read(new URL('../src/agents/bridge.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bridge, /setGateStatus|'approve'|'feedback'|YALLAFLOW_DECISION_PROVENANCE|decideGate|\/gates\//);
  assert.equal(process.env.YALLAFLOW_DECISION_PROVENANCE, undefined, 'never set on a console process');
});

test('review findings: re-deciding after "request changes", request ids per gate, malformed bodies, provenance limits, strict doctor', async () => {
  const root = await freshProject('yf-gates-review-');
  const id = await featureAtSpecReview(root);
  const c = await consoleOn(root);
  try {
    const decide = async (body) => c.post(`work/${id}/gates/specification/decision`, body);
    let shown = await (await c.get(`work/${id}/gates/specification`)).json();
    const base = { confirmGate: 'specification', note: 'Points must expire after a year.', requestedAt: shown.requestedAt, digest: shown.digest };
    assert.equal((await decide({ ...base, decision: 'request_changes', requestId: 'req-changes-01' })).status, 200);
    assert.equal((await reviews(root, id)).gates.specification.status, 'changes_requested');
    // A reused request id on another gate is not mistaken for the first decision.
    const otherGate = await c.post(`work/${id}/gates/plan/decision`, { decision: 'approve', requestId: 'req-changes-01' });
    assert.equal(otherGate.status, 422, 'validated first; never reported as a duplicate success for another gate');
    // The specification is revised; the console can decide the gate again.
    const workMd = path.join(root, '.yallaflow', 'work', id, 'work.md');
    await writeFile(workMd, (await readFile(workMd, 'utf8')).replace('never expire', 'expire after a year'));
    shown = await (await c.get(`work/${id}/gates/specification`)).json();
    assert.equal(shown.gateStatus, 'changes_requested');
    assert.match(shown.sections.map((entry) => entry.text).join('\n'), /expire after a year/);
    const again = await decide({ ...base, decision: 'approve', note: 'Now right.', requestedAt: shown.requestedAt, digest: shown.digest, requestId: 'req-approve-03' });
    assert.equal(again.status, 200, await again.clone().text());
    assert.equal((await reviews(root, id)).gates.specification.status, 'approved');
    // Malformed bodies are client errors, never 500.
    for (const raw of ['null', '[]', '"x"']) {
      const response = await fetch(`${c.server.url}api/p/${c.pid}/work/${id}/actions/hold`, { method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, Origin: c.origin, 'Content-Type': 'application/json' }, body: raw });
      assert.ok(response.status >= 400 && response.status < 500, `${raw} -> ${response.status}`);
      const gate = await fetch(`${c.server.url}api/p/${c.pid}/work/${id}/gates/specification/decision`, { method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, Origin: c.origin, 'Content-Type': 'application/json' }, body: raw });
      assert.ok(gate.status >= 400 && gate.status < 500, `decision ${raw} -> ${gate.status}`);
    }
    assert.equal((await c.post(`work/${id}/actions/hold`, { reason: 'bad\u0000reason' })).status, 422);
  } finally {
    await c.close();
  }
  // Console provenance never applies to the baseline or reconciliation gates.
  const refused = run(root, ['approve', id, '--stage', 'baseline', '--note', 'x'], { ok: false, env: { YALLAFLOW_DECISION_PROVENANCE: JSON.stringify({ via: 'console', host: 'h' }) } });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /does not apply to the baseline gate/);
  // Doctor rejects a provenance that claims more than "identity not verified".
  const file = path.join(root, '.yallaflow', 'work', id, 'reviews.yaml');
  const ledger = await reviews(root, id);
  ledger.gates.specification.provenance = { ...ledger.gates.specification.provenance, verified: true };
  await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.match(run(root, ['doctor'], { ok: false }).stdout, /provenance must be exactly/);
});

// PF-0061: pasted screenshots use the same intake pipeline when editing a request.
test('revision attachments preserve bytes, deduplicate retries and respect request-edit and HTTP guards', async () => {
  const root = await freshProject('yf-revision-files-');
  const id = routedBoundedChange(root, 'Screenshot request');
  const c = await consoleOn(root);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
  const upload = (target = id, extra = {}, body = png, suffix = 'revision-sources') => fetch(`${c.server.url}api/p/${c.pid}/work/${target}/${suffix}`, {
    method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, Origin: c.origin, 'Content-Type': 'application/octet-stream', 'X-Request-Id': 'revision-12345', 'X-File-Name': 'screenshot.png', ...extra }, body
  });
  try {
    assert.equal((await upload(id, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await upload(id, { Authorization: 'Bearer invalid' })).status, 401);
    assert.equal((await upload(id, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await upload(id, { 'X-File-Name': 'bad.svg' })).status, 415);
    assert.equal((await upload(id, {}, Buffer.alloc(0))).status, 400);
    assert.equal((await upload(id, {}, png, 'sources')).status, 403, 'creation request binding remains enforced');
    assert.equal((await c.post(`work/${id}/actions/revise`, { text: 'Updated with screenshot', reason: 'Visual reference' })).status, 200);
    const response = await upload(); assert.equal(response.status, 201, await response.clone().text());
    const first = await response.json(); assert.ok(first.source);
    const stored = await readFile(path.join(root, '.yallaflow', 'sources', first.source, 'screenshot.png'));
    assert.deepEqual(stored, png);
    const duplicate = await upload(); assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).source, first.source);
    assert.equal((await meta(root, id)).sources.length, 1);
    assert.equal((await meta(root, id)).requestHistory.length, 1);
    assert.equal((await (await c.get(`work/${id}`)).json()).item.requestEditable, true);
    run(root, ['advance', id]);
    assert.equal((await upload()).status, 409);
    assert.equal((await meta(root, id)).sources.length, 1);
    const untouched = routedBoundedChange(root, 'Held request');
    run(root, ['work', 'hold', untouched, '--reason', 'Waiting', '--accept-minimum-version', '1.4.0']);
    assert.equal((await upload(untouched)).status, 409);
    run(root, ['work', 'resume', untouched]);
    run(root, ['work', 'close', untouched, '--outcome', 'cancelled', '--reason', 'Cancelled']);
    assert.equal((await upload(untouched)).status, 409);
    const pending = createdWork(run(root, ['start', 'Pending request']).stdout);
    assert.equal((await upload(pending)).status, 201, 'unclassified requests can also receive screenshots');
    const ro = await consoleOn(root, { readOnly: true });
    try {
      const denied = await fetch(`${ro.server.url}api/p/${ro.pid}/work/${pending}/revision-sources`, { method: 'POST', headers: { Authorization: `Bearer ${ro.server.token}`, Origin: ro.origin, 'Content-Type': 'application/octet-stream' }, body: png });
      assert.equal(denied.status, 405);
    } finally { await ro.close(); }
  } finally { await c.close(); }
});

test('revision upload rechecks eligibility in the CLI if work starts after its queued check', async () => {
  const { attachFile } = await import('../src/console/create.js');
  const { Readable } = await import('node:stream');
  const root = await freshProject('yf-revision-race-');
  const id = routedBoundedChange(root, 'Request before race');
  const request = Readable.from([Buffer.from('reference text')]);
  request.headers = { 'x-request-id': 'revision-race-123', 'x-file-name': 'notes.txt' };
  const runner = { exclusive: async (cwd, callback) => callback(async (argv) => {
    run(root, ['advance', id]); // external CLI wins after the console eligibility check
    return run(cwd, argv, { ok: false });
  }) };
  await assert.rejects(attachFile(root, id, request, runner, { revision: true }), /already started/);
  assert.equal((await meta(root, id)).sources?.length ?? 0, 0);
});
