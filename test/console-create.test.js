// v1.2.0 Create Work: the console's only write. Core semantics (--keep-active, activate,
// request IDs, attestation), the HTTP guards, attachments, retries and concurrency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { MAX_UPLOAD_BYTES, safeFileName, titleFrom } from '../src/console/create.js';
import { parseStartArgs } from '../src/cli.js';
import { MAX_EXTRACTION_INPUT_BYTES } from '../src/intake/constants.js';
import { acquireWorkspaceLock } from '../src/utils/lock.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const created = (result) => /Created (PF-\d+)/.exec(result.stdout)?.[1];
const state = async (root) => JSON.parse(await readFile(path.join(root, '.yallaflow', 'state', 'current.yaml'), 'utf8'));
const meta = async (root, id) => JSON.parse(await readFile(path.join(root, '.yallaflow', 'work', id, 'meta.yaml'), 'utf8'));
const workIds = async (root) => (await readdir(path.join(root, '.yallaflow', 'work')).catch(() => [])).sort();

async function project(kind = 'greenfield') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-create-'));
  await initWorkspace(root, 'Shop', kind, 'adaptive');
  return root;
}

// ---------------------------------------------------------------- Core
test('start without new options behaves exactly as before (focus moves to the new item)', async () => {
  const root = await project();
  const a = created(run(root, ['change', 'First', '--scope', 'bounded']));
  const b = created(run(root, ['start', 'Second', 'request', '--', 'with', 'dashes']));
  assert.equal((await state(root)).activeWork, b);
  assert.equal((await meta(root, b)).rawRequest, 'Second request -- with dashes');
  assert.equal((await meta(root, b)).activation, undefined);
  assert.equal((await meta(root, b)).attestation, undefined);
  const c = created(run(root, ['start', '--keep-active', 'triage', 'mail']));
  assert.equal((await meta(root, c)).rawRequest, '--keep-active triage mail', 'without `--` the new options are plain request text, as before');
  const d = created(run(root, ['start', '--via', 'email', 'triage']));
  assert.equal((await meta(root, d)).rawRequest, '--via email triage');
  const e = created(run(root, ['start', '--keep-active', '--', '--help']));
  assert.equal((await meta(root, e)).rawRequest, '--help', 'after `--` even --help is the request');
  assert.notEqual(a, b);
});

test('parseStartArgs: new options only as leading tokens; anything else is the legacy request', () => {
  assert.deepEqual(parseStartArgs(['fix', 'the', '--keep-active', 'bug']), ['fix the --keep-active bug']);
  assert.deepEqual(parseStartArgs(['--', 'x']), ['-- x']);
  assert.deepEqual(parseStartArgs(['--keep-active', '--', '--via', 'y']), ['--via y', { keepActive: true }]);
  assert.deepEqual(parseStartArgs(['--keep-active', 'x']), ['--keep-active x']);
  assert.deepEqual(parseStartArgs(['--request-id', 'foo', 'bar']), ['--request-id foo bar']);
  assert.deepEqual(parseStartArgs(['--keep-active', '--via', 'console', '--request-id', 'abcd1234', '--', 'Add $(rm -rf /)']), ['Add $(rm -rf /)', { keepActive: true, via: 'console', requestId: 'abcd1234' }]);
  assert.throws(() => parseStartArgs(['--via', 'web', '--', 'x']), /--via must be console/);
  assert.throws(() => parseStartArgs(['--via', 'console', '--request-id', 'bad id!', '--', 'x']), /--request-id/);
  assert.throws(() => parseStartArgs(['--request-id', 'abcd1234', '--', 'x']), /requires --via console/);
});

test('--keep-active never replaces unfinished active work; routing and checkpoints never move focus; activate does', async () => {
  const root = await project();
  const active = created(run(root, ['change', 'Current task', '--scope', 'bounded']));
  const before = await state(root);
  const next = created(run(root, ['start', '--keep-active', '--', 'Export orders to CSV']));
  assert.deepEqual(await state(root), before, 'state/current.yaml is untouched');
  assert.equal((await meta(root, next)).activation.deferred, true);
  assert.equal((await meta(root, next)).activation.keptActive, active);
  const routed = run(root, ['route', next, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'User.', '--title', 'CSV export']);
  assert.equal(routed.status, 0, routed.stderr);
  assert.match(routed.stdout, /Not made active/);
  run(root, ['advance', next]);
  run(root, ['checkpoint', next, '--skill', 'context-discovery', '--complete', '--summary', 'Read the export code.']);
  assert.equal((await state(root)).activeWork, active, 'progress on the new item never switches focus');
  const activated = run(root, ['activate', next]);
  assert.equal(activated.status, 0, activated.stderr);
  assert.match(activated.stdout, new RegExp(`${next} is now the active work item \\(was ${active}\\)`));
  assert.equal((await state(root)).activeWork, next);
  assert.equal((await meta(root, next)).activation.deferred, false);
  assert.match(await readFile(path.join(root, '.yallaflow', 'work', next, 'progress.md'), 'utf8'), /Activated: now the active work item \(was PF-0001\)/);
  assert.equal(run(root, ['activate', 'PF-9999']).status, 1);
});

test('--keep-active never activates, even when no work item is active (owner decision)', async () => {
  const root = await project();
  const before = await state(root);
  const id = created(run(root, ['start', '--keep-active', '--', 'First request']));
  assert.deepEqual(await state(root), before, 'state/current.yaml is untouched');
  assert.equal((await state(root)).activeWork, null);
  assert.deepEqual({ ...(await meta(root, id)).activation, at: undefined }, { deferred: true, keptActive: null, at: undefined });
  const routed = run(root, ['route', id, '--type', 'bug', '--scope', 'bounded', '--confidence', 'high', '--reason', 'User.', '--title', 'Bug']);
  assert.equal(routed.status, 0, routed.stderr);
  assert.equal((await state(root)).activeWork, null, 'routing does not activate it either');
  assert.match(run(root, ['activate', id]).stdout, new RegExp(`${id} is now the active work item\\.`));
  assert.equal((await state(root)).activeWork, id);
  const plain = created(run(root, ['start', 'Plain CLI request']));
  assert.equal((await state(root)).activeWork, plain, 'start without the option still activates, as before');
});

test('console create with nothing active leaves nothing active', async () => {
  const root = await project();
  const { server, pid, post } = await serve([root]);
  try {
    const body = await (await post(`/api/p/${pid}/work`, { requestId: 'idle-00001', request: 'Add CSV export', type: 'feature', scope: 'bounded' })).json();
    assert.equal(body.deferred, true);
    assert.equal(body.keptActive, null);
    assert.equal((await state(root)).activeWork, null);
  } finally {
    await server.close();
  }
});

test('attachments report what YallaFlow could actually do with each file', async () => {
  const root = await project();
  const { server, pid, post } = await serve([root]);
  try {
    const { id } = await (await post(`/api/p/${pid}/work`, { requestId: 'avail-0001', request: 'Requirements with files' })).json();
    const upload = (name, bytes) => post(`/api/p/${pid}/work/${id}/sources`, bytes, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-Request-Id': 'avail-0001' }).then((r) => r.json());
    const md = await upload('notes.md', Buffer.from('# Notes\n'));
    assert.equal(md.contentAvailability, 'native-text');
    assert.equal(md.availabilityNote, null);
    const png = await upload('screen.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    assert.equal(png.contentAvailability, 'original-only');
    assert.match(png.availabilityNote, /preserved as the original only/);
    const pdf = await upload('broken.pdf', Buffer.from('%PDF-1.4 not really a pdf'));
    assert.equal(pdf.contentAvailability, 'original-only');
    assert.match(pdf.availabilityNote, /Text extraction failed/);
    const detail = await (await fetch(`${server.url}api/p/${pid}/work/${id}`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
    const byName = Object.fromEntries(detail.sources.map((source) => [source.name, source]));
    assert.equal(byName['notes.md'].contentAvailability, 'native-text');
    assert.equal(byName['screen.png'].contentAvailability, 'original-only');
    assert.match(byName['broken.pdf'].availabilityNote, /Text extraction failed/);
  } finally {
    await server.close();
  }
});

test('request IDs: a retried or concurrent request creates exactly one item, with an unverified console attestation', async () => {
  const root = await project();
  const args = ['start', '--keep-active', '--via', 'console', '--request-id', 'req-0001-abcd', '--', 'Add CSV export'];
  const results = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve) => {
    const { spawn } = require_child();
    const child = spawn(process.execPath, [cli, ...args], { cwd: root });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('close', (status) => resolve({ status, out }));
  })));
  assert.ok(results.every((r) => r.status === 0), JSON.stringify(results));
  assert.equal(results.filter((r) => /^Created PF-/m.test(r.out)).length, 1);
  assert.equal(results.filter((r) => /^Already created PF-0001 for request req-0001-abcd/m.test(r.out)).length, 5);
  assert.deepEqual(await workIds(root), ['PF-0001']);
  const attestation = (await meta(root, 'PF-0001')).attestation;
  assert.equal(attestation.recordedVia, 'console');
  assert.equal(attestation.verified, false);
  assert.equal(attestation.requestId, 'req-0001-abcd');
  assert.equal(attestation.claimedBy, undefined, 'no identity is invented');
  assert.match(await readFile(path.join(root, '.yallaflow', 'work', 'PF-0001', 'progress.md'), 'utf8'), /Created from the YallaFlow console \(local user, identity not verified\)/);
});

import { spawn as spawnChild } from 'node:child_process';
function require_child() { return { spawn: spawnChild }; }

test('helpers: titles come from the user\'s words; file names are reduced safely', () => {
  assert.equal(titleFrom('  Add CSV export\nDetails follow'), 'Add CSV export');
  assert.ok(titleFrom('word '.repeat(60)).length <= 91);
  assert.equal(safeFileName('..%2F..%2Fetc%2Fpasswd'), 'passwd');
  assert.equal(safeFileName('C:\\temp\\BRD v2.docx'), 'BRD v2.docx');
  assert.equal(safeFileName('a\u0000b<>.pdf'), 'ab.pdf');
  assert.equal(safeFileName('.hidden.md'), 'hidden.md');
  assert.equal(MAX_UPLOAD_BYTES, MAX_EXTRACTION_INPUT_BYTES, 'the console limit is Core\'s own');
});

// ---------------------------------------------------------------- HTTP
async function serve(roots, options = {}) {
  const server = await startConsoleServer({ roots, port: 0, ...options });
  const origin = server.url.replace(/\/$/, '');
  const projects = await (await fetch(`${server.url}api/projects`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
  const pid = projects.projects[0].id;
  const post = (pathname, body, headers = {}) => fetch(`${server.url}${pathname.slice(1)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${server.token}`, Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)
  });
  return { server, pid, post, origin, projects };
}

test('POST guards: token, Origin, Host, content type, size, read-only, unknown routes', async () => {
  const root = await project();
  const { server, pid, post, origin } = await serve([root]);
  try {
    const body = JSON.stringify({ requestId: 'guard-0001', request: 'x' });
    const raw = (headers) => fetch(`${server.url}api/p/${pid}/work`, { method: 'POST', headers, body });
    assert.equal((await raw({ Origin: origin, 'Content-Type': 'application/json' })).status, 401);
    assert.equal((await raw({ Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' })).status, 403, 'a missing Origin is refused for writes');
    assert.equal((await raw({ Authorization: `Bearer ${server.token}`, Origin: 'http://evil.example', 'Content-Type': 'application/json' })).status, 403);
    assert.equal((await post(`/api/p/${pid}/work`, body, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post(`/api/p/${pid}/work`, 'x'.repeat(70 * 1024))).status, 413);
    assert.equal((await post(`/api/p/${pid}/work`, '{not json')).status, 400);
    assert.equal((await post(`/api/p/${pid}/work`, { requestId: 'guard-0002', request: ' ' })).status, 400);
    assert.equal((await post(`/api/p/${pid}/work`, { requestId: 'guard-0003', request: 'x', scope: 'bounded' })).status, 400, 'no size without a type');
    assert.equal((await post(`/api/p/${pid}/work`, { requestId: 'guard-0004', request: 'x', type: 'feature' })).status, 400, 'a type needs a size');
    const combo = await post(`/api/p/${pid}/work`, { requestId: 'guard-0005', request: 'x', type: 'feature', scope: 'spike' });
    assert.equal(combo.status, 422);
    assert.match((await combo.json()).error.message, /Unsupported routing combination/);
    assert.equal((await post(`/api/p/${pid}/snapshot`, {})).status, 405, 'no other route accepts POST');
    assert.equal((await post(`/api/p/0000000000/work`, {})).status, 404, 'unknown project');
    assert.equal((await fetch(`${server.url}api/p/${pid}/work`, { method: 'PUT', headers: { Authorization: `Bearer ${server.token}`, Origin: origin } })).status, 405);
    assert.deepEqual(await workIds(root), [], 'nothing was created by a refused request');
  } finally {
    await server.close();
  }
  const ro = await serve([root], { readOnly: true });
  try {
    assert.equal(ro.projects.readOnly, true);
    assert.equal((await ro.post(`/api/p/${ro.pid}/work`, { requestId: 'ro-000001', request: 'x' })).status, 405);
    assert.deepEqual(await workIds(root), []);
  } finally {
    await ro.server.close();
  }
});

test('create: unclassified and classified items through Core; shell text stored verbatim; focus kept', async () => {
  const root = await project();
  const active = created(run(root, ['change', 'Current task', '--scope', 'bounded']));
  const { server, pid, post } = await serve([root]);
  try {
    const text = 'Export orders $(touch PWNED) `id`; rm -rf ./x && echo "done" > out.txt';
    const free = await post(`/api/p/${pid}/work`, { requestId: 'create-0001', request: text });
    assert.equal(free.status, 201);
    const a = await free.json();
    assert.equal(a.item.routing, 'pending');
    assert.equal(a.item.state, 'new');
    assert.match(a.item.nextAction, new RegExp(`yallaflow route ${a.id}`), 'the real next valid action from Core');
    assert.equal(a.deferred, true);
    assert.equal(a.keptActive, active);
    assert.equal((await meta(root, a.id)).rawRequest, text);
    assert.deepEqual((await readdir(root)).filter((name) => ['PWNED', 'out.txt'].includes(name)), [], 'nothing executed');

    const typed = await post(`/api/p/${pid}/work`, { requestId: 'create-0002', request: 'Fix VAT rounding on invoices\nThe total is off by one cent.', type: 'bug', scope: 'bounded' });
    assert.equal(typed.status, 201);
    const b = await typed.json();
    assert.equal(b.item.type, 'bug');
    assert.equal(b.item.scope, 'bounded');
    assert.equal(b.item.title, 'Fix VAT rounding on invoices');
    assert.equal(b.item.routing, 'routed');
    assert.equal((await meta(root, b.id)).routingReason, 'Classified by the user in the YallaFlow console.');
    assert.equal((await state(root)).activeWork, active, 'creating from the console never replaces active work');

    const again = await post(`/api/p/${pid}/work`, { requestId: 'create-0002', request: 'Fix VAT rounding on invoices', type: 'bug', scope: 'bounded' });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).id, b.id, 'a retry returns the same item');
    const snap = await (await fetch(`${server.url}api/p/${pid}/snapshot`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
    assert.deepEqual(snap.items.map((item) => item.id).sort(), [active, a.id, b.id].sort(), 'the created items are in the Flow');
  } finally {
    await server.close();
  }
});

test('create: concurrent requests get distinct IDs; repeated ones never duplicate', async () => {
  const root = await project();
  const { server, pid, post } = await serve([root]);
  try {
    const bodies = [1, 2, 3, 4].flatMap((n) => [n, n].map(() => ({ requestId: `conc-000${n}`, request: `Request ${n}` })));
    const results = await Promise.all(bodies.map((body) => post(`/api/p/${pid}/work`, body).then((r) => r.json())));
    const ids = new Map();
    for (const [index, result] of results.entries()) ids.set(bodies[index].requestId, [...(ids.get(bodies[index].requestId) ?? []), result.id]);
    for (const [, list] of ids) assert.equal(new Set(list).size, 1, 'both copies of a request got the same item');
    assert.equal(new Set([...ids.values()].map((list) => list[0])).size, 4);
    assert.equal((await workIds(root)).length, 4);
  } finally {
    await server.close();
  }
});

test('brownfield without approved understanding: Core refuses and nothing is created', async () => {
  const root = await project('brownfield');
  await writeFile(path.join(root, 'package.json'), '{"name":"legacy"}');
  const { server, pid, post } = await serve([root]);
  try {
    const response = await post(`/api/p/${pid}/work`, { requestId: 'brown-0001', request: 'Fix invoice totals' });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error.message, /understanding|baseline/i);
    assert.deepEqual(await workIds(root), []);
  } finally {
    await server.close();
  }
});

test('attachments: preserved through intake, deduplicated on retry, refused safely, temp files removed, item kept', async () => {
  const root = await project();
  // Uploads land under os.tmpdir(): point it at a fresh folder so leftovers are exact.
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'yf-uploads-'));
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  const { server, pid, post } = await serve([root]);
  try {
    const { id } = await (await post(`/api/p/${pid}/work`, { requestId: 'attach-0001', request: 'Build the BRD scope' })).json();
    const upload = (name, bytes, requestId = 'attach-0001', target = id) => post(`/api/p/${pid}/work/${target}/sources`, bytes, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-Request-Id': requestId });
    const brd = Buffer.from('# BRD\n\nUsers export orders to CSV.\n');

    const first = await upload('../../BRD v1.md', brd);
    assert.equal(first.status, 201);
    const one = await first.json();
    assert.match(one.source, /^SRC-\d+$/);
    assert.equal(one.name, 'BRD v1.md');
    const retry = await upload('BRD v1.md', brd);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { source: one.source, name: 'BRD v1.md', duplicate: true, contentAvailability: 'native-text', availabilityNote: null });
    const sources = (await meta(root, id)).sources;
    assert.equal(sources.length, 1, 'a retried upload never adds a second copy');
    assert.match(await readFile(path.join(root, '.yallaflow', 'work', id, 'progress.md'), 'utf8'), /attached from the YallaFlow console \(local user, identity not verified\)/);

    assert.equal((await upload('tool.exe', Buffer.from('MZ'))).status, 415);
    assert.equal((await upload('empty.md', Buffer.alloc(0))).status, 400);
    assert.equal((await upload('noext', brd)).status, 400);
    // A Core refusal after the file was received (here: the workspace is busy) is reported,
    // the item stays, and the same upload can be retried safely.
    const releaseLock = await acquireWorkspaceLock(root, { command: 'test holder' });
    process.env.YALLAFLOW_LOCK_TIMEOUT_MS = '300';
    let busy;
    try {
      busy = await upload('notes.txt', Buffer.from('More notes'));
    } finally {
      delete process.env.YALLAFLOW_LOCK_TIMEOUT_MS;
      await releaseLock();
    }
    assert.equal(busy.status, 503);
    const busyBody = await busy.json();
    assert.equal(busyBody.error.code, 'WORKSPACE_BUSY');
    assert.match(busyBody.error.message, /busy|lock/i);
    assert.equal((await meta(root, id)).sources.length, 1, 'nothing half-attached');
    assert.equal((await upload('notes.txt', Buffer.from('More notes'))).status, 201, 'the retry succeeds');
    const other = created(run(root, ['change', 'Unrelated', '--scope', 'bounded']));
    assert.equal((await upload('BRD.md', brd, 'attach-0001', other)).status, 403, 'only the item this request created');
    assert.equal((await upload('BRD.md', brd, 'attach-9999')).status, 403);

    const show = await (await fetch(`${server.url}api/p/${pid}/work/${id}`, { headers: { Authorization: `Bearer ${server.token}` } })).json();
    assert.equal(show.item.id, id, 'the created item stays intact after failed attachments');
    assert.equal(show.sources.length, 2);
  } finally {
    await server.close();
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
  }
  assert.deepEqual((await readdir(tmp)).filter((name) => name.startsWith('yallaflow-upload-')), [], 'every private upload folder was removed');
});

test('an oversized upload is refused before it is stored', async () => {
  const root = await project();
  const { server, pid, post } = await serve([root]);
  try {
    const { id } = await (await post(`/api/p/${pid}/work`, { requestId: 'big-00001', request: 'Large file' })).json();
    const response = await fetch(`${server.url}api/p/${pid}/work/${id}/sources`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${server.token}`, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/octet-stream', 'X-File-Name': 'big.pdf', 'X-Request-Id': 'big-00001', 'Content-Length': String(MAX_UPLOAD_BYTES + 1) },
      body: Buffer.alloc(1)
    }).catch((error) => ({ status: 'aborted', error }));
    assert.ok(response.status === 413 || response.status === 'aborted', String(response.status));
    assert.equal((await meta(root, id)).sources, undefined);
  } finally {
    await server.close();
  }
});

// Independent review findings (PF-0032 code review), each reproduced before the fix.
test('review: requests starting with "-" keep their classification; "--help" is plain text', async () => {
  const root = await project();
  const { server, pid, post } = await serve([root]);
  try {
    for (const [n, request] of [[1, '-h\nFix login'], [2, '--fix the login page'], [3, '--help']]) {
      const response = await post(`/api/p/${pid}/work`, { requestId: `dash-000${n}`, request, type: 'bug', scope: 'bounded' });
      assert.equal(response.status, 201, request);
      const body = await response.json();
      assert.equal(body.classifyError, undefined, request);
      assert.equal(body.item.routing, 'routed', request);
      assert.equal((await meta(root, body.id)).rawRequest, request.trim());
    }
  } finally {
    await server.close();
  }
});

test('review: two identical uploads at once store one copy; a long non-ASCII name is shortened, not leaked', async () => {
  const root = await project();
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'yf-uploads-'));
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  const { server, pid, post } = await serve([root]);
  try {
    const { id } = await (await post(`/api/p/${pid}/work`, { requestId: 'twice-0001', request: 'Upload twice' })).json();
    const upload = (name, bytes) => post(`/api/p/${pid}/work/${id}/sources`, bytes, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-Request-Id': 'twice-0001' });
    const bytes = Buffer.from('# Same BRD\n');
    const both = await Promise.all([upload('BRD.md', bytes), upload('BRD.md', bytes)]);
    const bodies = await Promise.all(both.map((r) => r.json()));
    assert.equal(new Set(bodies.map((b) => b.source)).size, 1, JSON.stringify(bodies));
    assert.equal(bodies.filter((b) => b.duplicate).length, 1);
    assert.equal((await meta(root, id)).sources.length, 1);
    const long = await upload(`${'规'.repeat(110)}.md`, Buffer.from('long name'));
    assert.equal(long.status, 201);
    const stored = await long.json();
    assert.ok(Buffer.byteLength(stored.name) <= 200 && stored.name.endsWith('.md'), stored.name);
  } finally {
    await server.close();
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
  }
  assert.deepEqual((await readdir(tmp)).filter((name) => name.startsWith('yallaflow-upload-')), []);
});

test('resume on a deferred item says how to activate it, and changes nothing', async () => {
  const root = await project();
  const active = created(run(root, ['change', 'Current task', '--scope', 'bounded']));
  const id = created(run(root, ['start', '--keep-active', '--', 'Later request']));
  const before = await state(root);
  const out = run(root, ['resume', id]).stdout;
  assert.match(out, new RegExp(`Current workspace focus remains ${active}`));
  assert.match(out, new RegExp(`yallaflow activate ${id}`));
  assert.deepEqual(await state(root), before);
});
