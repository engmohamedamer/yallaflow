// PF-0158: a generator is not started while a tool it needs is missing. The check is made
// when creation starts (never read from the saved plan), the refusal creates nothing, and the
// Advanced override applies only when the generator's own program is present.
// The per-system guidance is data: the Windows and macOS entries are checked here for presence
// and shape only (SIMULATED platform values), not on real machines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPrerequisites, createFromPlan, createPlan } from '../src/newproject/project.js';
import { CATALOG } from '../src/newproject/catalog.js';
import { GUIDED_PLATFORMS, toolGuidance } from '../src/newproject/guidance.js';
import { CORE_HOOKS } from '../src/commands/new.js';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';

process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-prereq-cfg-')), 'console.json');
const SUPPORTED = process.platform !== 'win32';
const OK = "const fs=require('fs');const d=process.argv[1];fs.mkdirSync(d);fs.writeFileSync(d+'/package.json','{}')";
// A generator (node) with one extra tool that does not exist on any machine.
const withTool = (id, extra) => ({
  id, label: `Fake ${id}`, stack: ['Fake'], generator: { tool: 'fake', package: 'fake-gen', version: '1.0.0' },
  prerequisites: [{ name: 'node', argv: [process.execPath, '--version'] }, ...extra],
  argv: (name) => [process.execPath, '-e', OK, name], network: false, installsDependencies: false, runsPackageScripts: false,
  marker: 'package.json', structure: ['package.json'], install: null, docs: null
});
const SECONDARY = withTool('fake-secondary', [{ name: 'yf-no-such-module', argv: ['yf-no-such-tool-anywhere', '-m'], module: 'x' }]);
const NO_PROGRAM = { ...withTool('fake-noprogram', []), prerequisites: [{ name: 'yf-no-such-generator', argv: ['yf-no-such-generator', '--version'] }], argv: (name) => ['yf-no-such-generator', name] };
const CATALOG_T = [...CATALOG, SECONDARY, NO_PROGRAM, withTool('fake-ready', [])];
const probeAs = (found) => async (prereq) => ({ name: prereq.name, found: found.includes(prereq.name), note: prereq.note ?? null, ...(prereq.module ? { module: true } : {}) });

test('the check says what is missing and whether an override is possible', async () => {
  const none = await checkPrerequisites('laravel', { probe: probeAs([]), platform: 'win32' });
  assert.equal(none.ready, false);
  assert.deepEqual(none.missing.map((tool) => tool.name), ['php', 'composer', 'pdo_sqlite']);
  assert.equal(none.overridable, false, 'composer, the generator itself, is missing: nothing to override');
  assert.ok(none.missing.every((tool) => tool.guidance?.platform === 'win32' && /^[a-z0-9.-]+\//.test(tool.guidance.url)));
  const driver = await checkPrerequisites('laravel', { probe: probeAs(['php', 'composer']), platform: 'linux' });
  assert.deepEqual(driver.missing.map((tool) => tool.name), ['pdo_sqlite']);
  assert.equal(driver.overridable, true, 'only a secondary tool is missing');
  assert.equal(driver.missing[0].guidance.command, 'sudo apt install php-sqlite3');
  const ready = await checkPrerequisites('laravel', { probe: probeAs(['php', 'composer', 'pdo_sqlite']) });
  assert.deepEqual({ ready: ready.ready, missing: ready.missing, overridable: ready.overridable }, { ready: true, missing: [], overridable: false });
  assert.equal((await checkPrerequisites('empty')).ready, true, 'an empty project needs no tools');
  // Git counts only when the plan initializes a repository, and a missing Git is never overridable
  const noGit = await checkPrerequisites('empty', { git: true, probe: probeAs([]), platform: 'win32' });
  assert.deepEqual([noGit.ready, noGit.overridable, noGit.missing.map((tool) => tool.name), noGit.missing[0].guidance.command], [false, false, ['git'], 'winget install --id Git.Git -e']);
  assert.equal((await checkPrerequisites('empty', { git: false, probe: probeAs([]) })).ready, true);
  assert.equal((await checkPrerequisites('laravel', { git: true, probe: probeAs(['php', 'composer']) })).overridable, false, 'Git missing blocks the override too');
  await assert.rejects(checkPrerequisites('nope'), { code: 'NEW_PROJECT_STACK' });
});

test('guidance exists for Windows, macOS and Linux for every tool the catalog and the console check; it is display only', () => {
  const tools = [...new Set([...CATALOG.flatMap((entry) => entry.prerequisites.map((prereq) => prereq.name)), 'git', 'docker', 'docker-compose', 'npm'])];
  for (const tool of tools) {
    for (const platform of GUIDED_PLATFORMS) {
      const entry = toolGuidance(tool, platform);
      assert.ok(entry, `${tool} on ${platform}`);
      assert.match(entry.url, /^[a-z0-9.-]+\.[a-z]{2,}\//, 'a host and a path, without a scheme');
      assert.ok(!entry.command || !/curl|\|\s*(ba)?sh|iex|Invoke-/i.test(entry.command), 'never a download-and-run one-liner');
      if (entry.steps) assert.ok(entry.hint, 'steps carry a key for the Arabic wording');
    }
  }
  assert.equal(toolGuidance('php', 'freebsd'), null);
  assert.equal(toolGuidance('unknown-tool', 'linux'), null);
});

test('creation is refused before anything is created; the override needs the generator itself', { skip: !SUPPORTED }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'yf-prereq-'));
  const go = (plan, options = {}) => createFromPlan(plan.id, plan.hash.slice(0, 8), { catalog: CATALOG_T, hooks: CORE_HOOKS, ...options });

  const blocked = await createPlan({ name: 'one', parent, stack: 'fake-secondary' }, { catalog: CATALOG_T });
  await assert.rejects(go(blocked), (error) => error.code === 'NEW_PROJECT_PREREQUISITES' && error.overridable === true && error.missing[0].name === 'yf-no-such-module' && /Nothing was created/.test(error.message));
  assert.deepEqual(await readdir(parent), [], 'no staging folder, no project');
  // the override never replaces the confirmation
  await assert.rejects(createFromPlan(blocked.id, 'deadbeef', { catalog: CATALOG_T, hooks: CORE_HOOKS, allowMissingTools: true }), { code: 'NEW_PROJECT_CONFIRM' });
  const made = await go(blocked, { allowMissingTools: true });
  assert.equal(made.destination, path.join(parent, 'one'));

  const noProgram = await createPlan({ name: 'two', parent, stack: 'fake-noprogram' }, { catalog: CATALOG_T });
  await assert.rejects(go(noProgram, { allowMissingTools: true }), (error) => error.code === 'NEW_PROJECT_PREREQUISITES' && error.overridable === false);
  assert.deepEqual(await readdir(parent), ['one']);

  // a tool that appears after the plan was made is seen: the check is fresh, not the plan's
  const later = await createPlan({ name: 'three', parent, stack: 'fake-secondary' }, { catalog: CATALOG_T });
  assert.equal(later.body.prerequisites.some((tool) => !tool.found), true);
  assert.equal((await go(later, { probe: probeAs(['node', 'yf-no-such-module']) })).destination, path.join(parent, 'three'));
  // Git ticked and missing: refused before the folder is made, even for the empty project and with the override
  const wantsGit = await createPlan({ name: 'six', parent, stack: 'empty', git: true }, { catalog: CATALOG_T });
  const gitGone = probeAs(['node']);
  await assert.rejects(go(wantsGit, { probe: gitGone, allowMissingTools: true }), (error) => error.code === 'NEW_PROJECT_PREREQUISITES' && error.overridable === false && /without --git/.test(error.message));
  assert.ok(!(await readdir(parent)).includes('six'));
  // ready stacks and the empty project are unaffected
  assert.ok(await go(await createPlan({ name: 'four', parent, stack: 'fake-ready' }, { catalog: CATALOG_T })));
  assert.ok(await go(await createPlan({ name: 'five', parent, stack: 'empty' }, { catalog: CATALOG_T })));
});

test('console: the plan carries the tool check, create is refused with it, Recheck is a read, never read-only', { skip: !SUPPORTED }, async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'yf-prereq-home-'));
  await initWorkspace(home, 'Home', 'greenfield', 'adaptive');
  const parent = await mkdtemp(path.join(os.tmpdir(), 'yf-prereq-'));
  // a PATH with node only: PHP and Composer are missing whatever this machine has
  const savedPath = process.env.PATH;
  process.env.PATH = path.dirname(process.execPath);
  const server = await startConsoleServer({ roots: [home], port: 0 });
  t.after(async () => { process.env.PATH = savedPath; await server.close(); });
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  const post = (route, body) => fetch(`${server.url}api/new/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });

  const plan = await (await post('plan', { name: 'shop', parent, stack: 'laravel' })).json();
  assert.equal(plan.tools.ready, false);
  assert.equal(plan.tools.overridable, false);
  assert.deepEqual(plan.tools.missing.map((tool) => tool.name).sort(), ['composer', 'pdo_sqlite', 'php']);
  assert.equal(plan.tools.platform, process.platform);
  for (const body of [{ acknowledgeScripts: true }, { acknowledgeScripts: true, overrideMissingTools: true }]) {
    const refused = await post('create', { planId: plan.id, confirm: plan.hash, ...body });
    assert.equal(refused.status, 422);
    const answer = await refused.json();
    assert.equal(answer.error.code, 'NEW_PROJECT_PREREQUISITES');
    assert.equal(answer.tools.ready, false);
  }
  assert.equal((await post('create', { planId: plan.id, confirm: plan.hash, acknowledgeScripts: true, overrideMissingTools: 'yes' })).status, 400);
  assert.deepEqual(await readdir(parent), [], 'nothing was created');

  const recheck = await fetch(`${server.url}api/new/prerequisites?stack=laravel`, { headers });
  assert.equal(recheck.status, 200);
  assert.equal((await recheck.json()).ready, false);
  assert.equal((await fetch(`${server.url}api/new/prerequisites?stack=../x`, { headers })).status, 400);
  assert.equal((await (await fetch(`${server.url}api/new/prerequisites?stack=empty`, { headers })).json()).ready, true);
  const empty = await (await post('plan', { name: 'blank', parent, stack: 'empty' })).json();
  assert.equal(empty.tools.ready, true);
  // this console's PATH has node only: an empty project with Git ticked is blocked on Git, with no override
  const withGit = await (await post('plan', { name: 'blankgit', parent, stack: 'empty', git: true })).json();
  assert.deepEqual([withGit.tools.ready, withGit.tools.overridable, withGit.tools.missing.map((tool) => tool.name)], [false, false, ['git']]);
  assert.equal((await post('create', { planId: withGit.id, confirm: withGit.hash, overrideMissingTools: true })).status, 422);
  assert.equal((await (await fetch(`${server.url}api/new/prerequisites?stack=empty&git=1`, { headers })).json()).ready, false);
  assert.deepEqual(await readdir(parent), []);

  const readOnly = await startConsoleServer({ roots: [home], port: 0, readOnly: true });
  try {
    assert.equal((await fetch(`${readOnly.url}api/new/prerequisites?stack=laravel`, { headers: { Authorization: `Bearer ${readOnly.token}` } })).status, 405);
  } finally { await readOnly.close(); }
});
