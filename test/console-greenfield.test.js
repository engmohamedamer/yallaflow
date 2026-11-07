// 1.4.0 Greenfield journey in the console (PF-0057): home-bounded folder chooser, project
// registration (no duplicates, retry by plan), stepper creation with full-hash confirmation,
// planned attachments, Git init, guided runtime setup and enabling agents for one run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { loadRegistry, registryPath } from '../src/console/registry.js';
import { runtimeAddArgs } from '../src/console/greenfield.js';

const SUPPORTED = process.platform !== 'win32';

function request(server, pathname, { method = 'GET', headers = {}, body = null, auth = true, origin = method === 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.port, path: pathname, method,
      headers: { Host: `127.0.0.1:${server.port}`, ...(auth ? { Authorization: `Bearer ${server.token}` } : {}), ...(origin ? { Origin: `http://127.0.0.1:${server.port}` } : {}), ...(body !== null && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}), ...headers }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(Buffer.isBuffer(body) ? body : JSON.stringify(body));
    req.end();
  });
}
const post = (server, pathname, body, options = {}) => request(server, pathname, { method: 'POST', body, ...options });

// A fake home folder for the test process (os.homedir() reads $HOME on POSIX).
async function withHome(fn) {
  const previous = process.env.HOME;
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'yf-home-')));
  process.env.HOME = home;
  try {
    return await fn(home);
  } finally {
    process.env.HOME = previous;
  }
}

async function waitFor(fn, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

test('folder chooser: directories inside home only, no hidden folders or files, no symlink escape, markers, Unicode', { skip: !SUPPORTED }, () => withHome(async (home) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'yf-outside-'));
  await mkdir(path.join(home, 'Projects', 'مشاريع جديدة'), { recursive: true });
  await mkdir(path.join(home, 'Projects', 'with git', '.git'), { recursive: true });
  await mkdir(path.join(home, 'Projects', 'yf-project', '.yallaflow'), { recursive: true });
  await writeFile(path.join(home, 'Projects', 'yf-project', 'readme.md'), 'x');
  await mkdir(path.join(home, '.secret'));
  await writeFile(path.join(home, 'notes.txt'), 'private');
  await symlink(outside, path.join(home, 'escape'));
  await symlink(path.join(home, 'Projects'), path.join(home, 'shortcut'));
  const server = await startConsoleServer({ roots: [], port: 0 });
  try {
    const top = await request(server, '/api/fs/dirs');
    assert.equal(top.status, 200);
    assert.equal(top.data.path, home);
    assert.equal(top.data.parent, null);
    assert.deepEqual(top.data.folders.map((f) => f.name), ['Projects', 'shortcut'], 'no hidden folder, no file, no link that leaves home');
    const projects = await request(server, `/api/fs/dirs?path=${encodeURIComponent(path.join(home, 'Projects'))}`);
    const byName = Object.fromEntries(projects.data.folders.map((f) => [f.name, f]));
    assert.equal(byName['with git'].git, true);
    assert.equal(byName['yf-project'].yallaflow, true);
    assert.equal(byName['مشاريع جديدة'].empty, true);
    assert.equal(projects.data.parent, home);
    assert.ok(!JSON.stringify(projects.data).includes('readme.md'), 'file names are never listed');
    for (const bad of [outside, path.join(home, 'escape'), path.join(home, 'Projects', '..', '..'), '/etc', 'relative/path']) {
      const res = await request(server, `/api/fs/dirs?path=${encodeURIComponent(bad)}`);
      assert.ok([400, 403].includes(res.status), `${bad} → ${res.status}`);
    }
    assert.equal((await request(server, `/api/fs/dirs?path=${encodeURIComponent(path.join(home, 'notes.txt'))}`)).status, 400);
    assert.equal((await request(server, '/api/fs/dirs', { auth: false })).status, 401);
  } finally {
    await server.close();
  }
  const readOnly = await startConsoleServer({ roots: [], port: 0, readOnly: true });
  try {
    assert.equal((await request(readOnly, '/api/fs/dirs')).status, 405, 'a read-only console chooses no folders');
  } finally {
    await readOnly.close();
  }
}));

test('registration: an existing YallaFlow project inside home is added once, live; others are refused', { skip: !SUPPORTED }, () => withHome(async (home) => {
  const root = path.join(home, 'Work', 'my shop');
  await mkdir(root, { recursive: true });
  await initWorkspace(root, 'shop', 'greenfield', 'adaptive');
  await mkdir(path.join(home, 'plain'));
  const server = await startConsoleServer({ roots: [], port: 0 });
  try {
    const first = await post(server, '/api/projects', { root });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.data.added, true);
    const again = await post(server, '/api/projects', { root });
    assert.equal(again.data.added, false, 'no duplicate');
    assert.equal(again.data.id, first.data.id);
    const listed = (await request(server, '/api/projects')).data.projects;
    assert.deepEqual(listed.map((p) => p.root), [root]);
    assert.equal((await request(server, `/api/p/${first.data.id}/snapshot`)).status, 200, 'usable without a restart');
    assert.equal((await loadRegistry(registryPath())).projects.filter((p) => p.root === root).length, 1);
    assert.equal((await post(server, '/api/projects', { root: path.join(home, 'plain') })).status, 422);
    assert.equal((await post(server, '/api/projects', { root: os.tmpdir() })).status, 403);
    assert.equal((await post(server, '/api/projects', { root, extra: 1 })).status, 400);
    assert.equal((await post(server, '/api/projects', { root }, { origin: false })).status, 403, 'a write needs the console Origin');
  } finally {
    await server.close();
  }
  const readOnly = await startConsoleServer({ roots: [], port: 0, readOnly: true });
  try {
    assert.equal((await post(readOnly, '/api/projects', { root })).status, 405);
  } finally {
    await readOnly.close();
  }
}));

test('stepper creation: full-hash confirmation, server-side registration, planned attachments, Git, retry without duplicates', { skip: !SUPPORTED }, () => withHome(async (home) => {
  const parent = path.join(home, 'New Projects مشاريع');
  await mkdir(parent);
  const brief = Buffer.from('# Notebook\nTeams keep meeting notes.\n');
  const sha256 = createHash('sha256').update(brief).digest('hex');
  const server = await startConsoleServer({ roots: [], port: 0 });
  try {
    const plan = await post(server, '/api/new/plan', { name: 'notebook', parent, stack: 'empty', description: 'A shared notebook for teams.', requirements: '- Create notebooks', environment: 'later', git: true, files: [{ name: 'brief.md', size: brief.length, sha256 }] });
    assert.equal(plan.status, 200, plan.text);
    assert.equal(plan.data.body.git, true);
    assert.deepEqual(plan.data.body.attachments, [{ name: 'brief.md', size: brief.length, sha256 }]);
    // A different (or changed) plan hash is refused; nothing is created.
    const wrong = await post(server, '/api/new/create', { planId: plan.data.id, confirm: 'f'.repeat(64) });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.data.error.code, 'NEW_PROJECT_CONFIRM');
    const started = await post(server, '/api/new/create', { planId: plan.data.id, confirm: plan.data.hash });
    assert.equal(started.status, 200, started.text);
    const progress = await waitFor(async () => {
      const res = await request(server, `/api/new/plans/${plan.data.id}`);
      return res.data.outcome ? res.data : null;
    });
    assert.equal(progress.outcome.ok, true, JSON.stringify(progress.outcome));
    assert.equal(progress.outcome.registration.ok, true, 'registered by the server when creation finished');
    const root = path.join(parent, 'notebook');
    const listed = (await request(server, '/api/projects')).data.projects;
    assert.deepEqual(listed.map((p) => p.root), [root]);
    assert.ok(spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root }).status === 0, 'Git initialized');
    // Retry registration by plan id: same project, never a second one.
    const retry = await post(server, '/api/projects', { planId: plan.data.id });
    assert.equal(retry.data.added, false);
    assert.equal((await request(server, '/api/projects')).data.projects.length, 1);
    // Attachments: only the reviewed file, once.
    const upload = (bytes, name = 'brief.md') => post(server, `/api/new/plans/${plan.data.id}/files`, bytes, { headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) } });
    assert.equal((await upload(Buffer.from('# Something else, same size!!!!!!!!!!\n'.slice(0, brief.length)))).status, 409, 'different bytes are refused');
    const attached = await upload(brief);
    assert.equal(attached.status, 201, attached.text);
    const meta = JSON.parse(await readFile(path.join(root, '.yallaflow', 'work', progress.outcome.workId, 'meta.yaml'), 'utf8'));
    assert.equal(meta.sources.length, 1);
    assert.equal((await upload(brief)).status, 200, 'a second upload stores no second copy');
    assert.equal(meta.titleHint, 'notebook: A shared notebook for teams.');
    assert.equal(JSON.parse(await readFile(path.join(root, '.yallaflow', 'state', 'current.yaml'), 'utf8')).activeWork, null, 'nothing is activated');
  } finally {
    await server.close();
  }
}));

test('a plan that installs dependencies needs the project name typed', { skip: !SUPPORTED }, () => withHome(async (home) => {
  const server = await startConsoleServer({ roots: [], port: 0 });
  try {
    const plan = await post(server, '/api/new/plan', { name: 'web', parent: home, stack: 'react-vite', install: true });
    assert.equal(plan.status, 200, plan.text);
    const refused = await post(server, '/api/new/create', { planId: plan.data.id, confirm: plan.data.hash });
    assert.equal(refused.status, 422);
    assert.equal(refused.data.error.code, 'NEW_PROJECT_CONFIRM_NAME');
    assert.equal((await post(server, '/api/new/create', { planId: plan.data.id, confirm: plan.data.hash, confirmName: 'wrong' })).status, 422);
  } finally {
    await server.close();
  }
}));

test('Git init: explicit, once, never inside another repository; refused read-only', { skip: !SUPPORTED }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-git-'));
  await initWorkspace(root, 'g', 'greenfield', 'adaptive');
  const repo = await mkdtemp(path.join(os.tmpdir(), 'yf-repo-'));
  spawnSync('git', ['init', '--quiet'], { cwd: repo });
  const inner = path.join(repo, 'inner');
  await mkdir(inner);
  await initWorkspace(inner, 'i', 'greenfield', 'adaptive');
  const server = await startConsoleServer({ roots: [root, inner], port: 0 });
  try {
    const [p, q] = (await request(server, '/api/projects')).data.projects;
    assert.equal((await post(server, `/api/p/${p.id}/git/init`, {})).status, 400, 'needs confirmation');
    const done = await post(server, `/api/p/${p.id}/git/init`, { confirm: true });
    assert.equal(done.status, 200, done.text);
    assert.deepEqual(done.data, { initialized: true, remote: false, commit: false });
    assert.notEqual(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root }).status, 0, 'no commit');
    assert.equal((await post(server, `/api/p/${p.id}/git/init`, { confirm: true })).status, 409);
    assert.equal((await post(server, `/api/p/${q.id}/git/init`, { confirm: true })).status, 409, 'inside another repository');
  } finally {
    await server.close();
  }
  const readOnly = await startConsoleServer({ roots: [root], port: 0, readOnly: true });
  try {
    const [p] = (await request(readOnly, '/api/projects')).data.projects;
    assert.equal((await post(readOnly, `/api/p/${p.id}/git/init`, { confirm: true })).status, 405);
  } finally {
    await readOnly.close();
  }
});

test('runtime setup: Core runtime add with option-safe arguments; the service is defined, not trusted, not running', { skip: !SUPPORTED }, async () => {
  assert.deepEqual(runtimeAddArgs({ id: 'web', name: '--kind=docker-compose', kind: 'process', cwd: '.', ports: [5173], env: ['API_URL'], argv: ['npm', 'run', 'dev'] }),
    ['runtime', 'add', 'web', '--name=--kind=docker-compose', '--kind=process', '--cwd=.', '--port=5173', '--env=API_URL', '--', 'npm', 'run', 'dev']);
  assert.throws(() => runtimeAddArgs({ id: 'web', name: 'Web', kind: 'process', argv: ['x'], env: ['SECRET=value'] }), /variable names only/);
  assert.throws(() => runtimeAddArgs({ id: 'Web!', name: 'Web', kind: 'process', argv: ['x'] }), /service id/);
  assert.throws(() => runtimeAddArgs({ id: 'web', name: 'Web', kind: 'shell', argv: ['x'] }), /kind/);
  assert.throws(() => runtimeAddArgs({ fromSuggestion: '1', argv: ['x'] }), /as it is/);
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-rt-'));
  await initWorkspace(root, 'rt', 'greenfield', 'adaptive');
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const [p] = (await request(server, '/api/projects')).data.projects;
    const added = await post(server, `/api/p/${p.id}/runtime/services`, { id: 'web', name: 'Web', kind: 'process', cwd: '.', ports: [5173], argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] });
    assert.equal(added.status, 201, added.text);
    const status = (await request(server, `/api/p/${p.id}/runtime`)).data;
    const web = status.services.find((s) => s.id === 'web');
    assert.ok(web, JSON.stringify(status));
    assert.notEqual(web.state, 'running');
    assert.equal((await post(server, `/api/p/${p.id}/runtime/web/start`, {})).status, 422, 'start before trust is still refused');
    assert.equal((await post(server, `/api/p/${p.id}/runtime/services`, { fromSuggestion: '99' })).status, 422);
  } finally {
    await server.close();
  }
});

test('agents: off by default, enabled for this run only after confirmation, never in read-only; nothing starts', { skip: !SUPPORTED }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-agents-'));
  await initWorkspace(root, 'a', 'greenfield', 'adaptive');
  const server = await startConsoleServer({ roots: [root], port: 0, agentEnv: { PATH: '' } });
  try {
    const [p] = (await request(server, '/api/projects')).data.projects;
    const before = await request(server, '/api/agents');
    assert.equal(before.data.enabled, false);
    assert.equal(before.data.canEnable, true);
    assert.equal(before.data.codex.ready, false, 'no adapter on this PATH');
    assert.equal((await post(server, `/api/p/${p.id}/agent/start`, { provider: 'codex' })).status, 405, 'agent actions stay off');
    assert.equal((await post(server, '/api/agents/enable', {})).status, 400);
    const enabled = await post(server, '/api/agents/enable', { confirm: true });
    assert.equal(enabled.status, 200, enabled.text);
    assert.equal(enabled.data.enabled, true);
    assert.equal((await request(server, '/api/projects')).data.agents.enabled, true);
    assert.equal((await request(server, `/api/p/${p.id}/agent`)).data.session ?? null, null, 'no session was started');
    assert.equal(JSON.parse(await readFile(path.join(root, '.yallaflow', 'state', 'current.yaml'), 'utf8')).activeWork ?? null, null);
    assert.equal((await post(server, '/api/agents/enable', { confirm: true })).data.already, true);
  } finally {
    await server.close();
  }
  const readOnly = await startConsoleServer({ roots: [root], port: 0, readOnly: true });
  try {
    assert.equal((await request(readOnly, '/api/agents')).data.canEnable, false);
    assert.equal((await post(readOnly, '/api/agents/enable', { confirm: true })).status, 405);
  } finally {
    await readOnly.close();
  }
});

// Security review of PF-0057: each finding keeps a regression test.
test('review: parallel registrations add a project once and lose none from the saved list', { skip: !SUPPORTED }, () => withHome(async (home) => {
  const roots = [];
  for (const name of ['a', 'b', 'c']) {
    const root = path.join(home, name);
    await mkdir(root);
    await initWorkspace(root, name, 'greenfield', 'adaptive');
    roots.push(root);
  }
  const server = await startConsoleServer({ roots: [], port: 0 });
  try {
    const same = await Promise.all([1, 2, 3].map(() => post(server, '/api/projects', { root: roots[0] })));
    assert.equal(same.filter((r) => r.data.added).length, 1, 'added once');
    await Promise.all(roots.slice(1).map((root) => post(server, '/api/projects', { root })));
    assert.equal((await request(server, '/api/projects')).data.projects.length, 3);
    assert.deepEqual((await loadRegistry(registryPath())).projects.map((p) => p.root).filter((r) => r.startsWith(home + path.sep)).sort(), roots.sort(), 'no saved entry is lost');
    assert.equal((await post(server, '/api/projects', { planId: '' })).status, 400);
  } finally {
    await server.close();
  }
}));

test('review: hidden folders are refused even by path; read-only consoles probe no tools', { skip: !SUPPORTED }, () => withHome(async (home) => {
  await mkdir(path.join(home, '.config', 'secretapp'), { recursive: true });
  const server = await startConsoleServer({ roots: [], port: 0 });
  try {
    for (const hidden of [path.join(home, '.config'), path.join(home, '.config', 'secretapp')]) {
      assert.equal((await request(server, `/api/fs/dirs?path=${encodeURIComponent(hidden)}`)).status, 403, hidden);
    }
  } finally {
    await server.close();
  }
  const readOnly = await startConsoleServer({ roots: [], port: 0, readOnly: true });
  try {
    assert.equal((await request(readOnly, '/api/new/tools')).status, 405);
    assert.equal((await request(readOnly, '/api/agents')).data.codex, null);
  } finally {
    await readOnly.close();
  }
}));

test('review: plans that run package scripts need the name; control characters and NUL are refused', { skip: !SUPPORTED }, () => withHome(async (home) => {
  const server = await startConsoleServer({ roots: [], port: 0 });
  try {
    const laravel = await post(server, '/api/new/plan', { name: 'shop', parent: home, stack: 'laravel' });
    assert.equal(laravel.status, 200, laravel.text);
    const refused = await post(server, '/api/new/create', { planId: laravel.data.id, confirm: laravel.data.hash });
    assert.equal(refused.data.error.code, 'NEW_PROJECT_CONFIRM_NAME', 'its generator runs Composer scripts');
    assert.equal((await post(server, '/api/new/plan', { name: 'x', parent: home, stack: 'empty', description: 'a\0b' })).status, 400);
    assert.equal((await post(server, '/api/new/plan', { name: 'x', parent: home, stack: 'empty', description: 'x'.repeat(4001) })).status, 400);
    const bell = await post(server, '/api/new/plan', { name: 'x', parent: home, stack: 'empty', files: [{ name: 'a\u001b[31m.md', size: 3, sha256: 'b'.repeat(64) }] });
    assert.equal(bell.status, 422, 'a control character in a file name is refused');
  } finally {
    await server.close();
  }
}));

test('review: runtime add refuses option-like commands and typed suggestions; a local override keeps the shared kind', { skip: !SUPPORTED }, async () => {
  assert.throws(() => runtimeAddArgs({ id: 'web', name: 'Web', kind: 'process', argv: ['--', 'sh', '-c', 'x'] }), /program, not an option/);
  assert.throws(() => runtimeAddArgs({ fromSuggestion: ['1'] }), /Unknown suggestion/);
  assert.ok(!runtimeAddArgs({ id: 'web', name: 'Web', kind: 'process', local: true, argv: ['node', 'x'] }, { override: true }).some((a) => a.startsWith('--kind=')));
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-rt2-'));
  await initWorkspace(root, 'rt', 'greenfield', 'adaptive');
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const [p] = (await request(server, '/api/projects')).data.projects;
    assert.equal((await post(server, `/api/p/${p.id}/runtime/services`, { id: 'web', name: 'Web', kind: 'process', argv: ['node', 'a.js'] })).status, 201);
    const local = await post(server, `/api/p/${p.id}/runtime/services`, { id: 'web', name: 'Web here', kind: 'process', local: true, argv: ['node', 'b.js'] });
    assert.equal(local.status, 201, local.text);
  } finally {
    await server.close();
  }
});

test('a registration failure after creation is reported as partial success, never as a failed creation', { skip: !SUPPORTED }, () => withHome(async (home) => {
  const { wizardPlan, wizardCreate, wizardProgress } = await import('../src/console/newproject.js');
  const { createRunner } = await import('../src/console/runner.js');
  const runner = createRunner();
  const plan = await wizardPlan(home, { name: 'partial', parent: home, stack: 'empty' }, runner);
  await wizardCreate(home, { planId: plan.id, confirm: plan.hash }, runner, { register: async () => { throw Object.assign(new Error('the saved project list could not be written'), { code: 'EACCES' }); } });
  const progress = await waitFor(async () => { const p = await wizardProgress(plan.id); return p.outcome ? p : null; });
  assert.equal(progress.outcome.ok, true, 'the project was created');
  assert.deepEqual(progress.outcome.registration, { ok: false, code: 'EACCES', message: 'the saved project list could not be written' });
}));
