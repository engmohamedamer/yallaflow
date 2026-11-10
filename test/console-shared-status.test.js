// PF-0113: the console shows where a checkout stands (branch, Shared Project Mode, integration
// branch), offers the existing Shared enable flow from Overview, recommends it for new work on a
// feature branch, and doctor diagnoses merge collisions (work IDs and fact IDs) on every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { emptyLedger } from '../src/context/ledger.js';
import { startConsoleServer } from '../src/console/server.js';
import { createLane } from '../src/execution/lanes.js';
import { platformCheck } from '../src/execution/git-ops.js';
import { writeLocalIdentity } from '../src/shared/identity.js';
import { fakeTools } from '../test-support/agent-fixtures.js';
import { loadSchema, validate } from '../test-support/schema.js';

// The developer's own Git settings (init.defaultBranch) must not decide these results.
const emptyGlobal = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-gitcfg-')), 'gitconfig');
await writeFile(emptyGlobal, '');
process.env.GIT_CONFIG_GLOBAL = emptyGlobal;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const OVERVIEW = loadSchema('overview-1.schema.json');
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const git = (cwd, args) => spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });

async function repo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-shared-status-'));
  git(root, ['init', '-q', '-b', 'main']);
  await initWorkspace(root, 'Shop', 'greenfield', 'adaptive');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}

async function withConsole(roots, fn) {
  const tools = await fakeTools();
  const server = await startConsoleServer({ roots, port: 0, agents: true, agentEnv: tools.env });
  const headers = { Authorization: `Bearer ${server.token}` };
  const post = { ...headers, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  try {
    const projects = (await (await fetch(`${server.url}api/projects`, { headers })).json()).projects;
    const get = async (pid, route) => { const r = await fetch(`${server.url}api/p/${pid}/${route}`, { headers }); return { status: r.status, body: await r.json() }; };
    const enable = async (pid) => { const r = await fetch(`${server.url}api/p/${pid}/execution/shared-enable`, { method: 'POST', headers: post, body: JSON.stringify({ confirmed: true }) }); return { status: r.status, body: await r.json() }; };
    await fn({ projects, get, enable });
  } finally {
    await server.close();
  }
}

test('overview: feature branch without Shared Mode — branch, detected integration branch, Turn on; CLI JSON unchanged', async () => {
  const root = await repo();
  git(root, ['config', 'init.defaultBranch', 'main']);
  git(root, ['checkout', '-qb', 'feature/csv']);
  const before = run(root, ['change', 'Existing plain item', '--scope', 'bounded']);
  const legacyId = /Created (PF-\d{4})/.exec(before.stdout)[1];
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'work']);

  const cliDoc = JSON.parse(run(root, ['overview', '--json']).stdout);
  assert.equal('git' in cliDoc, false, 'the CLI overview contract is unchanged');

  await withConsole([root], async ({ projects, get, enable }) => {
    const pid = projects[0].id;
    const { status, body } = await get(pid, 'overview');
    assert.equal(status, 200);
    assert.deepEqual(body.git, { branch: 'feature/csv', sharedMode: false, integrationBranch: 'main', integrationBranchSource: 'detected', lane: false, canEnableShared: true });
    const { git: _git, ...document } = body;
    assert.deepEqual(validate(OVERVIEW, document), [], 'the CLI part still matches overview-1');

    // No detectable default branch: nothing to compare against.
    git(root, ['config', '--unset', 'init.defaultBranch']);
    const unknown = (await get(pid, 'overview')).body.git;
    assert.equal(unknown.integrationBranch, null);
    assert.equal(unknown.integrationBranchSource, null);

    // Turn on through the existing endpoint: existing IDs stay valid, new ones are branch-safe.
    git(root, ['config', 'init.defaultBranch', 'main']);
    const enabled = await enable(pid);
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    const on = (await get(pid, 'overview')).body.git;
    assert.equal(on.sharedMode, true);
    assert.equal(on.integrationBranch, 'main');
    assert.equal(on.integrationBranchSource, 'configured');
    assert.equal(on.canEnableShared, false);
    await writeLocalIdentity(root, 'MMMMMMMMMM');
    const next = /Created (PF-[A-Z0-9-]+)/.exec(run(root, ['change', 'New item', '--scope', 'bounded']).stdout)[1];
    assert.equal(next, 'PF-MMMMMMMMMM-0001');
    assert.equal(run(root, ['work', 'show', legacyId, '--json']).status, 0, `${legacyId} is still valid`);
  });
});

test('overview: a lane project reports its own branch, is never offered Turn on, and cannot enable or preview', async () => {
  if (!platformCheck().ok) return;
  const root = await repo();
  run(root, ['shared', 'enable', '--integration-branch', 'main']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'shared']);
  const lane = await createLane(root, { slug: 'csv-export' });
  await withConsole([root, lane.path], async ({ projects, get, enable }) => {
    const home = projects.find((p) => p.kind !== 'lane');
    const laneProject = projects.find((p) => p.kind === 'lane');
    assert.ok(laneProject, 'the lane is listed as a lane project');
    const homeGit = (await get(home.id, 'overview')).body.git;
    assert.deepEqual(homeGit, { branch: 'main', sharedMode: true, integrationBranch: 'main', integrationBranchSource: 'configured', lane: false, canEnableShared: false });
    const laneGit = (await get(laneProject.id, 'overview')).body.git;
    assert.equal(laneGit.branch, lane.branch);
    assert.equal(laneGit.lane, true);
    assert.equal(laneGit.canEnableShared, false);
    assert.equal((await get(laneProject.id, 'shared/preview')).status, 409);
    const refused = await enable(laneProject.id);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'NOT_HOME');
  });
});

// The UI helpers, evaluated from the shipped app.js with minimal stand-ins.
async function uiHelpers(state) {
  const app = await readFile(fileURLToPath(new URL('../resources/console/app.js', import.meta.url)), 'utf8');
  const body = /(\s*function gitLine\(g\) \{[\s\S]*?)\n\s*function viewOverview\(\) \{/.exec(app)[1];
  const make = new Function('A', 'esc', 'state', `let readOnly = state.readOnly; let pid = state.pid; let projectOverview = state.projectOverview;\n${body}\nreturn { gitLine, sharedHint };`);
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return make((_ar, en) => en, esc, state);
}

test('ui: Overview line and New Work hint compare only against a known integration branch', async () => {
  const git = (over) => ({ branch: 'feature/csv', sharedMode: false, integrationBranch: 'main', integrationBranchSource: 'detected', lane: false, canEnableShared: true, ...over });
  const ui = async (g, readOnly = false) => uiHelpers({ readOnly, pid: 'p1', projectOverview: { pid: 'p1', data: { git: g } } });

  const off = await ui(git());
  const line = off.gitLine(git());
  assert.match(line, /⑂ feature\/csv/);
  assert.match(line, /data-shared-mode="off"/);
  assert.match(line, /Integration branch: <span class="ltr">main<\/span> \(from Git settings\)/);
  assert.match(line, /data-shared-open/);
  assert.match(off.sharedHint(), /not the integration branch <span class="ltr">main<\/span>/);

  assert.equal((await ui(git({ integrationBranch: null, integrationBranchSource: null }))).sharedHint(), '', 'unknown integration branch: no comparison');
  assert.equal((await ui(git({ branch: 'main' }))).sharedHint(), '', 'on the integration branch: no hint');
  assert.equal((await ui(git({ sharedMode: true, canEnableShared: false }))).sharedHint(), '');
  assert.equal((await ui(git({ lane: true, canEnableShared: false }))).sharedHint(), '');
  const noAgents = await ui(git({ canEnableShared: false }));
  assert.doesNotMatch(noAgents.sharedHint(), /data-shared-open/);
  assert.match(noAgents.sharedHint(), /yallaflow shared enable/);

  const on = await ui(git({ sharedMode: true, canEnableShared: false, integrationBranchSource: 'configured' }));
  const onLine = on.gitLine(git({ sharedMode: true, canEnableShared: false, integrationBranchSource: 'configured' }));
  assert.match(onLine, /data-shared-mode="on"/);
  assert.doesNotMatch(onLine, /data-shared-open|from Git settings|shared enable/);
  assert.match(off.gitLine(git({ branch: null })), /Not on a branch/);
});

test('ui: one Shared enable panel, and work IDs stay whole beside their titles', async () => {
  const app = await readFile(fileURLToPath(new URL('../resources/console/app.js', import.meta.url)), 'utf8');
  assert.equal(app.match(/data-shared-enable disabled/g).length, 1, 'the enable control exists once (sharedPanel)');
  assert.equal(app.match(/execution\/shared-enable/g).length, 1, 'one call site for the enable endpoint');
  assert.match(app, /function wid\(id\) \{ return `<span class="ltr wid" title="\$\{esc\(id\)\}">\$\{esc\(id\)\}<\/span>`; \}/);
  assert.match(app, /data-copy="\$\{esc\(it\.id\)\}"/, 'the item page copies the canonical ID');
});

test('doctor: duplicate fact IDs are diagnosed read-only; a healthy workspace prints no diagnosis', async () => {
  const root = await repo();
  const healthy = run(root, ['doctor']);
  assert.equal(healthy.status, 0, healthy.stdout);
  assert.doesNotMatch(healthy.stdout, /read-only diagnosis/);

  const file = path.join(root, '.yallaflow', 'context', 'index.yaml');
  const ledger = { ...emptyLedger() };
  const fact = { id: 'CTX-0001', kind: 'project', status: 'current', summary: 'Shop sells things.' };
  ledger.facts = [fact, { ...fact, summary: 'Shop also rents things.' }];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`);
  const raw = await readFile(file, 'utf8');
  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /Duplicate project-memory fact IDs \(1\) — read-only diagnosis; nothing was changed/);
  assert.match(doctor.stdout, /CTX-0001 appears 2 times/);
  assert.match(doctor.stdout, /Do not renumber or edit them by hand/);
  assert.equal(await readFile(file, 'utf8'), raw, 'doctor changed nothing');
});
