// Real-project screens for the website (PF-0080).
//
// Opens a READ-ONLY console on an existing YallaFlow project (isolated console configuration;
// the project is never registered, and the read-only console has no write route) and
// captures Flow, Work, Insights, Overview and one work item in English (light) and
// Arabic (dark). Every file under the project's .yallaflow/ is hashed before and after, and
// the run fails if anything changed.
//
// Usage:
//   node research/docs-tour/capture-real.mjs <playwright-core dir> <project dir> <work item id> <out dir> [browser executable]
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const [pwDir, project, itemId, out, executablePath] = process.argv.slice(2);
const { chromium } = require(pwDir);
const temp = mkdtempSync(path.join(os.tmpdir(), 'yf-real-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(temp, 'registry.json');
const { startConsoleServer } = await import(pathToFileURL(path.join(root, 'src/console/server.js')).href);
mkdirSync(out, { recursive: true });

function fingerprint(dir) {
  const hashes = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else hashes[path.relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return hashes;
}
const before = fingerprint(path.join(project, '.yallaflow'));

const server = await startConsoleServer({ roots: [project], port: 0, readOnly: true });
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const go = async (hash, wait) => { await page.evaluate((h) => { location.hash = h; }, hash); if (wait) await page.locator(wait).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1200); };
await page.goto(`${server.url}#token=${server.token}`);
await page.waitForSelector('nav.tabs');
async function look(lang, theme) {
  if ((await page.locator('html').getAttribute('lang')) !== lang) await page.locator('[data-lang]').first().click();
  const current = await page.evaluate(() => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  if (current !== theme) await page.locator('[data-theme-toggle]').first().click();
  await page.waitForTimeout(300);
}
const shots = [
  ['real-flow', '#/map', '.station, .node'],
  ['real-work', '#/lines', '.line'],
  ['real-insights', '#/insights', 'main'],
  ['real-overview', '#/overview', 'main'],
  ['real-item', `#/item/${itemId}`, 'main']
];
for (const [lang, theme] of [['en', 'light'], ['ar', 'dark']]) {
  await look(lang, theme);
  for (const [name, hash, wait] of shots) {
    await go(hash, wait);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(out, `${name}-${lang}.png`), animations: 'disabled' });
    console.log('captured', `${name}-${lang}.png`);
  }
}
await browser.close();
await server.close();

const after = fingerprint(path.join(project, '.yallaflow'));
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
rmSync(temp, { recursive: true, force: true });
if (changed.length) { console.error('PROJECT CHANGED:', changed); process.exit(1); }
console.log(`project .yallaflow unchanged (${Object.keys(after).length} files)`);
