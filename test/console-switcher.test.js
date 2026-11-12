// PF-0127 (1.5.2): the header's project switcher — one styled menu instead of a native select
// and a separate small "All projects" link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../resources/console/app.css', import.meta.url), 'utf8');
const topbar = app.slice(app.indexOf('function topbar(r)'), app.indexOf('const count = snap ? needs().length : 0;'));

test('the switcher shows the current project with its readiness and lists every project', () => {
  assert.doesNotMatch(topbar, /<select class="projsel"/, 'no native select');
  assert.match(topbar, /<details class="projmenu" data-popmenu><summary aria-haspopup="menu"/);
  assert.match(topbar, /const dot = level \? `<span class="projdot \$\{level\}" aria-hidden="true"><\/span>` : '';/);
  assert.match(topbar, /projects\.map\(\(p\) => `<a role="menuitem" href="#\/map" data-open-project="\$\{esc\(p\.id\)\}"/);
  assert.match(topbar, /\$\{p\.id === pid \? 'aria-current="true"' : ''\}/);
});

test('project actions live in the same menu; read-only hides Add and New', () => {
  assert.match(topbar, /readOnly \? '' : `<button type="button" role="menuitem" class="projmenu-item" data-folder-open="existing">/);
  assert.match(topbar, /href="#\/new"><span class="projmenu-check" aria-hidden="true">✦<\/span>\$\{A\('مشروع جديد', 'New project'\)\}/);
  // PF-0132: with agents on, the same item reads "All projects & agents" (Agents moved into Projects).
  assert.match(topbar, /href="#\/projects"><span class="projmenu-check" aria-hidden="true">▤<\/span>\$\{agentsOn \? A\('كل المشاريع والوكلاء', 'All projects & agents'\) : A\('كل المشاريع', 'All projects'\)\}/);
  assert.match(app, /<div class="projpick">\$\{picker\}<\/div>/, 'the separate small link is gone');
});

test('header menus: Esc closes and refocuses, arrows move, outside click and opening another close it', () => {
  assert.match(app, /if \(e\.key === 'Escape'\) \{ menu\.open = false; menu\.querySelector\('summary'\)\?\.focus\(\); return; \}/);
  assert.match(app, /if \(e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'\) \{/);
  assert.match(app, /for \(const menu of document\.querySelectorAll\('\[data-popmenu\]\[open\]'\)\) if \(!menu\.contains\(e\.target\)\) menu\.open = false;/);
  assert.match(app, /document\.addEventListener\('toggle', \(e\) => \{ if \(e\.target\.matches\?\.\('\[data-popmenu\]'\) && e\.target\.open\)/);
  assert.match(app, /x\.closest\('\[data-popmenu\]'\)\?\.removeAttribute\('open'\); switchProject/);
});

test('switcher styles cover readiness, focus, dark mode and phone width', () => {
  for (const rule of ['.projdot.ready {', '.projdot.incomplete {', '.projdot.attention {', '.projmenu-item:focus-visible {', ':root[data-theme="dark"] .projmenu-check', '.projmenu-panel { position: fixed;']) assert.ok(css.includes(rule), rule);
});
