// 1.4.0 browser regression against disposable projects only (never a real project).
// Usage: node research/release-1.4/browser-check.mjs <playwright-core dir> [chromium|firefox|webkit] [only]
// Uses already-installed browsers; never downloads anything. Screenshots go to
// research/release-1.4/screenshots/<engine>-<name>.png.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const playwright = require(process.argv[2]);
const engine = process.argv[3] || 'chromium';
const only = process.argv[4] || null;
const temp = mkdtempSync(path.join(os.tmpdir(), 'yf-browser-1.4-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(temp, 'registry.json');
const { initWorkspace } = await import(pathToFileURL(path.join(root, 'src/core/workspace.js')).href);
const { startConsoleServer } = await import(pathToFileURL(path.join(root, 'src/console/server.js')).href);
const output = path.join(root, 'research/release-1.4/screenshots');
mkdirSync(output, { recursive: true });

async function laravel() {
  const dir = mkdtempSync(path.join(temp, 'shop-'));
  await initWorkspace(dir, 'Shop', 'brownfield', 'adaptive');
  writeFileSync(path.join(dir, 'composer.json'), JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^11.9' } }));
  writeFileSync(path.join(dir, 'composer.lock'), '{}');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=20' }, devDependencies: { vite: '^5.0.0' } }));
  writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  db:\n    image: mysql:8.0\n  cache:\n    image: redis:7\n');
  mkdirSync(path.join(dir, 'app'));
  for (const name of ['User.php', 'Order.php']) writeFileSync(path.join(dir, 'app', name), '<?php\n');
  // A reviewed runtime service (Node on a free loopback port) for the Setup checks.
  mkdirSync(path.join(dir, 'web'));
  writeFileSync(path.join(dir, 'web', 'server.js'), "const http=require('http');console.log('booting token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');http.createServer((q,r)=>r.end('ok')).listen(Number(process.argv[2]),'127.0.0.1',()=>console.log('listening'));");
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  execFileSync(process.execPath, [path.join(root, 'src/cli.js'), 'runtime', 'add', 'web', '--name', 'Web app', '--cwd', 'web', '--port', String(port), '--ready-port', String(port), '--', 'node', 'server.js', String(port)], { cwd: dir, env: process.env });
  return dir;
}

const results = [];
const errors = [];
// The console remembers language and theme; set them explicitly.
async function setLang(page, lang) {
  if ((await page.locator('html').getAttribute('lang')) !== lang) await page.locator('[data-lang]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), lang);
}
async function setTheme(page, theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  if (current !== theme) await page.locator('[data-theme-toggle]').click();
}
const checks = {
  async overview(page, server) {
    await page.goto(`${server.url}#token=${server.token}`);
    await page.locator('nav.tabs a[href="#/overview"]').click();
    await page.locator('table.stack').waitFor();
    await setLang(page, 'en');
    await setTheme(page, 'light');
    assert.match(await page.locator('[data-understanding]').first().getAttribute('data-understanding'), /REQUIRED/);
    assert.ok(await page.getByText('Laravel', { exact: true }).first().isVisible());
    assert.equal(await page.locator('[data-understanding] button').count(), 0, 'no control starts or approves onboarding');
    await page.screenshot({ path: path.join(output, `${engine}-overview-en.png`), fullPage: true });
    await setLang(page, 'ar');
    await page.locator('table.stack').waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    await setTheme(page, 'dark');
    await page.screenshot({ path: path.join(output, `${engine}-overview-ar-dark.png`), fullPage: true });
    await setLang(page, 'en');
    await setTheme(page, 'light');
    await page.locator('nav.tabs a[href="#/map"]').click();
    await page.waitForFunction(() => location.hash === '#/map' && document.querySelector('nav.tabs a[href="#/map"]')?.getAttribute('aria-current') === 'page');
    await page.locator('[data-understanding] a[href="#/overview"]').waitFor();
    await page.screenshot({ path: path.join(output, `${engine}-flow-onboarding-strip.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('nav.tabs a[href="#/overview"]').click();
    await page.locator('table.stack').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `no horizontal page scroll on mobile (overflow ${overflow}px)`);
    await page.screenshot({ path: path.join(output, `${engine}-overview-mobile.png`), fullPage: true });
  }
};

checks.setup = async (page, server) => {
  await page.goto(`${server.url}#token=${server.token}`);
  await setLang(page, 'en');
  await setTheme(page, 'light');
  await page.locator('nav.tabs a[href="#/setup"]').click();
  const card = page.locator('[data-service="web"]');
  await card.waitFor();
  assert.equal(await card.locator('[data-svc-state]').getAttribute('data-svc-state'), 'stopped', 'opening Setup starts nothing');
  assert.ok(await card.locator('[data-rt="start"]').isDisabled(), 'start is disabled until trusted');
  await page.screenshot({ path: path.join(output, `${engine}-setup-untrusted.png`), fullPage: true });
  await card.locator('[data-trust-input="web"]').fill('wrong');
  await card.locator('[data-rt="trust"]').click();
  await card.locator('[role="alert"]').waitFor();
  await card.locator('[data-trust-input="web"]').fill('web');
  await card.locator('[data-rt="trust"]').click();
  await page.locator('[data-service="web"] [data-rt="start"]:not([disabled])').waitFor();
  await page.locator('[data-service="web"] [data-rt="start"]').click();
  await page.locator('[data-service="web"] [data-svc-state="running"]').waitFor({ timeout: 30000 });
  await page.locator('[data-service="web"] [data-rt-logs="web"]').click();
  await page.locator('[data-service="web"] .svclog').waitFor();
  const log = await page.locator('[data-service="web"] .svclog').innerText();
  assert.match(log, /listening/);
  assert.doesNotMatch(log, /ghp_ABCDEFGHIJ/, 'the log view is redacted');
  await page.screenshot({ path: path.join(output, `${engine}-setup-running-en.png`), fullPage: true });
  await setLang(page, 'ar');
  await setTheme(page, 'dark');
  await page.locator('[data-service="web"]').waitFor();
  await page.screenshot({ path: path.join(output, `${engine}-setup-running-ar-dark.png`), fullPage: true });
  await setLang(page, 'en');
  await setTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-service="web"]').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no horizontal page scroll on mobile (overflow ${overflow}px)`);
  await page.screenshot({ path: path.join(output, `${engine}-setup-mobile.png`), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-service="web"] [data-rt="stop"]').click();
  await page.locator('[data-service="web"] [data-svc-state="stopped"]').waitFor({ timeout: 30000 });
};

checks.wizard = async (page, server) => {
  const parent = mkdtempSync(path.join(temp, 'new-parent-'));
  mkdirSync(path.join(parent, 'taken'));
  await page.goto(`${server.url}#token=${server.token}`);
  await setLang(page, 'en');
  await setTheme(page, 'light');
  await page.goto(`${server.url}#/projects`);
  await page.locator('a[href="#/new"]').click();
  const form = page.locator('[data-wiz-form]');
  await form.waitFor();
  await form.locator('input[name="name"]').fill('taken');
  await form.locator('input[name="parent"]').fill(parent);
  await form.locator('.stackcard', { hasText: 'Empty project' }).click();
  await page.screenshot({ path: path.join(output, `${engine}-wizard-form.png`), fullPage: true });
  await form.locator('button[type="submit"]').click();
  await page.locator('.errbar[role="alert"]').waitFor();
  assert.match(await page.locator('.errbar[role="alert"]').innerText(), /already exists/);
  await page.locator('[data-wiz-form] input[name="name"]').fill('demo-app');
  await page.locator('[data-wiz-form] button[type="submit"]').click();
  const confirm = page.locator('[data-wiz-create]');
  await confirm.waitFor();
  assert.ok(await page.getByText('What runs, in order').isVisible());
  await page.screenshot({ path: path.join(output, `${engine}-wizard-review.png`), fullPage: true });
  await confirm.locator('input[name="confirm"]').fill('00000000');
  await confirm.locator('button[type="submit"]').click();
  await page.locator('.errbar[role="alert"]').waitFor();
  const hash = (await page.locator('[data-wiz-create] b.mono').innerText()).trim();
  await page.locator('[data-wiz-create] input[name="confirm"]').fill(hash);
  await page.locator('[data-wiz-create] button[type="submit"]').click();
  await page.locator('[data-wiz-done]').waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(output, `${engine}-wizard-done.png`), fullPage: true });
  await setLang(page, 'ar');
  await setTheme(page, 'dark');
  await page.locator('[data-wiz-done]').waitFor();
  await page.screenshot({ path: path.join(output, `${engine}-wizard-done-ar-dark.png`), fullPage: true });
  await setLang(page, 'en');
  await setTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no horizontal page scroll on mobile (overflow ${overflow}px)`);
  await page.screenshot({ path: path.join(output, `${engine}-wizard-mobile.png`), fullPage: true });
  const config = JSON.parse(readFileSync(path.join(parent, 'demo-app', '.yallaflow', 'config.yaml'), 'utf8'));
  assert.equal(config.project.origin.createdBy, 'yallaflow new');
};

const browser = await playwright[engine].launch({ headless: true });
try {
  const project = await laravel();
  const server = await startConsoleServer({ roots: [project], port: 0 });
  try {
    for (const [name, check] of Object.entries(checks)) {
      if (only && only !== name) continue;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
      try {
        await check(page, server);
        results.push({ name, ok: true });
      } catch (error) {
        results.push({ name, ok: false, error: error.message });
        await page.screenshot({ path: path.join(output, `${engine}-${name}-failure.png`), fullPage: true }).catch(() => {});
      }
      await context.close();
    }
  } finally {
    await server.close();
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(output, `${engine}-results.json`), `${JSON.stringify({ engine, results, pageErrors: errors }, null, 2)}\n`);
console.log(JSON.stringify({ engine, results, pageErrors: errors }, null, 2));
if (errors.length || results.some((result) => !result.ok)) process.exitCode = 1;
