// 1.4.0 New Project Wizard (PF-0048): reviewed plans, staged creation, Core init with
// provenance (Greenfield), first work item, failures and recovery, console routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createFromPlan, createPlan, discardPlan, loadPlan, plansDir } from '../src/newproject/project.js';
import { CATALOG } from '../src/newproject/catalog.js';
import { CORE_HOOKS } from '../src/commands/new.js';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { assessProjectUnderstanding } from '../src/baseline/understanding.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (cwd, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const json = (result) => JSON.parse(result.stdout.trim().split('\n').at(-1));
const SUPPORTED = process.platform !== 'win32';

// Test-only catalog entries: a fake "generator" (node) that succeeds, fails, or writes
// no marker. The production catalog is never changed.
const fake = (id, script, marker = 'package.json') => ({
  id, label: `Fake ${id}`, stack: ['Node.js', 'Fake'], generator: { tool: 'fake', package: 'fake-gen', version: '1.0.0' },
  prerequisites: [{ name: 'node', argv: [process.execPath, '--version'] }],
  argv: (name) => [process.execPath, '-e', script, name], network: false, installsDependencies: false, runsPackageScripts: false,
  marker, structure: ['package.json'], install: null, docs: null
});
const OK = "const fs=require('fs');const d=process.argv[1];fs.mkdirSync(d);fs.writeFileSync(d+'/package.json',JSON.stringify({name:d}));fs.mkdirSync(d+'/src');fs.writeFileSync(d+'/src/index.js','export {};\\n');console.log('generated',d)";
const FAIL = "console.error('registry unreachable');process.exit(7)";
const NOMARK = "require('fs').mkdirSync(process.argv[1]);";
const CATALOG_T = [...CATALOG, fake('fake-ok', OK), fake('fake-fail', FAIL), fake('fake-nomark', NOMARK)];

async function parentDir() {
  return mkdtemp(path.join(os.tmpdir(), 'yf-new-'));
}

test('plan: validated name, absent destination, no nesting, catalog-only stacks; nothing is created', async () => {
  const parent = await parentDir();
  await assert.rejects(createPlan({ name: '../x', parent, stack: 'empty' }), { code: 'NEW_PROJECT_NAME' });
  await assert.rejects(createPlan({ name: 'app', parent: 'relative/dir', stack: 'empty' }), { code: 'NEW_PROJECT_PARENT' });
  await assert.rejects(createPlan({ name: 'app', parent, stack: 'rails' }), { code: 'NEW_PROJECT_STACK' });
  await mkdir(path.join(parent, 'taken'));
  await assert.rejects(createPlan({ name: 'taken', parent, stack: 'empty' }), { code: 'NEW_PROJECT_EXISTS' });
  const repo = await parentDir();
  await initWorkspace(repo, 'Existing', 'brownfield', 'adaptive');
  await assert.rejects(createPlan({ name: 'inner', parent: repo, stack: 'empty' }), { code: 'NEW_PROJECT_NESTED' });
  const nested = await createPlan({ name: 'inner', parent: repo, stack: 'empty', allowNested: true });
  assert.equal(nested.body.nestedIn, repo);

  const plan = await createPlan({ name: 'shop', parent, stack: 'laravel', rationale: 'PHP team; Laravel conventions.' });
  assert.deepEqual(plan.body.steps.find((step) => step.id === 'generate').argv, ['composer', 'create-project', 'laravel/laravel:13.11.0', 'shop', '--no-interaction', '--prefer-dist']);
  assert.equal(plan.body.network, true);
  assert.equal(plan.body.executesExternalCommands, true);
  assert.ok(plan.body.expectedStructure.includes('artisan'));
  assert.equal(plan.body.rationale, 'PHP team; Laravel conventions.');
  assert.deepEqual(await readdir(parent), ['taken'], 'planning created nothing');
  assert.equal((await loadPlan(plan.id)).hash, plan.hash);
  await assert.rejects(createPlan({ name: 'x', parent, stack: 'laravel', install: true }), { code: 'NEW_PROJECT_INSTALL' });
});

test('create: hash confirmation, staging, promotion, Core init with provenance → Greenfield, first work item', { skip: !SUPPORTED }, async () => {
  const parent = await parentDir();
  const plan = await createPlan({ name: 'storefront', parent, stack: 'fake-ok' }, { catalog: CATALOG_T });
  await assert.rejects(createFromPlan(plan.id, 'deadbeef', { catalog: CATALOG_T, hooks: CORE_HOOKS }), { code: 'NEW_PROJECT_CONFIRM' });
  await assert.rejects(createFromPlan(plan.id, plan.hash.slice(0, 7), { catalog: CATALOG_T, hooks: CORE_HOOKS }), { code: 'NEW_PROJECT_CONFIRM' });
  const result = await createFromPlan(plan.id, plan.hash.slice(0, 8), { catalog: CATALOG_T, hooks: CORE_HOOKS });
  const root = path.join(parent, 'storefront');
  assert.equal(result.destination, root);
  assert.deepEqual((await readdir(parent)).sort(), ['storefront'], 'staging was removed after success');
  const config = JSON.parse(await readFile(path.join(root, '.yallaflow', 'config.yaml'), 'utf8'));
  assert.equal(config.project.kind, 'greenfield');
  assert.deepEqual({ ...config.project.origin, createdAt: undefined }, { createdBy: 'yallaflow new', generator: 'fake-gen@1.0.0', template: 'fake-ok', stack: ['Node.js', 'Fake'], planHash: plan.hash, createdAt: undefined });
  // The generated code (manifest + source) would classify as Brownfield; provenance keeps it Greenfield.
  const understanding = await assessProjectUnderstanding(root, { kind: 'greenfield' });
  assert.equal(understanding.state, 'GREENFIELD_UNDERSTANDING_FROM_INTENT');
  assert.match(understanding.label, /created from fake-gen@1\.0\.0 by the New Project Wizard; generated code not reviewed/);
  const facts = JSON.parse(await readFile(path.join(root, '.yallaflow', 'context', 'index.yaml'), 'utf8').catch(() => '{"facts":[]}'));
  assert.equal((facts.facts ?? []).length, 0, 'no project-memory fact is created from generated code');
  const meta = JSON.parse(await readFile(path.join(root, '.yallaflow', 'work', result.workId, 'meta.yaml'), 'utf8'));
  assert.equal(meta.routingStatus, 'pending', 'the first work item is left for the developer to route');
  assert.equal(JSON.parse(await readFile(path.join(root, '.yallaflow', 'state', 'current.yaml'), 'utf8')).activeWork, null);
  const brief = run(root, ['brief']);
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /generated code not reviewed/);
  assert.equal(run(root, ['start', 'Add a product list']).status, 0, 'normal work is allowed, as for a new project');
  assert.match(await readFile(path.join(root, '.yallaflow', 'local', 'new-project.log'), 'utf8'), /generated storefront/);
  // Retry after success never repeats steps.
  const again = await createFromPlan(plan.id, plan.hash.slice(0, 8), { catalog: CATALOG_T, hooks: CORE_HOOKS }).catch((error) => error);
  assert.equal(again.code, undefined, 'a finished plan is idempotent');
  assert.equal(again.workId, result.workId);
});

test('existing projects keep the gate: no provenance, no Greenfield; a copied origin on a brownfield workspace is ignored', async () => {
  const root = await parentDir();
  await initWorkspace(root, 'Legacy', 'brownfield', 'adaptive');
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, 'index.js'), '1');
  const configFile = path.join(root, '.yallaflow', 'config.yaml');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.project.origin = { createdBy: 'yallaflow new', generator: 'x@1', template: 'x', stack: [], planHash: 'a'.repeat(64), createdAt: 'x' };
  await writeFile(configFile, JSON.stringify(config));
  assert.equal((await assessProjectUnderstanding(root, { kind: 'brownfield' })).state, 'PROJECT_UNDERSTANDING_REQUIRED', 'a recorded brownfield kind is never re-labelled');
  const plain = await parentDir();
  await initWorkspace(plain, 'Grown', 'greenfield', 'adaptive');
  await writeFile(path.join(plain, 'package.json'), '{}');
  await writeFile(path.join(plain, 'index.js'), '1');
  assert.equal((await assessProjectUnderstanding(plain, { kind: 'greenfield' })).state, 'PROJECT_UNDERSTANDING_REQUIRED', 'without wizard provenance the existing rules apply');
});

test('failures: generator error, missing marker, destination appearing; staging and diagnostics kept, nothing overwritten', { skip: !SUPPORTED }, async () => {
  const parent = await parentDir();
  const failing = await createPlan({ name: 'broken', parent, stack: 'fake-fail' }, { catalog: CATALOG_T });
  const error = await createFromPlan(failing.id, failing.hash.slice(0, 12), { catalog: CATALOG_T, hooks: CORE_HOOKS }).catch((e) => e);
  assert.equal(error.code, 'NEW_PROJECT_GENERATOR_FAILED');
  assert.match(error.message, /exited with code 7[\s\S]*registry unreachable/);
  assert.equal((await readdir(parent)).includes('broken'), false);
  const staging = (await loadPlan(failing.id)).progress.staging;
  assert.match(await readFile(path.join(staging, 'yallaflow-new.log'), 'utf8'), /registry unreachable/);
  assert.equal((await discardPlan(failing.id)).removed, true);
  assert.deepEqual(await readdir(parent), []);

  const nomark = await createPlan({ name: 'half', parent, stack: 'fake-nomark' }, { catalog: CATALOG_T });
  assert.equal((await createFromPlan(nomark.id, nomark.hash, { catalog: CATALOG_T, hooks: CORE_HOOKS }).catch((e) => e)).code, 'NEW_PROJECT_GENERATOR_FAILED');
  assert.equal((await readdir(parent)).includes('half'), false);

  const raced = await createPlan({ name: 'raced', parent, stack: 'fake-ok' }, { catalog: CATALOG_T });
  await mkdir(path.join(parent, 'raced'));
  await writeFile(path.join(parent, 'raced', 'mine.txt'), 'keep');
  assert.equal((await createFromPlan(raced.id, raced.hash, { catalog: CATALOG_T, hooks: CORE_HOOKS }).catch((e) => e)).code, 'NEW_PROJECT_EXISTS');
  assert.equal(await readFile(path.join(parent, 'raced', 'mine.txt'), 'utf8'), 'keep', 'an existing folder is never touched');
});

test('a plan edited outside YallaFlow cannot run a different command', { skip: !SUPPORTED }, async () => {
  const parent = await parentDir();
  const plan = await createPlan({ name: 'app', parent, stack: 'empty' });
  const file = path.join(plansDir(), `${plan.id}.json`);
  const doc = JSON.parse(await readFile(file, 'utf8'));
  doc.body.steps[0].argv = ['sh', '-c', 'touch /tmp/pwned-by-plan'];
  await writeFile(file, JSON.stringify(doc));
  await assert.rejects(loadPlan(plan.id), { code: 'NEW_PROJECT_PLAN_TAMPERED' });
  // Even with a recomputed hash, the command must match the catalog.
  const { planHash } = await import('../src/newproject/project.js');
  doc.hash = planHash(doc.body);
  await writeFile(file, JSON.stringify(doc));
  await assert.rejects(createFromPlan(plan.id, doc.hash, { hooks: CORE_HOOKS }), { code: 'NEW_PROJECT_PLAN_TAMPERED' });
  assert.deepEqual(await readdir(parent), []);
});

test('CLI: catalog, recommend, plan, create (empty stack), discard', { skip: !SUPPORTED }, async () => {
  const parent = await parentDir();
  const catalog = json(run(parent, ['new', 'catalog', '--json'])).catalog;
  assert.deepEqual(catalog.map((entry) => entry.id), ['laravel', 'react-vite', 'vue-vite', 'nextjs', 'nestjs', 'empty']);
  assert.match(run(parent, ['new', 'recommend']).stdout, /yallaflow new plan[\s\S]*--rationale/);
  const plan = json(run(parent, ['new', 'plan', '--name', 'blank', '--parent', parent, '--stack', 'empty', '--json']));
  assert.match(run(parent, ['new', 'show', plan.id]).stdout, /Destination: .*blank/);
  const scripted = run(parent, ['new', 'create', plan.id, '--confirm', plan.hash.slice(0, 10), '--json']);
  assert.equal(json(scripted).error.code, 'NEW_PROJECT_INTERACTIVE', 'a script or agent tool call cannot confirm a plan');
  const created = run(parent, ['new', 'create', plan.id, '--confirm', plan.hash.slice(0, 10)], { YALLAFLOW_NEW_VIA: 'console' });
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /First work item: PF-0001 \(not routed, not active\)/);
  assert.equal(json(run(path.join(parent, 'blank'), ['overview', '--json'])).understanding.state, 'GREENFIELD_UNDERSTANDING_FROM_INTENT');
});

test('console: wizard routes are guarded, need the hash confirmation, and are refused read-only', { skip: !SUPPORTED }, async () => {
  const home = await parentDir();
  await initWorkspace(home, 'Home', 'greenfield', 'adaptive');
  const parent = await parentDir();
  const server = await startConsoleServer({ roots: [home], port: 0 });
  const origin = server.url.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${server.token}`, Origin: origin, 'Content-Type': 'application/json' };
  const post = (route, body, extra = {}) => fetch(`${server.url}api/new/${route}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${server.url}api/new/catalog`)).status, 401);
    assert.equal((await (await fetch(`${server.url}api/new/catalog`, { headers })).json()).catalog.length, 6);
    assert.equal((await post('plan', { name: 'web', parent, stack: 'empty' }, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('plan', { name: 'web', parent, stack: 'empty', command: 'rm -rf /' })).status, 400, 'no free-form fields');
    const planned = await post('plan', { name: 'web', parent, stack: 'empty' });
    assert.equal(planned.status, 200);
    const plan = await planned.json();
    assert.equal((await post('create', { planId: plan.id, confirm: 'nothash0' })).status, 422);
    const created = await post('create', { planId: plan.id, confirm: plan.hash.slice(0, 8) });
    assert.equal(created.status, 200, await created.clone().text());
    assert.deepEqual(await created.json(), { started: true, planId: plan.id }, 'creation runs in the background');
    let progress;
    for (let i = 0; i < 100; i++) {
      progress = await (await fetch(`${server.url}api/new/plans/${plan.id}`, { headers })).json();
      if (progress.outcome) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(progress.outcome.ok, true, JSON.stringify(progress.outcome));
    assert.equal(progress.outcome.destination, path.join(await (await import('node:fs/promises')).realpath(parent), 'web'));
    assert.equal(progress.plan.progress.steps['first-work'].status, 'done');
  } finally {
    await server.close();
  }
  const ro = await startConsoleServer({ roots: [home], port: 0, readOnly: true });
  try {
    const refused = await fetch(`${ro.url}api/new/plan`, { method: 'POST', headers: { Authorization: `Bearer ${ro.token}`, Origin: ro.url.replace(/\/$/, ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', parent, stack: 'empty' }) });
    assert.equal(refused.status, 405);
  } finally {
    await ro.close();
  }
});

// ---------------------------------------------------------------- security review (PF-0048)
test('review: staging is npm\'s project root, so a parent .npmrc or node_modules cannot shadow the generator', { skip: !SUPPORTED }, async () => {
  const parent = await parentDir();
  await writeFile(path.join(parent, 'package.json'), '{}');
  const probe = { ...fake('probe', "const fs=require('fs');const d=process.argv[1];fs.mkdirSync(d);fs.writeFileSync(d+'/package.json',JSON.stringify({npmRoot:require('child_process').execSync('npm prefix',{encoding:'utf8'}).trim()}));") };
  const plan = await createPlan({ name: 'pinned', parent, stack: 'probe' }, { catalog: [...CATALOG_T, probe] });
  await createFromPlan(plan.id, plan.hash, { catalog: [...CATALOG_T, probe], hooks: CORE_HOOKS });
  const recorded = JSON.parse(await readFile(path.join(parent, 'pinned', 'package.json'), 'utf8')).npmRoot;
  assert.notEqual(recorded, await (await import('node:fs/promises')).realpath(parent), 'npm did not resolve to the parent folder');
  assert.match(path.basename(recorded), /^\.yallaflow-new-/);
});

test('review: a retry never labels or installs into a folder that replaced the created one; failure text is redacted', { skip: !SUPPORTED }, async () => {
  const parent = await parentDir();
  const plan = await createPlan({ name: 'proj', parent, stack: 'fake-ok' }, { catalog: CATALOG_T });
  const failingInit = { ...CORE_HOOKS, initProject: async () => { throw new Error('init interrupted'); } };
  await assert.rejects(createFromPlan(plan.id, plan.hash, { catalog: CATALOG_T, hooks: failingInit }), /init interrupted/);
  const { rename: mv, rm } = await import('node:fs/promises');
  await mv(path.join(parent, 'proj'), path.join(parent, 'proj-created'));
  await mkdir(path.join(parent, 'proj'));
  await writeFile(path.join(parent, 'proj', 'package.json'), '{"name":"someone-else"}');
  const retry = await createFromPlan(plan.id, plan.hash, { catalog: CATALOG_T, hooks: CORE_HOOKS }).catch((e) => e);
  assert.equal(retry.code, 'NEW_PROJECT_DESTINATION_CHANGED');
  assert.equal(await readFile(path.join(parent, 'proj', '.yallaflow', 'config.yaml'), 'utf8').catch(() => null), null, 'the replacement folder was not initialized');
  await rm(path.join(parent, 'proj'), { recursive: true });

  const leaky = fake('leaky', "console.log('GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');process.exit(3)");
  const leakPlan = await createPlan({ name: 'leak', parent, stack: 'leaky' }, { catalog: [...CATALOG_T, leaky] });
  const failure = await createFromPlan(leakPlan.id, leakPlan.hash, { catalog: [...CATALOG_T, leaky], hooks: CORE_HOOKS }).catch((e) => e);
  assert.equal(failure.code, 'NEW_PROJECT_GENERATOR_FAILED');
  assert.equal(failure.message.includes('ghp_ABCDEFGHIJ'), false, 'the failure message is redacted');
});

test('review: a parent npm workspace that would capture staging stops the generator before it runs', { skip: !SUPPORTED }, async () => {
  const parent = await parentDir();
  await writeFile(path.join(parent, 'package.json'), JSON.stringify({ name: 'evil-root', private: true, workspaces: ['.yallaflow-new-*'] }));
  const npmProbe = { ...fake('npm-probe', "require('fs').writeFileSync('/dev/null','')"), argv: (name) => ['npx', '--yes', '--offline', 'create-yf-never-run', name] };
  const plan = await createPlan({ name: 'captured', parent, stack: 'npm-probe' }, { catalog: [...CATALOG_T, npmProbe] });
  const error = await createFromPlan(plan.id, plan.hash, { catalog: [...CATALOG_T, npmProbe], hooks: CORE_HOOKS }).catch((e) => e);
  assert.equal(error.code, 'NEW_PROJECT_NPM_ROOT');
  assert.equal((await readdir(parent)).includes('captured'), false);
});
