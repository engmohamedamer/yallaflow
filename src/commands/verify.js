import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { nextVerificationRunId, recordVerification, listVerificationRuns } from '../core/evidence.js';
import { findProjectRoot, getCurrentState, workspacePath } from '../core/workspace.js';
import { readYaml } from '../core/yaml.js';

// GAP-VERIFY-001: argv boundaries are preserved exactly and executed with shell:false
// by default — YallaFlow never reconstructs a shell command from argv. Shell syntax
// (pipes, redirection) requires the explicit --shell mode below.
async function runArgv(root, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, shell: false, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  return {
    executionMode: 'argv',
    executable,
    args,
    displayCommand: formatArgv([executable, ...args]),
    result
  };
}

// GAP-VERIFY-001 (explicit escape hatch): shell interpretation only ever happens when
// requested by name, never silently.
async function runShell(root, shellCommand) {
  const result = spawnSync(shellCommand, { cwd: root, shell: true, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  return { executionMode: 'shell', executable: shellCommand, args: [], displayCommand: shellCommand, result };
}

async function runScript(root, scriptPath) {
  const result = spawnSync(scriptPath, [], { cwd: root, shell: false, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  return { executionMode: 'script', executable: scriptPath, args: [], displayCommand: `script ${scriptPath}`, result };
}

function formatArgv(argv) {
  return argv.map((token) => (/\s/.test(token) ? `"${token}"` : token)).join(' ');
}

async function runVerification(root, workId, execution) {
  const state = await getCurrentState(root);
  const resolvedWorkId = workId ?? state.activeWork;
  if (!resolvedWorkId) throw new Error('No active work item to verify.');
  const meta = await readYaml(path.join(workspacePath(root), 'work', resolvedWorkId, 'meta.yaml'));
  if (meta.routingStatus === 'pending') throw new Error(`${meta.id} is awaiting routing. Run \`yallaflow route\` first.`);

  const startedAt = new Date().toISOString();
  const { executionMode, executable, args, displayCommand, result } = await execution(root);
  const finishedAt = new Date().toISOString();
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const runId = await nextVerificationRunId(root, resolvedWorkId);
  const logName = `${runId}-verification.log`;
  const logFile = path.join(workspacePath(root), 'work', resolvedWorkId, 'evidence', logName);
  await writeFile(logFile, output, 'utf8');
  const record = {
    command: displayCommand,
    executionMode,
    executable,
    args,
    displayCommand,
    success: result.status === 0,
    exitCode: result.status,
    startedAt,
    finishedAt,
    log: logName
  };
  const run = await recordVerification(root, resolvedWorkId, record);
  if (output) process.stdout.write(output);
  console.log(`Verification ${run.status.toUpperCase()} (exit ${run.exitCode ?? 'unknown'}) — ${run.id} [${executionMode}].`);
  if (!run.success) process.exitCode = 1;
}

export async function verifyCommand(argv, requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!argv.length) throw new Error('Usage: yallaflow verify [work-id] -- <executable> [args...]');
  const [executable, ...args] = argv;
  return runVerification(root, requestedWorkId, (workRoot) => runArgv(workRoot, executable, args));
}

export async function verifyShellCommand(shellCommand, requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!shellCommand || !shellCommand.trim()) throw new Error('Usage: yallaflow verify [work-id] --shell "<command>"');
  return runVerification(root, requestedWorkId, (workRoot) => runShell(workRoot, shellCommand));
}

export async function verifyScriptCommand(scriptPath, requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!scriptPath || !scriptPath.trim()) throw new Error('Usage: yallaflow verify [work-id] --script <path>');
  return runVerification(root, requestedWorkId, (workRoot) => runScript(workRoot, path.resolve(workRoot, scriptPath)));
}

export async function verifyListCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item. Provide a work ID: `yallaflow verify list PF-0001`.');
  const runs = await listVerificationRuns(root, workId);
  if (!runs.length) {
    console.log(`${workId}: no verification evidence recorded.`);
    return;
  }
  console.log(`${workId} — ${runs.length} verification run${runs.length === 1 ? '' : 's'}:`);
  for (const run of runs) {
    const mode = run.executionMode ? ` [${run.executionMode}]` : '';
    console.log(`${run.id} — ${run.status.toUpperCase()}${mode} (exit ${run.exitCode ?? 'unknown'}) — ${run.displayCommand ?? run.command}`);
    console.log(`  verified: ${run.verifiedAt}`);
  }
}
