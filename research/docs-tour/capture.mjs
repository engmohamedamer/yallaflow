// Screens for docs/tour.md and docs/tour.ar.md (PF-0074).
//
// Builds a disposable demo project ("Clinic Booking") under a temporary folder with an
// isolated console configuration, walks one simple request from Create work to DONE through
// the real CLI, prepares a runtime plan, and captures the console in English (light) and
// Arabic (dark). It never reads or touches a real project, the saved console project list,
// or the global install, and it downloads nothing.
//
// Usage:
//   node research/docs-tour/capture.mjs <playwright-core dir> [browser executable]
// Output: docs/images/tour/<name>-<en|ar>.png
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2]);
const executablePath = process.argv[3] || undefined;
const temp = mkdtempSync(path.join(os.tmpdir(), 'yf-docs-tour-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(temp, 'registry.json');
const { startConsoleServer } = await import(pathToFileURL(path.join(root, 'src/console/server.js')).href);
const out = path.join(root, 'docs/images/tour');
mkdirSync(out, { recursive: true });

const cli = (dir, args) => execFileSync(process.execPath, [path.join(root, 'src/cli.js'), ...args], { cwd: dir, env: process.env, encoding: 'utf8' });
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

// ---------------------------------------------------------------- the console
// It starts with no project: the first screen is the New project wizard.
const server = await startConsoleServer({ roots: [], port: 0, agents: true });
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(700); };
await page.goto(`${server.url}#token=${server.token}`);
await page.waitForTimeout(1200);

const closeDialogs = async () => {
  for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()); i++) {
    await page.locator('dialog[open] [data-cw-cancel]').first().click({ timeout: 2000 }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
};
async function look(lang, theme) {
  if ((await page.locator('html').getAttribute('lang')) !== lang) await page.locator('[data-lang]').first().click();
  const current = await page.evaluate(() => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  if (current !== theme) await page.locator('[data-theme-toggle]').first().click();
  await page.waitForTimeout(300);
}
// Each screen in English-light and Arabic-dark. `prep` puts the page in place; `target`
// (optional) is the element to frame; otherwise the visible viewport is captured.
async function shoot(name, prep, target = null) {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'dark']]) {
    await closeDialogs();
    await look(lang, theme);
    await prep(lang);
    await page.mouse.move(0, 0);
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    const file = path.join(out, `${name}-${lang}.png`);
    if (target) await page.locator(target).first().screenshot({ path: file, animations: 'disabled' });
    else await page.screenshot({ path: file, animations: 'disabled' });
    console.log('captured', path.relative(root, file));
  }
}

// 0. The New project wizard: an empty project, created by a human confirmation on the page.
const parent = path.join(temp, 'projects');
mkdirSync(parent);
const project = path.join(parent, 'clinic-booking');
const IDEA = { en: 'Online booking for a small clinic: patients pick a doctor and a time, and the clinic confirms.', ar: 'حجز أونلاين لعيادة صغيرة: المريض يختار الدكتور والميعاد، والعيادة تأكّد.' };
async function fillIdea(lang) {
  const f = page.locator('[data-wiz-step="1"]');
  await f.waitFor();
  await f.locator('input[name="name"]').fill('clinic-booking');
  await f.locator('textarea[name="description"]').fill(IDEA[lang]);
  const parentInput = f.locator('input[name="parent"]');
  if (!(await parentInput.isVisible())) await f.locator('summary', { hasText: /path|المسار|بنفسك/ }).first().click();
  await parentInput.fill(parent);
  await parentInput.press('Tab');
}
const next = async () => { await page.locator('form[data-wiz-step] button[type="submit"]').last().click(); await page.waitForTimeout(500); };
await shoot('00-new-project', async (lang) => { await go('#/new'); await fillIdea(lang); });
await look('en', 'light');
await fillIdea('en');
await next();
await page.locator('[data-wiz-step="2"]').waitFor();
await page.locator('[data-wiz-step="2"] .stackcard', { hasText: 'Empty project' }).first().click();
await next();
await page.locator('[data-wiz-step="3"]').waitFor();
await page.locator('[data-wiz-step="3"] .stackcard', { hasText: 'Local tools' }).first().click();
await next();
await page.locator('[data-wiz-create]').waitFor({ timeout: 30000 });
await shoot('00b-new-project-review', async () => { await page.locator('[data-wiz-create]').waitFor(); });
await page.locator('[data-wiz-create] button[type="submit"]').click();
// A successful creation opens the new project's Overview.
await page.waitForFunction(() => location.hash.startsWith('#/overview'), null, { timeout: 60000 });
await page.waitForTimeout(800);

// The code the developer and the agent write next (a tiny Node site and API).
writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'clinic-booking', private: true, engines: { node: '>=20' }, scripts: { web: 'node web/server.js', api: 'node api/server.js' } }, null, 2));
const webPort = await freePort();
const apiPort = await freePort();
mkdirSync(path.join(project, 'web'));
mkdirSync(path.join(project, 'api'));
writeFileSync(path.join(project, 'web/server.js'), "const http=require('http');const port=Number(process.argv[2]||5173);http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<h1>Clinic Booking</h1><p>Book a visit.</p>');}).listen(port,'127.0.0.1',()=>console.log('web ready on '+port));\n");
writeFileSync(path.join(project, 'api/server.js'), "const http=require('http');const port=Number(process.argv[2]||3000);http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({ok:true}));}).listen(port,'127.0.0.1',()=>console.log('api ready on '+port));\n");
writeFileSync(path.join(project, 'web/contact.html'), '<form><input name="name"><input name="email" type="email"><textarea name="message"></textarea></form>\n');

// The plan an agent would propose (read-only investigation → yallaflow runtime plan propose).
cli(project, ['runtime', 'analyze']);
const plan = {
  summary: 'Two local Node services: the API on its own port, and the web front end that calls it. Start the API first. No Docker, no database; nothing outside the project.',
  services: [
    { id: 'api', name: 'Booking API', kind: 'process', command: ['node', 'api/server.js', String(apiPort)], cwd: '.', env: [], ports: [apiPort], ready: { port: apiPort }, dependsOn: [], links: [{ label: 'API health', url: `http://127.0.0.1:${apiPort}/` }], confidence: 'confirmed', evidence: ['api/server.js', 'package.json#scripts.api'], notes: ['Listens on 127.0.0.1 only.'] },
    { id: 'web', name: 'Clinic website', kind: 'process', command: ['node', 'web/server.js', String(webPort)], cwd: '.', env: [], ports: [webPort], ready: { port: webPort }, dependsOn: ['api'], links: [{ label: 'Clinic website', url: `http://localhost:${webPort}/` }], confidence: 'confirmed', evidence: ['web/server.js', 'package.json#scripts.web'], notes: [] }
  ],
  unresolved: [{ item: 'Production hosting', reason: 'No deployment configuration in the repository; only local development is covered.' }]
};
const planFile = path.join(temp, 'plan.json');
writeFileSync(planFile, JSON.stringify(plan));
cli(project, ['runtime', 'plan', 'propose', '--file', planFile]);

await page.goto(`${server.url}#token=${server.token}`);
await page.waitForSelector('nav.tabs');
await go('#/overview');

// 1. A new project: the setup checklist on Overview.
await shoot('01-overview', async () => { await closeDialogs(); await go('#/overview'); });

// 2. Create work: the request in the developer's own words.
const REQUEST = { en: 'Add a "work email" field to the contact form, filled in by the visitor.', ar: 'ضيف خانة «إيميل العمل» في فورم تواصل معنا، والزائر هو اللي يكتبها.' };
await shoot('02-create-work', async (lang) => {
  await closeDialogs(); await go('#/lines');
  await page.locator('[data-create]').first().click();
  await page.locator('dialog[open] textarea[name="request"]').fill(REQUEST[lang]);
}, 'dialog[open]');
await page.locator('dialog[open] textarea[name="request"]').fill(REQUEST.en);
await page.locator('dialog[open] [data-create-form] button[type="submit"]').click();
await page.waitForTimeout(1200);
await closeDialogs();
// The wizard already opened PF-0001 from the idea; the request is the newest work item.
const { readdirSync } = await import('node:fs');
const id = readdirSync(path.join(project, '.yallaflow/work')).filter((x) => /^PF-\d+$/.test(x)).sort().at(-1);
console.log('request work item:', id);

// 3. The agent routes it and works through the checkpoints (the real CLI, as an agent would).
cli(project, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--title', 'Add a work email field to the contact form', '--reason', 'A small form change: one optional input, validated as an email, and included in the message to support.']);
cli(project, ['advance', id]);
cli(project, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'The contact form is web/contact.html; messages go to support by email. No database change is needed.', '--evidence', 'web/contact.html']);
cli(project, ['advance', id]);
cli(project, ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'A new optional "work email" input that the visitor fills in; a value must be a valid email.', '--evidence', 'user:the visitor enters the work email']);
for (let i = 0; i < 3; i++) { try { cli(project, ['advance', id]); } catch {} }
cli(project, ['checkpoint', id, '--skill', 'implementation-planning', '--complete', '--summary', 'Add the input after the email field, validate it as an email, and include it in the support message.']);
cli(project, ['advance', id]);
writeFileSync(path.join(project, 'web/contact.html'), '<form><input name="name"><input name="email" type="email"><input name="work_email" type="email" placeholder="Work email"><textarea name="message"></textarea></form>\n');
cli(project, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'Added the optional work_email input (type=email) after the email field.', '--evidence', 'web/contact.html']);
cli(project, ['advance', id]);

// 4. Mid-flow: the board and the item, while verification is next.
await shoot('03-work-board', async () => { await go('#/lines'); });
await shoot('04-item-in-progress', async () => { await go(`#/item/${id}`); });

// 5. Verified and finished.
cli(project, ['verify', id, '--', process.execPath, '-e', "const s=require('fs').readFileSync('web/contact.html','utf8');if(!/name=\"work_email\" type=\"email\"/.test(s))process.exit(1);console.log('work_email input present')"]);
cli(project, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'The form has the work_email input with email validation (V-001).', '--evidence', 'verification:V-001']);
cli(project, ['knowledge', 'review', id, '--none']);
cli(project, ['advance', id]);
await shoot('05-item-done', async () => { await go('#/overview'); await go(`#/item/${id}`); });
await shoot('06-flow', async () => { await go('#/map'); });

// 6. Setup, first time: the agent's proposal arrives preselected.
// (When the agent's proposal arrives while the page waits for it, it comes preselected.)
await shoot('07-setup-plan', async () => {
  await go('#/setup'); await page.locator('#setup-plan').waitFor();
  for (const sid of ['api', 'web']) { const box = page.locator(`[data-plan-pick="${sid}"]`); if (!(await box.isChecked())) await box.check(); }
  await page.locator('[data-plan-save]:not([disabled])').waitFor();
}, '#setup-plan');
// Save the proposal (untrusted), review and trust each service, then start the project.
await go('#/setup');
await page.locator('[data-plan-pick="api"]').check().catch(() => {});
await page.locator('[data-plan-pick="web"]').check().catch(() => {});
await page.locator('[data-plan-save]').click();
await page.locator('#setup-run').waitFor();
// The services are chosen: the first-time guide is done for this demo.
await page.locator('[data-setup-step="skip"]').click().catch(() => {});
await page.waitForTimeout(800);
await page.locator('[data-rt-review="api"]').click();
await page.locator('[data-review="api"]').waitFor();
await shoot('08-setup-trust', async () => { await go('#/setup'); if (!(await page.locator('[data-review="api"]').count())) { await page.locator('[data-rt-review="api"]').click(); await page.locator('[data-review="api"]').waitFor(); } }, '#setup-run');
for (const sid of ['api', 'web']) {
  if (!(await page.locator(`[data-review="${sid}"]`).count())) { await page.locator(`[data-rt-review="${sid}"]`).click(); await page.locator(`[data-review="${sid}"]`).waitFor(); }
  await page.locator(`[data-trust-input="${sid}"]`).fill(sid);
  await page.locator(`[data-review="${sid}"] [data-rt="trust"]`).click();
  await page.locator(`[data-service="${sid}"] [data-rt="start"]`).waitFor();
}
await page.locator('[data-rt-all="start"]').click();
await page.locator('[data-service="web"] [data-svc-state="running"]').waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
await shoot('09-setup-running', async () => { await go('#/setup'); await page.locator('[data-service="web"] [data-svc-state="running"]').waitFor(); });

// 7. The same Run control on a phone.
await page.setViewportSize({ width: 390, height: 844 });
await shoot('10-setup-mobile', async () => { await go('#/setup'); await page.locator('#setup-run').waitFor(); });

// Stop what the demo started, then clean up.
await page.setViewportSize({ width: 1360, height: 860 });
await look('en', 'light');
await page.locator('[data-rt-all="stop"]').click().catch(() => {});
await page.waitForTimeout(2500);
await browser.close();
await server.close();
try { cli(project, ['runtime', 'stop', '--all']); } catch {}
rmSync(temp, { recursive: true, force: true });
console.log('done:', path.relative(root, out));
