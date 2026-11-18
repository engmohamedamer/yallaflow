// PF-0177 (W6a): the Run page on a system where some actions are not available. Nothing is
// hidden behind an "unsupported" page: services, review and logs stay, and only what the system
// cannot do is left out, with the reason. Evaluated from the shipped app.js with minimal stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const caps = { win32: { platform: 'win32', lifecycle: true, compose: false, gracefulStop: false, verified: false }, linux: { platform: 'linux', lifecycle: true, compose: true, gracefulStop: true, verified: true }, freebsd: { platform: 'freebsd', lifecycle: false, compose: false, gracefulStop: false, verified: false } };

function kit({ lang = 'en', platform = 'win32' } = {}) {
  const data = { supported: platform !== 'freebsd', capabilities: caps[platform], services: [] };
  const context = vm.createContext({
    A: (ar, en) => (lang === 'ar' ? ar : en), L: (v) => (lang === 'ar' ? v.ar : v.en), esc, JSON, Set,
    readOnly: false, pid: 'p1', runtime: { pid: 'p1', data }, runtimeBusy: {}, runtimeLogs: {}, runtimeErr: {}, runtimeReview: {},
    route: () => ({ v: 'run' }), bulkable: () => [], openLinks: () => '', needsBlock: () => '', unknownNote: () => '', portBlock: () => '', editForm: () => '', failureBlock: () => '', reviewPanel: () => '', sharedConfirm: () => '', savedChip: () => '', sxOpen: () => '',
    runsOutside: (sv) => Boolean(sv.runningOutside?.length) && !['running', 'starting'].includes(sv.state)
  });
  vm.runInContext(`${cut('  const RT_STATE = {', '  };')}  };
    ${cut('  // PF-0177: what this system can do from the Run page', '  const profileError =')}
    ${cut('  function serviceCard(sv) {', '  // ---------- Analyze → Review and save')}
    globalThis.fx = { card: serviceCard, note: runtimePlatformNote, caps: runtimeCaps };`, context);
  return { fx: context.fx, data };
}
const sv = (extra = {}) => ({ id: 'web', name: 'Web', kind: 'process', state: 'stopped', trust: { trusted: true }, ports: [], unmanagedPorts: [], command: ['npm', 'run', 'dev'], cwd: '.', env: [], overridden: [], dependsOn: [], definitionHash: 'sha256:x', ...extra });

test('Windows: a trusted service can be started and stopped; a running one says that Stop is forceful', () => {
  for (const lang of ['en', 'ar']) {
    const { fx } = kit({ lang });
    assert.match(fx.card(sv()), /data-rt="start"/);
    const running = fx.card(sv({ state: 'running' }));
    assert.match(running, /data-rt="stop"/);
    assert.match(running, /data-rt="restart"/);
    assert.match(running, lang === 'en' ? /data-forced-stop>On Windows, Stop ends this service and the programs it started at once/ : /data-forced-stop>على Windows/);
  }
  assert.doesNotMatch(kit({ platform: 'linux' }).fx.card(sv({ state: 'running' })), /data-forced-stop/, 'Linux stops gracefully: no note');
});

test('Windows: a Docker Compose service shows why it is not started here and offers no Start or Stop', () => {
  for (const lang of ['en', 'ar']) {
    const html = kit({ lang }).fx.card(sv({ id: 'db', kind: 'docker-compose', unsupported: 'compose-windows' }));
    assert.match(html, /data-svc-unsupported="compose"/);
    assert.match(html, /data-compose-windows/);
    assert.match(html, /docker compose up/);
    assert.doesNotMatch(html, /data-rt="(start|stop|restart)"/);
    assert.match(html, /data-rt-logs="db"/, 'its log and definition are still there');
  }
});

test('the platform note: what is not verified, the forceful stop and Compose on Windows; nothing on Linux; no lifecycle on an unknown system', () => {
  const win = kit();
  const note = win.fx.note(win.data);
  assert.match(note, /not yet verified on a real machine/);
  assert.match(note, /Stop ends the service and the programs it started at once/);
  assert.match(note, /Docker Compose services are not started from YallaFlow on Windows yet/);
  const linux = kit({ platform: 'linux' });
  assert.equal(linux.fx.note(linux.data), '');
  const other = kit({ platform: 'freebsd' });
  assert.match(other.fx.note(other.data), /data-run-platform="no-lifecycle"[\s\S]*see, define and review services here/);
  const html = other.fx.card(sv());
  assert.match(html, /data-svc-unsupported="lifecycle"/);
  assert.doesNotMatch(html, /data-rt="start"/);
  // An older server without capabilities: derived from `supported`.
  assert.equal(other.fx.caps({ supported: true }).lifecycle, true);
  assert.equal(other.fx.caps({ supported: false }).lifecycle, false);
});

test('the Run page is never replaced by an "unsupported" page; an empty project shows its own empty state first', () => {
  const view = cut('  function viewRun() {', '  // Settings: a section menu');
  assert.doesNotMatch(app, /runtimeUnsupported|Linux and macOS only/);
  assert.doesNotMatch(view, /!r\.supported\)/);
  assert.ok(view.indexOf('if (!r.services.length)') > 0);
  assert.match(view, /runtimePlatformNote\(r\)/);
  assert.match(cut('  function runSection(', '  // ---------- agent setup on this machine'), /!runtimeCaps\(r\)\.lifecycle/);
});
