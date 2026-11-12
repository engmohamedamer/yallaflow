// PF-0136: the guided run path on the Run tab — the agent (or a quick scan) proposes, the
// developer picks, approves every exact command once, and the app starts. Trust stays bound
// to the reviewed definition hash; shared or blocked services keep their own review.
// Evaluated from the shipped app.js with minimal stand-ins, like the other console UI tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flow = cut('  // ---------- PF-0136: one guided path on the Run tab', '  function viewRun() {');

const svc = (id, extra = {}) => ({ id, name: id.toUpperCase(), definitionHash: `sha256:${id}`, trust: { trusted: false, reason: 'new' }, ...extra });
const review = (id, extra = {}) => ({ definitionHash: `sha256:${id}`, effective: { command: ['docker', 'compose', 'up', id], folder: `/home/dev/shop/${id}`, cwd: '.', profile: '.yallaflow/runtime.yaml', env: ['APP_KEY'], ports: [8080] }, covered: ['docker-compose.yml'], notCovered: [], blocking: [], shared: null, ...extra });

function world({ services = [], plan = null, reviews = {}, agentsOn = true, trustFails = [] } = {}) {
  const calls = { api: [], post: [], started: 0, saved: 0 };
  const context = vm.createContext({
    A: (_ar, en) => en, esc, L: (v) => (typeof v === 'string' ? v : v.en), fwd: () => '→', when: (iso) => String(iso), encodeURIComponent, JSON, Object, Set, Promise, Boolean, Error,
    pid: 'p1', readOnly: false, agentsOn, setupBusy: null, setupMsg: null, planAwaitAgent: null,
    route: () => ({ v: 'run' }), render: () => {},
    runtime: { pid: 'p1', data: { services } }, runtimePlan: plan ? { pid: 'p1', data: plan } : null,
    planPick: new Set(), currentPlanView: () => (plan?.agent ? 'agent' : 'scan'),
    confChip: (c) => `<chip>${c}</chip>`, suggestionNote: (x) => x,
    api: async (url) => { calls.api.push(url); const id = /runtime\/([^/]+)\/review$/.exec(url)[1]; if (!reviews[id]) throw new Error('no review'); return { review: reviews[id] }; },
    post: async (url, body) => { calls.post.push({ url, body: JSON.parse(body) }); const id = /runtime\/([^/]+)\/trust$/.exec(url)?.[1]; if (trustFails.includes(id)) throw new Error('changed since the review'); return {}; },
    setupDo: async (kind, fn) => { context.setupBusy = kind; context.setupMsg = null; try { await fn(); } catch (e) { context.setupMsg = { tone: 'fail', html: e.message }; } context.setupBusy = null; },
    runProject: async (action) => { assert.equal(action, 'start'); calls.started += 1; },
    savePlan: async () => { calls.saved += 1; context.setupMsg = { tone: 'done', html: 'saved' }; }
  });
  context.autoPickPlan = () => { context.planPick.clear(); for (const sv of (plan?.agent ?? plan?.scan)?.services ?? []) if (!(sv.blocking ?? []).length) context.planPick.add(sv.id); };
  vm.runInContext(`${flow}\nthis.fx = { loadBulkReviews, bulkable, runFind, runApprove, approveAll, useProposal, bulkReview };`, context);
  return { context, calls, fx: context.fx };
}

test('nothing saved, no proposal: one primary action asks the agent; a quick scan is the fallback', () => {
  const withAgent = world().fx.runFind({ services: [] });
  assert.match(withAgent, /data-run-find="start"/);
  assert.match(withAgent, /<button class="btn go" data-rt-ask-agent /, 'the agent is the primary action');
  assert.match(withAgent, /<button class="btn sm ghost" data-rt-analyze /, 'the quick scan is secondary');
  assert.equal((withAgent.match(/class="btn go/g) ?? []).length, 1, 'exactly one primary button');

  const noAgent = world({ agentsOn: false }).fx.runFind({ services: [] });
  assert.match(noAgent, /<button class="btn go" data-rt-analyze /, 'without an agent the quick scan is primary');
  assert.doesNotMatch(noAgent, /data-rt-ask-agent/);
  assert.match(noAgent, /href="#\/settings\/agents"/);
});

test('a proposal shows each service with its command, preselected, and one button to use them', async () => {
  const plan = { agent: { proposedAt: '2026-11-12T10:00:00Z', summary: 'Laravel app behind Docker Compose.', services: [
    { id: 'app', name: 'Web app', kind: 'docker-compose', cwd: '.', command: ['docker', 'compose', 'up', 'app'], ports: [8080], confidence: 'confirmed' },
    { id: 'db', name: 'Database', kind: 'docker-compose', cwd: '.', command: ['docker', 'compose', 'up', 'db'], ports: [], confidence: 'inferred', blocking: ['compose file is outside the home folder'] }
  ] } };
  const w = world({ plan });
  const html = w.fx.runFind({ services: [] });
  assert.match(html, /data-run-find="proposal"/);
  assert.equal((html.match(/class="propcard"/g) ?? []).length, 2);
  assert.match(html, /docker compose up app/);
  assert.match(html, /Laravel app behind Docker Compose\./);
  assert.deepEqual([...w.context.planPick], ['app'], 'what can be used is preselected; a blocked service is not');
  assert.match(html, /data-plan-pick="db"  disabled/);
  assert.match(html, /data-plan-use [^>]*>Use the selected services \(1\)</);
  assert.match(html, /Nothing starts yet/);

  await w.fx.useProposal();
  assert.equal(w.calls.saved, 1);
  assert.equal(w.context.setupMsg, null, 'the approval card is the next step, not a "saved" message');
});

test('saved services are approved together from their reviewed commands; shared and blocked ones are left out', async () => {
  const services = [svc('app'), svc('queue'), svc('proxy'), svc('db'), svc('old', { trust: { trusted: true } })];
  const reviews = { app: review('app'), queue: review('queue'), proxy: review('proxy', { shared: { shared: true, reasons: ['serves other projects'] } }), db: review('db', { blocking: [{ reason: 'unresolved compose file' }] }) };
  const w = world({ services, reviews });
  await w.fx.loadBulkReviews();
  assert.equal(w.calls.api.length, 4, 'a review is read for every service that is not approved yet');
  await w.fx.loadBulkReviews();
  assert.equal(w.calls.api.length, 4, 'and not read again while its definition is unchanged');
  assert.deepEqual(w.fx.bulkable({ services }).map((sv) => sv.id), ['app', 'queue']);

  const html = w.fx.runApprove({ services });
  assert.match(html, /2 services wait for your approval/);
  assert.match(html, /data-approve-service="app" data-approve-hash="sha256:app"/);
  assert.match(html, /docker compose up queue/);
  assert.doesNotMatch(html, /data-approve-service="proxy"|data-approve-service="db"/);
  assert.match(html, /2 other service\(s\) need their own review/);
  assert.match(html, /data-run-approve="start"/);
  assert.match(html, /data-run-approve="only"/);

  await w.fx.approveAll(true);
  assert.deepEqual(w.calls.post.map((c) => c.url), ['/api/p/p1/runtime/app/trust', '/api/p/p1/runtime/queue/trust']);
  assert.deepEqual(w.calls.post[0].body, { confirmed: true, definitionHash: 'sha256:app' }, 'trust is bound to the hash of the review shown');
  assert.equal(w.calls.started, 1, 'then the project starts');
});

test('approval without starting, and a refused approval, start nothing', async () => {
  const services = [svc('app'), svc('queue')];
  const reviews = { app: review('app'), queue: review('queue') };
  const only = world({ services, reviews });
  await only.fx.loadBulkReviews();
  await only.fx.approveAll(false);
  assert.equal(only.calls.post.length, 2);
  assert.equal(only.calls.started, 0);

  const refused = world({ services, reviews, trustFails: ['queue'] });
  await refused.fx.loadBulkReviews();
  await refused.fx.approveAll(true);
  assert.equal(refused.calls.started, 0, 'a service Core refused to trust stops the start');
  assert.match(refused.context.setupMsg.html, /QUEUE: changed since the review/);
  assert.equal(refused.calls.api.filter((url) => url.endsWith('/queue/review')).length, 2, 'its review is read again before another approval');
});

test('nothing to approve shows no card; a read-only console never offers approval', async () => {
  const services = [svc('app', { trust: { trusted: true } })];
  const w = world({ services });
  await w.fx.loadBulkReviews();
  assert.equal(w.fx.runApprove({ services }), '');
  const ro = world({ services: [svc('app')], reviews: { app: review('app') } });
  await ro.fx.loadBulkReviews();
  ro.context.readOnly = true;
  assert.equal(ro.fx.runApprove({ services: [svc('app')] }), '');
});

test('the Run tab hosts the flow; Overview names the next run step; Settings keeps advanced editing', () => {
  assert.match(app, /if \(!readOnly\) return projectPage\('run', profileError\(r\) \+ runFind\(r\) \+ dev\);/);
  assert.match(app, /<div class="pmain">\$\{runApprove\(r\)\}\$\{runSection\(r, rows/);
  assert.match(app, /href="#\/run" data-run-next="\$\{esc\(st\.status\)\}"/);
  assert.doesNotMatch(app, /'Define the services'/);
  assert.match(app, /\['set-services', A\('تعديل متقدم للتشغيل', 'Advanced run setup'\)\], \['set-team'/);
  assert.match(app, /if \(e\.target\.closest\('\[data-plan-use\]'\)\) \{ useProposal\(\); return; \}/);
  assert.match(app, /approveAll\(apv\.dataset\.runApprove === 'start'\)/);
});
