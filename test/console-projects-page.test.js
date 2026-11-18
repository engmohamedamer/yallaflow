// PF-0169: the Projects page — compact, actionable project cards. Each card's state, current
// work, next action, agents and memory line come only from recorded data; search, filters and
// a per-visit frozen order find a project. Evaluated from the shipped app.js / app.css with
// minimal stand-ins, like the other console UI tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../resources/console/app.css', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page({ lang = 'en', pid = 'p1', projects = [], execView = { inbox: [], limits: [], lanes: [] }, readOnly = false, readiness = null, agentsOn = true } = {}) {
  const context = vm.createContext({
    lang, pid, projects, execView, readOnly, readiness, agentsOn, execError: null,
    A: (ar, en) => (lang === 'ar' ? ar : en), esc, L: (v) => (v == null ? '' : typeof v === 'string' ? v : v[lang] ?? v.en),
    fwd: () => (lang === 'ar' ? '←' : '→'), mins: (m) => `${m} min`, ago: () => '5m ago',
    STATE: { you: { ar: 'مستنيك', en: 'waiting for you' }, fail: { ar: 'فيه مشكلة', en: 'failing' } },
    stName: (i) => ['Understand', 'Decide', 'Change', 'Verify', 'Remember'][i] ?? 'New',
    curIndex: (it) => ({ understand: 0, decide: 1, change: 2, verify: 3, remember: 4 })[it.currentStation] ?? -1,
    projectMode: (id) => (projects.find((p) => p.id === id)?.mode === 'monitor' ? 'monitor' : 'manage'),
    careCount: (m) => (m?.available ? (m.mayBeStale ?? 0) + (m.staleEvidence ?? 0) + (m.disputed ?? 0) + (m.unresolved ?? 0) : 0),
    xPermCard: (p) => `<div class="xperm" data-x-perm="${p.requestId}"></div>`
  });
  vm.runInContext(`${cut('  const UNDERSTANDING_TEXT = {', '  const ASK_AR = {')}
${cut('  // PF-0082 / PF-0169', '  // PF-0162: the first screen')}
${cut('  function limitNotices() {', '  // Worktrees: this project')}
this.fx = { laneStatus, projectGroup, projectFacts, projectState, nextAction, projectCard, projectMenu, projectsToolbar, projectMatches, orderProjects, sortProjects, cardAgents, inboxSection, cardHealth, lanesOf, set: (o) => { if ('pflt' in o) pflt = o.pflt; if ('projOrder' in o) projOrder = o.projOrder; }, get: () => ({ pflt, projOrder }) };`, context);
  return context;
}

const item = (over) => ({ id: 'PF-0001', title: 'Work', state: 'paused', currentStation: 'change', lastActivityAt: '2026-11-10T10:00:00Z', waitingFor: null, ...over });
const snap = (items, over = {}) => ({ project: { activeWork: null, ...over.project }, items, invalid: over.invalid ?? [], counts: {} });
const health = (over = {}) => ({ memory: { available: true, current: 10, mayBeStale: 0, staleEvidence: 0, disputed: 0, unresolved: 0 }, understanding: 'PROJECT_UNDERSTANDING_ESTABLISHED', baselineId: null, kind: 'brownfield', origin: null, ...over });
const task = (workId, state) => ({ id: 't-000001', workId, provider: 'codex', state });
const run = (tasks, state = 'running') => ({ id: 'r-000001', state, lanes: [{ id: 'main', tasks }] });
const lane = (over) => ({ project: 'p1', name: 'Shop', kind: 'home', parent: null, session: null, pending: [], runs: [], lastStep: null, workingSince: null, ...over });

test('AC-001: open counts every open state, on-hold and closed are not open, and nothing is a percentage', () => {
  const { fx } = page();
  const f = fx.projectFacts({ project: { id: 'p1' }, snap: snap([item({ id: 'A', state: 'new' }), item({ id: 'B', state: 'you' }), item({ id: 'C', state: 'fail' }), item({ id: 'D', state: 'active' }), item({ id: 'E', state: 'done' }), item({ id: 'F', state: 'held' }), item({ id: 'G', state: 'closed' })]), health: health() });
  assert.equal(f.open, 4);
  assert.equal(f.done, 1);
  assert.equal(f.held, 1);
  const card = fx.projectCard({ project: { id: 'p1', name: 'Shop', root: '/home/u/code/shop' }, health: health(), f });
  assert.match(card, /4 open · 1 done · 1 on hold/);
  assert.doesNotMatch(card, /%|class="pflow"|class="ring/, 'no percentage ring and no station bars on the card');
  const view = cut('  function viewProjects() {', '  // ---------- team');
  assert.doesNotMatch(view, /ring\(|pflow|openCompletion/);
});

test('AC-002: one execution state per card, never "running" without a working agent session', () => {
  const { fx } = page();
  const state = (f) => fx.projectState({ error: null, open: 0, done: 0, pending: 0, you: 0, fail: 0, working: 0, ...f }).key;
  assert.equal(fx.projectState({ error: 'boom' }).key, 'error');
  assert.equal(state({ pending: 1, open: 2 }), 'you');
  assert.equal(state({ you: 1 }), 'you');
  assert.equal(state({ fail: 1, working: 1 }), 'fail');
  assert.equal(state({ working: 1, open: 1 }), 'running');
  assert.equal(state({ open: 3 }), 'open', 'open work without a working session is not "running"');
  assert.equal(state({ done: 4 }), 'done');
  assert.equal(state({}), 'empty');
  // a queued (not working) lane is live, but not running
  const f = fx.projectFacts({ project: { id: 'p1' }, snap: snap([item({})]), health: health() }, [lane({ runs: [run([task('PF-0001', 'queued')])] })]);
  assert.equal(f.live, 1);
  assert.equal(f.working, 0);
  assert.equal(fx.projectState(f).key, 'open');
});

test('AC-002/AC-006: readiness and memory are separate from execution state and link to the Overview', () => {
  const { fx } = page();
  const stale = fx.cardHealth({ id: 'p1' }, health({ memory: { available: true, current: 116, mayBeStale: 101, staleEvidence: 0, disputed: 0, unresolved: 1 } }));
  assert.match(stale, /116 facts/);
  assert.match(stale, /data-open-project="p1" data-open-view="overview"[^>]*>101 to recheck · 1 unresolved →/);
  assert.match(stale, /title="“To recheck”: the files behind them changed/);
  assert.match(fx.cardHealth({ id: 'p1' }, health()), /nothing needs care/);
  const gate = fx.cardHealth({ id: 'p2' }, health({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED', memory: { available: true, current: 0 } }));
  assert.match(gate, /data-understanding-chip="PROJECT_UNDERSTANDING_REQUIRED"[^>]*><i><\/i>Project understanding needed/);
  const wizard = fx.cardHealth({ id: 'p3' }, health({ understanding: 'GREENFIELD_UNDERSTANDING_FROM_INTENT', memory: { available: true, current: 0 }, origin: { createdBy: 'yallaflow new', stack: ['Node.js', 'React'], environment: 'docker' } }));
  assert.match(wizard, /empty so far/);
  assert.match(wizard, /Chosen at creation: <bdi>Node\.js · React · Docker<\/bdi>/);
  assert.doesNotMatch(wizard, /data-understanding-chip/, 'a Greenfield project is never shown as needing understanding');
});

test('AC-003: the card leads with the item waiting for you, then failing, then active, then the most recent', () => {
  const { fx } = page();
  const lead = (items, activeWork = null) => fx.projectFacts({ project: { id: 'p1' }, snap: snap(items, { project: { activeWork } }), health: health() }).current?.id;
  const a = item({ id: 'A', lastActivityAt: '2026-11-01T00:00:00Z' });
  const b = item({ id: 'B', lastActivityAt: '2026-11-09T00:00:00Z' });
  assert.equal(lead([a, b]), 'B', 'most recently active open item');
  assert.equal(lead([a, b], 'A'), 'A', "the project's active work");
  assert.equal(lead([a, b, item({ id: 'C', state: 'fail' })], 'A'), 'C');
  assert.equal(lead([a, item({ id: 'C', state: 'fail' }), item({ id: 'D', state: 'you' })], 'A'), 'D');
  assert.equal(lead([item({ id: 'E', state: 'done' })]), undefined);
  const card = page().fx.projectCard({ project: { id: 'p1', name: 'Shop', root: '/r' }, health: health(), f: page().fx.projectFacts({ project: { id: 'p1' }, snap: snap([item({ id: 'PF-0009', title: 'Fix <totals>', state: 'you', currentStation: 'decide' })]), health: health() }) });
  assert.match(card, /<a href="#" class="pcard-work" data-x-open="p1" data-x-work="PF-0009"><span class="pcard-wid ltr">PF-0009<\/span><span class="pcard-wtitle" dir="auto">Fix &lt;totals&gt;<\/span><span class="tiny muted pcard-wst">waiting for you · Decide<\/span><\/a>/);
});

test('AC-004: the next action follows recorded state, and a monitored project only gets viewing actions', () => {
  const { fx } = page();
  const base = { error: null, open: 0, done: 0, pending: 0, you: 0, fail: 0, working: 0, current: null, understanding: 'PROJECT_UNDERSTANDING_ESTABLISHED', baselineId: null };
  const next = (f, ctx) => { const a = fx.nextAction('p1', { ...base, ...f }, ctx); return a && `${a.kind}:${a.work ?? a.view ?? ''}:${a.label}${a.attn ? '!' : ''}`; };
  assert.equal(next({ error: 'x' }), null);
  assert.equal(next({ pending: 1 }), 'inbox::Review the agent request!');
  assert.equal(next({ current: item({ id: 'PF-1', state: 'you', waitingFor: { kind: 'review' } }) }), 'item:PF-1:Review the decision!');
  assert.equal(next({ current: item({ id: 'PF-1', state: 'you', waitingFor: { kind: 'question' } }) }), 'item:PF-1:Answer the question!');
  assert.equal(next({ understanding: 'PROJECT_UNDERSTANDING_AWAITING_REVIEW', baselineId: 'PF-0002' }), 'item:PF-0002:Review project understanding!');
  assert.equal(next({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED' }), 'view:map:Start project understanding');
  assert.equal(next({ understanding: 'PROJECT_UNDERSTANDING_IN_PROGRESS', baselineId: 'PF-0002' }), 'item:PF-0002:Continue project understanding');
  assert.equal(next({}, { readiness: { steps: [{ id: 'agent', status: 'choose' }] } }), 'view:settings/agents:Continue setup');
  assert.equal(next({ current: item({ id: 'PF-3', state: 'fail' }), fail: 1 }), 'item:PF-3:Open the failing work!');
  assert.equal(next({ working: 1, current: item({ id: 'PF-4', state: 'active' }) }), 'view:team:View running work');
  assert.equal(next({ current: item({ id: 'PF-5' }) }), 'item:PF-5:Continue PF-5');
  assert.equal(next({ done: 3 }), null, 'an idle project offers only Open project — no duplicate action');
  // monitor-only and read-only: nothing that writes
  assert.equal(next({ pending: 1, current: item({ id: 'PF-6', state: 'you' }) }, { monitor: true }), 'item:PF-6:Open PF-6');
  assert.equal(next({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED' }, { monitor: true }), null);
  assert.equal(next({}, { readOnly: true, readiness: { steps: [{ id: 'agent', status: 'choose' }] } }), null);
  // the button reuses existing destinations
  const card = fx.projectCard({ project: { id: 'p1', name: 'Shop', root: '/r' }, health: health({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED' }), f: fx.projectFacts({ project: { id: 'p1' }, snap: snap([]), health: health({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED' }) }) });
  assert.match(card, /<button type="button" class="btn sm pcard-next " data-open-project="p1" data-open-view="map">Start project understanding<\/button>/);
});

test('AC-005: no agents panel without a live lane; a live lane is one compact row; Needs you collapses when empty', () => {
  const { fx } = page({ execView: { inbox: [], limits: [], lanes: [lane({ session: { provider: 'codex', status: 'working', workId: 'PF-0007' }, lastStep: { title: 'Edited a file' } }), lane({ project: 'p2' })] } });
  const live = fx.cardAgents({ id: 'p1' });
  assert.match(live, /class="pagents"/);
  assert.match(live, /data-x-open="p1" data-x-work="PF-0007"/);
  assert.match(live, /working/);
  assert.doesNotMatch(live, /No agent running/);
  assert.equal(fx.cardAgents({ id: 'p2' }), '', 'an idle home lane is not live');
  assert.equal(page({ execView: null }).fx.cardAgents({ id: 'p1' }), '', 'no panel while loading');
  const empty = fx.inboxSection();
  assert.match(empty, /^<p class="inbox-ok tiny" id="inbox" role="status"><span class="chip done"><i><\/i>Nothing needs you<\/span>/);
  assert.doesNotMatch(empty, /<section class="inbox/);
  const full = page({ execView: { inbox: [{ project: 'p2', requestId: 'r1' }], limits: [], lanes: [] } }).fx.inboxSection();
  assert.match(full, /<section class="inbox has" id="inbox"/);
  assert.match(full, /<span class="pbadge you">1<\/span>/);
  assert.match(full, /data-x-perm="r1"/);
});

test('AC-007: the card opens on its surface, its controls act alone, and the menu keeps Remove behind its dialog', () => {
  const { fx } = page();
  const project = { id: 'p1', name: 'Shop', root: '/home/u/code/shop' };
  const card = fx.projectCard({ project, health: health(), f: fx.projectFacts({ project, snap: snap([]), health: health() }) });
  assert.match(card, /<article class="pcard panel here" data-card-open="p1"/);
  assert.match(card, /<span class="tag pcard-here">Current<\/span>/);
  assert.match(card, /<button type="button" class="btn sm go" data-open-project="p1">Open project<\/button>/);
  const menu = fx.projectMenu(project);
  assert.match(menu, /<details class="pcard-menu" data-popmenu><summary class="pcard-more" aria-haspopup="menu" aria-label="More actions for Shop"/);
  assert.match(menu, /role="menu"/);
  assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 3);
  assert.match(menu, /data-remove-project="p1"/);
  assert.doesNotMatch(page({ readOnly: true }).fx.projectMenu(project), /data-remove-project|data-open-folder/);
  // the card click ignores its links, buttons, menu and text selection; Remove still asks first
  const handler = cut('  // PF-0169: the Projects page — filters, order', '  document.addEventListener(\'change\', (e) => { if (e.target.matches?.(\'[data-psort]\'))');
  assert.match(handler, /e\.target\.closest\('a,button,summary,details,input,select,label,\[role=menu\]'\)\) return;/);
  assert.match(handler, /getSelection/);
  assert.match(handler, /switchProject\(card\.dataset\.cardOpen\)/);
  assert.match(handler, /closest\?\.\('\[data-popmenu\] \[role=menuitem\]'\)/, 'a menu item closes its menu');
  assert.match(app, /if \(rmp\) \{ const p = projects\.find\(\(x\) => x\.id === rmp\.dataset\.removeProject\); if \(p\) askRemoveProject\(\{ id: p\.id, name: p\.name \}\); return; \}/);
  assert.match(app, /if \(e\.key === 'Escape'\) \{ menu\.open = false; menu\.querySelector\('summary'\)\?\.focus\(\); return; \}/);
});

test('AC-008: search by name or path, status filters with counts, and an order frozen per visit', () => {
  const projects = [{ id: 'a', name: 'Alpha', root: '/w/alpha' }, { id: 'b', name: 'Beta', root: '/home/u/YaSchools/beta' }, { id: 'c', name: 'Gamma', root: '/w/gamma' }];
  const ctx = page({ projects, pid: 'a' });
  const { fx } = ctx;
  const entry = (project, items, h = health()) => ({ project, snap: snap(items), health: h, f: fx.projectFacts({ project, snap: snap(items), health: h }) });
  const entries = [
    entry(projects[0], [item({ state: 'done', lastActivityAt: '2026-11-01T00:00:00Z' })]),
    entry(projects[1], [item({ state: 'you', lastActivityAt: '2026-11-05T00:00:00Z' })]),
    entry(projects[2], [item({ state: 'paused', lastActivityAt: '2026-11-09T00:00:00Z' })], health({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED' }))
  ];
  const by = (q, st = 'all') => entries.filter((e) => fx.projectMatches(e, { q, st })).map((e) => e.project.id).join(',');
  assert.equal(by('yasch'), 'b', 'path matches, case-insensitively');
  assert.equal(by('GAM'), 'c');
  assert.equal(by('', 'attention'), 'b');
  assert.equal(by('', 'setup'), 'c', 'needs setup wins over open work');
  assert.equal(by('', 'open'), '');
  assert.equal(by('', 'idle'), 'a');
  const bar = fx.projectsToolbar(entries);
  assert.match(bar, /<input type="search" data-pq value="" placeholder="Search by name or path…" aria-label="Search projects">/);
  assert.match(bar, /data-pf="all" aria-pressed="true">All <span class="pfn">3<\/span>/);
  assert.match(bar, /data-pf="attention" aria-pressed="false">Needs you <span class="pfn">1<\/span>/);
  assert.match(bar, /<option value="attention" >Needs attention first<\/option>/);
  // default order: latest recorded activity; attention-first on request
  assert.equal(fx.orderProjects(entries).map((e) => e.project.id).join(','), 'c,b,a');
  // a live update that makes Alpha the most recent does not reshuffle the visit's order
  const later = [{ ...entries[0], f: { ...entries[0].f, lastAt: '2026-11-17T00:00:00Z' } }, entries[1], entries[2]];
  assert.equal(fx.orderProjects(later).map((e) => e.project.id).join(','), 'c,b,a');
  // a project added during the visit goes last
  const added = entry({ id: 'd', name: 'Delta', root: '/w/d' }, [item({ lastActivityAt: '2026-11-20T00:00:00Z' })]);
  assert.equal(fx.orderProjects([...later, added]).map((e) => e.project.id).join(','), 'c,b,a,d');
  // the first draw, before any project is known, never freezes an empty order
  fx.set({ projOrder: null }); fx.orderProjects([]);
  assert.equal(fx.orderProjects(entries).map((e) => e.project.id).join(','), 'c,b,a');
  fx.set({ pflt: { q: '', st: 'all', sort: 'attention' } });
  assert.equal(fx.orderProjects(entries).map((e) => e.project.id).join(','), 'b,c,a');
  // the order resets when the page is left, and search keeps focus across redraws
  assert.match(app, /if \(r\.v !== 'projects'\) projOrder = null;/);
  assert.match(app, /document\.activeElement\?\.matches\?\.\('\[data-pq\]'\) \? '\[data-pq\]'/);
  assert.match(app, /else if \(e\.target\.matches\('\[data-pq\]'\)\) \{ pflt\.q = e\.target\.value; render\(\); \}/);
  assert.match(app, /if \(e\.target\.matches\?\.\('\[data-psort\]'\)\) \{ pflt\.sort = e\.target\.value; projOrder = null; render\(\); \}/);
});

test('AC-009: Arabic and English copy, LTR paths and IDs, and a 3/2/1 column grid', () => {
  const project = { id: 'p1', name: 'متجر', root: '/home/u/code/shop' };
  for (const lang of ['ar', 'en']) {
    const { fx } = page({ lang });
    const f = fx.projectFacts({ project, snap: snap([item({ id: 'PF-0042', state: 'paused' })]), health: health() });
    const card = fx.projectCard({ project, health: health(), f });
    assert.match(card, /<span class="ltr tiny muted pcard-path" title="\/home\/u\/code\/shop">…\/code\/shop<\/span>/);
    assert.match(card, /<span class="pcard-wid ltr">PF-0042<\/span>/);
    assert.match(card, /<h2 dir="auto">متجر<\/h2>/);
    assert.match(card, lang === 'ar' ? /افتح المشروع[\s\S]*كمّل PF-0042/ : /Open project[\s\S]*Continue PF-0042/);
    assert.match(card, lang === 'ar' ? /فيه شغل مفتوح/ : />Open work</);
  }
  assert.match(css, /\.projects \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 1100px\) \{ \.projects \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
  assert.match(css, /\.agents, \.projects \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\[dir=rtl\] \.pcard-path \{ text-align: right; \}/);
  assert.match(css, /@media \(max-width: 760px\) \{\n  \.ptools input\[type=search\] \{ flex: 1 1 100%; \}/);
});

test('AC-010: cards take their content height, and no open work means one message, not three', () => {
  const { fx } = page();
  const project = { id: 'p1', name: 'Shop', root: '/r' };
  const done = fx.projectCard({ project, health: health(), f: fx.projectFacts({ project, snap: snap([item({ state: 'done' }), item({ id: 'PF-0002', state: 'done' })]), health: health() }) });
  assert.match(done, /data-state-chip><i><\/i>All tasks completed<\/span>/);
  assert.match(done, /<span class="tiny muted pcard-counts">2 done<\/span>/, 'no "0 open" beside it');
  assert.doesNotMatch(done, /pcard-work|No open work|0 open/);
  const empty = fx.projectCard({ project, health: health(), f: fx.projectFacts({ project, snap: snap([]), health: health() }) });
  assert.match(empty, />No work yet<\/span>/);
  assert.match(empty, /<span class="tiny muted pcard-counts"><\/span>/);
  assert.doesNotMatch(empty, /pcard-work|No work recorded yet/);
  const ar = page({ lang: 'ar' }).fx;
  assert.match(ar.projectCard({ project, health: health(), f: ar.projectFacts({ project, snap: snap([item({ state: 'done' })]), health: health() }) }), />كل المهام خلصت<\/span>/);
  assert.match(css, /\.projects \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 16px; align-items: start; \}/);
  assert.doesNotMatch(css, /\.pcard-work\.none|min-height: 58px/);
});

test('AC-011: the highlighted item and the last activity fall back to update and creation time', () => {
  const { fx } = page();
  const facts = (items, activeWork = null) => fx.projectFacts({ project: { id: 'p1' }, snap: snap(items, { project: { activeWork } }), health: health() });
  // the portal case: a new item with no activity yet, created after the other item's last activity
  const older = item({ id: 'PF-0008', lastActivityAt: '2026-11-09T19:00:00Z' });
  const newer = item({ id: 'PF-0009', state: 'new', lastActivityAt: undefined, updatedAt: undefined, createdAt: '2026-11-09T19:30:00Z' });
  assert.equal(facts([older, newer]).current.id, 'PF-0009');
  assert.equal(facts([older, { ...newer, createdAt: '2026-11-09T18:00:00Z' }]).current.id, 'PF-0008');
  assert.equal(facts([newer]).lastAt, '2026-11-09T19:30:00Z', 'creating work is recorded activity');
  // the YallaFlow case: the active item leads over a paused older one, and both count as open
  const f = facts([item({ id: 'PF-0112', state: 'paused', lastActivityAt: '2026-11-10T00:00:00Z' }), item({ id: 'PF-0169', state: 'active', lastActivityAt: '2026-11-17T00:00:00Z' }), item({ id: 'PF-0140', state: 'done' })], 'PF-0169');
  assert.equal(f.current.id, 'PF-0169');
  assert.equal(f.open, 2);
  assert.equal(f.done, 1);
});

test('AC-012: agent rows show what is live — never a task of DONE work — and say running, paused or queued', () => {
  const { fx } = page();
  const closed = new Set(['PF-0140']);
  const st = (l) => fx.laneStatus(lane(l), closed)?.key ?? null;
  // the stale run left after a restart: its task is interrupted, but PF-0140 is DONE — history
  assert.equal(st({ runs: [run([task('PF-0140', 'interrupted')], 'paused')] }), null);
  assert.equal(st({ runs: [run([task('PF-0140', 'working')])] }), null);
  assert.equal(st({ runs: [run([task('PF-0200', 'done')], 'finished')] }), null, 'a finished run is history');
  assert.equal(st({ runs: [run([task('PF-0200', 'failed'), task('PF-0201', 'cancelled')], 'paused')] }), null);
  assert.equal(st({ runs: [run([task('PF-0200', 'interrupted')], 'paused')] }), 'paused');
  assert.equal(fx.laneStatus(lane({ runs: [run([task('PF-0200', 'interrupted')], 'paused')] }), closed).label, 'paused — can resume');
  assert.equal(st({ runs: [run([task('PF-0200', 'queued')])] }), 'queued');
  assert.equal(st({ session: { provider: 'codex', status: 'working', workId: 'PF-0201' } }), 'working');
  assert.equal(st({ session: { provider: 'codex', status: 'starting', workId: 'PF-0201' } }), 'starting');
  assert.equal(st({ session: { provider: 'claude', status: 'connected', workId: null } }), 'session');
  assert.equal(st({ session: { provider: 'codex', status: 'idle', workId: 'PF-0201' }, pending: [{ requestId: 'r' }] }), 'approval');
  assert.equal(st({ kind: 'lane', name: 'yf/PF-0201' }), 'lane');
  assert.equal(st({}), null);
  // the card: the stale PF-0140 row is gone, a resumable task stays with its work item linked
  const ctx = page({ execView: { inbox: [], limits: [], lanes: [lane({ runs: [run([task('PF-0140', 'interrupted')], 'paused')] }), lane({ project: 'p1', kind: 'lane', name: 'yf/PF-0201', runs: [run([task('PF-0201', 'interrupted')], 'paused')] })] } });
  const html = ctx.fx.cardAgents({ id: 'p1' }, closed);
  assert.doesNotMatch(html, /PF-0140/);
  assert.match(html, /data-lane-state="paused"[\s\S]*data-x-open="p1" data-x-work="PF-0201"[\s\S]*paused — can resume/);
  const onlyHistory = page({ execView: { inbox: [], limits: [], lanes: [lane({ runs: [run([task('PF-0140', 'interrupted')], 'paused')] })] } });
  assert.equal(onlyHistory.fx.cardAgents({ id: 'p1' }, closed), '');
  const f = onlyHistory.fx.projectFacts({ project: { id: 'p1' }, snap: snap([item({ id: 'PF-0140', state: 'done' })]), health: health() }, onlyHistory.fx.lanesOf('p1'));
  assert.equal(f.live, 0);
  assert.equal(onlyHistory.fx.projectState(f).key, 'done');
});

test('AC-013: the status filters never overlap, add up to All, and never say an agent runs when only work is open', () => {
  const projects = [{ id: 'a', name: 'A', root: '/a' }, { id: 'b', name: 'B', root: '/b' }, { id: 'c', name: 'C', root: '/c' }, { id: 'd', name: 'D', root: '/d' }, { id: 'e', name: 'E', root: '/e' }];
  const { fx } = page({ projects, pid: 'a' });
  const entry = (project, items, h = health()) => ({ project, health: h, f: fx.projectFacts({ project, snap: snap(items), health: h }) });
  const entries = [
    entry(projects[0], [item({ state: 'you' })], health({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED' })),
    entry(projects[1], [], health({ understanding: 'PROJECT_UNDERSTANDING_REQUIRED' })),
    entry(projects[2], [item({ state: 'paused' })]),
    entry(projects[3], [item({ state: 'done' })]),
    entry(projects[4], [])
  ];
  assert.deepEqual(entries.map((e) => fx.projectGroup(e)), ['attention', 'setup', 'open', 'idle', 'idle']);
  const bar = fx.projectsToolbar(entries);
  const counts = [...bar.matchAll(/data-pf="(\w+)" aria-pressed="\w+">([^<]+) <span class="pfn">(\d+)<\/span>/g)].map((m) => [m[1], m[2], Number(m[3])]);
  assert.deepEqual(counts.map((c) => c[1]), ['All', 'Needs you', 'Needs setup', 'Open work', 'No open work']);
  assert.equal(counts.slice(1).reduce((n, c) => n + c[2], 0), counts[0][2], 'the groups add up to All');
  assert.doesNotMatch(bar, /In progress|Idle|شغّال|هادي/);
  const ar = page({ lang: 'ar', projects, pid: 'a' }).fx.projectsToolbar(entries);
  for (const label of ['الكل', 'محتاجك', 'محتاج إعداد', 'فيه شغل مفتوح', 'مفيش شغل مفتوح']) assert.ok(ar.includes(`>${label} <span class="pfn">`), label);
  assert.equal(fx.projectState(entries[2].f).label, 'Open work');
  assert.notEqual(fx.projectState(entries[2].f).key, 'running');
});

test('AC-014: Continue and the work link open that project on that item; another project is switched to first', () => {
  const handler = cut("    const xa = e.target.closest('[data-x-perm],[data-x-act],[data-x-open]');", '      xa.disabled = true;');
  assert.match(handler, /if \(xa\.dataset\.xOpen\) \{ const target = `item\/\$\{encodeURIComponent\(xa\.dataset\.xWork\)\}`; if \(xpid === pid\) location\.hash = `#\/\$\{target\}`; else switchProject\(xpid, target\); return; \}/);
  const { fx } = page({ pid: 'other' });
  const project = { id: 'p2', name: 'Portal', root: '/r' };
  const card = fx.projectCard({ project, health: health(), f: fx.projectFacts({ project, snap: snap([item({ id: 'PF-0008' })]), health: health() }) });
  assert.match(card, /<a href="#" class="pcard-work" data-x-open="p2" data-x-work="PF-0008">/);
  assert.match(card, /<button type="button" class="btn sm pcard-next " data-x-open="p2" data-x-work="PF-0008">Continue PF-0008<\/button>/);
  assert.doesNotMatch(card, /class="tag pcard-here"/, 'not the current project');
});

// PF-0170: opening a project draws its page as soon as the snapshot is loaded; the slower
// reads (readiness, project overview, agents) fill in afterwards. A visible loader shows
// only while nothing can be drawn.
test('PF-0170: a project page draws before the slow reads, with a visible loader until then', () => {
  const sw = cut('  async function switchProject(next, view = \'map\') {', '  // PF-0159: read the saved preferences.');
  assert.match(sw, /await load\(\);\n    await buildDigest\(\);\n    render\(\);[^\n]*\n    await loadForView\(\);\n    render\(\);/);
  const boot = app.slice(app.lastIndexOf('  (async () => {'));
  assert.match(boot, /await load\(\);\n    await buildDigest\(\);\n    render\(\);[^\n]*\n    await loadForView\(\);/);
  assert.match(app, /const body = !snap \? \(error \? '' : pageLoader\(\)\) :/);
  assert.match(app, /if \(!overview\) return pageLoader\(A\('بيحمّل المشاريع…', 'Loading projects…'\)\);/);
  assert.match(app, /if \(!team\) return pageLoader\(\);/);
  assert.match(app, /const pageLoader = \(text = A\('بيحمّل…', 'Loading…'\)\) => `<div class="pageload" role="status" aria-live="polite"><span class="pageload-spin" aria-hidden="true"><\/span><span>\$\{text\}<\/span><\/div>`;/);
  assert.match(css, /\.pageload-spin \{[^}]*animation: pageload-spin/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.pageload-spin \{ animation: none;/);
});
