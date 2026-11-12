// PF-0132: the console's information architecture — Agents inside Projects, one Project
// destination with Overview · Run · Settings tabs, team mode in the header, Settings, the
// Workspace and the New Project success step, and header tabs Workspace · Project · More.
// Evaluated from the shipped app.js / app.css with minimal stand-ins, like the other console UI tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../resources/console/app.css', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (lang = 'en') => ({ lang, A: (ar, en) => (lang === 'ar' ? ar : en), esc, L: (v) => (typeof v === 'string' ? v : v[lang] ?? v.en), fwd: () => (lang === 'ar' ? '←' : '→'), mins: (m) => `${m} min` });
const topbar = cut('  function topbar(r) {', '  // PF-0132: Team or Solo');

function routes(hash) {
  const replaced = [];
  const context = vm.createContext({ location: { hash, pathname: '/', search: '' }, history: { replaceState: (_s, _t, url) => { replaced.push(url); } }, document: { getElementById: () => null } });
  vm.runInContext(`${cut('  const route = () =>', '  const items = () =>')}\nthis.canonicalHash = canonicalHash; this.normalizeRoute = normalizeRoute;`, context);
  return { context, replaced };
}

test('AC-002/AC-007: header tabs are exactly Workspace · Project · More; no Agents or Setup & run tab', () => {
  const nav = /<nav class="tabs"[^\n]*<\/nav>/.exec(topbar)[0];
  const tabs = [...nav.matchAll(/\$\{tab\(([^,]+),/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['workspaceHref()', "'#/overview'"], 'two tab links, then the More menu');
  assert.match(nav, /\$\{more\}<\/nav>/);
  assert.match(nav, /A\('المشروع', 'Project'\), \[\.\.\.PROJECT_TABS, 'setup'\]\.includes\(r\.v\)/, 'Project is active on Overview, Run and Settings');
  assert.doesNotMatch(app, /tab\('#\/agents'|tab\('#\/setup'|'Setup & run'\)/);
  assert.match(topbar, /\$\{teamIndicator\(\)\}/, 'the team indicator sits beside the project switcher');
  assert.match(topbar, /href="#\/projects">[^\n]*'All projects & agents'/, 'the switcher leads to Projects');
});

test('AC-002/AC-003: old routes and in-page anchors land on their new home', () => {
  const cases = { '#/agents': '#/projects/inbox', '#/setup': '#/run', '#/setup/agents': '#/settings/agents', '#setup-agents': '#/settings/agents', '#setup-run': '#/run', '#setup-config': '#/settings/services', '#/overview': null, '#/run': null, '#/settings': null, '#/projects': null };
  for (const [hash, want] of Object.entries(cases)) {
    const { context, replaced } = routes(hash);
    assert.equal(context.canonicalHash(), want, hash);
    context.normalizeRoute();
    assert.deepEqual(replaced, want ? [`/${want}`] : [], hash);
  }
  assert.match(app, /const views = \{[^}]*run: viewRun, settings: viewSettings, setup: viewRun,[^}]*agents: viewProjects,/);
  assert.match(app, /const SECTION_ID = \{ agents: 'setup-agents', team: 'set-team', services: 'set-services', project: 'set-project', inbox: 'inbox' \};/);
  assert.match(app, /normalizeRoute\(\);\n {4}closeDrawer\(\);/, 'every hash change is normalized first');
  assert.match(app, /scrollTo\(0, 0\); landOnSection\(\);/);
  assert.doesNotMatch(app, /location\.hash = '#\/agents'|href="#\/agents"|href="#\/setup"/, 'nothing links to the old pages any more');
});

test('AC-002: the bell still counts agent requests and leads to the Projects inbox', () => {
  assert.match(app, /const needs = \(\) => \[[^\n]*\(execView\?\.inbox \?\? \[\]\)/, 'the inbox is part of the bell count');
  assert.match(app, /<a href="\$\{elsewhere \? '#\/projects\/inbox' :/);
  assert.match(app, /<a class="tiny notes-all" href="#\/projects\/inbox">/);
});

function projects({ agentsOn = true, execView = null } = {}) {
  const context = vm.createContext({ ...base(), agentsOn, execView, execError: null, xPermCard: (p) => `<div class="xperm" data-x-perm="${p.requestId}"></div>` });
  vm.runInContext(`${cut('  function limitNotices() {', '  // Worktrees: this project')}\nthis.inbox = inboxSection; this.card = cardAgents;`, context);
  return context;
}

test('AC-001: Projects shows the Needs-you inbox above the cards and each card lists only its own lanes', () => {
  const lane = (over) => ({ project: 'p1', name: 'Shop', kind: 'home', parent: null, session: null, pending: [], runs: [], lastStep: null, workingSince: null, ...over });
  const execView = {
    inbox: [{ project: 'p2', requestId: 'r1', title: 'Run tests' }],
    limits: [],
    lanes: [
      lane({ session: { provider: 'codex', status: 'working', workId: 'PF-0007' }, lastStep: { title: 'Edited a file' } }),
      lane({ project: 'l1', name: 'yf/PF-0008', kind: 'lane', parent: 'p1', session: { provider: 'claude', status: 'idle', workId: 'PF-0008' }, pending: [{ requestId: 'r2' }] }),
      lane({ project: 'p2', name: 'Blog', session: { provider: 'codex', status: 'working', workId: 'PF-0099' } })
    ]
  };
  const on = projects({ execView });
  const inbox = on.inbox();
  assert.match(inbox, /id="inbox"/);
  assert.match(inbox, /data-x-perm="r1"/, 'the existing permission cards (approve/deny) are reused');
  const card = on.card({ id: 'p1' });
  assert.match(card, /PF-0007/);
  assert.match(card, /PF-0008/, 'a child lane of the project is listed');
  assert.match(card, /needs your approval/);
  assert.doesNotMatch(card, /PF-0099/, 'another project\'s lane is not');
  assert.match(card, /data-x-open="p1" data-x-work="PF-0007"/);
  assert.match(card, /data-open-view="team"/, 'queues and merges stay on Worktrees');
  assert.match(on.card({ id: 'p3' }), /No agent running\./);
  const off = projects({ agentsOn: false, execView });
  assert.equal(off.inbox(), '');
  assert.equal(off.card({ id: 'p1' }), '');
  assert.match(app, /\$\{overview\.length \? inboxSection\(\) : ''\}/, 'the inbox comes before the cards');
  assert.match(app, /\$\{cardAgents\(project\)\}/);
  assert.match(app, /if \(agentsOn && \(\['projects', 'team'\]\.includes\(v\) \|\| !execView\)\) await loadExecution\(\);/);
  assert.doesNotMatch(app, /function viewAgents\(/);
});

function shell(over = {}) {
  const context = vm.createContext({ ...base(), pid: 'p1', projects: [{ id: 'p1', name: 'Shop', root: '/home/u/code/shop' }], readiness: { pid: 'p1', data: { level: 'ready' } }, snap: null, runtime: null, setupInfo: null, readOnly: false, setupPending: () => true, sharedHint: () => '<div class="awarn">hint</div>', projectOverview: null, ...over });
  vm.runInContext(`${cut('  // PF-0132: Team or Solo', '  // Three different failures')}${cut('  // ---------- the Project destination (PF-0132)', '  // ---------- new-project Overview')}\nthis.tabs = projTabs; this.page = projectPage; this.team = teamIndicator; this.banner = branchBanner;`, context);
  return context;
}

test('AC-003: one Project page with an accessible tab bar and badges', () => {
  const c = shell({ projectOverview: { pid: 'p1', data: { project: { name: 'Shop' }, memory: { available: true, mayBeStale: 2, staleEvidence: 0, disputed: 1, unresolved: 0 } } }, runtime: { pid: 'p1', data: { services: [{ state: 'failed' }, { state: 'running' }] } }, setupInfo: { pid: 'p1', record: null } });
  const html = c.page('run', '<p>body</p>');
  assert.match(html, /<h1>Shop<\/h1><span class="chip done"><i><\/i>Ready<\/span>/);
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.match(html, /id="ptab-run" href="#\/run" aria-selected="true" aria-controls="ptab-panel" tabindex="0"/);
  assert.match(html, /id="ptab-overview" href="#\/overview" aria-selected="false" aria-controls="ptab-panel" tabindex="-1"/);
  assert.match(html, /Overview<span class="pbadge wait"[^>]*>3<\/span>/, 'needs-care count');
  assert.match(html, /Run<span class="pbadge fail"[^>]*>✕ 1<\/span>/, 'failed services');
  assert.match(html, /role="tabpanel" id="ptab-panel" aria-labelledby="ptab-run"><p>body<\/p>/);
  assert.match(app, /const tabEl = e\.target\.closest\?\.\('\.ptabs \[role="tab"\]'\);/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/, 'arrow keys, Home and End move between the tabs');
  assert.match(app, /A\('نظرة عامة', 'Overview'\)/); assert.match(app, /A\('التشغيل', 'Run'\)/); assert.match(app, /A\('الإعدادات', 'Settings'\)/);
});

test('AC-004: Overview is summary, needs care, areas and stack in two columns, one on phones', () => {
  const view = cut('  function viewOverview() {', '  // ---------- the Project destination (PF-0132)');
  for (const part of ['class="panel ovsum"', 'id="ov-care"', 'id="ov-areas"', 'id="ov-stack"', 'class="pcols"', 'class="pside"', 'class="keynums"']) assert.ok(view.includes(part), part);
  assert.doesNotMatch(view, /gitLine\(/, 'team mode moved out of the Overview');
  assert.match(css, /\.pcols \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 340px;/);
  assert.match(css, /@media \(max-width: 1000px\) \{ \.pcols \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 760px\) \{ \.areas \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  assert.match(css, /\.setnav \{ position: static; display: flex; flex-wrap: wrap;/, 'the Settings menu wraps on phones instead of scrolling sideways');
});

function failure({ agentsOn = true, readOnly = false, tail = ['booting', 'Error: port 5173 in use'] } = {}) {
  const context = vm.createContext({ ...base(), agentsOn, readOnly, failedTail: { web: tail }, runtimeLogs: {}, runtimeBusy: {} });
  vm.runInContext(`${cut('  function failureBlock(sv) {', '  function serviceCard(sv) {')}\nthis.block = failureBlock;`, context);
  return context.block({ id: 'web', name: 'Web' });
}

test('AC-005: a failed service is one line with View log, Ask the agent to fix and Start again', () => {
  const html = failure();
  assert.match(html, /<span class="ltr svcfail-line" title="Error: port 5173 in use">Error: port 5173 in use<\/span>/);
  assert.doesNotMatch(html, /<pre/, 'no log until asked for');
  assert.match(html, /data-rt-logs="web">View log</);
  assert.match(html, /data-ready-chat="[^"]*Find the cause and propose a fix\.">Ask the agent to fix it</);
  assert.match(html, /data-rt="restart" data-id="web" >Start again</);
  assert.match(failure({ agentsOn: false }), /data-copy="[^"]*" data-copy-what="text">Copy for your agent</);
  const ro = failure({ readOnly: true });
  assert.match(ro, /View log/); assert.doesNotMatch(ro, /data-rt="restart"/);
  assert.match(failure({ tail: [] }), /No log yet\./);
  const card = cut('  function serviceCard(sv) {', '  // ---------- Analyze → Review and save');
  assert.match(card, /<details class="svcmore svclinks" data-sx="links:\$\{esc\(sv\.id\)\}" \$\{sxOpen\(`links:\$\{sv\.id\}`\)\}>/, 'links are folded by default');
  assert.match(card, /<details class="svcmore" data-sx="svc:/, 'the definition is folded');
  assert.match(card, /data-rt-logs-hide=/);
  const run = cut('  function viewRun() {', '  // Settings: a section menu');
  assert.match(run, /<details class="panel sidecard how" data-sx="how" \$\{sxOpen\('how'\)\}>/, 'the setup analysis is folded in the side column');
  assert.match(run, /runSection\(r, rows, \{ opens: false, approving: [^}]+\}\)/);
  for (const action of ['data-rt="start"', 'data-rt="stop"', 'data-rt-review=', 'data-rt-all="start"', 'data-rt-all="stop"', 'data-rt="trust"', 'data-rt-suggest=', 'data-rt-form', 'data-plan-save', 'data-rt-analyze', 'data-rt-ask-agent']) assert.ok(app.includes(action), action);
});

test('AC-006: the header shows Team or Solo with the branch, amber when Solo off the integration branch', () => {
  const git = (over) => ({ branch: 'feature/csv', sharedMode: false, integrationBranch: 'main', lane: false, canEnableShared: true, ...over });
  const at = (g) => shell({ projectOverview: { pid: 'p1', data: { git: g } } });
  const solo = at(git()).team();
  assert.match(solo, /class="teamind solo off" href="#\/settings\/team" data-team-indicator="solo"/);
  assert.match(solo, /teamind-dot/);
  assert.match(solo, />Solo<\/span><span class="teamind-branch ltr" aria-hidden="true">⑂ feature\/csv<\/span>/);
  assert.doesNotMatch(at(git({ branch: 'main' })).team(), /teamind-dot/, 'on the integration branch: no amber');
  assert.doesNotMatch(at(git({ integrationBranch: null })).team(), /teamind-dot/, 'unknown integration branch: never a guess');
  const team = at(git({ sharedMode: true })).team();
  assert.match(team, /class="teamind team " href="#\/settings\/team" data-team-indicator="team"/);
  assert.match(team, /👥<\/span><span class="teamind-mode">Team<\/span>/);
  assert.equal(shell().team(), '', 'nothing before the overview is read');
  assert.match(app, /if \(pid && PROJECT_VIEWS\.includes\(v\) && \(\['overview', 'settings'\]\.includes\(v\) \|\| projectOverview\?\.pid !== pid\)\) await loadProjectOverview\(\);/, 'every project page reads the Git position');
  // Workspace banner: a warning in Solo (the New Work hint), a note in Team mode.
  assert.match(at(git()).banner(), /data-branch-banner="solo"><div class="awarn">hint<\/div>/);
  assert.match(at(git({ sharedMode: true })).banner(), /data-branch-banner="team"[\s\S]*combined on <span class="ltr">main<\/span>/);
  assert.equal(at(git({ branch: 'main' })).banner(), '');
  assert.equal(at(git({ lane: true })).banner(), '');
  assert.match(app, /agentStrip\(\) \+ branchBanner\(\) \+/, 'the banner is on the Workspace (Flow and List)');
  // Settings: the Team mode section with the existing confirmed flow.
  const settings = cut('  function viewSettings() {', '  // The add-service form is never redrawn');
  assert.match(settings, /<section class="setsec" id="set-team">[^\n]*gitLine\(g\)/);
  assert.match(settings, /\['setup-agents', A\('الوكلاء', 'Agents'\)\], \['set-services', A\('تعديل متقدم للتشغيل', 'Advanced run setup'\)\], \['set-team', A\('وضع الفريق', 'Team mode'\)\], \['set-project', A\('المشروع', 'Project'\)\]/);
  assert.match(settings, /agentsSection\(\)/);
});

function wizard(git, readOnly = false) {
  const context = vm.createContext({ ...base(), readOnly, wiz: { ready: { id: 'new1', git } } });
  vm.runInContext(`${cut('  function wizTeamStep(id) {', '  function readStep(form) {')}\nthis.step = wizTeamStep;`, context);
  return context.step('new1');
}

test('AC-006: the New Project success step offers team mode as optional, with the confirmed flow', () => {
  const g = { branch: 'main', sharedMode: false, integrationBranch: 'main', lane: false, canEnableShared: true };
  const html = wizard(g);
  assert.match(html, /data-wiz-team="off"/);
  assert.match(html, /Optional/);
  assert.match(html, /<button type="button" class="btn sm" data-shared-open data-shared-pid="new1">Turn on team mode…<\/button>/);
  assert.match(wizard({ ...g, canEnableShared: false }), /yallaflow shared enable/, 'agents off: the CLI hint, as on the team card');
  assert.match(wizard({ ...g, sharedMode: true }), /Team mode is on/);
  assert.equal(wizard({ ...g, branch: null }), '', 'no Git: no team step');
  assert.equal(wizard(null), '');
  assert.match(app, /\$\{wizTeamStep\(reg\.id\)\}/);
  assert.match(app, /openSharedSheet\(pa\.dataset\.sharedPid \|\| pid\)/, 'the same dialog, for the new project');
  assert.equal(app.match(/execution\/shared-enable/g).length, 1, 'still one call site for the enable endpoint');
});

test('AC-007: every new label has Arabic and English; light and dark use the shared tokens', () => {
  for (const [ar, en] of [['محتاجك', 'Needs you'], ['مفيش وكيل شغّال.', 'No agent running.'], ['اعرض السجل', 'View log'], ['شغّلها تاني', 'Start again'], ['اتجهّز إزاي', 'How this was set up'], ['فردي', 'Solo'], ['فريق', 'Team'], ['شغل الفريق', 'Team mode']]) {
    assert.ok(app.includes(`A('${ar}', '${en}')`), en);
  }
  const block = css.slice(css.indexOf('PF-0132: information architecture'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, 'no hard-coded colours: light and dark come from the tokens');
});
