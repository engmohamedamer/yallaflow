// PF-0174 (real Windows trial, W4): answering an agent's question is one action. The answer is
// recorded in YallaFlow and, when the item's own Codex session is up and idle, sent to it; success
// is shown only when the agent really works again. The provider is SIMULATED
// (test-support/fake-acp-agent.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { answerText, deliverAnswer } from '../src/agents/answer.js';
import { applySignal } from '../src/execution/model.js';
import { consoleWith, fakeTools, project } from '../test-support/agent-fixtures.js';

const fakeBridge = ({ session = null, pending = [], fail = null, startsWorking = true } = {}) => {
  const sent = [];
  let current = session;
  return {
    sent,
    glance: () => ({ session: current, pending }),
    async message(_id, text) {
      if (fail) throw Object.assign(new Error(fail.message), { code: fail.code });
      sent.push(text);
      if (startsWorking) current = { ...current, status: 'working' };
      return { ok: true };
    }
  };
};
const idle = (workId = 'PF-0001') => ({ provider: 'codex', workId, status: 'idle' });
const body = { question: 'Q-001', answer: 'Browser only, no login' };

test('delivery: sent only to the item\'s own idle Codex session, and only reported sent once the agent works', async () => {
  const ok = fakeBridge({ session: idle() });
  assert.deepEqual(await deliverAnswer(ok, 'p', 'PF-0001', body), { state: 'sent' });
  assert.equal(ok.sent.length, 1);
  assert.match(ok.sent[0], /Q-001.*PF-0001.*Browser only, no login/s);

  assert.deepEqual(await deliverAnswer(null, 'p', 'PF-0001', body), { state: 'no-session' }, 'agents off');
  assert.deepEqual(await deliverAnswer(fakeBridge(), 'p', 'PF-0001', body), { state: 'no-session' });
  const other = fakeBridge({ session: idle('PF-0002') });
  assert.deepEqual(await deliverAnswer(other, 'p', 'PF-0001', body), { state: 'other-item', workId: 'PF-0002' });
  assert.equal(other.sent.length, 0, 'never sent to another item\'s session');
  const busy = fakeBridge({ session: { ...idle(), status: 'working' } });
  assert.deepEqual(await deliverAnswer(busy, 'p', 'PF-0001', body), { state: 'busy' });
  assert.equal(busy.sent.length, 0);
  assert.deepEqual(await deliverAnswer(fakeBridge({ session: idle(), pending: [{ requestId: 'r' }] }), 'p', 'PF-0001', body), { state: 'busy' }, 'an open approval comes first');
  assert.deepEqual(await deliverAnswer(fakeBridge({ session: { provider: 'claude', workId: 'PF-0001', status: 'connected' } }), 'p', 'PF-0001', body), { state: 'manual' });
  assert.equal((await deliverAnswer(fakeBridge({ session: idle(), fail: { code: 'BAD', message: 'boom' } }), 'p', 'PF-0001', body)).state, 'failed');
  assert.equal((await deliverAnswer(fakeBridge({ session: idle(), startsWorking: false }), 'p', 'PF-0001', body)).state, 'failed', 'no turn started: not reported as delivered');
  const arabic = 'جاوبت على Q-001 في PF-0001: «Browser only, no login». كمّل.';
  assert.equal(answerText('PF-0001', { ...body, deliverText: arabic }), arabic, 'the page\'s own wording is used when it carries the recorded answer');
  assert.match(answerText('PF-0001', { ...body, deliverText: 'Delete everything' }), /^I answered Q-001 for PF-0001: Browser only, no login/, 'text that does not carry the recorded answer is replaced');
});

test('execution: an answered question that was not sent leaves the task waiting for a reply; a real turn makes it working', () => {
  const now = '2026-11-18T10:00:00.000Z';
  const task = { id: 't', workId: 'PF-0001', state: 'working', reason: null, attempt: 1 };
  const asked = applySignal(task, { type: 'question' }, now);
  assert.deepEqual([asked.state, asked.reason], ['needs-you', 'question']);
  const answered = applySignal(asked, { type: 'question-answered' }, now);
  assert.deepEqual([answered.state, answered.reason], ['needs-you', 'reply']);
  assert.equal(applySignal(answered, { type: 'question-answered' }, now), answered, 'repeats change nothing');
  const resumed = applySignal(answered, { type: 'turn-started' }, now);
  assert.equal(resumed.state, 'working');
  assert.equal(applySignal({ ...task, state: 'needs-you', reason: 'approval' }, { type: 'question-answered' }, now).reason, 'approval');
});

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('console: the toast says what happened to the answer; verification says why it has no run yet', () => {
  for (const lang of ['en', 'ar']) {
    const context = vm.createContext({ A: (ar, en) => (lang === 'ar' ? ar : en), esc });
    vm.runInContext(`${cut('  const answerDeliverText =', '  async function submitAction(form) {')}; globalThis.fx = { answerToast, verifyEmptyText, answerDeliverText };`, context);
    const { fx } = context;
    assert.match(fx.answerToast('PF-0001', { state: 'sent' }), lang === 'en' ? /delivered — the agent is working again/ : /وصلت للوكيل/);
    assert.doesNotMatch(fx.answerToast('PF-0001', null), lang === 'en' ? /delivered/ : /وصلت للوكيل/, 'no session: never "delivered"');
    assert.match(fx.answerToast('PF-0001', { state: 'busy' }), lang === 'en' ? /still busy/ : /مشغول/);
    assert.match(fx.verifyEmptyText({ stage: 'IMPLEMENTATION', waitingFor: { kind: 'question' } }), lang === 'en' ? /Not started — waiting for your answer/ : /مستني إجابتك/);
    assert.match(fx.verifyEmptyText({ stage: 'PLAN' }), lang === 'en' ? /Not started — verification comes after implementation\. Current stage: PLAN/ : /المرحلة الحالية: PLAN/);
    assert.match(fx.verifyEmptyText({ stage: 'VERIFY' }), lang === 'en' ? /current step/ : /الخطوة الحالية/);
    assert.match(fx.answerDeliverText('PF-0001', 'Q-001', 'x'), /PF-0001/);
  }
  assert.match(cut('  function agentState(it) {', '  function agentDock(it) {'), /Waiting for your input — \$\{it\.id\}/);
});

test('end to end: Answer on the page records the answer, the idle Codex session receives it and works again (simulated provider)', async () => {
  const { root, workId } = await project();
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const routed = spawnSync(process.execPath, [cli, 'route', workId, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'test'], { cwd: root, encoding: 'utf8' });
  assert.equal(routed.status, 0, routed.stderr);
  const added = spawnSync(process.execPath, [cli, 'question', 'add', workId, '--category', 'business', '--text', 'Where are notes stored?'], { cwd: root, encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const tools = await fakeTools();
  const c = await consoleWith(root, { agents: true, agentEnv: tools.env });
  try {
    assert.ok((await c.post('start', { provider: 'codex', workId, mode: 'read-only' })).ok);
    await c.waitFor((e) => e.type === 'session.started');
    const answer = await fetch(`${c.server.url}api/p/${c.pid}/work/${workId}/actions/answer`, { method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, Origin: c.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Q-001', answer: 'In the browser only', deliverText: `Answer for ${workId}: In the browser only. Continue.` }) });
    const result = await answer.json();
    assert.equal(answer.status, 200, JSON.stringify(result));
    assert.deepEqual(result.delivery, { state: 'sent' });
    const sent = await c.waitFor((e) => e.type === 'message.sent');
    assert.equal(sent.text, `Answer for ${workId}: In the browser only. Continue.`);
    await c.waitFor((e) => e.type === 'turn.started');
    const questions = spawnSync(process.execPath, [cli, 'question', 'list', workId], { cwd: root, encoding: 'utf8' });
    assert.match(questions.stdout, /In the browser only/, 'the answer is recorded in YallaFlow too');
    await c.waitFor((e) => e.type === 'turn.ended');
    // A second answer while no question is open is refused by Core; nothing is sent twice.
    const sentBefore = c.events.filter((e) => e.type === 'message.sent').length;
    const again = await fetch(`${c.server.url}api/p/${c.pid}/work/${workId}/actions/answer`, { method: 'POST', headers: { Authorization: `Bearer ${c.server.token}`, Origin: c.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Q-009', answer: 'x' }) });
    assert.notEqual(again.status, 200);
    assert.equal(c.events.filter((e) => e.type === 'message.sent').length, sentBefore);
  } finally {
    await c.close();
  }
});
