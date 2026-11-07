// 1.4.0 Project Overview: `yallaflow overview --json` and the console's read route.
// Evidence-based stack detection keeps declared / detected / inferred apart, never reads
// secrets, and the whole read changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { composeImages } from '../src/inventory/stack.js';
import { loadSchema, validate } from '../test-support/schema.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const OVERVIEW = loadSchema('overview-1.schema.json');
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
function overview(root) {
  const result = run(root, ['overview', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const doc = JSON.parse(result.stdout);
  assert.deepEqual(validate(OVERVIEW, doc), []);
  return { doc, raw: result.stdout };
}

async function treeHash(root) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        hash.update(path.relative(root, full));
        hash.update(await readFile(full));
        hash.update(String((await stat(full)).mtimeMs));
      }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

const SECRET = 'S3cr3t-Value-That-Must-Not-Leak';

// A Laravel + Vite project with Docker services, two Node lockfiles and secrets in .env
// and in the compose environment block.
async function laravelProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-overview-'));
  await initWorkspace(root, 'Shop', 'brownfield', 'adaptive');
  await writeFile(path.join(root, 'composer.json'), JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^11.9' } }));
  await writeFile(path.join(root, 'composer.lock'), '{}');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ engines: { node: '>=20' }, devDependencies: { vite: '^5.0.0' }, packageManager: 'npm@10.8.1' }));
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  await writeFile(path.join(root, 'yarn.lock'), '');
  await writeFile(path.join(root, '.env'), `APP_KEY=base64:${SECRET}\nDB_PASSWORD=${SECRET}\n`);
  await writeFile(path.join(root, 'docker-compose.yml'), `services:\n  db:\n    image: mysql:8.0\n    environment:\n      MYSQL_ROOT_PASSWORD: ${SECRET}\n  cache:\n    image: "redis:7-alpine"\n  app:\n    image: \${APP_IMAGE}\n`);
  await mkdir(path.join(root, 'app', 'Http'), { recursive: true });
  for (const name of ['User.php', 'Order.php', 'Kernel.php']) await writeFile(path.join(root, 'app', 'Http', name), '<?php\n');
  await mkdir(path.join(root, 'frontend'), { recursive: true });
  await writeFile(path.join(root, 'frontend', 'package.json'), JSON.stringify({ dependencies: { react: '18.3.1' } }));
  await writeFile(path.join(root, 'frontend', 'main.tsx'), 'export {};\n');
  return root;
}

test('overview: evidence-based stack with declared / detected / inferred kept apart; no secret is read', async () => {
  const root = await laravelProject();
  const before = await treeHash(root);
  const { doc, raw } = overview(root);
  assert.equal(raw.includes(SECRET), false, 'neither .env nor compose environment values appear');
  assert.equal(await treeHash(root), before, 'the read changed nothing');

  const find = (component, kind) => doc.stack.entries.find((entry) => entry.component === component && (!kind || entry.kind === kind));
  assert.deepEqual({ ...find('Laravel'), locator: undefined }, { component: 'Laravel', kind: 'framework', basis: 'declared', declared: '^11.9', path: 'composer.json', locator: undefined });
  assert.equal(find('PHP', 'runtime').declared, '^8.2');
  assert.equal(find('Node.js', 'runtime').declared, '>=20');
  assert.equal(find('npm', 'package manager').declared, '10.8.1');
  assert.equal(find('Vite').basis, 'declared');
  assert.equal(find('React').path, 'frontend/package.json');
  assert.deepEqual([find('MySQL').declared, find('MySQL').kind, find('MySQL').basis], ['8.0', 'database', 'declared']);
  assert.deepEqual([find('Redis').declared, find('Redis').kind], ['7-alpine', 'cache']);
  assert.ok(find('container image from a variable'), 'an unresolved image is reported, not guessed');
  assert.equal(find('composer.lock').basis, 'detected');
  assert.equal(find('Docker Compose').basis, 'detected');
  const php = find('PHP', 'language');
  assert.deepEqual([php.basis, php.count], ['inferred', 3]);

  const rootModule = doc.modules.find((module) => module.path === '.');
  assert.deepEqual(rootModule.ecosystems.sort(), ['Node.js', 'PHP']);
  assert.ok(rootModule.frameworks.includes('Laravel'));
  assert.match(rootModule.conflicts.join(' '), /more than one Node\.js lockfile: package-lock\.json, yarn\.lock/);
  assert.deepEqual(doc.modules.find((module) => module.path === 'frontend').frameworks, ['React']);

  assert.equal(doc.understanding.state, 'PROJECT_UNDERSTANDING_REQUIRED');
  assert.match(doc.understanding.ask, /project understanding/i);
  assert.match(doc.understanding.command, /yallaflow baseline start/);
  assert.equal(doc.project.classification.kind, 'brownfield');
  assert.equal(doc.coverage.available, true);
  assert.equal(doc.memory.current, 0);
});

test('overview: greenfield intent, a legacy workspace and a damaged ledger all yield a valid document', async () => {
  const green = await mkdtemp(path.join(os.tmpdir(), 'yf-overview-green-'));
  await initWorkspace(green, 'New', 'greenfield', 'adaptive');
  const g = overview(green).doc;
  assert.equal(g.understanding.state, 'GREENFIELD_UNDERSTANDING_FROM_INTENT');
  assert.deepEqual(g.stack.entries, []);
  assert.deepEqual(g.modules, []);

  const legacy = await mkdtemp(path.join(os.tmpdir(), 'yf-overview-legacy-'));
  spawnSync('cp', ['-a', `${fileURLToPath(new URL('./fixtures/v0.3.6-workspace/', import.meta.url))}.`, legacy]);
  const before = await treeHash(legacy);
  overview(legacy);
  assert.equal(await treeHash(legacy), before, 'a legacy workspace is read without writing');

  await mkdir(path.join(green, '.yallaflow', 'context'), { recursive: true });
  await writeFile(path.join(green, '.yallaflow', 'context', 'index.yaml'), '{ not json');
  const damaged = overview(green).doc;
  assert.equal(damaged.memory.available, false);
  assert.ok(damaged.memory.error);

  const human = run(green, ['overview']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Machine-readable: yallaflow overview --json/);
});

test('overview: memory facts come with confidence and mechanical freshness', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-overview-mem-'));
  await initWorkspace(root, 'Mem', 'greenfield', 'adaptive');
  await writeFile(path.join(root, 'README.md'), 'Billing service.\n');
  const ledger = {
    schemaVersion: 2,
    facts: [
      { id: 'CTX-0001', area: 'project', state: 'current', confidence: 'confirmed', summary: 'A billing service.', provenance: 'repository', evidence: [{ type: 'repository', path: 'README.md', contentHash: `sha256:${createHash('sha256').update('Billing service.\n').digest('hex')}` }], history: [] },
      { id: 'CTX-0002', area: 'architecture', state: 'current', confidence: 'inferred', summary: 'One process.', provenance: 'repository', evidence: [{ type: 'repository', path: 'README.md', contentHash: 'sha256:0000' }], history: [] },
      { id: 'CTX-0003', area: 'architecture', state: 'superseded', confidence: 'confirmed', summary: 'Old.', provenance: 'repository', evidence: [], history: [] }
    ]
  };
  await writeFile(path.join(root, '.yallaflow', 'context', 'index.yaml'), JSON.stringify(ledger));
  const { doc } = overview(root);
  assert.equal(doc.memory.current, 2, 'superseded facts are history, not current memory');
  assert.deepEqual(doc.areas.project.facts.map((fact) => [fact.id, fact.freshness]), [['CTX-0001', 'fresh']]);
  assert.deepEqual(doc.areas.architecture.facts.map((fact) => [fact.id, fact.confidence, fact.freshness]), [['CTX-0002', 'inferred', 'may-be-stale']]);
  assert.equal(doc.understanding.state, 'PROJECT_UNDERSTANDING_ESTABLISHED');
});

test('composeImages: tags, digests, quotes and variables', () => {
  assert.deepEqual(composeImages('  image: postgres:16\n  image: "ghcr.io/acme/api:1.2"\n  image: nginx@sha256:abc\n  image: ${X}\n'), [
    { image: 'postgres', tag: '16' },
    { image: 'ghcr.io/acme/api', tag: '1.2' },
    { image: 'nginx', tag: null },
    { image: null, tag: null, unresolved: true }
  ]);
  assert.deepEqual(composeImages('environment:\n  IMAGE_PASSWORD: x\n'), []);
});

test('console: GET overview is token-protected, read-only and returns the contract', async () => {
  const root = await laravelProject();
  const server = await startConsoleServer({ roots: [root], port: 0 });
  try {
    const headers = { Authorization: `Bearer ${server.token}` };
    const pid = (await (await fetch(`${server.url}api/projects`, { headers })).json()).projects[0].id;
    assert.equal((await fetch(`${server.url}api/p/${pid}/overview`)).status, 401);
    const response = await fetch(`${server.url}api/p/${pid}/overview`, { headers });
    assert.equal(response.status, 200);
    const doc = await response.json();
    assert.deepEqual(validate(OVERVIEW, doc), []);
    assert.equal(JSON.stringify(doc).includes(SECRET), false);
    const post = await fetch(`${server.url}api/p/${pid}/overview`, { method: 'POST', headers: { ...headers, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 405, 'the overview offers no write');
  } finally {
    await server.close();
  }
});
