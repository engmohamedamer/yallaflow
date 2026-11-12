// PF-0128 (1.5.2): console polish — project cards with their own actions, the slim Workspace
// greeting, and an entrance motion only on page changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';
import { fileManagerCommand, openInFileManager } from '../src/console/reveal.js';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../resources/console/app.css', import.meta.url), 'utf8');

function post(server, pathname, body, { auth = true, origin = true } = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.port, path: pathname, method: 'POST', headers: { Host: `127.0.0.1:${server.port}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(origin ? { Origin: `http://127.0.0.1:${server.port}` } : {}), ...(auth ? { Authorization: `Bearer ${server.token}` } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function demo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-polish-'));
  await initWorkspace(root, 'demo', 'greenfield', 'adaptive');
  return root;
}

test('Open folder opens only the registered project root, behind the token and Origin', async () => {
  const root = await demo();
  const opened = [];
  const server = await startConsoleServer({ roots: [root], openFolder: async (dir) => { opened.push(dir); return { opened: true, root: dir }; } });
  try {
    const pid = server.projects?.[0]?.id ?? (await new Promise((resolve) => http.get({ host: '127.0.0.1', port: server.port, path: '/api/projects', headers: { Host: `127.0.0.1:${server.port}`, Authorization: `Bearer ${server.token}` } }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve(JSON.parse(Buffer.concat(c)).projects[0].id)); })));
    assert.equal((await post(server, `/api/p/${pid}/open-folder`, {}, { auth: false })).status, 401);
    assert.equal((await post(server, `/api/p/${pid}/open-folder`, {}, { origin: false })).status, 403);
    assert.equal((await post(server, '/api/p/0000000000/open-folder', {})).status, 404);
    assert.deepEqual(opened, []);
    const ok = await post(server, `/api/p/${pid}/open-folder`, { root: '/etc' });
    assert.equal(ok.status, 200);
    assert.deepEqual(opened, [root], 'the request body never chooses the folder');
  } finally {
    await server.close();
  }
});

test('a read-only console refuses Open folder', async () => {
  const root = await demo();
  const opened = [];
  const server = await startConsoleServer({ roots: [root], readOnly: true, openFolder: async (dir) => { opened.push(dir); } });
  try {
    const pid = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: server.port, path: '/api/projects', headers: { Host: `127.0.0.1:${server.port}`, Authorization: `Bearer ${server.token}` } }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve(JSON.parse(Buffer.concat(c)).projects[0].id)); }));
    assert.equal((await post(server, `/api/p/${pid}/open-folder`, {})).status, 405);
    assert.deepEqual(opened, []);
  } finally {
    await server.close();
  }
});

test('the file manager is started without a shell, per platform, and a missing folder is reported', async () => {
  assert.equal(fileManagerCommand('linux'), 'xdg-open');
  assert.equal(fileManagerCommand('darwin'), 'open');
  assert.equal(fileManagerCommand('win32'), 'explorer.exe');
  const root = await demo();
  const calls = [];
  const spawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  assert.deepEqual(await openInFileManager(root, { platform: 'linux', spawnFn }), { opened: true, root });
  assert.deepEqual(calls[0].args, [root]);
  assert.equal(calls[0].options.shell, false);
  await assert.rejects(openInFileManager(path.join(root, 'gone'), { spawnFn }), { code: 'FOLDER_MISSING' });
  const failing = () => { const child = new EventEmitter(); setImmediate(() => child.emit('error', new Error('ENOENT'))); return child; };
  await assert.rejects(openInFileManager(root, { spawnFn: failing }), { code: 'FILE_MANAGER_UNAVAILABLE' });
});

test('project cards carry Open, Open folder, Copy path and Remove; read-only hides the writes', () => {
  const view = app.slice(app.indexOf('function viewProjects'), app.indexOf('function viewProjects') + 6000);
  assert.match(view, /class="pcard panel/);
  assert.match(view, /data-open-project="\$\{project\.id\}">\$\{A\('افتح', 'Open'\)\}/);
  assert.match(view, /readOnly \? '' : `<button type="button" class="btn sm" data-open-folder=/);
  assert.match(view, /data-copy="\$\{esc\(project\.root \?\? ''\)\}" data-copy-what="path"/);
  assert.match(app, /what === 'path' \? A\('اتنسخ المسار ✓', 'Path copied ✓'\)/);
  for (const selector of ['.pcard {', '.pcard-foot {', '.pcard-path {']) assert.ok(css.includes(selector), selector);
});

test('the Workspace greeting is one slim row whose counts filter the work', () => {
  assert.match(app, /<section class="hero slim">\$\{ring\(pct, 56, 6\)\}/);
  assert.match(app, /class="hstat \$\{cls\} \$\{flt\.st === key \? 'on' : ''\}" data-f="\$\{key\}" aria-pressed="\$\{flt\.st === key\}"/);
  for (const selector of ['.hero.slim {', '.hstat {', '.hstat.on {']) assert.ok(css.includes(selector), selector);
});

test('the entrance motion runs only when the page changes and respects reduced motion', () => {
  assert.match(app, /const entering = !reduced && r\.v !== lastView;/);
  assert.match(app, /if \(entering\) appEl\.querySelector\('main'\)\?\.classList\.add\('enter'\);/);
  assert.doesNotMatch(app, /<main class="\$\{entering/, 'the class never changes the redraw markup');
  assert.match(css, /main\.enter > \* \{ animation: enter/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important;/);
});

test('PF-0130: the "since you were last here" notice shows each item as its ID and latest outcome, title in the tooltip', () => {
  const card = app.slice(app.indexOf('function digestCard()'), app.indexOf('function digestCard()') + 1600);
  assert.match(card, /<ul class="digest-chips">/);
  assert.match(card, /href="#\/item\/\$\{encodeURIComponent\(it\.id\)\}" title="\$\{esc\(full\)\}" aria-label="\$\{esc\(full\)\}"><b class="ltr">\$\{esc\(it\.id\)\}<\/b>/);
  assert.doesNotMatch(card, /<\/span> \$\{esc\(it\.title\)\}<\/a>/, 'the full title is no longer printed in the notice');
  assert.ok(css.includes('.digest-chip {'));
});

test('PF-0131: the live move toast names the item by its linked ID, the title only in the tooltip', () => {
  assert.match(app, /const ref = `<a class="toast-id ltr" href="#\/item\/\$\{encodeURIComponent\(first\.id\)\}" title="\$\{esc\(title\)\}"/);
  assert.match(app, /`\$\{ref\} اتسلّم من «\$\{stName\(first\.from\)\}» لـ«\$\{stName\(first\.to\)\}»`/);
  assert.doesNotMatch(app, /«\$\{esc\(title\)\}» (?:دخل|رجع|اتسلّم)/, 'no full title in the toast text');
  assert.ok(css.includes('.toast a.toast-id {'));
});

test('PF-0133: the agent is chosen in place — readiness card and chat panel — and links from the chat close it', () => {
  assert.match(app, /if \(st\.id === 'agent' && st\.status === 'choose'\) return agentChooser\(\);/);
  assert.match(app, /data-agent-choose="\$\{id\}"/);
  assert.match(app, /card\('codex', 'Codex'/);
  assert.match(app, /agentsClaudeAvailable\s*\? card\('claude'/);
  assert.match(app, /Claude Team or Enterprise accounts, console messages reach Claude Code only if your organization enabled channels/);
  assert.match(app, /await post\(`\/api\/p\/\$\{pid\}\/agents\/settings`, JSON\.stringify\(\{ agents: true, claude: provider === 'claude' \}\)/);
  assert.match(app, /if \(!readOnly && agentStep\(\)\?\.status === 'choose'\) return `<section class="panel agent" id="agent">/);
  assert.match(app, /<button type="button" class="linkbtn" data-agent-choose="claude">/, 'Claude is turned on in place, not by leaving the page');
  assert.match(app, /const away = e\.target\.closest\('#chatwin a\[href\^="#\/"\]'\);\s*if \(away && chatOpen\) toggleChat\(false\);/);
  assert.ok(css.includes('.agentpick-opt {'));
});

// PF-0137: the all-done summary box on the work map is the same slim row as the open-work one.
test('PF-0137: the all-done box is slim, with the filter chips and a small New work button', async () => {
  const { readFile } = await import('node:fs/promises');
  const appSource = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
  const cssSource = await readFile(new URL('../resources/console/app.css', import.meta.url), 'utf8');
  const start = appSource.indexOf('  function hero() {');
  const hero = appSource.slice(start, appSource.indexOf('  // PF-0137: `more` is the small button', start));
  assert.match(hero, /if \(!open\) return `<section class="hero calm slim"><span class="hico done xs" aria-hidden="true">✓<\/span>/);
  assert.match(hero, /<\/p><\/div>\$\{createButton\(true\)\}\$\{chips\}<\/section>`;/);
  assert.doesNotMatch(hero, /class="stats"/, 'no large stat tiles');
  assert.match(appSource, /more \? `<button class="btn go sm" data-create>＋ \$\{A\('شغل جديد', 'New work'\)\}<\/button>`/);
  assert.match(cssSource, /\.hico\.xs \{ width: 56px; height: 56px; font-size: 26px; \}/);
});
