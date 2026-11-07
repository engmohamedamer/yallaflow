import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { File } from 'node:buffer';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return app.slice(start, end);
};
const formatCode = cut('  const esc =', '  // ---------- token:');
const fileCode = cut('  const ACCEPT =', '  function openCreate()');
function harness() {
  const revoked = [], calls = [];
  const context = vm.createContext({ lang: 'en', File, URL: { createObjectURL: (f) => `blob:${f.name}`, revokeObjectURL: (u) => revoked.push(u) },
    crypto: { randomUUID: () => 'request-test-1234' }, TYPE: {}, size: (n) => `${n} bytes`, pid: 'project',
    ACTION_LABEL: { revise: { en: 'Edit request…' } }, L: (v) => v.en, toast() {}, refresh: async () => {},
    send: async (url, body) => { calls.push({ url, body }); return {}; }
  });
  vm.runInContext(formatCode + fileCode + cut('  async function submitAction(', '  // ---------- review-gate') + '\npost = (...args) => send(...args); this.queue = (form) => fileQueues.get(form);', context);
  return { context, calls, revoked };
}
function formFixture() {
  const handlers = {}, dialogHandlers = {}, nodes = {};
  const fields = [{ name: 'text', value: 'Updated request', disabled: false }, { name: 'reason', value: 'Details', disabled: false }];
  for (const selector of ['[data-request-files]', '[data-pending-files]', '[data-file-note]', '.errbar', '.formerr']) {
    nodes[selector] = { innerHTML: '', textContent: '', hidden: true, disabled: false, value: '', focus() {}, addEventListener: (name, cb) => { handlers[selector + ':' + name] = cb; } };
  }
  const dialog = { closed: 0, querySelector: (selector) => nodes[selector] ?? null, addEventListener: (name, cb) => { dialogHandlers[name] = cb; }, close() { this.closed++; dialogHandlers.close?.(); } };
  const form = { dataset: { actForm: 'revise', actItem: 'PF-0001' },
    addEventListener: (name, cb) => { handlers[name] = cb; },
    querySelector: (selector) => nodes[selector] ?? null,
    querySelectorAll: (selector) => selector === '[name]' ? fields : [...fields, nodes['[data-request-files]']],
    closest: () => dialog
  };
  return { form, handlers, dialogHandlers, nodes, fields, dialog };
}

test('agent text formats headings, lists, code, links, tables and Arabic without executable HTML', () => {
  const { context: c } = harness();
  const html = c.richText('# نتيجة\n\n**جاهز** و `path.js`\n\n- one\n- two\n\n1. first\n2. second\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n[Docs](https://example.com/?a=1&b=2)\n[x](javascript:alert(1))\n<script>alert(1)</script>\n\n| A | B |\n| --- | --- |\n| <b> | value |');
  assert.match(html, /<h3 dir="auto">نتيجة<\/h3>/);
  assert.match(html, /<strong>جاهز<\/strong>/);
  assert.match(html, /<ul><li dir="auto">one/);
  assert.match(html, /<ol><li dir="auto">first/);
  assert.match(html, /<pre dir="ltr"><code>&lt;img/);
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:|<b>/);
  assert.match(c.richText('```js\nconst x = 1;'), /const x = 1;<\/code><\/pre>/, 'partial streaming code fences stay readable');
  assert.match(c.richText('plain\nsecond line'), /plain<br>second line/);
});

test('paste preserves ordinary text, queues real screenshot bytes, removes previews and releases URLs', async () => {
  const { context: c, revoked } = harness();
  const f = formFixture(); c.initRequestFiles(f.form);
  let prevented = 0;
  f.handlers.paste({ clipboardData: { items: [{ kind: 'string' }] }, preventDefault: () => prevented++ });
  assert.equal(prevented, 0);
  const file = new File(['image-bytes'], 'image.png', { type: 'image/png' });
  const paste = () => f.handlers.paste({ clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] }, preventDefault: () => prevented++ });
  paste(); paste();
  const entries = c.queue(f.form).entries;
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].file.name, entries[1].file.name);
  assert.equal(await entries[0].file.text(), 'image-bytes');
  assert.match(f.nodes['[data-pending-files]'].innerHTML, /<img src="blob:screenshot/);
  c.requestBusy(f.form, true); paste(); assert.equal(entries.length, 2); c.requestBusy(f.form, false);
  f.handlers.click({ target: { closest: () => ({ dataset: { removeFile: '0' } }) } });
  assert.equal(entries.length, 1); assert.equal(revoked.length, 1);
  f.dialog.close(); assert.equal(revoked.length, 2); assert.equal(c.queue(f.form), undefined);
});

test('file selection and paste combine; unsupported, empty and oversized files are explained', () => {
  const { context: c } = harness(); const f = formFixture(); c.initRequestFiles(f.form);
  c.addRequestFiles(f.form, [new File(['hello'], 'notes.txt')]);
  c.addRequestFiles(f.form, [new File(['pixels'], 'image.png', { type: 'image/png' })], true);
  assert.equal(c.queue(f.form).entries.length, 2);
  c.addRequestFiles(f.form, [new File(['<svg>'], 'bad.svg', { type: 'image/svg+xml' }), new File([], 'empty.txt'), { name: 'big.png', size: 51 * 1024 * 1024 }]);
  assert.equal(c.queue(f.form).entries.length, 2);
  assert.match(f.nodes['[data-file-note]'].textContent, /not a supported type.*empty.*larger than 50 MB/);
});

test('revision partial failure keeps pending files and retries without duplicating text or successful uploads', async () => {
  const { context: c, calls } = harness(); const f = formFixture(); c.initRequestFiles(f.form);
  c.addRequestFiles(f.form, [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')]);
  let fail = true;
  c.send = async (url, body) => { calls.push({ url, body }); if (body?.name === 'two.txt' && fail) throw new Error('offline'); return {}; };
  await c.submitAction(f.form);
  assert.equal(f.dialog.closed, 0); assert.equal(f.form.dataset.busy, undefined);
  assert.match(f.nodes['.errbar'].textContent, /request text was saved.*attachments failed/);
  assert.equal(c.queue(f.form).entries[0].uploaded, true);
  fail = false; await c.submitAction(f.form);
  assert.equal(f.dialog.closed, 1);
  assert.equal(calls.filter((x) => x.url.endsWith('/actions/revise')).length, 1);
  assert.equal(calls.filter((x) => x.body?.name === 'one.txt').length, 1);
  assert.equal(calls.filter((x) => x.body?.name === 'two.txt').length, 2);
});

test('create uploads pasted files through the existing bound request endpoint', async () => {
  const { context: c, calls } = harness(); const f = formFixture(); c.initRequestFiles(f.form);
  f.form.request = { value: 'New work', focus() {} };
  c.addRequestFiles(f.form, [new File(['png'], 'image.png', { type: 'image/png' })], true);
  c.send = async (url, body) => { calls.push({ url, body }); return url.endsWith('/work') ? { id: 'PF-0002' } : { source: 'SRC-0001' }; };
  c.partialView = () => {}; c.finishCreate = () => assert.fail('files must show their outcome');
  vm.runInContext(cut('  async function uploadAll(', '  async function finishCreate(') + "\ncw = { pid: 'project', requestId: 'request-test-1234', attached: [] };", c);
  await c.submitCreate(f.form);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].body).request, 'New work');
  assert.match(calls[1].url, /work\/PF-0002\/sources$/);
  assert.equal(await calls[1].body.text(), 'png');
});


test('overview previews keep full facts available under View more, including after redraw', () => {
  const { context: c } = harness();
  c.projectOverview = { pid: 'project', data: {
    project: { kind: 'brownfield', name: 'Demo' }, understanding: {},
    memory: { available: true, current: 4, fresh: 4, mayBeStale: 0, staleEvidence: 0, unknown: 0 },
    areas: { project: { total: 4, facts: [1, 2, 3, 4].map((id) => ({ id: `CTX-${id}`, summary: id === 1 ? 'Long detail. '.repeat(30) + 'END' : `Fact ${id}`, freshness: 'fresh', confidence: 'confirmed' })) } },
    stack: { entries: [], unread: [] }, modules: [], coverage: { available: true, scannedEntries: 0, sourceFiles: 0, manifests: 0 }
  } };
  c.FRESH_TEXT = { fresh: 'Fresh' }; c.understandingCard = () => ''; c.devPanel = () => '';
  vm.runInContext(cut('  function viewOverview()', '  // ---------- new-project Overview'), c);
  const html = c.viewOverview();
  assert.match(html, /data-overview="project:CTX-1" ><summary>/);
  assert.match(html, /END<\/p>/, 'full long content is preserved');
  assert.ok(html.indexOf('Fact 3') < html.indexOf('class="disclosure area-more"'));
  assert.ok(html.indexOf('Fact 4') > html.indexOf('class="disclosure area-more"'));
  vm.runInContext("overviewExpanded.add('project:project')", c);
  assert.match(c.viewOverview(), /data-overview="project:project" open>/);
});
