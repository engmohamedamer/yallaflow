import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { exists } from '../src/utils/fs.js';
import { prepareFileIntake } from '../src/intake/file.js';
import { assertSafeSourceName, assertWithinDirectory } from '../src/intake/validation.js';
import { listSources, loadSource, sourceDirPath } from '../src/core/sources.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function freshWorkspace(prefix = 'yallaflow-intake-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await initWorkspace(root, 'demo', 'greenfield');
  return root;
}

async function writeSourceFile(root, name, content) {
  const file = path.join(root, name);
  await writeFile(file, content, 'utf8');
  return file;
}

function intake(root, args) {
  return spawnSync(process.execPath, [cli, 'intake', ...args], { cwd: root, encoding: 'utf8' });
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

test('markdown intake', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# Contract Management System\n\nGold or Silver packages.\n');
  const result = intake(root, ['SRS.md']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Source captured: SRC-0001/);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentType, 'text/markdown');
});

test('text intake', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'notes.txt', 'Plain text requirement notes.');
  const result = intake(root, ['notes.txt']);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentType, 'text/plain');
});

test('JSON intake', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'req.json', JSON.stringify({ requirement: 'Contract management' }));
  const result = intake(root, ['req.json']);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentType, 'application/json');
});

test('YAML intake', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'req.yaml', 'requirement: Contract management\n');
  const result = intake(root, ['req.yaml']);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentType, 'application/x-yaml');

  await writeSourceFile(root, 'req2.yml', 'requirement: Contract management v2\n');
  const result2 = intake(root, ['req2.yml']);
  assert.equal(result2.status, 0, result2.stderr);
  assert.equal((await loadSource(root, 'SRC-0002')).contentType, 'application/x-yaml');
});

test('CSV intake', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'data.csv', 'id,name\n1,Contract A\n');
  const result = intake(root, ['data.csv']);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentType, 'text/csv');
});

test('unsupported file rejected', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'spec.pdf', '%PDF-1.4 fake');
  const result = intake(root, ['spec.pdf']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported file type: \.pdf/);
  assert.match(result.stderr, /Supported in this release:/);
  assert.match(result.stderr, /\.md, \.txt, \.json, \.yaml, \.yml, \.csv/);
});

test('missing file rejected', async () => {
  const root = await freshWorkspace();
  const result = intake(root, ['does-not-exist.md']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source file not found: does-not-exist\.md/);
});

test('directory rejected', async () => {
  const root = await freshWorkspace();
  await mkdir(path.join(root, 'a-directory.md'));
  const result = intake(root, ['a-directory.md']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source path is a directory, not a file/);
});

test('empty file rejected', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'empty.md', '');
  const result = intake(root, ['empty.md']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source file is empty: empty\.md/);
});

test('source copied into workspace', async () => {
  const root = await freshWorkspace();
  const content = '# SRS\n\nOriginal content.\n';
  await writeSourceFile(root, 'SRS.md', content);
  intake(root, ['SRS.md']);
  const copied = await readFile(path.join(workspacePath(root), 'sources', 'SRC-0001', 'SRS.md'), 'utf8');
  assert.equal(copied, content);
});

test('source metadata persisted', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.id, 'SRC-0001');
  assert.equal(source.sourceType, 'file');
  assert.equal(source.sourceName, 'SRS.md');
  assert.equal(source.sourceRef, 'sources/SRC-0001/SRS.md');
  assert.ok(source.capturedAt);
  assert.equal(source.metadata.extension, '.md');
});

test('SHA-256 persisted', async () => {
  const root = await freshWorkspace();
  const content = '# SRS\n\nHashed content.\n';
  await writeSourceFile(root, 'SRS.md', content);
  intake(root, ['SRS.md']);
  const source = await loadSource(root, 'SRC-0001');
  const expected = createHash('sha256').update(content, 'utf8').digest('hex');
  assert.equal(source.metadata.sha256, expected);
  assert.match(source.metadata.sha256, /^[a-f0-9]{64}$/);
});

test('pending work created', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  const result = intake(root, ['SRS.md']);
  assert.match(result.stdout, /Work created: PF-0001/);
  const meta = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.equal(meta.routingStatus, 'pending');
  assert.equal(meta.status, null);
});

test('source linked to work', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const meta = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.deepEqual(meta.sources, [{ id: 'SRC-0001', type: 'file', name: 'SRS.md' }]);
  const source = await loadSource(root, 'SRC-0001');
  assert.deepEqual(source.linkedWork, ['PF-0001']);
});

test('raw content preserved exactly', async () => {
  const root = await freshWorkspace();
  const content = 'Line one.\r\nLine two with trailing spaces.   \nNo trailing newline at end.';
  await writeSourceFile(root, 'exact.txt', content);
  intake(root, ['exact.txt']);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.rawText, content);
  const copied = await readFile(path.join(workspacePath(root), 'sources', 'SRC-0001', 'exact.txt'), 'utf8');
  assert.equal(copied, content);
});

test('filename preserved', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'Client-Requirements_v2.txt', 'content');
  intake(root, ['Client-Requirements_v2.txt']);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.sourceName, 'Client-Requirements_v2.txt');
});

test('optional title flows into routing default without inference', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md', '--title', 'Contract Management System']);
  const pending = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.equal(pending.titleHint, 'Contract Management System');

  const route = run(root, [
    'route', 'PF-0001', '--type', 'feature', '--scope', 'architectural',
    '--confidence', 'high', '--reason', 'Greenfield SRS intake.'
  ]);
  assert.equal(route.status, 0, route.stderr);
  const routed = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.equal(routed.title, 'Contract Management System');
});

test('default title is derived mechanically from the filename, not inferred', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const pending = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.equal(pending.titleHint, 'SRS');
});

test('no routing inference from file contents', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# Bug: production is on fire\n\nThis looks like a bug report.\n');
  intake(root, ['SRS.md']);
  const pending = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.equal(pending.type, null);
  assert.equal(pending.scope, null);
  assert.equal(pending.routingStatus, 'pending');
});

test('duplicate intake does not overwrite', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'a.md', 'same content');
  await writeSourceFile(root, 'b.md', 'same content');
  const first = intake(root, ['a.md']);
  assert.match(first.stdout, /Source captured: SRC-0001/);
  const second = intake(root, ['b.md']);
  assert.match(second.stdout, /This file matches existing source SRC-0001\./);
  assert.match(second.stdout, /Source captured: SRC-0002/);
  const sources = await listSources(root);
  assert.deepEqual(sources.map((s) => s.id), ['SRC-0001', 'SRC-0002']);
});

test('restart preserves source relationship', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const reloadedWork = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.deepEqual(reloadedWork.sources, [{ id: 'SRC-0001', type: 'file', name: 'SRS.md' }]);
  const reloadedSource = await loadSource(root, 'SRC-0001');
  assert.deepEqual(reloadedSource.linkedWork, ['PF-0001']);
});

test('guide exposes source', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const result = run(root, ['guide', 'PF-0001']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Source:\nSRC-0001 — SRS\.md/);
});

test('resume exposes source', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const result = run(root, ['resume']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Source: SRC-0001 — SRS\.md/);
});

test('source list', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const result = run(root, ['source', 'list']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sources: 1/);
  assert.match(result.stdout, /SRC-0001 \[file\] SRS\.md/);
  assert.match(result.stdout, /linked: PF-0001/);
});

test('source show', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'SRS.md', '# SRS\n');
  intake(root, ['SRS.md']);
  const result = run(root, ['source', 'show', 'SRC-0001']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^SRC-0001/);
  assert.match(result.stdout, /Type: file/);
  assert.match(result.stdout, /Name: SRS\.md/);
  assert.match(result.stdout, /Content type: text\/markdown/);
  assert.match(result.stdout, /Checksum: sha256:[a-f0-9]{64}/);
  assert.match(result.stdout, /Location: \.yallaflow\/sources\/SRC-0001\/SRS\.md/);
  assert.match(result.stdout, /Linked work: PF-0001/);
  assert.doesNotMatch(result.stdout, /# SRS/);

  const withContent = run(root, ['source', 'show', 'SRC-0001', '--content']);
  assert.equal(withContent.status, 0, withContent.stderr);
  assert.match(withContent.stdout, /# SRS/);
});

test('existing text start still works', async () => {
  const root = await freshWorkspace();
  const result = run(root, ['start', 'Production upload returns 500']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Raw request: Production upload returns 500/);
  const meta = await readYaml(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'));
  assert.equal(meta.rawRequest, 'Production upload returns 500');
  assert.equal(meta.sources, undefined);
});

test('old workspace without sources/ loads', async () => {
  const root = await freshWorkspace();
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false);
  const sources = await listSources(root);
  assert.deepEqual(sources, []);
  const doctor = run(root, ['doctor']);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /PASS sources \(0 present\)/);
});

test('read-only commands do not create sources/', async () => {
  const root = await freshWorkspace();
  for (const args of [['source', 'list'], ['status'], ['doctor']]) {
    const result = run(root, args);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false);
});

test('failed intake leaves no partial work or source', async () => {
  const root = await freshWorkspace();
  await writeSourceFile(root, 'bad.pdf', 'not really a pdf');
  const result = intake(root, ['bad.pdf']);
  assert.equal(result.status, 1);
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false);
  const workDir = path.join(workspacePath(root), 'work');
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(workDir), []);
});

test('large multiline SRS remains exact', async () => {
  const root = await freshWorkspace();
  const lines = [];
  for (let i = 1; i <= 500; i++) lines.push(`Line ${i}: some requirement detail with unicode — é, 中文, emoji 🚀.`);
  const content = `# Contract Management System\n\n${lines.join('\n')}\n`;
  await writeSourceFile(root, 'SRS.md', content);
  intake(root, ['SRS.md']);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.rawText, content);
  assert.equal(source.metadata.sizeBytes, Buffer.byteLength(content, 'utf8'));
  const copied = await readFile(path.join(workspacePath(root), 'sources', 'SRC-0001', 'SRS.md'), 'utf8');
  assert.equal(copied, content);
});

test('source path traversal attempts are rejected', async () => {
  assert.throws(() => assertSafeSourceName('../../etc/passwd'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('..'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('.'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('a/b.md'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('a\\b.md'), /Unsafe source name/);
  assert.doesNotThrow(() => assertSafeSourceName('SRS.md'));

  const root = await freshWorkspace();
  const dir = sourceDirPath(root, 'SRC-0001');
  assert.throws(
    () => assertWithinDirectory(path.join(dir, '..', '..', 'escaped.md'), dir),
    /Refusing to write outside the source directory/
  );
  assert.doesNotThrow(() => assertWithinDirectory(path.join(dir, 'SRS.md'), dir));
});

test('file adapter produces a source-neutral normalized intake contract', async () => {
  const root = await freshWorkspace();
  const file = await writeSourceFile(root, 'SRS.md', '# SRS\n\nContent.\n');
  const normalized = await prepareFileIntake(file);
  assert.equal(normalized.sourceType, 'file');
  assert.equal(normalized.sourceName, 'SRS.md');
  assert.equal(normalized.contentType, 'text/markdown');
  assert.equal(normalized.rawText, '# SRS\n\nContent.\n');
  assert.ok(normalized.capturedAt);
  assert.equal(normalized.metadata.extension, '.md');
  assert.match(normalized.metadata.sha256, /^[a-f0-9]{64}$/);
});
