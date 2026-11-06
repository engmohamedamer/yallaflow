// Regression (2026-11-06): a console started by a test opened the developer's saved projects
// and wrote into them. Every `npm test` process must use a temporary user config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registryPath } from '../src/console/registry.js';

test('npm test preloads the user-config isolation', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.test, /--import \.\/test-support\/isolate-user-config\.js/);
});

test('the console registry of a test process is a temporary file, never the real one', { skip: !process.env.YALLAFLOW_TEST_USER_CONFIG && 'run through npm test' }, () => {
  const file = registryPath();
  assert.ok(file.startsWith(path.resolve(os.tmpdir())), file);
  assert.ok(file.startsWith(process.env.YALLAFLOW_TEST_USER_CONFIG), file);
});
