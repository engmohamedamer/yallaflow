import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
// Exercise the shipped action controller without starting a browser or a live project.
const controller = app.slice(app.indexOf('  const ACTION_LABEL ='), app.indexOf('  async function submitAction('));

function harness({ readOnly = false, response, lang = 'en' } = {}) {
  const item = { id: 'PF-0001', title: 'Short title', routing: 'routed', stage: 'INTAKE', state: 'new', requestEditable: true };
  const field = { value: '', focus() {} };
  const submit = { disabled: false, focus() {} };
  const error = { hidden: true, textContent: '' };
  let closeHandler;
  const dialog = {
    isConnected: false, innerHTML: '',
    setAttribute() {}, showModal() {},
    addEventListener(name, callback) { if (name === 'close') closeHandler = callback; },
    remove() { this.isConnected = false; },
    close() { closeHandler(); },
    querySelector(selector) {
      if (selector === '[name="text"]') return field;
      if (selector === 'button[type="submit"]') return submit;
      if (selector === '.errbar') return error;
      return field;
    }
  };
  const calls = [];
  const context = vm.createContext({
    readOnly, pid: 'project-a', snap: { project: {} },
    byId: () => item,
    A: (ar, en) => lang === 'ar' ? ar : en,
    L: (value) => value[lang],
    esc: (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    why: (e) => e.message,
    api: async (url) => { calls.push(url); return response; },
    document: { querySelector: () => null, createElement: () => dialog, body: { appendChild(d) { d.isConnected = true; } } }
  });
  vm.runInContext(controller, context);
  return { context, item, field, submit, error, dialog, calls };
}

test('edit is offered alongside Advance in INTAKE and suppressed for ineligible or read-only work', () => {
  const h = harness();
  assert.ok(h.context.itemActions(h.item).includes('revise'));
  assert.ok(h.context.itemActions(h.item).includes('advance'));
  for (const patch of [{ requestEditable: false }, { lifecycle: { state: 'on_hold' } }, { lifecycle: { state: 'closed' } }, { state: 'done' }]) {
    assert.ok(!h.context.itemActions({ ...h.item, ...patch }).includes('revise'));
  }
  const ro = harness({ readOnly: true });
  assert.equal(ro.context.itemActions(ro.item).length, 0);
  assert.ok(!h.context.itemActions({ ...h.item, routing: 'pending' }).includes('advance'));
});

test('editor waits for full raw text, preserves long multiline content and supports Arabic', async () => {
  const raw = 'طلب كامل\n' + '<details> & '.repeat(1100);
  const h = harness({ lang: 'ar', response: { item: { requestEditable: true }, request: { raw } } });
  h.context.openAction('revise', h.item.id);
  assert.equal(h.submit.disabled, true);
  assert.equal(h.field.disabled, true);
  await new Promise(setImmediate);
  assert.equal(h.field.value, raw);
  assert.equal(h.submit.disabled, false);
  assert.equal(h.field.disabled, false);
  assert.match(h.dialog.innerHTML, /الطلب بعد التعديل/);
  assert.match(h.dialog.innerHTML, /maxlength="20000"/);
  assert.deepEqual(h.calls, ['/api/p/project-a/work/PF-0001']);
});

test('a started request or failed load leaves saving disabled and shows the error', async () => {
  for (const failed of [false, true]) {
    const response = failed ? Promise.reject(new Error('Offline')) : Promise.resolve({ item: { requestEditable: false } });
    const h = harness({ response });
    h.context.openAction('revise', h.item.id);
    await new Promise(setImmediate);
    assert.equal(h.submit.disabled, true);
    assert.equal(h.field.value, '');
    assert.equal(h.error.hidden, false);
    assert.match(h.error.textContent, /no longer editable|Offline/);
  }
});

test('cancelling before loading completes discards the load without writing', async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const h = harness({ response });
  h.context.openAction('revise', h.item.id);
  h.dialog.close();
  resolve({ item: { requestEditable: true }, request: { raw: 'Full request' } });
  await new Promise(setImmediate);
  assert.equal(h.dialog.isConnected, false);
  assert.equal(h.field.value, '');
  assert.equal(h.calls.length, 1);
});
