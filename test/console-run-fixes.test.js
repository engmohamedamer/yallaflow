// PF-0166: the Run tab fixes a service where it fails. Console routes (edit, port, install)
// take validated fields only and say where a change was saved; the card shows what is
// missing with the exact command, a taken port with its owner and a free port, the line that
// explains a failure, and an edit form that sends only what changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { addService } from '../src/runtime/profile.js';
import { SUPPORTED } from '../src/runtime/process.js';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';

process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-runfix-cfg-')), 'console.json');
process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), 'yf-runfix-xdg-'));

test('console routes: edit and port need a save location, take fields (never a command line), and report where they saved', { skip: !SUPPORTED }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-runfix-'));
  await initWorkspace(root, 'R', 'greenfield', 'adaptive');
  await mkdir(path.join(root, 'landing'));
  await writeFile(path.join(root, 'landing', 'package.json'), JSON.stringify({ scripts: { start: 'ng serve' }, devDependencies: { '@angular/cli': '^19' } }));
  await writeFile(path.join(root, 'landing', 'package-lock.json'), '{}');
  await addService(root, { id: 'landing-start', name: 'Landing', kind: 'process', command: ['npm', '--prefix', 'landing', 'run', 'start'], cwd: '.', ports: [4200], ready: { port: 4200 }, links: [{ label: 'App', url: 'http://localhost:4200/' }] });
  const sharedBefore = await readFile(path.join(root, '.yallaflow', 'runtime.yaml'), 'utf8');
  const server = await startConsoleServer({ roots: [root], port: 0 });
  t.after(() => server.close());
  const auth = { Authorization: `Bearer ${server.token}` };
  const headers = { ...auth, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  const pid = (await (await fetch(`${server.url}api/projects`, { headers: auth })).json()).projects[0].id;
  const post = async (route, body) => { const r = await fetch(`${server.url}api/p/${pid}/runtime/landing-start/${route}`, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const service = async () => (await (await fetch(`${server.url}api/p/${pid}/runtime`, { headers: auth })).json()).services[0];

  const first = await service();
  assert.deepEqual([first.prerequisites.ok, first.prerequisites.problems[0].fix.display, first.source, first.overridden], [false, 'cd landing && npm ci --include=dev', 'shared', []]);

  // the save location is the developer's decision
  for (const bad of [{ from: 4200, to: 4202 }, { from: 4200, to: 4202, scope: 'everywhere' }, { from: '4200', to: 4202, scope: 'local' }, { from: 4200, to: 4202, scope: 'local', command: 'rm -rf /' }]) assert.equal((await post('port', bad)).status, 400, JSON.stringify(bad));
  const moved = await post('port', { from: 4200, to: 4202, scope: 'local' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual([moved.body.savedTo, moved.body.file, moved.body.from, moved.body.to], ['local', '.yallaflow/local/runtime.yaml', 4200, 4202]);
  assert.equal(await readFile(path.join(root, '.yallaflow', 'runtime.yaml'), 'utf8'), sharedBefore, 'a change for this machine leaves the shared file alone');
  const after = await service();
  assert.deepEqual([after.command, after.ports.map((p) => p.port), after.ready, after.links, after.overridden.sort()], [['npm', '--prefix', 'landing', 'run', 'start', '--', '--port', '4202'], [4202], { port: 4202 }, [{ label: 'App', url: 'http://localhost:4202/' }], ['command', 'links', 'ports', 'ready']]);
  assert.equal(after.trust.trusted, false, 'a moved service is reviewed again before it starts');

  for (const bad of [{ name: 'X' }, { scope: 'local' }, { scope: 'local', kind: 'docker-compose' }, { scope: 'local', argv: 'npm start' }, { scope: 'local', ports: ['x'] }, { scope: 'local', env: ['A=1'] }, { scope: 'local', readyPort: 1, noReady: true }]) assert.equal((await post('edit', bad)).status, 400, JSON.stringify(bad));
  const edited = await post('edit', { scope: 'shared', name: 'Landing page' });
  assert.deepEqual([edited.status, edited.body.savedTo, edited.body.changed, edited.body.masked], [200, 'shared', ['name'], []]);
  const doc = JSON.parse(await readFile(path.join(root, '.yallaflow', 'runtime.yaml'), 'utf8')).services[0];
  assert.deepEqual([doc.name, doc.links, doc.ports, doc.command], ['Landing page', [{ label: 'App', url: 'http://localhost:4200/' }], [4200], ['npm', '--prefix', 'landing', 'run', 'start']], 'one changed field; the rest of the shared definition is as it was');
  const refused = await post('edit', { scope: 'local', argv: ['node', 'x.js'], ports: [4202] });
  assert.equal(refused.status, 200);
  const cannot = await post('port', { from: 4202, to: 4203, scope: 'local' });
  assert.deepEqual([cannot.status, cannot.body.error.code], [422, 'RUNTIME_PORT_COMMAND'], 'a command it does not understand is not edited by guesswork');
  assert.deepEqual((await service()).ports.map((p) => p.port), [4202], 'and nothing changed');

  // install: the reviewed command's hash and an explicit confirmation, for a trusted service only
  for (const bad of [{}, { confirmed: true }, { confirmed: false, commandHash: 'a'.repeat(64) }, { confirmed: true, commandHash: 'npm ci' }]) assert.equal((await post('install', bad)).status, 400);
  const untrusted = await post('install', { confirmed: true, commandHash: 'a'.repeat(64) });
  assert.deepEqual([untrusted.status, untrusted.body.error.code], [422, 'RUNTIME_UNTRUSTED']);
  // read-only and monitored consoles refuse all three
  const ro = await startConsoleServer({ roots: [root], port: 0, readOnly: true });
  try {
    for (const route of ['edit', 'port', 'install']) assert.equal((await fetch(`${ro.url}api/p/${pid}/runtime/landing-start/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${ro.token}`, Origin: ro.url.replace(/\/$/, ''), 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
  } finally { await ro.close(); }
});

// ---- the page (evaluated from the shipped app.js with minimal stand-ins) ----
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIX = { argv: ['npm', 'ci', '--include=dev'], cwd: 'landing', display: 'cd landing && npm ci --include=dev', manager: 'npm', lockfile: 'package-lock.json', changesLockfile: false, hash: 'a'.repeat(64) };
const sv = (over = {}) => ({ id: 'landing-start', name: 'Landing', source: 'shared', overridden: [], command: ['npm', '--prefix', 'landing', 'run', 'start'], cwd: '.', env: ['NODE_ENV'], ports: [{ port: 4200, listening: false }], ready: { port: 4200 }, open: '/', dependsOn: ['api'], links: [{ label: 'App', url: 'http://localhost:4200/' }], state: 'stopped', trust: { trusted: true }, prerequisites: { ok: true, problems: [] }, unmanagedPorts: [], ...over });

function kit({ lang = 'en', readOnly = false, agentsOn = false } = {}) {
  const context = vm.createContext({ A: (ar, en) => (lang === 'ar' ? ar : en), L: (v) => v.en, esc, JSON, Object, Boolean, Number, String, Set, Array, readOnly, agentsOn, runtimeBusy: {}, runtimeLogs: {}, runtimeErr: {}, runtimeReview: {}, failedTail: {}, runsOutside: () => false, sxOpen: () => '',
    shq: (v) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(String(v)) ? String(v) : `'${String(v).replace(/'/g, `'\\''`)}'`) });
  vm.runInContext(`${cut('  function argvOf(text) {', '  async function addService(body) {')}
    ${cut('  const rtFix = {};', '  // Reads the edit form and keeps only what differs')}
    ${cut('  function editPatch(sv, form) {', '  async function submitEdit(form) {')}
    ${cut('  // PF-0123: what failed and how to recover', '  function serviceCard(sv) {')}
    globalThis.fx = { needs: needsBlock, unknown: unknownNote, port: portBlock, edit: editForm, patch: editPatch, fail: failureBlock, chip: savedChip, scope: scopeChoice, saved: savedWhere, fix: rtFix, editing: svcEdit, ack: rtInstallAck, tail: failedTail };`, context);
  return context.fx;
}
const form = (values) => ({ querySelector: (sel) => { const name = /\[name="([^"]+)"\]/.exec(sel)?.[1]; return name in values ? { value: values[name] } : null; } });

test('the card says what is missing, shows the exact command first, and installs only after a tick on a trusted service', () => {
  for (const lang of ['en', 'ar']) {
    const fx = kit({ lang });
    const missing = sv({ prerequisites: { ok: false, problems: [{ code: 'DEPENDENCIES_MISSING', dir: 'landing', message: 'x', fix: FIX }] } });
    const html = fx.needs(missing);
    assert.match(html, /data-svc-need="DEPENDENCIES_MISSING"/);
    assert.match(html, /<code class="cli grow" dir="ltr">cd landing &amp;&amp; npm ci --include=dev<\/code>/);
    assert.match(html, lang === 'en' ? /no node_modules folder/ : /لا يوجد مجلد node_modules/);
    assert.match(html, lang === 'en' ? /package\.json and the lockfile are not changed/ : /لن يتغيّر package\.json ولا ملف القفل/);
    assert.match(html, lang === 'en' ? /stay on this machine only[\s\S]*each teammate installs/ : /تبقى على جهازك فقط/);
    assert.match(html, /data-rt-install="landing-start" data-hash="a{64}" disabled/, 'off until the command is ticked as reviewed');
    fx.ack.add('landing-start');
    assert.match(fx.needs(missing), /data-rt-install="landing-start" data-hash="a{64}" >/);
    const untrusted = fx.needs({ ...missing, trust: { trusted: false } });
    assert.ok(!/data-rt-install=/.test(untrusted), 'no install button before the service is trusted');
    assert.match(untrusted, lang === 'en' ? /reviewed and trusted/ : /مراجعة الخدمة وتوثيقها/);
    assert.match(fx.needs({ ...missing, prerequisites: { ok: false, problems: [{ code: 'LOCAL_TOOL_MISSING', dir: 'landing', tool: 'ng', package: '@angular/cli', fix: { ...FIX, lockfile: null, changesLockfile: true } }] } }), lang === 'en' ? /runs ng \(from the package @angular\/cli\)[\s\S]*the install creates one/ : /يبدأ ng \(من الحزمة @angular\/cli\)/);
    assert.equal(fx.needs(sv()), '');
    assert.equal(fx.needs({ ...missing, state: 'running' }), '');
  }
  assert.ok(!/data-rt-install=|data-rt-install-ack/.test(kit({ readOnly: true }).needs(sv({ prerequisites: { ok: false, problems: [{ code: 'DEPENDENCIES_MISSING', dir: '.', fix: FIX }] } }))));
});

test('a taken port: the owner by name, a free port, one consistent change, and where it is saved', () => {
  for (const lang of ['en', 'ar']) {
    const fx = kit({ lang });
    assert.equal(fx.port(sv()), '');
    fx.fix['landing-start'] = { port: 4200, owner: 'process node (pid 4321)', ownerService: { id: 'front', name: 'FrontApp' }, declaredBy: null, suggestion: 4202 };
    const html = fx.port(sv());
    assert.match(html, lang === 'en' ? /Port 4200 is in use<\/b> by <span dir="auto">the service &quot;FrontApp&quot; of this project/ : /المنفذ 4200 مستخدم<\/b> من <span dir="auto">الخدمة «FrontApp» في هذا المشروع/);
    assert.match(html, lang === 'en' ? /YallaFlow will not stop the other one/ : /لن يوقف YallaFlow الخدمة الأخرى/);
    assert.match(html, /name="to" min="1" max="65535" required value="4202"/);
    assert.match(html, lang === 'en' ? /Changed together: the start command, the port, the readiness check and the open links/ : /يتغيّر معاً: أمر التشغيل، المنفذ، فحص الجاهزية، وروابط الفتح/);
    assert.match(html, /name="scope" value="local" checked>[\s\S]*name="scope" value="shared">/, 'this machine is the default; shared is a choice');
    assert.match(html, lang === 'en' ? /only after you commit and push it yourself\. Saving uploads nothing/ : /بعد أن تعمل commit و push بنفسك\. الحفظ لا يرفع شيئاً/);
    fx.fix['landing-start'] = { port: 4200, owner: 'process node (pid 9)', ownerService: null, declaredBy: { id: 'front', name: 'FrontApp' }, suggestion: null, error: 'cannot tell', cannot: true };
    const stuck = fx.port(sv({ source: 'local' }));
    assert.match(stuck, /process node \(pid 9\)/);
    assert.match(stuck, lang === 'en' ? /also defined for the service &quot;FrontApp&quot;/ : /معرّف أيضاً للخدمة «FrontApp»/);
    assert.match(stuck, /role="alert"[^>]*>cannot tell<\/p><button type="button" class="btn sm" data-svc-edit="landing-start">/, 'a command it cannot change leads to editing it yourself');
    assert.match(stuck, /data-scope-only="local"[\s\S]*type="hidden" name="scope" value="local"/, 'a service of this machine has no shared choice');
  }
  const fx = kit();
  assert.match(fx.saved({ savedTo: 'shared', file: '.yallaflow/runtime.yaml', masked: ['ports'] }), /after you commit and push; nothing was uploaded\. Your local override still wins on this machine for: ports\./);
  assert.match(fx.saved({ savedTo: 'local', file: '.yallaflow/local/runtime.yaml' }), /^Saved for this machine only/);
  assert.match(fx.chip(sv()), /data-saved="shared"/);
  assert.match(fx.chip(sv({ source: 'local' })), /data-saved="local"/);
  assert.match(fx.chip(sv({ overridden: ['command', 'ports'] })), /data-saved="shared-local"[^>]*local change to: command, ports\. The local change does not reach teammates/);
});

test('the edit form sends only what changed, with rarely used fields under Advanced', () => {
  const fx = kit();
  assert.equal(fx.edit(sv()), '');
  fx.editing['landing-start'] = { adv: false, error: null };
  const html = fx.edit(sv());
  const advancedAt = html.indexOf('svcedit-adv');
  for (const name of ['name', 'command', 'ports']) assert.ok(html.indexOf(`name="${name}"`) < advancedAt, `${name} is up front`);
  for (const name of ['cwd', 'readyKind', 'readyPort', 'readyLog', 'open', 'env']) assert.ok(html.indexOf(`name="${name}"`) > advancedAt, `${name} is under Advanced`);
  assert.match(html, /name="command" required value="npm --prefix landing run start"/);
  assert.match(html, /data-edit-kept>[^<]*including the links \(1\) and the services it depends on \(api\)/);
  const same = { name: 'Landing', command: 'npm --prefix landing run start', ports: '4200', cwd: '.', open: '/', env: 'NODE_ENV', readyKind: 'port', readyPort: '4200', readyLog: '' };
  assert.deepEqual(JSON.parse(JSON.stringify(fx.patch(sv(), form(same)))), {}, 'nothing changed, nothing sent');
  assert.deepEqual(JSON.parse(JSON.stringify(fx.patch(sv(), form({ ...same, ports: '4202' })))), { ports: [4202] }, 'one field: links, dependencies and the rest are not in the request');
  assert.deepEqual(JSON.parse(JSON.stringify(fx.patch(sv(), form({ ...same, command: 'npm --prefix landing run start -- --host "my host"', readyKind: 'log', readyLog: 'compiled', env: 'NODE_ENV, PORT' })))), { argv: ['npm', '--prefix', 'landing', 'run', 'start', '--', '--host', 'my host'], env: ['NODE_ENV', 'PORT'], readyLog: 'compiled' });
  assert.deepEqual(JSON.parse(JSON.stringify(fx.patch(sv(), form({ ...same, readyKind: 'none', name: 'New' })))), { name: 'New', noReady: true });
});

test('a failure shows the cause line and says what it means; the text for the agent starts from it', () => {
  const fx = kit({ agentsOn: true });
  fx.tail['landing-start'] = ['    at Module._load (node:internal)', "  code: 'MODULE_NOT_FOUND',", '}', 'Node.js v22.11.0'];
  const dep = fx.fail(sv({ state: 'failed', failure: { line: "Error: Cannot find module '/w/landing/node_modules/@angular/cli/bin/ng.js'", kind: 'missing-module', module: 'dependency' }, prerequisites: { ok: false, problems: [{ code: 'DEPENDENCIES_MISSING', dir: 'landing', fix: FIX }] } }));
  assert.match(dep, /data-fail-why>A required package is not installed\. The fix is above\./);
  assert.match(dep, /svcfail-line" title="[^"]*" data-fail-cause="missing-module">Error: Cannot find module &#39;\/w\/landing\/node_modules\/@angular\/cli\/bin\/ng\.js&#39;</, 'the line with the missing file, not "Node.js v22"');
  assert.match(dep, /data-ready-chat="[^"]*The cause stated in the log: Error: Cannot find module[^"]*These are its last log lines/);
  assert.match(dep, /data-rt-logs="landing-start">View log</, 'the full log stays one click away');
  const wrongPath = fx.fail(sv({ state: 'failed', failure: { line: "Error: Cannot find module './dist/main.js'", kind: 'missing-module', module: 'project-file' } }));
  assert.match(wrongPath, /points to a file that does not exist in the project[^<]*this is not a missing dependency/);
  // without a recognised cause it is the last line, as before
  const plain = fx.fail(sv({ state: 'failed' }));
  assert.match(plain, /<span class="ltr svcfail-line" title="Node\.js v22\.11\.0">Node\.js v22\.11\.0<\/span>/);
  assert.ok(!/data-fail-why/.test(plain));
});

test('one place for run setup: Run holds the analysis and suggestions; Settings only defines a service by hand', () => {
  assert.match(app, /else services = profileError\(runtime\.data\) \+ addServicePanel\(\) \+ stackSection\(\);/);
  assert.match(app, /<h2>\$\{A\('تعريف الخدمات يدويًا', 'Define services manually'\)\}<\/h2>/);
  assert.doesNotMatch(app, /Advanced run setup|تعديل متقدم للتشغيل/);
  assert.match(app, /data-sx="run-more"[\s\S]{0,400}\$\{planSection\(r\)\}\$\{suggestionsPanel\(r\)\}<\/details>/);
  assert.equal((app.match(/\$\{planSection\(/g) ?? []).length, 1, 'the analysis is rendered in one place');
  assert.match(app, /\$\{changed\}\$\{needsBlock\(sv\)\}\$\{unknownNote\(sv\)\}\$\{portBlock\(sv\)\}\$\{editForm\(sv\)\}\$\{sv\.state === 'failed' \? failureBlock\(sv\) : ''\}/);
  assert.match(app, /readOnly \|\| running \? '' : `<button class="btn sm ghost" data-svc-edit=/, 'Edit is on the card, not while it runs');
  assert.match(app, /else if \(e\.code === 'PORT_IN_USE' && e\.data\?\.port\) rtFix\[id\] = \{/);
});

test('owner review: NEEDS_SETUP offers an Advanced "try anyway" (trusted services only); UNKNOWN is a note, never a block; a local change can be undone', () => {
  for (const lang of ['en', 'ar']) {
    const fx = kit({ lang });
    const missing = sv({ prerequisites: { state: 'NEEDS_SETUP', ok: false, problems: [{ code: 'DEPENDENCIES_MISSING', dir: 'landing', message: 'x', fix: FIX }] } });
    const html = fx.needs(missing);
    assert.match(html, /<details class="small svcanyway" data-svc-anyway="landing-start" data-sx="anyway:landing-start" ><summary>/, 'behind an Advanced disclosure');
    assert.match(html, /data-rt="start-anyway" data-id="landing-start"/);
    assert.match(html, lang === 'en' ? /Trust, folders and ports are still checked/ : /التوثيق والمجلدات والمنافذ ما زالت تُفحص/);
    assert.ok(!/data-rt="start-anyway"/.test(fx.needs({ ...missing, trust: { trusted: false } })), 'an untrusted service is reviewed first');
    assert.ok(!/data-rt="start-anyway"/.test(kit({ lang, readOnly: true }).needs(missing)));
    assert.equal(fx.needs({ ...missing, state: 'running' }), '');
    const unknown = (reason) => fx.unknown(sv({ prerequisites: { state: 'UNKNOWN', ok: true, problems: [], reason } }));
    assert.match(unknown('custom-module-path'), /data-svc-unknown="custom-module-path"/);
    assert.match(unknown('custom-module-path'), lang === 'en' ? /Starting is not blocked/ : /التشغيل غير ممنوع/);
    assert.ok(!/data-rt=/.test(unknown('yarn-pnp')), 'no action is needed or offered');
    assert.equal(unknown('unsupported-command'), '', 'a command the check does not apply to stays quiet');
    assert.equal(unknown('not-checked'), '');
    assert.equal(fx.unknown(sv({ prerequisites: { state: 'READY', ok: true, problems: [] } })), '');
    fx.editing['landing-start'] = { adv: false, error: null };
    assert.match(fx.edit(sv({ overridden: ['command', 'ports'] })), /data-svc-local-change[\s\S]*data-rt-reset="landing-start" data-fields="command, ports"/);
    assert.match(fx.edit(sv({ overridden: ['command', 'ports'] })), lang === 'en' ? /removes <b>all<\/b> of your local changes to this service \(listed above\), not only the port[\s\S]*Remove all local changes and return to the shared definition/ : /يحذف <b>كل<\/b> تعديلاتك المحلية على هذه الخدمة[\s\S]*احذف كل التعديلات المحلية/);
    assert.ok(!/data-rt-reset/.test(fx.edit(sv({ source: 'local', overridden: [] }))), 'a personal service has nothing to return to');
    assert.ok(!/data-rt-reset/.test(fx.edit(sv())));
  }
  assert.match(app, /if \(action === 'start-anyway'\) \{ body = \{ skipSetupCheck: true \}; action = 'start'; \}/);
  assert.match(app, /\[data-rt-reset\][\s\S]{0,200}!confirm\(/);
  assert.match(app, /Remove all of your local changes to \$\{id\}\?\\nRemoved: \$\{resetBtn\.dataset\.fields\}\\nNot only the port/);
  assert.match(app, /Other services still mention port \$\{fx\.port\} and were not changed/);
});
