import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, link, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executionInputs } from '../src/runtime/inputs.js';

async function fixture(command = ['node', 'server.js']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-trust-inputs-'));
  const service = { command, cwd: '.', env: [], kind: 'process' };
  return { root, service, inputs: () => executionInputs(root, service), put: (name, value) => writeFile(path.join(root, name), value) };
}

test('runtime inputs: package/composer scripts revoke trust; metadata and application code do not', async () => {
  const f = await fixture();
  await f.put('package.json', JSON.stringify({ name: 'before', scripts: { dev: 'node server.js', predev: 'echo check' } }));
  await f.put('composer.json', JSON.stringify({ scripts: { dev: ['php artisan serve'] } }));
  const initial = await f.inputs();
  await f.put('server.js', 'application change');
  await f.put('package.json', JSON.stringify({ scripts: { predev: 'echo check', dev: 'node server.js' }, name: 'after' }));
  assert.deepEqual(await f.inputs(), initial);
  await f.put('package.json', JSON.stringify({ scripts: { dev: 'node other.js' } }));
  assert.notDeepEqual(await f.inputs(), initial);
  const packageChanged = await f.inputs();
  await f.put('composer.json', JSON.stringify({ scripts: { dev: ['php artisan other'] } }));
  assert.notDeepEqual(await f.inputs(), packageChanged);
});

test('runtime inputs: direct shell, interpreter flags and extensionless shebang scripts are bound', async () => {
  for (const command of [['./run.sh'], ['bash', '-e', 'run.sh'], ['bash', 'run.sh', '-c'], ['bash', '-o', 'errexit', 'run.sh'], ['./runner']]) {
    const f = await fixture(command);
    const name = command[0] === './runner' ? 'runner' : 'run.sh';
    await f.put(name, '#!/usr/bin/env bash\necho before\n');
    const before = await f.inputs();
    await f.put(name, '#!/usr/bin/env bash\necho after\n');
    assert.notDeepEqual(await f.inputs(), before, command.join(' '));
  }
});

test('runtime inputs: default and explicitly selected Compose files and project directories are bound', async () => {
  const cases = [
    { command: ['docker', 'compose', 'up'], file: 'compose.yaml' },
    { command: ['docker', 'compose', '-f', 'custom.yml', 'up'], file: 'custom.yml' },
    { command: ['docker-compose', '--file=custom.yml', 'up'], file: 'custom.yml' },
    { command: ['docker', 'compose', '--project-directory', 'nested', 'up'], file: 'nested/compose.yaml' }
  ];
  for (const { command, file } of cases) {
    const f = await fixture(command);
    await mkdir(path.dirname(path.join(f.root, file)), { recursive: true });
    await f.put(file, 'services: {}');
    const before = await f.inputs();
    await f.put(file, 'services: {web: {image: test}}');
    assert.notDeepEqual(await f.inputs(), before);
  }
});

test('runtime inputs: selected package directories and ancestors are included', async () => {
  for (const command of [['npm', '--prefix', 'nested', 'run', 'dev'], ['composer', '--working-dir=nested', 'run', 'dev']]) {
    const f = await fixture(command);
    await mkdir(path.join(f.root, 'nested'));
    const file = command[0] === 'composer' ? 'nested/composer.json' : 'nested/package.json';
    await f.put(file, '{"scripts":{"dev":"before"}}');
    const before = await f.inputs();
    await f.put(file, '{"scripts":{"dev":"after"}}');
    assert.notDeepEqual(await f.inputs(), before);
    f.service.cwd = 'nested';
    f.service.command = ['node', 'server.js'];
    await f.put('package.json', '{"scripts":{"test":"before"}}');
    const nested = await f.inputs();
    await f.put('package.json', '{"scripts":{"test":"after"}}');
    assert.notDeepEqual(await f.inputs(), nested);
  }
});

test('runtime inputs: file removal changes fingerprints; unsafe and malformed files fail closed', async () => {
  const f = await fixture(['bash', 'run.sh']);
  await f.put('run.sh', 'echo safe');
  const before = await f.inputs();
  await rm(path.join(f.root, 'run.sh'));
  assert.notDeepEqual(await f.inputs(), before);
  await symlink('/etc/passwd', path.join(f.root, 'run.sh'));
  await assert.rejects(f.inputs(), { code: 'RUNTIME_TRUST_INPUT' });
  await rm(path.join(f.root, 'run.sh'));
  await f.put('original', 'echo safe');
  await link(path.join(f.root, 'original'), path.join(f.root, 'run.sh'));
  await assert.rejects(f.inputs(), { code: 'RUNTIME_TRUST_INPUT' });
  await rm(path.join(f.root, 'run.sh'));
  await f.put('package.json', '{bad');
  await assert.rejects(f.inputs(), { code: 'RUNTIME_TRUST_INPUT' });
});
