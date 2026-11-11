// PF-0123 (1.5.2): connect an existing folder from the console — the folder chooser's kinds,
// the read-only preview, Core's own init after a confirmed preview, and the safety refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { createFolder, listFolders } from '../src/console/folders.js';
import { previewConnect } from '../src/console/connect.js';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

async function home() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'yf-home-')));
  const laravel = path.join(dir, 'code', 'clinic');
  await mkdir(path.join(laravel, 'app', 'Models'), { recursive: true });
  await mkdir(path.join(laravel, 'routes'), { recursive: true });
  await writeFile(path.join(laravel, 'composer.json'), JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^11.0' } }));
  await writeFile(path.join(laravel, 'artisan'), '<?php\n');
  for (const name of ['User', 'Booking', 'Invoice']) await writeFile(path.join(laravel, 'app', 'Models', `${name}.php`), `<?php\nclass ${name} {}\n`);
  await writeFile(path.join(laravel, 'routes', 'web.php'), '<?php\n');
  await writeFile(path.join(laravel, 'CLAUDE.md'), '# Clinic\n\nOur own notes for Claude.\n');
  git(laravel, ['init', '-q']);
  await writeFile(path.join(laravel, 'routes', 'api.php'), '<?php // uncommitted work in progress\n');
  await mkdir(path.join(dir, 'code', 'empty'), { recursive: true });
  const existing = path.join(dir, 'code', 'shop');
  await mkdir(existing, { recursive: true });
  await initWorkspace(existing, 'Shop', 'greenfield', 'adaptive');
  await mkdir(path.join(existing, 'packages', 'inner'), { recursive: true });
  return { dir, laravel, existing };
}

async function withHome(dir, fn) {
  const previous = process.env.HOME;
  process.env.HOME = dir;
  try { return await fn(); } finally { process.env.HOME = previous; }
}

async function serve(roots, options = {}) {
  const server = await startConsoleServer({ roots, port: 0, ...options });
  const origin = server.url.replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${server.token}` };
  const get = async (pathname) => { const r = await fetch(`${server.url}${pathname.slice(1)}`, { headers: auth }); return { status: r.status, body: await r.json() }; };
  const post = async (pathname, body) => { const r = await fetch(`${server.url}${pathname.slice(1)}`, { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  return { server, get, post };
}

test('the folder chooser labels YallaFlow projects, existing code (with its stack) and empty folders from names only', async () => {
  const { dir } = await home();
  const listed = await listFolders(path.join(dir, 'code'), { home: dir });
  const kinds = Object.fromEntries(listed.folders.map((entry) => [entry.name, [entry.kind, entry.stack]]));
  assert.deepEqual(kinds, { clinic: ['code', 'laravel'], empty: ['empty', null], shop: ['yallaflow', null] });
});

test('preview: an existing Laravel codebase shows its stack and the exact file plan, without running Git', async () => {
  const { dir, laravel } = await home();
  const preview = await previewConnect(laravel, { home: dir });
  assert.equal(preview.kind, 'existing-code');
  assert.equal(preview.projectKind, 'brownfield');
  assert.deepEqual(preview.stack, ['Laravel 11']);
  // No Git command runs in a preview (a folder's own Git config could name programs to run).
  assert.deepEqual([preview.git, preview.uncommitted], [true, null]);
  assert.deepEqual(preview.plan, [{ path: '.yallaflow/', op: 'create' }, { path: 'CLAUDE.md', op: 'append-block' }, { path: 'AGENTS.md', op: 'create' }]);
  assert.deepEqual(preview.problems, []);
  assert.match(preview.planHash, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(path.join(laravel, '.yallaflow')), false, 'the preview writes nothing');
});

test('connect: Core init after the confirmed preview; existing content kept; registered; understanding is the next step', async () => {
  const { dir, laravel, existing } = await home();
  await withHome(dir, async () => {
    const { server, get, post } = await serve([existing]);
    try {
      const { body: preview } = await get(`/api/fs/connect-preview?path=${encodeURIComponent(laravel)}`);
      const stale = await post('/api/projects/connect', { root: laravel, planHash: '0'.repeat(64), confirm: true });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error.code, 'PREVIEW_CHANGED');
      assert.ok(stale.body.preview, 'the refusal carries the fresh preview');
      assert.equal(existsSync(path.join(laravel, '.yallaflow')), false);
      assert.equal((await post('/api/projects/connect', { root: laravel, planHash: preview.planHash })).status, 400, 'an explicit confirmation is required');
      const done = await post('/api/projects/connect', { root: laravel, planHash: preview.planHash, confirm: true });
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(done.body.initialized, true);
      assert.equal(done.body.added, true);
      assert.ok(existsSync(path.join(laravel, '.yallaflow', 'config.yaml')));
      const claude = await readFile(path.join(laravel, 'CLAUDE.md'), 'utf8');
      assert.ok(claude.startsWith('# Clinic\n\nOur own notes for Claude.\n'), 'the developer\'s text is kept in place');
      assert.match(claude, /yallaflow-bootstrap:begin/);
      assert.match(git(laravel, ['status', '--porcelain']).stdout, /routes\/api\.php|routes\//, 'uncommitted work is untouched');
      const listed = (await get('/api/projects')).body.projects;
      const added = listed.find((entry) => entry.root === laravel);
      assert.ok(added, 'the connected project is in the console');
      const readiness = (await get(`/api/p/${added.id}/readiness`)).body;
      assert.equal(readiness.steps.find((step) => step.id === 'understanding').status, 'required');
    } finally {
      await server.close();
    }
  });
});

test('connect refuses unsafe folders and writes nothing: hand-edited bootstrap, nested project, outside home, hidden, home itself', async () => {
  const { dir, laravel, existing } = await home();
  await writeFile(path.join(laravel, 'CLAUDE.md'), '# Clinic\n<!-- yallaflow-bootstrap:begin provider=claude version=3 sha256=' + '0'.repeat(64) + ' -->\nedited by hand\n<!-- yallaflow-bootstrap:end -->\n');
  const edited = await previewConnect(laravel, { home: dir });
  assert.equal(edited.problems[0].code, 'BOOTSTRAP_UNSAFE');
  const nested = await previewConnect(path.join(existing, 'packages', 'inner'), { home: dir });
  assert.equal(nested.problems[0].code, 'NESTED');
  await withHome(dir, async () => {
    const { server, get, post } = await serve([existing]);
    try {
      const refused = await post('/api/projects/connect', { root: laravel, planHash: edited.planHash, confirm: true });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error.code, 'BOOTSTRAP_UNSAFE');
      assert.equal(existsSync(path.join(laravel, '.yallaflow')), false);
      assert.equal((await get(`/api/fs/connect-preview?path=${encodeURIComponent(os.tmpdir())}`)).status, 403, 'outside home');
      await mkdir(path.join(dir, '.secret'), { recursive: true });
      assert.equal((await get(`/api/fs/connect-preview?path=${encodeURIComponent(path.join(dir, '.secret'))}`)).status, 403, 'hidden folder');
      assert.equal((await get(`/api/fs/connect-preview?path=${encodeURIComponent(dir)}`)).status, 400, 'not the home folder itself');
      const opened = await get(`/api/fs/connect-preview?path=${encodeURIComponent(existing)}`);
      assert.deepEqual([opened.body.kind, opened.body.action, opened.body.plan], ['yallaflow', 'open', []]);
    } finally {
      await server.close();
    }
  });
});

test('an empty folder becomes a Greenfield project that is ready for work', async () => {
  const { dir, existing } = await home();
  const empty = path.join(dir, 'code', 'empty');
  await withHome(dir, async () => {
    const { server, get, post } = await serve([existing]);
    try {
      const { body: preview } = await get(`/api/fs/connect-preview?path=${encodeURIComponent(empty)}`);
      assert.equal(preview.kind, 'empty');
      const done = await post('/api/projects/connect', { root: empty, planHash: preview.planHash, confirm: true });
      assert.equal(done.status, 200);
      assert.equal(done.body.projectKind, 'greenfield');
      const readiness = (await get(`/api/p/${done.body.id}/readiness`)).body;
      assert.equal(readiness.allows.createWork, true);
    } finally {
      await server.close();
    }
  });
});

test('new folder for a project location: one safe name, inside home, never reused', async () => {
  const { dir } = await home();
  const listed = await createFolder(path.join(dir, 'code'), 'new-app', { home: dir });
  assert.equal(listed.path, path.join(dir, 'code', 'new-app'));
  await assert.rejects(createFolder(path.join(dir, 'code'), 'new-app', { home: dir }), { code: 'EXISTS' });
  for (const bad of ['..', '.hidden', 'a/b', '', ' lead', 'x'.repeat(90), 'bad\u0000name', 'trail.']) await assert.rejects(createFolder(path.join(dir, 'code'), bad, { home: dir }), { code: 'BAD_NAME' }, JSON.stringify(bad));
  await assert.rejects(createFolder(os.tmpdir(), 'x', { home: dir }), { code: 'OUTSIDE_HOME' });
  assert.ok((await createFolder(path.join(dir, 'code'), 'مشروع جديد', { home: dir })).path.endsWith('مشروع جديد'), 'Arabic names are fine');
});

test('a read-only console neither previews, connects nor creates folders', async () => {
  const { dir, laravel, existing } = await home();
  await withHome(dir, async () => {
    const { server, get, post } = await serve([existing], { readOnly: true });
    try {
      assert.equal((await get(`/api/fs/connect-preview?path=${encodeURIComponent(laravel)}`)).status, 405);
      assert.equal((await post('/api/projects/connect', { root: laravel, planHash: 'x', confirm: true })).status, 405);
      assert.equal((await post('/api/fs/mkdir', { parent: dir, name: 'x' })).status, 405);
    } finally {
      await server.close();
    }
  });
});

test('connect never writes through a CLAUDE.md or AGENTS.md link that leaves the folder (even a dangling one)', async () => {
  const { dir, laravel } = await home();
  const outside = path.join(dir, 'outside-notes.txt');
  await writeFile(outside, 'my shell config\n');
  await rm(path.join(laravel, 'CLAUDE.md'));
  await symlink(outside, path.join(laravel, 'CLAUDE.md'));
  await symlink(path.join(dir, 'not-there', 'x.desktop'), path.join(laravel, 'AGENTS.md'));
  const preview = await previewConnect(laravel, { home: dir });
  assert.deepEqual(preview.problems.map((problem) => [problem.code, problem.file]), [['BOOTSTRAP_LINK_OUTSIDE', 'CLAUDE.md'], ['BOOTSTRAP_LINK_OUTSIDE', 'AGENTS.md']]);
  await withHome(dir, async () => {
    const { server, post } = await serve([]);
    try {
      const refused = await post('/api/projects/connect', { root: laravel, planHash: preview.planHash, confirm: true });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error.code, 'BOOTSTRAP_LINK_OUTSIDE');
    } finally {
      await server.close();
    }
  });
  assert.equal(await readFile(outside, 'utf8'), 'my shell config\n', 'the linked file is untouched');
  assert.equal(existsSync(path.join(dir, 'not-there')), false);
  assert.equal(existsSync(path.join(laravel, '.yallaflow')), false);
  // A link to the other agent file inside the folder is a deliberate setup and stays fine.
  await rm(path.join(laravel, 'CLAUDE.md')); await rm(path.join(laravel, 'AGENTS.md'));
  await writeFile(path.join(laravel, 'AGENTS.md'), '# Agents\n');
  await symlink('AGENTS.md', path.join(laravel, 'CLAUDE.md'));
  assert.deepEqual((await previewConnect(laravel, { home: dir })).problems, []);
});
