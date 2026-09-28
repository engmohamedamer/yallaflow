import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('exposes the YallaFlow product and CLI identity', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'yallaflow');
  assert.equal(pkg.private, true);
  assert.equal(pkg.description, 'AI-agnostic engineering governance layer for coding agents: durable project memory, adaptive workflows, and evidence-backed delivery.');
  assert.deepEqual(pkg.bin, { yallaflow: 'src/cli.js' });
  assert.equal(pkg.version, '0.3.7-internal.1');

  const result = spawnSync(process.execPath, ['src/cli.js', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^YallaFlow foundation CLI/);
  assert.match(result.stdout, /Give AI your project, not just your prompt\./);
  assert.match(result.stdout, /yallaflow init/);
  assert.match(result.stdout, /yallaflow start \[request\]/);
  assert.match(result.stdout, /yallaflow intake <file> \[<file> \.\.\.\] \[--title TITLE\]/);
  assert.match(result.stdout, /yallaflow intake add <work-id> <file>/);
  assert.match(result.stdout, /yallaflow source --help/);
  assert.match(result.stdout, /yallaflow route <work-id>/);
  assert.match(result.stdout, /yallaflow guide \[work-id\]/);
  assert.match(result.stdout, /yallaflow ready \[work-id\]/);
  assert.match(result.stdout, /yallaflow skill <skill-id>/);
  assert.match(result.stdout, /yallaflow checkpoint --help/);
  assert.match(result.stdout, /yallaflow question --help/);
  assert.match(result.stdout, /yallaflow knowledge --help/);
  assert.match(result.stdout, /yallaflow context --help/);
  assert.match(result.stdout, /yallaflow limitation --help/);
  assert.match(result.stdout, /yallaflow agent --help/);
  assert.doesNotMatch(result.stdout, /\bpf\b/);
});

test('namespace help is concise and discoverable', () => {
  const checkpoint = spawnSync(process.execPath, ['src/cli.js', 'checkpoint', '--help'], { encoding: 'utf8' });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  assert.match(checkpoint.stdout, /yallaflow checkpoint \[work-id\] --skill SKILL --status STATUS/);
  assert.match(checkpoint.stdout, /yallaflow checkpoint revise \[work-id\]/);

  const question = spawnSync(process.execPath, ['src/cli.js', 'question', '--help'], { encoding: 'utf8' });
  assert.equal(question.status, 0, question.stderr);
  assert.match(question.stdout, /yallaflow question add \[work-id\]/);
  assert.match(question.stdout, /yallaflow question resolve \[work-id\]/);

  const knowledge = spawnSync(process.execPath, ['src/cli.js', 'knowledge', '--help'], { encoding: 'utf8' });
  assert.equal(knowledge.status, 0, knowledge.stderr);
  assert.match(knowledge.stdout, /yallaflow knowledge propose \[work-id\]/);
  assert.match(knowledge.stdout, /--source design-spec\|implementation-runtime/);

  const source = spawnSync(process.execPath, ['src/cli.js', 'source', '--help'], { encoding: 'utf8' });
  assert.equal(source.status, 0, source.stderr);
  assert.match(source.stdout, /yallaflow source list/);
  assert.match(source.stdout, /yallaflow source show <source-id> \[--content\]/);
});
