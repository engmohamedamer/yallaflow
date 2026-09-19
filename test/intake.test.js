import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { exists } from '../src/utils/fs.js';
import { prepareFileIntake } from '../src/intake/file.js';
import { assertSafeSourceName, assertWithinDirectory } from '../src/intake/validation.js';
import { listSources, loadSource, loadSourceText, persistSource, removeSourceDir, sourceDirPath } from '../src/core/sources.js';
import { MAX_EXTRACTION_INPUT_BYTES, MAX_SOURCE_BYTES, SOURCE_SCHEMA_VERSION } from '../src/intake/constants.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fixturesDir = fileURLToPath(new URL('fixtures/intake/', import.meta.url));

function fixture(name) {
  return path.join(fixturesDir, name);
}

async function freshWorkspace(prefix = 'yallaflow-intake-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await initWorkspace(root, 'demo', 'greenfield');
  return root;
}

function intake(root, args) {
  return spawnSync(process.execPath, [cli, 'intake', ...args], { cwd: root, encoding: 'utf8' });
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

async function metaOf(root, workId) {
  return readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
}

// ---------------------------------------------------------------------------
// Tier 1 — Native Text
// ---------------------------------------------------------------------------

for (const [file, contentType] of [
  ['sample.txt', 'text/plain'],
  ['sample.md', 'text/markdown'],
  ['sample.json', 'application/json'],
  ['sample.jsonl', 'application/jsonl'],
  ['sample.yaml', 'application/x-yaml'],
  ['sample.xml', 'application/xml'],
  ['sample.html', 'text/html'],
  ['sample.csv', 'text/csv'],
  ['sample.tsv', 'text/tab-separated-values'],
  ['sample.toml', 'application/toml']
]) {
  test(`native text intake: ${file}`, async () => {
    const root = await freshWorkspace();
    const result = intake(root, [fixture(file)]);
    assert.equal(result.status, 0, result.stderr);
    const source = await loadSource(root, 'SRC-0001');
    assert.equal(source.contentAvailability, 'native-text');
    assert.equal(source.contentType, contentType);
    assert.equal(source.rawText, await readFile(fixture(file), 'utf8'));
  });
}

// ---------------------------------------------------------------------------
// Tier 2 — Office / Rich Documents
// ---------------------------------------------------------------------------

test('office intake: docx', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.docx')]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'extracted');
  const text = await loadSourceText(root, source);
  assert.match(text, /Requirements/);
  assert.match(text, /Contract creation/);
});

test('office intake: pptx produces per-slide sections', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.pptx')]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  const text = await loadSourceText(root, source);
  assert.match(text, /# Slide 1/);
  assert.match(text, /# Slide 2/);
  assert.match(text, /Contract Management System/);
});

test('office intake: xlsx produces a sheet table with the real sheet name', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.xlsx')]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  const text = await loadSourceText(root, source);
  assert.match(text, /# Sheet: sample/);
  assert.match(text, /\| ID \| Requirement \| Priority \|/);
  assert.match(text, /\| R1 \| Contract creation \| High \|/);
});

test('office intake: rtf', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.rtf')]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  const text = await loadSourceText(root, source);
  assert.match(text, /Requirements/);
  assert.match(text, /Contract creation/);
});

test('office intake: odt', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.odt')]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await loadSource(root, 'SRC-0001')).contentAvailability, 'extracted');
});

test('office intake: ods', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.ods')]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await loadSource(root, 'SRC-0001')).contentAvailability, 'extracted');
});

test('office intake: odp', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.odp')]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await loadSource(root, 'SRC-0001')).contentAvailability, 'extracted');
});

// ---------------------------------------------------------------------------
// Tier 3 — PDF
// ---------------------------------------------------------------------------

test('PDF intake produces per-page sections', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.pdf')]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'extracted');
  const text = await loadSourceText(root, source);
  assert.match(text, /# Page 1/);
  assert.match(text, /Requirements/);
});

// ---------------------------------------------------------------------------
// Tier 4 — Images / Visual Sources
// ---------------------------------------------------------------------------

for (const [file, format] of [['sample.png', 'png'], ['sample.jpg', 'jpg'], ['sample.svg', 'svg']]) {
  test(`image intake preserves original without claiming extraction: ${file}`, async () => {
    const root = await freshWorkspace();
    const result = intake(root, [fixture(file)]);
    assert.equal(result.status, 0, result.stderr);
    const source = await loadSource(root, 'SRC-0001');
    assert.equal(source.contentAvailability, 'original-only');
    assert.equal(source.metadata.format, format);
    assert.equal(await loadSourceText(root, source), null);
  });
}

test('PNG dimensions are read from the header', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.png')]);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.metadata.width, 64);
  assert.equal(source.metadata.height, 32);
});

// ---------------------------------------------------------------------------
// Tier 5 — Generic Binary Attachment
// ---------------------------------------------------------------------------

test('unsupported binary is accepted as original-only, not rejected', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.psd')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Source captured: SRC-0001/);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'original-only');
});

test('a dangerous archive extension is preserved, never auto-unpacked', async () => {
  const root = await freshWorkspace();
  const zipPath = path.join(root, 'bundle.zip');
  // Minimal valid empty zip (end-of-central-directory record only).
  await writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const result = intake(root, [zipPath]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'original-only');
  assert.equal(source.detectedFormat, 'archive');
  assert.equal(await exists(path.join(workspacePath(root), 'sources', 'SRC-0001', 'bundle.zip')), true);
});

// ---------------------------------------------------------------------------
// Security / Failure
// ---------------------------------------------------------------------------

test('corrupt DOCX degrades to original-only instead of failing intake', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('corrupt.docx')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Warning: could not extract text/);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'original-only');
  assert.ok(source.metadata.extractionError);
});

test('corrupt PDF degrades to original-only instead of failing intake', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('corrupt.pdf')]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'original-only');
});

test('fake extension (non-zip content named .docx) is detected and preserved as binary', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('fake.docx')]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'original-only');
  assert.equal(source.metadata.extensionMismatch, true);
});

test('path traversal attempts are rejected at the validation boundary', async () => {
  assert.throws(() => assertSafeSourceName('../../etc/passwd'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('..'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('.'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('a/b.md'), /Unsafe source name/);
  assert.throws(() => assertSafeSourceName('a\\b.md'), /Unsafe source name/);
  assert.doesNotThrow(() => assertSafeSourceName('SRS.docx'));

  const root = await freshWorkspace();
  const dir = sourceDirPath(root, 'SRC-0001');
  assert.throws(
    () => assertWithinDirectory(path.join(dir, '..', '..', 'escaped.md'), dir),
    /Refusing to write outside the source directory/
  );
});

test('malicious filename with embedded traversal sequences is sanitized to its basename', async () => {
  const root = await freshWorkspace();
  const weirdDir = path.join(root, 'weird..name');
  await mkdir(weirdDir, { recursive: true });
  const weirdFile = path.join(weirdDir, 'notes.txt');
  await writeFile(weirdFile, 'Client notes.');
  const result = intake(root, [weirdFile]);
  assert.equal(result.status, 0, result.stderr);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.sourceName, 'notes.txt');
});

test('zero-byte file is rejected', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('empty.txt')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source file is empty/);
});

test('oversize source file is rejected with a clear error, never silently truncated', async () => {
  const root = await freshWorkspace();
  const bigFile = path.join(root, 'huge.txt');
  // A sparse file: ftruncate creates a hole file reporting the target size without
  // actually writing/allocating real bytes, so this stays fast and cheap in CI.
  const handle = await (await import('node:fs/promises')).open(bigFile, 'w');
  await handle.truncate(MAX_SOURCE_BYTES + 1024);
  await handle.close();

  const result = intake(root, [bigFile]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds the 200 MB safe size limit/);
});

test('a file exceeding the extraction limit is preserved as original-only rather than parsed', async () => {
  const root = await freshWorkspace();
  const bigDocx = path.join(root, 'huge.docx');
  // Needs a real zip signature up front so format detection identifies it as
  // "office" (and therefore subject to the extraction-size gate) rather than as a
  // signature mismatch, which is a different, already-covered code path.
  const handle = await (await import('node:fs/promises')).open(bigDocx, 'w');
  await handle.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 0, 4, 0);
  await handle.truncate(MAX_EXTRACTION_INPUT_BYTES + 1024);
  await handle.close();

  const result = intake(root, [bigDocx]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Warning:.*extraction limit/);
  const source = await loadSource(root, 'SRC-0001');
  assert.equal(source.contentAvailability, 'original-only');
  assert.equal(source.metadata.extractionSkipped, 'exceeds-extraction-size-limit');
});

test('rollback: a persisted source can be removed if the owning work item fails to be created', async () => {
  const root = await freshWorkspace();
  const normalized = await prepareFileIntake(fixture('sample.txt'));
  const source = await persistSource(root, normalized);
  assert.equal(await exists(sourceDirPath(root, source.id)), true);
  await removeSourceDir(root, source.id);
  assert.equal(await exists(sourceDirPath(root, source.id)), false);
});

test('duplicate intake does not overwrite; checksum match is reported', async () => {
  const root = await freshWorkspace();
  const dupPath = path.join(root, 'duplicate.txt');
  await copyFile(fixture('sample.txt'), dupPath);
  const first = intake(root, [fixture('sample.txt')]);
  assert.match(first.stdout, /Source captured: SRC-0001/);
  const second = intake(root, [dupPath]);
  assert.match(second.stdout, /This file matches existing source SRC-0001\./);
  assert.match(second.stdout, /Source captured: SRC-0002/);
  const sources = await listSources(root);
  assert.deepEqual(sources.map((s) => s.id), ['SRC-0001', 'SRC-0002']);
});

test('restart preserves source relationship and checksum', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.docx')]);
  const meta = await metaOf(root, 'PF-0001');
  assert.equal(meta.sources[0].id, 'SRC-0001');
  assert.equal(meta.sources[0].detectedFormat, 'docx');
  assert.equal(meta.sources[0].contentAvailability, 'extracted');
  const reloaded = await loadSource(root, 'SRC-0001');
  const expected = createHash('sha256').update(await readFile(fixture('sample.docx'))).digest('hex');
  assert.equal(reloaded.original.sha256, expected);
  assert.deepEqual(reloaded.linkedWork, ['PF-0001']);
});

// ---------------------------------------------------------------------------
// Multiple sources
// ---------------------------------------------------------------------------

test('intake accepts multiple files at once, creating one work item with several sources', async () => {
  const root = await freshWorkspace();
  const result = intake(root, [fixture('sample.docx'), fixture('sample.xlsx'), '--title', 'Contract Hub']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sources captured: SRC-0001, SRC-0002/);
  const meta = await metaOf(root, 'PF-0001');
  assert.equal(meta.sources.length, 2);
  assert.equal(meta.titleHint, 'Contract Hub');
});

test('intake add attaches an additional source to an existing work item', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.docx')]);
  const result = run(root, ['intake', 'add', 'PF-0001', fixture('sample.xlsx')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Attached to: PF-0001/);
  assert.match(result.stdout, /Total sources on PF-0001: 2/);
  const meta = await metaOf(root, 'PF-0001');
  assert.equal(meta.sources.length, 2);
  assert.equal(meta.sources[1].name, 'sample.xlsx');
  const source2 = await loadSource(root, 'SRC-0002');
  assert.deepEqual(source2.linkedWork, ['PF-0001']);
});

test('intake add works after the work item has been routed', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.docx')]);
  run(root, ['route', 'PF-0001', '--type', 'feature', '--scope', 'architectural', '--confidence', 'high', '--reason', 'Multi-source SRS.']);
  const result = run(root, ['intake', 'add', 'PF-0001', fixture('sample.xlsx')]);
  assert.equal(result.status, 0, result.stderr);
  const resume = run(root, ['resume']);
  assert.match(resume.stdout, /SRC-0001/);
  assert.match(resume.stdout, /SRC-0002/);
});

// ---------------------------------------------------------------------------
// source list / show
// ---------------------------------------------------------------------------

test('source list shows format and content availability', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.docx')]);
  const result = run(root, ['source', 'list']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SRC-0001 \[DOCX\] sample\.docx — extracted text available/);
});

test('source show --content explains when no text representation exists', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.png')]);
  const result = run(root, ['source', 'show', 'SRC-0001', '--content']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No text representation is available/);
});

test('source show --content prints extracted text for office documents', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.docx')]);
  const result = run(root, ['source', 'show', 'SRC-0001', '--content']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Contract creation/);
});

// ---------------------------------------------------------------------------
// guide / resume expose source quality
// ---------------------------------------------------------------------------

test('guide and resume expose format and content availability', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.docx')]);
  const guide = run(root, ['guide', 'PF-0001']);
  assert.equal(guide.status, 0, guide.stderr);
  assert.match(guide.stdout, /DOCX, extracted text available/);
  const resume = run(root, ['resume']);
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /DOCX, extracted text available/);
});

// ---------------------------------------------------------------------------
// Legacy compatibility
// ---------------------------------------------------------------------------

test('legacy (schemaVersion 1) sources remain readable without migration', async () => {
  const root = await freshWorkspace();
  const dir = path.join(workspacePath(root), 'sources', 'SRC-0001');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SRS.md'), '# Legacy source\n', 'utf8');
  const legacyRecord = {
    schemaVersion: 1,
    id: 'SRC-0001',
    sourceType: 'file',
    sourceName: 'SRS.md',
    sourceRef: 'sources/SRC-0001/SRS.md',
    contentType: 'text/markdown',
    rawText: '# Legacy source\n',
    capturedAt: '2026-01-01T00:00:00.000Z',
    metadata: { sizeBytes: 17, sha256: 'a'.repeat(64), extension: '.md' },
    linkedWork: ['PF-0001']
  };
  await writeYaml(path.join(dir, 'source.json'), legacyRecord);

  const loaded = await loadSource(root, 'SRC-0001');
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(await loadSourceText(root, loaded), '# Legacy source\n');

  const listResult = run(root, ['source', 'list']);
  assert.equal(listResult.status, 0, listResult.stderr);
  assert.match(listResult.stdout, /SRC-0001/);

  const showResult = run(root, ['source', 'show', 'SRC-0001']);
  assert.equal(showResult.status, 0, showResult.stderr);
  assert.match(showResult.stdout, /Content: native text/);
});

test('new sources are always written as the current schema version', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.txt')]);
  const record = await loadSource(root, 'SRC-0001');
  assert.equal(record.schemaVersion, SOURCE_SCHEMA_VERSION);
});

// ---------------------------------------------------------------------------
// Everything else already proven in the v0.3.1 foundation continues to hold
// ---------------------------------------------------------------------------

test('existing text start still works, unaffected by universal file intake', async () => {
  const root = await freshWorkspace();
  const result = run(root, ['start', 'Production upload returns 500']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Raw request: Production upload returns 500/);
  const meta = await metaOf(root, 'PF-0001');
  assert.equal(meta.rawRequest, 'Production upload returns 500');
  assert.equal(meta.sources, undefined);
});

test('old workspace without sources/ loads, and read-only commands never create it', async () => {
  const root = await freshWorkspace();
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false);
  for (const args of [['source', 'list'], ['status'], ['doctor']]) {
    const result = run(root, args);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(await exists(path.join(workspacePath(root), 'sources')), false);
});

test('optional title and no routing inference', async () => {
  const root = await freshWorkspace();
  intake(root, [fixture('sample.docx'), '--title', 'Contract Management System']);
  const pending = await metaOf(root, 'PF-0001');
  assert.equal(pending.titleHint, 'Contract Management System');
  assert.equal(pending.type, null);
  assert.equal(pending.scope, null);
  assert.equal(pending.routingStatus, 'pending');
});
