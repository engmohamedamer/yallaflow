// PF-0159: the developer's preferences on this machine: preferences.json beside console.json.
// Only known, typed fields; never a credential; private to the user; defaults when missing or
// unreadable; console.json and project settings untouched; a read-only console never writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { loadPreferences, savePreferences, preferencesPath, validatePreferencesPatch, DEFAULT_PREFERENCES } from '../src/console/preferences.js';
import { addProject, loadRegistry, registryPath } from '../src/console/registry.js';
import { initWorkspace } from '../src/core/workspace.js';
import { startConsoleServer } from '../src/console/server.js';

const POSIX = process.platform !== 'win32';
const tmp = (prefix) => mkdtemp(path.join(os.tmpdir(), prefix));
const defaults = { language: null, theme: null, preferredAgent: null, lastFolder: null, saveChatHistory: null, onboarding: { completed: false, intent: null } };

test('the file lives beside console.json on Linux, macOS and Windows (simulated environment values)', () => {
  assert.equal(preferencesPath({ YALLAFLOW_CONSOLE_CONFIG: '/x/y/console.json' }), path.join('/x/y', 'preferences.json'));
  assert.equal(path.dirname(preferencesPath({ XDG_CONFIG_HOME: '/home/u/.config' })), path.dirname(registryPath({ XDG_CONFIG_HOME: '/home/u/.config' })));
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)), defaults);
});

test('missing, invalid, oversized or linked files mean defaults; reading never throws', async () => {
  const dir = await tmp('yf-prefs-');
  const file = path.join(dir, 'preferences.json');
  assert.deepEqual(await loadPreferences(file), { ...defaults, saved: false });
  await writeFile(file, '{ not json');
  const broken = await loadPreferences(file);
  assert.deepEqual({ ...broken, problem: undefined }, { ...defaults, saved: false, problem: undefined });
  assert.match(broken.problem, /ignored/);
  await writeFile(file, JSON.stringify(['a']));
  assert.equal((await loadPreferences(file)).saved, false);
  // invalid values are dropped one by one; valid ones are kept
  await writeFile(file, JSON.stringify({ language: 'fr', theme: 'dark', preferredAgent: 'gpt', lastFolder: 'relative/path', onboarding: { completed: 'yes', intent: 'monitor' } }));
  assert.deepEqual(await loadPreferences(file), { ...defaults, theme: 'dark', onboarding: { completed: false, intent: 'monitor' }, saved: true });
  if (POSIX) {
    const target = path.join(dir, 'elsewhere.json');
    await writeFile(target, JSON.stringify({ language: 'en' }));
    const link = path.join(dir, 'link', 'preferences.json');
    await mkdir(path.dirname(link));
    await symlink(target, link);
    assert.equal((await loadPreferences(link)).language, null, 'a link is never read');
    await savePreferences({ theme: 'light' }, link);
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { language: 'en' }, 'a save replaces the link, never writes through it');
    assert.equal((await loadPreferences(link)).theme, 'light');
  }
});

test('only known, typed fields can be saved: no free-form value, so no credential', async () => {
  for (const bad of [null, [], 'x', { token: 'abc' }, { apiKey: 'sk-123' }, { language: 'sk-123' }, { theme: 'blue' }, { preferredAgent: 'claude --dangerously' }, { preferredAgent: { name: 'codex' } },
    { lastFolder: 'not/absolute' }, { lastFolder: '/a\nb' }, { lastFolder: `/${'a'.repeat(5000)}` }, { lastFolder: '' }, { onboarding: 'done' }, { onboarding: { secret: 'x' } }, { onboarding: { completed: 1 } }, { onboarding: { intent: 'hack' } }, { schemaVersion: 9 }]) {
    assert.throws(() => validatePreferencesPatch(bad), { code: 'BAD_PREFERENCES', status: 400 }, JSON.stringify(bad));
  }
  assert.deepEqual(validatePreferencesPatch({ language: 'ar', theme: null, preferredAgent: 'claude', lastFolder: 'C:\\Users\\Mona Ali\\code', onboarding: { completed: true, intent: 'create' } }),
    { language: 'ar', theme: null, preferredAgent: 'claude', lastFolder: 'C:\\Users\\Mona Ali\\code', onboarding: { completed: true, intent: 'create' } });
});

test('saving merges, is private (0600), keeps keys a newer version wrote, and leaves console.json alone', async () => {
  const dir = await tmp('yf-prefs-');
  const file = path.join(dir, 'sub', 'preferences.json');
  const registry = path.join(dir, 'sub', 'console.json');
  const project = await tmp('yf-prefs-project-');
  await initWorkspace(project, 'P', 'greenfield', 'adaptive');
  await addProject(project, registry);
  const before = await readFile(registry, 'utf8');

  assert.deepEqual(await savePreferences({ language: 'en', preferredAgent: 'codex' }, file), { ...defaults, language: 'en', preferredAgent: 'codex', saved: true });
  assert.deepEqual(await savePreferences({ onboarding: { intent: 'manage' } }, file), { ...defaults, language: 'en', preferredAgent: 'codex', onboarding: { completed: false, intent: 'manage' }, saved: true });
  assert.deepEqual((await savePreferences({ onboarding: { completed: true }, preferredAgent: null, lastFolder: '/home/u/code' }, file)).onboarding, { completed: true, intent: 'manage' });
  if (POSIX) assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(path.dirname(file))).sort(), ['console.json', 'preferences.json'], 'no temporary file is left');
  assert.equal(await readFile(registry, 'utf8'), before, 'console.json is not touched');
  // a key from a newer YallaFlow survives a save by this one
  const stored = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...stored, futureSetting: { a: 1 } }));
  await savePreferences({ theme: 'dark' }, file);
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(after.futureSetting, { a: 1 });
  assert.equal(after.schemaVersion, 1);
  assert.ok(!JSON.stringify(after).match(/token|secret|password|api.?key/i));
  // the registry, saved again by any console version, does not lose the preferences
  await addProject(await (async () => { const other = await tmp('yf-prefs-project-'); await initWorkspace(other, 'Q', 'greenfield', 'adaptive'); return other; })(), registry);
  assert.equal((await loadRegistry(registry)).projects.length, 2);
  assert.equal((await loadPreferences(file)).theme, 'dark');
  await assert.rejects(savePreferences({ nope: 1 }, file), { code: 'BAD_PREFERENCES' });
});

test('console API: read anywhere, write only as JSON with the token and Origin, never read-only', async (t) => {
  const home = await tmp('yf-prefs-home-');
  await initWorkspace(home, 'Home', 'greenfield', 'adaptive');
  const saved = process.env.YALLAFLOW_CONSOLE_CONFIG;
  process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(await tmp('yf-prefs-cfg-'), 'console.json');
  const server = await startConsoleServer({ roots: [home], port: 0 });
  const readOnly = await startConsoleServer({ roots: [home], port: 0, readOnly: true });
  t.after(async () => { await server.close(); await readOnly.close(); if (saved === undefined) delete process.env.YALLAFLOW_CONSOLE_CONFIG; else process.env.YALLAFLOW_CONSOLE_CONFIG = saved; });
  const auth = { Authorization: `Bearer ${server.token}` };
  const headers = { ...auth, Origin: server.url.replace(/\/$/, ''), 'Content-Type': 'application/json' };
  const post = (body, extra = {}) => fetch(`${server.url}api/preferences`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });

  assert.equal((await fetch(`${server.url}api/preferences`)).status, 401);
  assert.deepEqual(await (await fetch(`${server.url}api/preferences`, { headers: auth })).json(), { ...defaults, saved: false, readOnly: false });
  assert.equal((await post({ language: 'en' }, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await post({ language: 'en' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ language: 'en' }, { Authorization: 'Bearer wrong' })).status, 401);
  const refused = await post({ apiKey: 'sk-live-123' });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error.code, 'BAD_PREFERENCES');
  const ok = await post({ language: 'en', theme: 'dark', preferredAgent: 'codex', lastFolder: home, onboarding: { completed: true, intent: 'create' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { language: 'en', theme: 'dark', preferredAgent: 'codex', lastFolder: home, saveChatHistory: null, onboarding: { completed: true, intent: 'create' }, saved: true });
  // a second console (another port, a restart) reads the same preferences; a read-only one never writes
  const seen = await (await fetch(`${readOnly.url}api/preferences`, { headers: { Authorization: `Bearer ${readOnly.token}` } })).json();
  assert.deepEqual({ language: seen.language, theme: seen.theme, readOnly: seen.readOnly }, { language: 'en', theme: 'dark', readOnly: true });
  const denied = await fetch(`${readOnly.url}api/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${readOnly.token}`, Origin: readOnly.url.replace(/\/$/, ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'ar' }) });
  assert.equal(denied.status, 405);
  assert.equal((await loadPreferences()).language, 'en');
});

// ---- the page (evaluated from the shipped app.js with minimal stand-ins) ----
const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const cut = (from, to) => { const start = app.indexOf(from); assert.ok(start >= 0, from); const end = app.indexOf(to, start); assert.ok(end > start, to); return app.slice(start, end); };

test('the page: saved preferences win over the browser copy; a browser choice is carried over once; read-only saves nothing', async () => {
  const run = async ({ server, browser, readOnly = false }) => {
    const local = new Map(Object.entries(browser));
    const posts = [];
    const context = vm.createContext({
      Object, JSON, Promise,
      store: { get: (k, d) => (local.has(k) ? local.get(k) : d), set: (k, v) => local.set(k, v) },
      api: async () => ({ ...server, readOnly }),
      post: async (_path, body) => { posts.push(JSON.parse(body)); return { ...server, ...JSON.parse(body), saved: true }; },
      lang: local.get('lang') ?? 'ar', theme: local.get('theme') ?? null, prefs: null
    });
    vm.runInContext(`${cut('  async function loadPrefs() {', '  (async () => {')}; globalThis.go = async () => { await loadPrefs(); return { lang, theme, prefs }; }; globalThis.save = savePrefs;`, context);
    const state = await context.go();
    await new Promise((resolve) => setImmediate(resolve));
    return { state, posts, local, save: context.save };
  };
  const returning = await run({ server: { language: 'en', theme: 'dark', saved: true }, browser: { lang: 'ar' } });
  assert.deepEqual({ lang: returning.state.lang, theme: returning.state.theme }, { lang: 'en', theme: 'dark' });
  assert.deepEqual(returning.posts, [], 'nothing to carry over');
  assert.equal(returning.local.get('lang'), 'en');
  const upgrade = await run({ server: { language: null, theme: null, saved: false }, browser: { lang: 'en', theme: 'dark' } });
  assert.deepEqual(upgrade.posts, [{ language: 'en', theme: 'dark' }], 'the browser choice moves into preferences.json');
  const fresh = await run({ server: { language: null, theme: null, saved: false }, browser: {} });
  assert.deepEqual(fresh.posts, [], 'a default language is not saved as a choice');
  assert.equal(fresh.state.lang, 'ar');
  const ro = await run({ server: { language: null, theme: null }, browser: { lang: 'en' }, readOnly: true });
  assert.deepEqual(ro.posts, []);
  assert.equal(await ro.save({ theme: 'dark' }), null);
});
