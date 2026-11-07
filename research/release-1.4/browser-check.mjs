// 1.4.0 browser regression against disposable projects only (never a real project).
// Usage: node research/release-1.4/browser-check.mjs <playwright-core dir> [chromium|firefox|webkit] [only]
// Uses already-installed browsers; never downloads anything. Screenshots go to
// research/release-1.4/screenshots/<engine>-<name>.png.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
