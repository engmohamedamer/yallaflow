import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { recordVerification } from '../core/evidence.js';
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
  const logFile = path.join(workspacePath(root), 'work', state.activeWork, 'evidence', 'verification.log');
  await writeFile(logFile, output, 'utf8');
  const record = {
    command,
    success: result.status === 0,
    exitCode: result.status,
    startedAt,
    finishedAt,
    log: 'verification.log'
  };
  await recordVerification(root, state.activeWork, record);
  if (output) process.stdout.write(output);
  console.log(`Verification ${record.success ? 'PASSED' : 'FAILED'} (exit ${record.exitCode ?? 'unknown'}).`);
  if (!record.success) process.exitCode = 1;
}
