// PF-0163: the wizard's choices survive a reload, and an interrupted creation is resumed from
// its saved plan without repeating finished steps. The draft lives in this browser only and
// holds typed choices, the step and a plan id: never file contents and never a confirmation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createFromPlan, createPlan, loadPlan } from '../src/newproject/project.js';
import { CATALOG } from '../src/newproject/catalog.js';
import { CORE_HOOKS } from '../src/commands/new.js';

process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-resume-cfg-')), 'console.json');
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

function wizard({ stored = null, plans = {}, consoleReadOnly = false, serverDraft = null } = {}) {
  const local = new Map(stored ? [['wizardDraft', stored]] : []);
  const calls = { api: [], after: [], timers: 0, posts: [] };
  const context = vm.createContext({
    JSON, Object, Math, Date, RegExp, String, Boolean, consoleReadOnly,
    store: { get: (k, d) => (local.has(k) && local.get(k) !== null ? local.get(k) : d), set: (k, v) => local.set(k, v) },
    post: async (url, body) => { calls.posts.push([url, JSON.parse(body)]); return {}; },
    api: async (url) => { calls.api.push(url); if (url === '/api/new/catalog') return { catalog: [] }; if (url === '/api/new/draft') return { draft: serverDraft }; const id = url.split('/').at(-1); if (!plans[id]) throw new Error('No plan'); return plans[id]; },
    setInterval: () => { calls.timers += 1; return 7; }, clearInterval: () => { calls.timers -= 1; },
    pollWizard() {}, afterCreate: async (outcome, options) => { calls.after.push([outcome, options]); },
    wizForm: null
  });
  vm.runInContext(`let wiz = { step: 1, catalog: null, tools: null, form: null, files: [], plan: null, error: null, busy: false, progress: null, acknowledged: false, attach: null, registration: null, ready: null };
    let wizTimer = null;
    const wizForm = () => (wiz.form ??= { name: '', description: '', requirements: '', parent: '/home/u', stack: 'empty', environment: 'later', git: true, install: false, allowNested: false, agent: 'codex', noAgent: false });
    ${cut('  const WIZ_DRAFT = ', '  async function loadTools() {')}
    ${cut('  function resetWizard() {', '  async function wizardRegister() {')}
    globalThis.fx = { load: loadWizard, save: saveWizDraft, clean: cleanWizDraft, reset: resetWizard, form: wizForm, state: () => wiz, set: (patch) => Object.assign(wiz, patch) };`, context);
  return { fx: context.fx, calls, local };
}

test('the draft holds typed choices only, each bounded; anything else in storage is ignored', () => {
  const { fx } = wizard();
  same(fx.clean(null), null);
  same(fx.clean({ form: {} }), null);
  same(fx.clean({ form: { name: 'x'.repeat(65) } }), null, 'an over-long value is dropped');
  const cleaned = fx.clean({ form: { name: 'shop', description: 'A store', stack: 'laravel', git: 'yes', install: true, token: 'sk-123', files: [{ name: 'a.pdf' }], confirm: 'abc' }, step: 9, planId: '../../etc', acknowledged: 'true', hadFiles: true, hash: 'f00' });
  same(cleaned, { form: { name: 'shop', description: 'A store', stack: 'laravel', install: true }, step: 1, planId: null, acknowledged: false, hadFiles: true });
  same(fx.clean({ form: { name: 'a' }, step: 'progress', planId: 'NP-20261116101010-abc123' }).step, 'progress');
  same(fx.clean({ form: { name: 'a' }, step: 'progress', planId: 'nope' }).step, 1, 'progress without a real plan id is not progress');
});

test('choices are saved as the developer goes and restored after a reload, without the reviewed plan', async () => {
  const first = wizard();
  Object.assign(first.fx.form(), { name: 'shop', description: 'A store', stack: 'laravel', environment: 'local', agent: 'claude', noAgent: true });
  first.fx.set({ step: 4, plan: { id: 'NP-20261116101010-abc123', hash: 'f'.repeat(64) }, acknowledged: true, files: [{ name: 'brd.pdf', file: {} }] });
  first.fx.save();
  const stored = first.local.get('wizardDraft');
  assert.ok(!JSON.stringify(stored).includes('f'.repeat(64)), 'the plan hash (the confirmation) is never stored');
  assert.ok(!JSON.stringify(stored).includes('brd.pdf'), 'no file is stored');
  same([stored.step, stored.planId, stored.hadFiles], [4, null, true], 'a plan id is kept only while a creation runs');

  const reloaded = wizard({ stored });
  await reloaded.fx.load();
  const state = reloaded.fx.state();
  same([state.form.name, state.form.stack, state.form.environment, state.form.agent, state.form.noAgent, state.form.parent], ['shop', 'laravel', 'local', 'claude', true, '/home/u']);
  same([state.step, state.plan, state.acknowledged, state.restored], [3, null, true, { hadFiles: true }], 'back on the last choice step: the review builds a fresh plan');
  // a second load never overwrites what is being typed now
  reloaded.fx.form().name = 'changed';
  await reloaded.fx.load();
  assert.equal(reloaded.fx.state().form.name, 'changed');
  // starting over clears the draft; a read-only console restores nothing
  reloaded.fx.reset();
  same([reloaded.local.get('wizardDraft'), reloaded.fx.state().form, reloaded.fx.state().step], [null, null, 1]);
  const ro = wizard({ stored, consoleReadOnly: true });
  await ro.fx.load();
  assert.equal(ro.fx.state().form, null);
});

test('a creation that was running is found again: still running, finished, interrupted, or gone', async () => {
  const id = 'NP-20261116101010-abc123';
  const stored = { form: { name: 'shop', stack: 'laravel' }, step: 'progress', planId: id, acknowledged: true };
  const plan = { id, hash: 'a'.repeat(64), body: { name: 'shop', steps: [] }, progress: { steps: { generate: { status: 'done' } } } };

  const running = wizard({ stored, plans: { [id]: { plan, log: '', running: true, outcome: null } } });
  await running.fx.load();
  same([running.fx.state().step, running.fx.state().plan.id, running.calls.timers, running.calls.after.length], ['progress', id, 1, 0], 'the page follows the running creation again');

  const finished = wizard({ stored, plans: { [id]: { plan, log: '', running: false, outcome: { ok: true, destination: '/home/u/shop', registration: { ok: true, id: 'p1' } } } } });
  await finished.fx.load();
  same([finished.fx.state().step, finished.calls.after.length, finished.calls.after[0][1]], ['progress', 1, { upload: false }], 'finished while away: completed without re-uploading files this page no longer has');

  const interrupted = wizard({ stored, plans: { [id]: { plan, log: '', running: false, outcome: null } } });
  await interrupted.fx.load();
  same([interrupted.fx.state().step, interrupted.fx.state().progress.running, interrupted.calls.timers, interrupted.calls.after.length, interrupted.fx.state().acknowledged], ['progress', false, 0, 0, true]);

  const gone = wizard({ stored });
  await gone.fx.load();
  same([gone.fx.state().step, gone.fx.state().plan, gone.fx.state().form.name], [3, null, 'shop'], 'the plan is gone: the choices stay and the review makes a new plan');
  assert.equal(gone.local.get('wizardDraft').planId, null);
});

test('the page offers the right next step for an interrupted creation, and points to it from Projects', () => {
  const view = cut('    } else if (pr && !pr.running && !outcome) {', '    } else if (outcome?.error) {');
  assert.match(view, /const created = \['promote', 'init', 'first-work'\]\.every\(\(id\) => stepState\(id\) === 'done'\);/);
  assert.match(view, /data-wiz-interrupted="unfinished"[\s\S]*data-wiz-retry[\s\S]*Continue the creation[\s\S]*data-wiz-reset/);
  assert.match(view, /finished steps are not repeated/);
  assert.match(view, /data-wiz-interrupted="created"[\s\S]*data-wiz-register/, 'a project that exists is only added to the console, never created again');
  assert.match(app, /if \(e\.target\.closest\('\[data-wiz-retry\]'\)\) \{ wizardCreate\(null\); return; \}/, 'Continue is the same confirmed request as a first try');
  assert.match(cut('  async function wizardCreate(form) {', '  async function uploadPlanned() {'), /planId: wiz\.plan\.id, confirm: wiz\.plan\.hash/);
  assert.match(app, /data-unfinished-new[\s\S]{0,900}Continue where you left off/);
  assert.match(app, /data-wiz-restored>↺ \$\{A\('[^']+', 'Your previous choices were restored\.'\)\}/);
});

test('server side: continuing an interrupted creation repeats no finished step and creates no second project', { skip: process.platform === 'win32' }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'yf-resume-'));
  const counter = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-resume-count-')), 'runs');
  const script = `const fs=require('fs');fs.appendFileSync(${JSON.stringify(counter)},'x');const d=process.argv[1];fs.mkdirSync(d);fs.writeFileSync(d+'/package.json','{}')`;
  const entry = { id: 'fake-count', label: 'Fake', stack: ['Fake'], generator: { tool: 'fake', package: 'fake-gen', version: '1.0.0' }, prerequisites: [{ name: 'node', argv: [process.execPath, '--version'] }],
    argv: (name) => [process.execPath, '-e', script, name], network: false, installsDependencies: false, runsPackageScripts: false, marker: 'package.json', structure: [], install: null, docs: null };
  const catalog = [...CATALOG, entry];
  const plan = await createPlan({ name: 'shop', parent, stack: 'fake-count', description: 'A store' }, { catalog });
  // the first run is cut off after the project folder is in place (the process "died" during init)
  const dying = { ...CORE_HOOKS, initProject: async () => { throw new Error('console closed'); } };
  await assert.rejects(createFromPlan(plan.id, plan.hash, { catalog, hooks: dying }), /console closed/);
  const mid = await loadPlan(plan.id);
  same([mid.progress.steps.generate.status, mid.progress.steps.promote.status, mid.progress.steps.init?.status ?? null], ['done', 'done', null]);
  // continuing: the same plan and confirmation; a wrong confirmation is still refused
  await assert.rejects(createFromPlan(plan.id, 'deadbeef', { catalog, hooks: CORE_HOOKS }), { code: 'NEW_PROJECT_CONFIRM' });
  const result = await createFromPlan(plan.id, plan.hash, { catalog, hooks: CORE_HOOKS });
  assert.equal(result.destination, path.join(parent, 'shop'));
  assert.equal(await readFile(counter, 'utf8'), 'x', 'the generator ran once');
  same(await readdir(parent), ['shop'], 'one project, no second folder, staging removed');
  const done = await loadPlan(plan.id);
  assert.ok(['generate', 'promote', 'init', 'first-work'].every((step) => done.progress.steps[step].status === 'done'));
  // and once more: nothing left to do, nothing repeated
  await createFromPlan(plan.id, plan.hash, { catalog, hooks: CORE_HOOKS });
  assert.equal(await readFile(counter, 'utf8'), 'x');
});


// PF-0175 (real Windows trial, W5): browser storage is per port; the draft is also kept on this machine.
test('a draft saved by a console on another port is restored from the machine copy; every save and drop reaches it', async () => {
  const draft = { form: { name: 'notebook', description: 'simple notebook no login', parent: 'E:\\work', stack: 'empty' }, step: 2, planId: null };
  const w = wizard({ serverDraft: draft });
  await w.fx.load();
  same([w.fx.state().form.name, w.fx.state().form.description, w.fx.state().step], ['notebook', 'simple notebook no login', 2]);
  w.fx.save();
  assert.equal(w.calls.posts.at(-1)[0], '/api/new/draft');
  assert.equal(w.calls.posts.at(-1)[1].draft.form.name, 'notebook');
  assert.ok(!('files' in w.calls.posts.at(-1)[1].draft.form), 'never the files');
  const ro = wizard({ serverDraft: draft, consoleReadOnly: true });
  await ro.fx.load();
  assert.equal(ro.calls.api.includes('/api/new/draft'), false, 'a read-only console asks for no draft');
});
