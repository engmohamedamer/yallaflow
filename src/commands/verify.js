import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { nextVerificationRunId, recordVerification, listVerificationRuns } from '../core/evidence.js';
import { findProjectRoot, getCurrentState, workspacePath } from '../core/workspace.js';
import { readYaml } from '../core/yaml.js';

export async function verifyCommand(commandParts) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  if (!state.activeWork) throw new Error('No active work item to verify.');
  const meta = await readYaml(path.join(workspacePath(root), 'work', state.activeWork, 'meta.yaml'));
  if (meta.routingStatus === 'pending') throw new Error(`${meta.id} is awaiting routing. Run \`yallaflow route\` first.`);
  const command = commandParts.join(' ').trim();
  if (!command) throw new Error('Usage: yallaflow verify -- <verification command>');

  const startedAt = new Date().toISOString();
  const result = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8' });
  const finishedAt = new Date().toISOString();
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const runId = await nextVerificationRunId(root, state.activeWork);
  const logName = `${runId}-verification.log`;
  const logFile = path.join(workspacePath(root), 'work', state.activeWork, 'evidence', logName);
  await writeFile(logFile, output, 'utf8');
  const record = {
    command,
    success: result.status === 0,
    exitCode: result.status,
    startedAt,
    finishedAt,
    log: logName
  };
  const run = await recordVerification(root, state.activeWork, record);
  if (output) process.stdout.write(output);
  console.log(`Verification ${run.status.toUpperCase()} (exit ${run.exitCode ?? 'unknown'}) — ${run.id}.`);
  if (!run.success) process.exitCode = 1;
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
    console.log(`${run.id} — ${run.status.toUpperCase()} (exit ${run.exitCode ?? 'unknown'}) — ${run.command}`);
    console.log(`  verified: ${run.verifiedAt}`);
  }
}
