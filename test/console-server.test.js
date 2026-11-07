// v1.2.0 `yallaflow console` server: loopback-only, token-guarded, read-only, live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { loadSchema, validate } from '../test-support/schema.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (root, args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
};

// Raw request (fetch cannot forge Host), resolving { status, headers, body }.
function request(server, pathname, { method = 'GET', headers = {}, auth = true } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path: pathname, method, headers: { Host: `127.0.0.1:${server.port}`, ...(auth ? { Authorization: `Bearer ${server.token}` } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}
const json = (response) => JSON.parse(response.body.toString('utf8'));

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-console-'));
  await initWorkspace(root, 'demo', 'greenfield', 'adaptive');
  const id = /Created (PF-\d+)/.exec(run(root, ['start', 'Add CSV export']).stdout)[1];
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.']);
  await writeFile(path.join(root, 'brd.md'), '# Export\nOrders as CSV.\n');
  await writeFile(path.join(root, 'shot.png'), Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'));
  run(root, ['intake', 'add', id, path.join(root, 'brd.md'), path.join(root, 'shot.png')]);
  return { root, id };
}

async function treeHash(root) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else { hash.update(path.relative(root, full)); hash.update(await readFile(full)); hash.update(String((await stat(full)).mtimeMs)); }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

test('security: loopback host, token, origin, read-only methods and ID-only paths', async () => {
  const { root } = await project();
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    assert.equal((await request(server, '/')).status, 200, 'the UI shell carries no data and needs no token');
    assert.match((await request(server, '/')).headers['content-security-policy'], /script-src 'self'/);
    assert.equal((await request(server, '/api/projects', { auth: false })).status, 401);
    assert.equal((await request(server, '/api/projects', { headers: { Authorization: 'Bearer wrong' }, auth: false })).status, 401);
    assert.equal((await request(server, '/api/projects', { headers: { Host: 'evil.example:80' } })).status, 421);
    assert.equal((await request(server, '/api/projects', { headers: { Origin: 'http://evil.example' } })).status, 403);
    // 1.4.0 (PF-0057): registering a project is a write — it needs the console page's Origin.
    assert.equal((await request(server, '/api/projects', { method: 'POST' })).status, 403);
    assert.equal((await request(server, '/api/snapshot', { method: 'POST' })).status, 405, 'other paths stay read-only');
    assert.equal((await request(server, '/api/projects', { method: 'DELETE' })).status, 405);
    const pid = json(await request(server, '/api/projects')).projects[0].id;
    for (const bad of [`/api/p/${pid}/sources/..%2F..%2Fconfig.yaml/original`, `/api/p/${pid}/work/..%2Fmeta`, '/../package.json', '/app.js/../../package.json', `/api/p/nope/snapshot`]) {
      assert.equal((await request(server, bad)).status, 404, bad);
    }
    assert.equal(server.url.startsWith('http://127.0.0.1:'), true);
  } finally {
    await server.close();
  }
});

test('serves the snapshot, work detail and preserved sources by ID', async () => {
  const { root, id } = await project();
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const pid = json(await request(server, '/api/projects')).projects[0].id;
    const snapshot = json(await request(server, `/api/p/${pid}/snapshot`));
    assert.deepEqual(validate(loadSchema('snapshot-1.schema.json'), snapshot), []);
    const detail = json(await request(server, `/api/p/${pid}/work/${id}`));
    assert.deepEqual(validate(loadSchema('work-1.schema.json'), detail), []);
    assert.equal(detail.sources.length, 2);
    const [md, png] = ['brd.md', 'shot.png'].map((name) => detail.sources.find((entry) => entry.name === name));
    const text = await request(server, `/api/p/${pid}/sources/${md.id}/original`);
    assert.equal(text.status, 200);
    assert.match(text.headers['content-type'], /^text\/plain/);
    assert.match(text.headers['content-security-policy'], /sandbox/);
    assert.equal(text.headers['x-content-type-options'], 'nosniff');
    assert.match(text.body.toString(), /Orders as CSV/);
    const image = await request(server, `/api/p/${pid}/sources/${png.id}/original`);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.equal((await request(server, `/api/p/${pid}/sources/SRC-0999/original`)).status, 404);
    const missing = await request(server, `/api/p/${pid}/work/PF-0999`);
    assert.equal(missing.status, 404);
    assert.equal(json(missing).error.code, 'WORK_NOT_FOUND');
  } finally {
    await server.close();
  }
});

test('live: a CLI write reaches an open event stream within 2 seconds and refreshes the data', async () => {
  const { root, id } = await project();
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const pid = json(await request(server, '/api/projects')).projects[0].id;
    const before = json(await request(server, `/api/p/${pid}/snapshot`)).items[0].stage;
    const events = await fetch(`${server.url}api/events`, { headers: { Authorization: `Bearer ${server.token}` } });
    const reader = events.body.getReader();
    await reader.read(); // hello
    const started = Date.now();
    run(root, ['advance', id]);
    let received = null;
    while (!received) {
      const { value } = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('no event within 5 s')), 5000))]);
      const text = new TextDecoder().decode(value);
      if (text.includes('"type":"change"')) received = Date.now();
    }
    const elapsed = received - started;
    assert.ok(elapsed < 2000, `change event after ${elapsed} ms`);
    const after = json(await request(server, `/api/p/${pid}/snapshot`)).items[0].stage;
    assert.notEqual(after, before, 'the cache was invalidated');
    await reader.cancel();
  } finally {
    await server.close();
  }
});

test('the console never writes: browsing every route leaves the workspace byte-identical', async () => {
  const { root, id } = await project();
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: root });
  const before = await treeHash(root);
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const pid = json(await request(server, '/api/projects')).projects[0].id;
    const detail = json(await request(server, `/api/p/${pid}/work/${id}`));
    for (const pathname of ['/', '/app.js', '/app.css', `/api/p/${pid}/snapshot`, `/api/p/${pid}/work/${id}`, ...detail.sources.flatMap((s) => [`/api/p/${pid}/sources/${s.id}/original`, `/api/p/${pid}/sources/${s.id}/text`])]) {
      await request(server, pathname);
    }
    await request(server, '/api/projects', { method: 'POST' });
  } finally {
    await server.close();
  }
  assert.equal(await treeHash(root), before);
});

test('extracted text cannot be read outside its source directory; HEAD never opens the event stream', async () => {
  const { root, id } = await project();
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const pid = json(await request(server, '/api/projects')).projects[0].id;
    const source = json(await request(server, `/api/p/${pid}/work/${id}`)).sources[0];
    await writeFile(path.join(root, 'outside.txt'), 'SECRET-OUTSIDE');
    const recordFile = path.join(root, '.yallaflow', 'sources', source.id, 'source.json');
    const record = JSON.parse(await readFile(recordFile, 'utf8'));
    await writeFile(recordFile, JSON.stringify({ ...record, contentAvailability: 'extracted', representation: { path: '../outside.txt' } }));
    const response = await request(server, `/api/p/${pid}/sources/${source.id}/text`);
    assert.notEqual(response.status, 200);
    assert.doesNotMatch(response.body.toString(), /SECRET-OUTSIDE/);
    const cliShow = spawnSync(process.execPath, [cli, 'source', 'show', source.id, '--content'], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(cliShow.stdout, /SECRET-OUTSIDE/);
    const head = await request(server, '/api/events', { method: 'HEAD' });
    assert.equal(head.status, 405);
  } finally {
    await server.close();
  }
});
