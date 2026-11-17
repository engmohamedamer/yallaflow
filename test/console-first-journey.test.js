// PF-0162: the first-run journey. The welcome panel routes by intent (Create, Manage, Monitor);
// Create and Manage are agent-first, with the machine's agent setup shown in place; fixed
// templates and creating without an agent are labeled Advanced options; a returning user whose
// usual agent is ready sees no setup. Evaluated from the shipped app.js with minimal stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { computeMachineReadiness } from '../src/agents/machine-readiness.js';
import { CATALOG } from '../src/newproject/catalog.js';
import { describeCatalog } from '../src/newproject/catalog.js';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../resources/console/app.css', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const signedIn = { loggedIn: true, method: 'chatgpt', checked: true, subscription: true };
const machine = (platform, { codexReady = false, preferredAgent = null } = {}) => {
  const status = { platform, supportedPlatform: platform !== 'win32',
    codex: codexReady ? { cli: { version: '0.167.0' }, adapter: { version: '2.5.0' }, problems: [], login: signedIn, installed: true, ready: true, install: null, verified: null } : { cli: null, adapter: null, problems: ['x'], login: { loggedIn: false, method: null, checked: false, subscription: false }, installed: false, ready: false, install: { command: 'npm install -g x' }, verified: null },
    claude: { installed: false, version: null, connectionIncluded: true } };
  return { data: { ...status, readiness: computeMachineReadiness(status, { preferences: { preferredAgent } }) } };
};

function welcome({ lang = 'en', readOnly = false, machineInfo = null, welcomeSetup = false } = {}) {
  const calls = { prefs: [], opened: [], hash: null };
  const context = vm.createContext({
    A: (ar, en) => (lang === 'ar' ? ar : en), esc, readOnly, machineInfo, agentSetupCard: () => '<div data-agent-setup></div>',
    savePrefs: (patch) => calls.prefs.push(patch), openFolder: (mode) => calls.opened.push(mode), location: { set hash(v) { calls.hash = v; } }
  });
  vm.runInContext(`${cut('  let welcomeSetup = false;', '  function viewProjects() {')}; welcomeSetup = ${welcomeSetup}; globalThis.fx = { welcomePanel, chooseIntent, intent: () => folderIntent };`, context);
  return { fx: context.fx, calls };
}

test('first run: the welcome panel offers Create, Manage and Monitor in plain words, in Arabic and English', () => {
  for (const lang of ['en', 'ar']) {
    const html = welcome({ lang, machineInfo: machine('linux') }).fx.welcomePanel();
    assert.match(html, /data-welcome/);
    assert.deepEqual([...html.matchAll(/data-intent-go="(\w+)"/g)].map((m) => m[1]), ['create', 'manage', 'monitor']);
    assert.match(html, lang === 'en' ? /Create a new project[\s\S]*Manage an existing project[\s\S]*Monitor a project/ : /أنشئ مشروعاً جديداً[\s\S]*أدِر مشروعاً موجوداً[\s\S]*تابِع مشروعاً فقط/);
    assert.match(html, lang === 'en' ? /No agent needed/ : /بدون وكيل/);
    assert.match(html, lang === 'en' ? /Your files and Git history stay as they are/ : /ملفاتك وتاريخ Git يبقيان كما هما/);
    assert.ok(!/beginner|expert|مبتدئ|خبير/i.test(html), 'nobody is asked to label themselves');
  }
  const ro = welcome({ readOnly: true }).fx.welcomePanel();
  assert.ok(!/data-intent-go/.test(ro), 'a read-only console offers no journey');
});

test('first run: the agent state is shown with Create and Manage; its setup opens in place; a ready agent shows no setup', () => {
  assert.match(welcome().fx.welcomePanel(), /data-welcome-agent="checking"/);
  const needs = welcome({ machineInfo: machine('win32') }).fx.welcomePanel();
  assert.match(needs, /data-welcome-agent="needs-setup"/);
  assert.match(needs, /your own subscription \(never API keys\)/);
  assert.match(needs, /Monitor only does not need it/);
  assert.match(needs, /data-welcome-setup/);
  assert.ok(!/data-agent-setup/.test(needs), 'the setup card waits for the click');
  assert.match(welcome({ machineInfo: machine('win32'), welcomeSetup: true }).fx.welcomePanel(), /data-agent-setup/);
  const ready = welcome({ machineInfo: machine('linux', { codexReady: true, preferredAgent: 'codex' }) }).fx.welcomePanel();
  assert.match(ready, /data-welcome-agent="ready"[\s\S]*Codex is ready on this machine/);
  assert.ok(!/data-welcome-setup|data-agent-setup/.test(ready), 'returning user: nothing to set up');
});

test('first run: the intent is saved and routes: Create to the wizard, Manage and Monitor to the folder chooser', () => {
  const create = welcome();
  create.fx.chooseIntent('create');
  assert.equal(JSON.stringify([create.calls.prefs, create.calls.hash, create.calls.opened]), JSON.stringify([[{ onboarding: { intent: 'create', completed: true } }], '#/new', []]));
  for (const intent of ['manage', 'monitor']) {
    const picked = welcome();
    picked.fx.chooseIntent(intent);
    assert.equal(JSON.stringify([picked.calls.prefs, picked.calls.opened, picked.fx.intent(), picked.calls.hash]), JSON.stringify([[{ onboarding: { intent, completed: true } }], ['existing'], intent, null]));
  }
  // Monitor makes «Monitor only» the main action in the chooser; closing the chooser forgets the intent
  assert.match(app, /const watching = typeof folderIntent !== 'undefined' && folderIntent === 'monitor';/);
  assert.match(app, /class="btn \$\{watching \? 'go' : 'ghost'\}" data-folder-monitor/);
  assert.match(app, /d\.addEventListener\('close', \(\) => \{ folder = null; folderIntent = null; \}\);/);
});

// ---- the wizard ----
function wizard({ form = {}, machineInfo = null, claude = true, lang = 'en', preferred = null, step = 3 } = {}) {
  const calls = { planned: 0, renders: 0 };
  const catalog = { catalog: describeCatalog(CATALOG) };
  const context = vm.createContext({
    A: (ar, en) => (lang === 'ar' ? ar : en), L: (v) => (lang === 'ar' ? v.ar : v.en), esc, lang, JSON, Object, Boolean, String, FormData: class {},
    agentsClaudeAvailable: claude, agentInfo: null, machineInfo, prefs: { preferredAgent: preferred }, projects: [], pid: null, readOnly: false,
    agentSetupCard: () => '<div data-agent-setup></div>', render: () => { calls.renders += 1; }, loadAgentInfo: async () => {}, route: () => ({ v: 'new' }),
    wizardPlanNow: async () => { calls.planned += 1; }, api: async () => ({ tools: [] }), size: (n) => `${n}`, ACCEPT: '', ago: () => ''
  });
  // The wizard's own block of the page, from its state to the plan builder (which is stood in).
  const source = `${cut('  const preferredAgentId = () =>', '  // PF-0133: choose the project')}
    ${cut('  let wiz = { step: 1', '  // Builds the plan from the current choices')}
    wiz.step = ${JSON.stringify(step)}; wiz.catalog = ${JSON.stringify(catalog)};
    Object.assign(wizForm(), ${JSON.stringify(form)});
    globalThis.fx = { view: viewNew, next: () => wizardNext({ dataset: {} }), form: wizForm, state: () => wiz, agentRequired, machineAgentReady };`;
  vm.runInContext(source.replace('async function wizardNext(form) {\n    readStep(form);', 'async function wizardNext(form) {'), context);
  return { fx: context.fx, calls };
}

test('wizard stack step: planning with the agent is the usual path; fixed templates are a labeled Advanced section', () => {
  for (const lang of ['en', 'ar']) {
    const html = wizard({ step: 2, lang, form: { name: 'shop', parent: '/home/u' } }).fx.view();
    const advancedAt = html.indexOf('data-stack-advanced');
    assert.ok(advancedAt > 0);
    assert.ok(html.indexOf('value="empty"') < advancedAt, 'the agent-planned project comes first, outside Advanced');
    assert.match(html.slice(0, advancedAt), lang === 'en' ? /Plan it with your agent[\s\S]*recommended/ : /خطّطه مع وكيلك[\s\S]*الموصى به/);
    for (const id of ['laravel', 'react-vite', 'vue-vite', 'nextjs', 'nestjs']) assert.ok(html.indexOf(`value="${id}"`) > advancedAt, `${id} is under Advanced`);
    assert.match(html, lang === 'en' ? /Advanced: generate starter code from a fixed template<\/b> <span class="tiny muted">\(no agent needed\)/ : /متقدم: توليد كود مبدئي من قالب ثابت<\/b> <span class="tiny muted">\(بدون وكيل\)/);
    assert.ok(!/data-stack-advanced open/.test(html), 'closed until a template is chosen');
  }
  assert.match(wizard({ step: 2, form: { stack: 'laravel' } }).fx.view(), /data-stack-advanced open/, 'an expert who chose a template sees it at once');
});

test('wizard agent step: an agent-planned project needs a chosen, ready agent; the way around it is a labeled Advanced tick', async () => {
  const notReady = machine('win32');
  // default: Codex is preselected, "no agent" is not an ordinary choice, and the setup is shown in place
  const first = wizard({ machineInfo: notReady, form: { name: 'shop', parent: 'C:\\code' } });
  assert.equal(first.fx.form().agent, 'codex');
  const html = first.fx.view();
  assert.ok(!/name="wiz-agent" value="none"/.test(html), 'no-agent is not offered beside the agents');
  assert.match(html, /data-agent-advanced[\s\S]*name="noAgent"[\s\S]*Continue without a ready agent/);
  assert.match(html, /data-wiz-agent-setup="codex"[\s\S]*Codex is not ready on this machine yet[\s\S]*data-agent-setup/);
  assert.match(html, /not ready — finish its setup below/);
  await first.fx.next();
  assert.equal(first.calls.planned, 0, 'no plan while the agent is not ready');
  assert.match(first.fx.state().error, /Codex is not ready on this machine yet\. Finish its setup below, or open Advanced/);
  // nothing chosen
  const none = wizard({ machineInfo: notReady, form: { agent: 'none' } });
  await none.fx.next();
  assert.deepEqual([none.calls.planned, /Choose the agent for this project/.test(none.fx.state().error)], [0, true]);
  // the Advanced tick lets it through, with or without an agent
  for (const agent of ['none', 'codex']) {
    const advanced = wizard({ machineInfo: notReady, form: { agent, noAgent: true } });
    await advanced.fx.next();
    assert.deepEqual([advanced.calls.planned, advanced.fx.state().error], [1, null]);
  }
  // readiness unknown (the machine check has not answered): the page does not invent a block
  const unknown = wizard({ machineInfo: null });
  await unknown.fx.next();
  assert.equal(unknown.calls.planned, 1);
});

test('wizard agent step: a fixed template needs no agent; a returning user with a ready usual agent sees no setup', async () => {
  const template = wizard({ machineInfo: machine('linux'), form: { stack: 'laravel', agent: 'none' } });
  assert.equal(template.fx.agentRequired(), false);
  const html = template.fx.view();
  assert.match(html, /name="wiz-agent" value="none"/, 'with a template, no agent is an ordinary choice');
  assert.ok(!/data-agent-advanced/.test(html));
  await template.fx.next();
  assert.equal(template.calls.planned, 1);

  const returning = wizard({ machineInfo: machine('linux', { codexReady: true, preferredAgent: 'codex' }), preferred: 'codex' });
  const view = returning.fx.view();
  assert.equal(returning.fx.form().agent, 'codex');
  assert.match(view, /data-usual-agent="codex"/);
  assert.match(view, /ready on this machine/);
  assert.ok(!/data-wiz-agent-setup|data-agent-setup|not ready/.test(view), 'no setup card and no warning');
  await returning.fx.next();
  assert.deepEqual([returning.calls.planned, returning.fx.state().error], [1, null]);
  // the usual agent is Claude Code where this console can offer it; otherwise Codex
  assert.equal(wizard({ preferred: 'claude' }).fx.form().agent, 'claude');
  assert.equal(wizard({ preferred: 'claude', claude: false }).fx.form().agent, 'codex');
});

test('layout: the intent cards wrap on narrow screens and use the theme tokens (light and dark)', () => {
  assert.match(css, /\.welcome \.intentgrid \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(230px, 1fr\)\)/);
  assert.match(css, /\.intentcard \{[^}]*border: 1px solid var\(--line\)[^}]*background: var\(--card\)/);
  const added = css.slice(css.indexOf('/* PF-0158'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(added), 'no fixed colors in the new styles: tokens follow the theme');
  assert.ok(!/\b(left|right)\s*:/.test(added) && !/(margin|padding)-(left|right)/.test(added), 'no left/right rules: the layout follows the text direction');
});
