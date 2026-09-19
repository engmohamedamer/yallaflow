import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deterministicDiscovery } from '../src/core/discovery.js';

test('detects framework markers without an LLM', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-discovery-'));
  await writeFile(path.join(root, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^12.0' } }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vue: '^3.5.0' } }));
  const result = await deterministicDiscovery(root);
  assert.ok(result.stack.includes('PHP / Composer'));
  assert.ok(result.stack.includes('Laravel ^12.0'));
  assert.ok(result.stack.includes('vue ^3.5.0'));
});
