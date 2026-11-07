// Browser acceptance against extracted packages and disposable projects only.
// Pass a local playwright-core directory and installed browser; never downloads tools.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const playwright = require(process.argv[2]);
const engine = process.argv[3] || 'chromium';
const executablePath = process.argv[4];
assert(playwright[engine], 'Choose a supported browser engine');
const temp = mkdtempSync(path.join(os.tmpdir(), 'yf-browser-review-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(temp, 'registry.json');
const output = path.join(root, 'research/release-review/screenshots');
mkdirSync(output, { recursive: true });
const artifact = JSON.parse(readFileSync(path.join(root, 'research/release-review/artifacts/verification.json')));
const results = [];
const errors = [];
const browser = await playwright[engine].launch({ headless: true, executablePath });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, 'research/workspace-evolution/prototype.html')).href);
  assert(await page.locator('#overview').isVisible());
  for (const view of ['flow', 'agent', 'evidence', 'setup', 'wizard', 'overview']) {
    await page.locator(`nav [data-view="${view}"]`).click();
    assert(await page.locator(`#${view}`).isVisible());
  }
  await page.screenshot({ path: path.join(output, `${engine}-prototype-overview.png`), fullPage: true });
  await page.locator('#theme').click();
  await page.locator('nav [data-view="setup"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('#baseline').selectOption('missing');
  assert.match(await page.locator('#baseline-copy').innerText(), /No approved understanding/);
  await page.locator('#start-service').click();
  await page.locator('#confirm-dialog').click();
  assert.match(await page.locator('#service-status').innerText(), /simulated/);
  await page.locator('#stop-service').click();
  await page.locator('nav [data-view="flow"]').click();
  await page.locator('[data-action="advance"]').click();
  assert(await page.locator('#confirm-dialog').isDisabled());
  await page.keyboard.press('Escape');
  assert(!await page.locator('#dialog').isVisible());
  await page.locator('nav [data-view="wizard"]').click();
  await page.locator('#project-name').fill('<img src=x onerror=alert(1)>');
  await page.locator('#wizard-form button').click();
  assert.equal(await page.locator('#dialog-content img').count(), 0);
  assert(await page.locator('#confirm-dialog').isDisabled());
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('nav [data-view="overview"]').click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, `${engine}-prototype-mobile.png`), fullPage: true });
  results.push('prototype navigation, theme persistence, onboarding states, simulated run/stop, blocked advance, modal Escape, text injection and mobile overflow');
  await context.close();

  for (const version of ['1.2.0', '1.3.0']) {
    const packageRoot = path.join(artifact.scratch, `unpack-${version}`, 'package');
    const cli = path.join(packageRoot, 'src/cli.js');
    const project = path.join(temp, `project-${version}`);
    mkdirSync(project);
    execFileSync(process.execPath, [cli, 'init'], { cwd: project, env: process.env, stdio: 'pipe' });
    if (version === '1.3.0') execFileSync(process.execPath, [cli, 'start', '--keep-active', '--', 'Existing item navigation regression'], { cwd: project, env: process.env, stdio: 'pipe' });
    const { startConsoleServer } = await import(pathToFileURL(path.join(packageRoot, 'src/console/server.js')));
    let agentEnv = process.env;
    if (version === '1.3.0') {
      const { fakeTools } = await import(pathToFileURL(path.join(root, 'test-support/agent-fixtures.js')));
      const fake = await fakeTools();
      // Browser scheduling under a concurrent runtime matrix can exceed the
      // unit fixture's three-second turn. Keep this disposable turn cancellable
      // for a minute so the UI check cannot miss it merely through scheduling.
      const adapterSource = readFileSync(fake.env.YALLAFLOW_CODEX_ACP, 'utf8');
      assert(adapterSource.includes('index < 100 &&'));
      writeFileSync(fake.env.YALLAFLOW_CODEX_ACP, adapterSource.replace('index < 100 &&', 'index < 2000 &&'));
      agentEnv = { ...fake.env, YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS: '30000' };
    }
    const server = await startConsoleServer({ roots: [project], port: 0, agents: version === '1.3.0', agentEnv });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const ui = await ctx.newPage();
    try {
      ui.setDefaultTimeout(30000);
      ui.on('pageerror', error => errors.push(error.message));
      await ui.goto(`${server.url}#token=${server.token}`);
      await ui.locator('[data-lang]').click();
      if (version === '1.3.0') {
        // No workspace change occurs after the server starts. Item navigation must
        // fetch its agent state without relying on a watcher event to rescue it.
        await ui.locator('[data-w]').first().click();
        await ui.locator('[data-agent-start]').waitFor({ timeout: 5000 });
        results.push('1.3.0 existing-item navigation loads Agent Workspace without a workspace event');
      }
      await ui.locator('[data-create]').first().click();
      await ui.locator('textarea[name=request]').fill(`Browser acceptance ${version}`);
      await ui.locator('input[name=files]').setInputFiles({ name: 'acceptance.md', mimeType: 'text/markdown', buffer: Buffer.from('# Acceptance fixture\nA sample source, not production data.\n') });
      await ui.locator('[data-cw-submit]').click();
      await ui.locator('[data-cw-open]').click();
      await ui.locator('#chain').waitFor();
      assert.equal(JSON.parse(readFileSync(path.join(project, '.yallaflow/state/current.yaml'))).activeWork, null);
      await ui.locator('[data-theme-toggle]').click();
      const theme = await ui.locator('html').getAttribute('data-theme');
      await ui.locator('[data-bell]').click();
      assert.equal(await ui.locator('html').getAttribute('data-theme'), theme);
      await ui.locator('[data-bell]').click();
      await ui.screenshot({ path: path.join(output, `${engine}-${version}-item.png`), fullPage: true });
      if (version === '1.3.0') {
        await ui.locator('[data-agent-start]').click();
        await ui.locator('[data-agent-input]:enabled').waitFor();
        await ui.locator('[data-agent-input]').fill('PERMISSION');
        await ui.locator('[data-agent-form] button[type=submit]').click();
        await ui.locator('[data-agent-perm][data-decision=deny]').click();
        await ui.locator('[data-agent-input]:enabled').waitFor();
        await ui.locator('[data-agent-input]').fill('SLOW');
        await ui.locator('[data-agent-form] button[type=submit]').click();
        // Streaming must keep controls stable for a normal pointer interaction.
        await ui.locator('[data-agent-cancel]').waitFor({ state: 'visible' });
        await ui.locator('[data-agent-cancel]').click();
        await ui.locator('[data-agent-input]:enabled').waitFor();
        await ui.locator('[data-agent-end]').click();
        await ui.locator('[data-agent-resume]').first().click();
        await ui.locator('[data-agent-input]:enabled').waitFor();
        const activation = ui.waitForResponse(response => response.url().endsWith('/agent/activate'));
        await ui.locator('[data-agent-activate]').click();
        const activated = await activation;
        assert(activated.ok(), `activation request failed: ${activated.status()}`);
        await ui.waitForFunction(() => !document.querySelector('[data-agent-activate]'));
        assert(JSON.parse(readFileSync(path.join(project, '.yallaflow/state/current.yaml'))).activeWork);
        await ui.screenshot({ path: path.join(output, `${engine}-1.3.0-agent-simulated.png`), fullPage: true });
        await ui.locator('[data-agent-end]').click();
        results.push('1.3.0 SIMULATED provider: start, stream, permission deny, stop, end, resume, explicit activation');
      }
      await ui.setViewportSize({ width: 390, height: 844 });
      await ui.locator('[data-lang]').click();
      assert.equal(await ui.locator('html').getAttribute('dir'), 'rtl');
      assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await ui.screenshot({ path: path.join(output, `${engine}-${version}-mobile-rtl.png`), fullPage: true });
      results.push(`${version} packed console: create with attachment, detail/Flow, no auto-activation, theme regression, mobile RTL`);
    } catch (error) {
      await ui.screenshot({ path: path.join(output, `${engine}-${version}-failure.png`), fullPage: true });
      console.error('Sample agent panel at failure:', await ui.locator('#agent').innerText().catch(() => 'not present'));
      throw error;
    } finally { await ctx.close(); await server.close(); }
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  const result = { browser: engine, browserVersion: browser.version(), checkedAt: new Date().toISOString(), passed: results, errors, limitation: 'Provider is simulated; real subscription acceptance remains a manual gate.' };
  writeFileSync(path.join(output, `${engine}-results.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
