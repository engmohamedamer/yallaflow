// v0.3.5 pre-freeze hardening: proves stdin inheritance and stdout/stderr evidence
// capture work together, not just individually — a command that consumes piped stdin
// and produces both stdout and stderr must have all of it land in the evidence log,
// with an accurate exit code and a correctly cross-referenced V-xxx run. Uses
// `spawnSync`'s own `input` option (a finite string, closed immediately) so this can
// never hang CI waiting on an interactive stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { listVerificationRuns } from '../src/core/evidence.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function routedWork() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-verify-evidence-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, 'verify evidence capture fixture');
  const meta = await routeWorkItem(root, intake.id, {
    work_type: 'bug', scope: 'bounded', confidence: 'high', reason: 'Deterministic verify evidence-capture test route.'
  });
  return { root, meta };
}

test('a command consuming stdin and producing stdout+stderr has all three captured correctly, with an accurate exit code', async () => {
  const { root, meta } = await routedWork();
  const script = [
    'const chunks = [];',
    'process.stdin.on("data", (d) => chunks.push(d));',
    'process.stdin.on("end", () => {',
    '  const text = Buffer.concat(chunks).toString();',
    '  process.stdout.write("STDOUT saw: " + text);',
    '  process.stderr.write("STDERR saw: " + text);',
    '  process.exit(0);',
    '});'
  ].join('\n');

  const result = spawnSync(process.execPath, [cli, 'verify', '--', 'node', '-e', script], {
    cwd: root, encoding: 'utf8', input: 'piped-input-value\n'
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);

  // The CLI's own stdout mirrors the verified command's captured output back to the user.
  assert.match(result.stdout, /STDOUT saw: piped-input-value/);
  assert.match(result.stdout, /STDERR saw: piped-input-value/);
  assert.match(result.stdout, /Verification PASSED \(exit 0\) — V-001 \[argv\]\./);

  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.equal(run.success, true);
  assert.equal(run.exitCode, 0);
  assert.equal(run.id, 'V-001');
  assert.equal(run.log, 'V-001-verification.log');

  // The evidence log the run references contains both stdout and stderr content.
  const logPath = path.join(workspacePath(root), 'work', meta.id, 'evidence', run.log);
  const logContent = await readFile(logPath, 'utf8');
  assert.match(logContent, /STDOUT saw: piped-input-value/);
  assert.match(logContent, /STDERR saw: piped-input-value/);
});

test('a failing command with stdin/stdout/stderr is captured and does not erase a prior passing run', async () => {
  const { root, meta } = await routedWork();
  const first = spawnSync(process.execPath, [cli, 'verify', '--', 'true'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);

  const script = [
    'let data = "";',
    'process.stdin.on("data", (d) => { data += d; });',
    'process.stdin.on("end", () => {',
    '  process.stdout.write("about to fail\\n");',
    '  process.stderr.write("failure reason: " + data);',
    '  process.exit(3);',
    '});'
  ].join('\n');
  const second = spawnSync(process.execPath, [cli, 'verify', '--', 'node', '-e', script], {
    cwd: root, encoding: 'utf8', input: 'bad-config\n'
  });
  assert.equal(second.status, 1);
  assert.match(second.stdout, /about to fail/);
  assert.match(second.stdout, /failure reason: bad-config/);
  assert.match(second.stdout, /Verification FAILED \(exit 3\) — V-002 \[argv\]\./);

  const runs = await listVerificationRuns(root, meta.id);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'passed'); // earlier success not erased
  assert.equal(runs[1].status, 'failed');
  assert.equal(runs[1].exitCode, 3);

  const logPath = path.join(workspacePath(root), 'work', meta.id, 'evidence', runs[1].log);
  const logContent = await readFile(logPath, 'utf8');
  assert.match(logContent, /failure reason: bad-config/);
});
