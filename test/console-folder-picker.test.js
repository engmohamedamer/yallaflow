// PF-0139: the folder picker behaves like a file dialog — one click selects a folder, a double
// click / Enter / the row's arrow opens it, and the footer button acts on the selected folder
// (or the open one). Connecting a folder without Git offers an opt-in `git init`.
// Evaluated from the shipped app.js with minimal stand-ins, like the other console UI tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { previewConnect } from '../src/console/connect.js';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../resources/console/app.css', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const code = cut('  let folder = null; // { mode, data', '  // ---------- agents (1.4.0, PF-0057)');

const HOME = '/home/dev';
const listing = (over = {}) => ({
  path: HOME, parent: null, home: HOME, here: { kind: 'folder' }, truncated: false,
  folders: [
    { name: 'clinic', path: `${HOME}/clinic`, kind: 'code', stack: 'laravel', git: false, yallaflow: false, empty: false },
    { name: 'shop', path: `${HOME}/shop`, kind: 'yallaflow', yallaflow: true, git: true, empty: false },
    { name: 'blank', path: `${HOME}/blank`, kind: 'empty', empty: true, git: false, yallaflow: false }
  ],
  ...over
});

function picker({ mode = 'existing', data = listing(), lang = 'en', posts = {} } = {}) {
  const calls = { api: [], post: [], opened: [], toasts: [], switched: [] };
  const dialog = { innerHTML: '', open: true, close() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] };
  const context = vm.createContext({
    A: (ar, en) => (lang === 'ar' ? ar : en), esc, lang, encodeURIComponent, JSON, Object, Set, String, Boolean, Math, Promise,
    store: { get: (_key, dflt) => dflt, set() {} }, projects: [], wizForm: () => ({ name: 'newapp', parent: '' }), why: (e) => e.message,
    document: { getElementById: (id) => (id === 'folderdlg' ? dialog : null), querySelector: () => null, querySelectorAll: () => [] },
    api: async (url) => { calls.api.push(url); return { path: `${HOME}/clinic`, name: 'clinic', kind: 'existing-code', action: 'init', git: false, gitAbove: false, stack: ['Laravel 13'], sourceFiles: 108, plan: [{ path: '.yallaflow/', op: 'create' }], problems: [], planHash: 'h1' }; },
    post: async (url, body) => { calls.post.push({ url, body: JSON.parse(body) }); if (posts[url]) throw new Error(posts[url]); return { id: 'p9' }; },
    reloadProjects: async () => {}, switchProject: async (id, view) => { calls.switched.push([id, view]); }, toast: (html) => { calls.toasts.push(html); }, render() {}
  });
  vm.runInContext(`${code}\nfolder = { mode: ${JSON.stringify(mode)}, data: ${JSON.stringify(data)}, error: null, busy: false, preview: null, previewError: null, previewBusy: false, ack: false, creating: false, sel: null, editPath: false, gitInit: false };
    openFolder = async (mode, at) => { this.opened.push(at); };
    this.fx = { renderFolder, folderFooter, folderRow, folderTarget, pickFolder, onFolderKey, previewFolder, connectFolder, chooseFolder, previewPanel, state: () => folder };`, Object.assign(context, { opened: calls.opened }));
  return { context, calls, dialog, fx: context.fx };
}

test('a row is one select button plus an open arrow; nothing in the list navigates on a single click', () => {
  const { fx, dialog } = picker();
  fx.renderFolder();
  const row = fx.folderRow(listing().folders[0]);
  assert.match(row, /<button type="button" class="fpick-row" data-folder-pick="\/home\/dev\/clinic" aria-pressed="false">/);
  assert.match(row, /<button type="button" class="fpick-enter" data-folder-go="\/home\/dev\/clinic" tabindex="-1" aria-label="Open the folder clinic"/);
  assert.doesNotMatch(row, /class="fpick-row" data-folder-go=/, 'the row itself no longer enters the folder');
  assert.equal((dialog.innerHTML.match(/data-folder-pick=/g) ?? []).length, 3);
  assert.match(dialog.innerHTML, /Click selects a folder · double-click or Enter opens it · Backspace goes up\./);
  assert.match(app, /d\.addEventListener\('dblclick', \(e\) => \{ const row = e\.target\.closest\('\[data-folder-pick\]'\); if \(row && folder && !folder\.preview\) openFolder\(folder\.mode, row\.dataset\.folderPick\); \}\);/);
  assert.match(app, /if \(fpk && folder\) \{ pickFolder\(fpk\.dataset\.folderPick\); return; \}/);
  assert.match(css, /\.fpick-list li\.sel \{ background: var\(--nile-soft\);/);
});

test('at home with nothing selected the footer says what to do; selecting makes the button act on that folder', () => {
  const { fx } = picker();
  const idle = fx.folderFooter(listing());
  assert.match(idle, /Click the project folder to select it\./);
  assert.match(idle, /<button type="button" class="btn go" disabled>Choose the project folder</);

  fx.pickFolder(`${HOME}/clinic`);
  assert.deepEqual({ ...fx.folderTarget(), here: undefined }, { path: `${HOME}/clinic`, here: undefined, selected: true, atHome: false });
  const code1 = fx.folderFooter(listing());
  assert.match(code1, /Selected folder · Laravel/);
  assert.match(code1, /title="\/home\/dev\/clinic">~\/clinic</);
  assert.match(code1, /data-folder-preview>Set up YallaFlow here</);
  assert.match(fx.folderRow(listing().folders[0]), /<li data-name="clinic" class="sel">.*aria-pressed="true"/);

  fx.pickFolder(`${HOME}/shop`);
  assert.match(fx.folderFooter(listing()), /Selected folder · YallaFlow project[\s\S]*data-folder-choose>Open this project</);
  fx.pickFolder(`${HOME}/blank`);
  assert.match(fx.folderFooter(listing()), /data-folder-preview>Start a new project here</);
});

test('with nothing selected inside a folder, the button acts on the open folder', () => {
  const inside = listing({ path: `${HOME}/clinic`, parent: HOME, here: { kind: 'code', stack: 'laravel' }, folders: [] });
  const { fx } = picker({ data: inside });
  assert.equal(fx.folderTarget().path, `${HOME}/clinic`);
  assert.match(fx.folderFooter(inside), /Open folder · Laravel[\s\S]*data-folder-preview>Set up YallaFlow here</);
});

test('choosing and previewing use the selected folder', async () => {
  const w = picker();
  w.fx.pickFolder(`${HOME}/clinic`);
  await w.fx.previewFolder();
  assert.deepEqual(w.calls.api, ['/api/fs/connect-preview?path=%2Fhome%2Fdev%2Fclinic']);

  const open = picker();
  open.fx.pickFolder(`${HOME}/shop`);
  await open.fx.chooseFolder();
  assert.deepEqual(open.calls.post[0], { url: '/api/projects', body: { root: `${HOME}/shop` } });

  const parent = picker({ mode: 'parent' });
  parent.fx.pickFolder(`${HOME}/blank`);
  assert.match(parent.fx.folderFooter(listing()), /title="\/home\/dev\/blank">~\/blank\/<b>newapp<\/b>[\s\S]*data-folder-choose >Create the project here</);
});

test('keys: arrows move the selection, Enter or the forward arrow opens, the back arrow goes up', () => {
  const run = (lang, key, data = listing({ parent: '/home' })) => {
    const w = picker({ lang, data });
    const rows = data.folders.map((f) => ({ dataset: { folderPick: f.path }, focused: false, focus() { this.focused = true; }, matches: () => false, setAttribute() {}, closest: () => null }));
    w.dialog.querySelectorAll = (sel) => (sel.includes('.fpick-row') || sel.includes('[data-folder-pick]') ? rows : []);
    let prevented = false;
    w.fx.onFolderKey({ key, target: rows[0], preventDefault() { prevented = true; }, altKey: false, ctrlKey: false, metaKey: false });
    return { w, rows, prevented };
  };
  const down = run('en', 'ArrowDown');
  assert.equal(down.rows[1].focused, true);
  assert.equal(down.w.fx.state().sel, `${HOME}/shop`, 'moving also selects');
  assert.deepEqual(run('en', 'Enter').w.calls.opened, [`${HOME}/clinic`]);
  assert.deepEqual(run('en', 'ArrowRight').w.calls.opened, [`${HOME}/clinic`]);
  assert.deepEqual(run('en', 'ArrowLeft').w.calls.opened, ['/home'], 'back goes up');
  assert.deepEqual(run('ar', 'ArrowLeft').w.calls.opened, [`${HOME}/clinic`], 'forward is the left arrow in Arabic');
  assert.deepEqual(run('ar', 'ArrowRight').w.calls.opened, ['/home']);
  assert.match(picker({ lang: 'ar' }).fx.folderRow(listing().folders[0]), />‹<\/button><\/li>$/, 'the open arrow points forward in Arabic');
});

test('the path bar is the breadcrumb, with the typed path one click away', () => {
  const { fx, dialog } = picker({ data: listing({ path: `${HOME}/clinic`, parent: HOME }) });
  fx.renderFolder();
  assert.match(dialog.innerHTML, /class="fpick-bar">[\s\S]*data-folder-editpath="on" aria-label="Type a path"/);
  assert.doesNotMatch(dialog.innerHTML, /data-folder-pathform/, 'no path field until asked for');
  fx.state().editPath = true;
  fx.renderFolder();
  assert.match(dialog.innerHTML, /<form class="fpick-pathform" data-folder-pathform>[\s\S]*value="~\/clinic"[\s\S]*data-folder-editpath="off">Cancel</);
  assert.doesNotMatch(dialog.innerHTML, /class="fpick-bar"/);
});

// ---- git init, opt-in ----
test('the preview offers git init only for a folder with no Git repository, unticked', async () => {
  const w = picker();
  w.fx.pickFolder(`${HOME}/clinic`);
  await w.fx.previewFolder();
  const html = w.fx.previewPanel();
  assert.match(html, /<input type="checkbox" data-folder-gitinit > <span><b>Also create a Git repository in this folder<\/b> <span class="ltr tiny muted">\(git init\)<\/span> <span class="tiny muted">· optional<\/span>/);
  assert.match(html, /no commit, no remote, and your files stay as they are/);
  assert.match(html, /no Git changes unless you tick &quot;git init&quot; below|no Git changes unless you tick "git init" below/);
  for (const has of [{ git: true }, { gitAbove: true }]) {
    Object.assign(w.fx.state().preview, { git: false, gitAbove: false }, has);
    const other = w.fx.previewPanel();
    assert.doesNotMatch(other, /data-folder-gitinit/);
    assert.match(other, /No application code changes, no commit, no Git changes\./);
  }
});

test('connect runs git init only when ticked, after the connect, with the confirmed action', async () => {
  const plain = picker();
  plain.fx.pickFolder(`${HOME}/clinic`);
  await plain.fx.previewFolder();
  plain.fx.state().ack = true;
  await plain.fx.connectFolder();
  assert.deepEqual(plain.calls.post.map((x) => x.url), ['/api/projects/connect']);
  assert.match(plain.calls.toasts[0], /“clinic” is now a YallaFlow project ✓$/);

  const ticked = picker();
  ticked.fx.pickFolder(`${HOME}/clinic`);
  await ticked.fx.previewFolder();
  Object.assign(ticked.fx.state(), { ack: true, gitInit: true });
  await ticked.fx.connectFolder();
  assert.deepEqual(ticked.calls.post, [{ url: '/api/projects/connect', body: { root: `${HOME}/clinic`, planHash: 'h1', confirm: true } }, { url: '/api/p/p9/git/init', body: { confirm: true } }]);
  assert.match(ticked.calls.toasts[0], /✓ · Git repository created$/);
  assert.deepEqual(ticked.calls.switched, [['p9', 'map']]);
});

test('a refused git init is reported and never undoes the connect', async () => {
  const w = picker({ posts: { '/api/p/p9/git/init': 'This project is already inside a Git repository; nothing was changed.' } });
  w.fx.pickFolder(`${HOME}/clinic`);
  await w.fx.previewFolder();
  Object.assign(w.fx.state(), { ack: true, gitInit: true });
  await w.fx.connectFolder();
  assert.match(w.calls.toasts[0], /is now a YallaFlow project ✓ · Git was not created: This project is already inside a Git repository/);
  assert.deepEqual(w.calls.switched, [['p9', 'map']]);
});

test('previewConnect reports a Git repository above the folder without running Git', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-picker-'));
  const make = async (rel) => { const full = path.join(dir, rel); await mkdir(full, { recursive: true }); await writeFile(path.join(full, 'package.json'), '{"name":"x"}'); return full; };
  const alone = await make('alone');
  const inner = await make('mono/packages/inner');
  await mkdir(path.join(dir, 'mono', '.git'));
  const own = await make('own');
  await mkdir(path.join(own, '.git'));
  assert.deepEqual([(await previewConnect(alone, { home: dir })).git, (await previewConnect(alone, { home: dir })).gitAbove], [false, false]);
  assert.deepEqual([(await previewConnect(inner, { home: dir })).git, (await previewConnect(inner, { home: dir })).gitAbove], [false, true]);
  assert.deepEqual([(await previewConnect(own, { home: dir })).git, (await previewConnect(own, { home: dir })).gitAbove], [true, false]);
});
