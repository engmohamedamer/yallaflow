// PF-0123 (1.5.2): console refinement — redraw stability, honest copy, and the later phases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');

test('a redraw never rebuilds an unchanged page and waits while a pointer is pressed', () => {
  assert.match(app, /if \(html === lastHtml && appEl\.childElementCount && !domDirty\) return;/);
  // Direct page changes (a disabled button, a streamed chat line) force the next rebuild.
  assert.match(app, /new MutationObserver\(noteMutations\)/);
  assert.match(app, /if \(pointerPressed\(\)\) \{/);
  // The wait is bounded and released on pointerup, pointercancel, dragstart and window blur.
  assert.match(app, /const POINTER_DEFER_MS = \d+;/);
  assert.match(app, /\['pointerup', 'pointercancel', 'dragstart'\]/);
  assert.match(app, /window\.addEventListener\('blur'/);
});

test('copy reports success only after the browser confirms it, with two fallbacks', () => {
  const copyFn = app.slice(app.indexOf('function copy(text'), app.indexOf('function toast('));
  // The Clipboard API is called synchronously inside the click (Safari user activation).
  assert.match(copyFn, /promise\.then\(done, fallback\)/);
  assert.match(copyFn, /if \(selectionCopy\(text\)\) done\(\); else manualCopy\(text\);/);
  assert.doesNotMatch(copyFn, /toast\(esc\(text\)\)/, 'a failed copy never shows the text as if it were copied');
  assert.match(app, /function manualCopy\(text\)/);
  assert.match(app, /document\.execCommand\('copy'\)/);
  assert.match(app, /data-copy-what="id"/);
});

// ---------- Tailwind foundation (REQ-001) ----------

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('Tailwind is a pinned development tool; users get the built stylesheet with no build step', async () => {
  assert.equal(pkg.devDependencies?.tailwindcss, '4.3.5');
  assert.equal(pkg.devDependencies?.['@tailwindcss/cli'], '4.3.5');
  assert.equal(pkg.dependencies?.tailwindcss, undefined, 'never a runtime dependency');
  assert.match(pkg.scripts['build:css'], /tailwindcss -i resources\/console\/tailwind\.input\.css -o resources\/console\/tw\.css --minify/);
  // PF-0124: the committed, tested tw.css is what ships; nothing regenerates it on pack/publish.
  assert.equal(pkg.scripts.prepack, undefined);
  assert.equal(pkg.scripts.prepublishOnly, undefined);
  assert.ok(pkg.files.includes('resources'), 'resources/console/tw.css ships in the package');
  const css = await readFile(new URL('../resources/console/tw.css', import.meta.url), 'utf8');
  assert.match(css, /^\/\*! tailwindcss v4\.3\.5/);
  // No preflight reset (box-sizing/margin/border resets, html/body rules) and no unprefixed class
  // that could clash with app.css; only Tailwind's own --tw-* property initialisation may target *.
  assert.doesNotMatch(css, /box-sizing:border-box|(^|[},])\s*(html|body)[,{:]/);
  for (const rule of css.match(/(?:^|})\s*\*,[^{]*\{[^}]*\}/g) ?? []) assert.match(rule, /\{(--tw-[a-z-]+:[^;}]*;?)+\}/, rule);
  for (const cls of css.match(/(?:^|[}\s,])\.(?!tw\\:)[A-Za-z][\w-]*/g) ?? []) assert.fail(`unprefixed class ${cls}`);
  const html = await readFile(new URL('../resources/console/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('href="tw.css"') > html.indexOf('href="app.css"'), 'tw.css loads after app.css');
  const input = await readFile(new URL('../resources/console/tailwind.input.css', import.meta.url), 'utf8');
  assert.match(input, /prefix\(tw\)/);
  assert.doesNotMatch(input, /@import[^;]*(preflight|"tailwindcss";)/, 'no preflight reset is imported');
  assert.match(input, /--color-nile: var\(--nile\);/, 'colours follow the console tokens and themes');
});

const cli = path.join(ROOT, 'node_modules', '.bin', 'tailwindcss');
// CI sets YALLAFLOW_REQUIRE_CSS_CHECK=1: there a missing CLI is a failure, never a skip.
const requireCss = process.env.YALLAFLOW_REQUIRE_CSS_CHECK === '1';
test('tw.css is up to date with tailwind.input.css and app.js', { skip: existsSync(cli) || requireCss ? false : 'Tailwind CLI not installed here (npm ci installs it; CI runs this check)' }, async () => {
  assert.ok(existsSync(cli), 'YALLAFLOW_REQUIRE_CSS_CHECK=1 but the Tailwind CLI is not installed: run npm ci');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-tw-'));
  try {
    const out = path.join(dir, 'tw.css');
    await new Promise((resolve, reject) => execFile(cli, ['-i', 'resources/console/tailwind.input.css', '-o', out, '--minify'], { cwd: ROOT }, (error) => (error ? reject(error) : resolve())));
    assert.equal(await readFile(out, 'utf8'), await readFile(path.join(ROOT, 'resources/console/tw.css'), 'utf8'), 'run `npm run build:css` and include resources/console/tw.css');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('typing or changing a field marks the page changed, so a redraw that resets it is never skipped', () => {
  assert.match(app, /for \(const type of \['input', 'change'\]\) document\.addEventListener\(type, \(e\) => \{ if \(e\.target\.closest\?\.\('#app'\)\) domDirty = true; \}, true\);/);
});
