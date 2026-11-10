import { readFile } from 'node:fs/promises';
import { findProjectRoot } from '../core/workspace.js';
import { loadIntegration, loadMergeChecks, recordIntegration, setMergeChecks } from '../execution/integration.js';

// yallaflow integration record|show (PF-0112, D10): the durable MERGED & VERIFIED record of a
// work item, written by the console's Review & Merge after every post-merge step succeeded.
export async function integrationCommand(action, workId, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (action === 'record') {
    // Automated Merge is off in 1.5.0 (owner, 2026-11-10): nothing may record MERGED & VERIFIED.
    throw new Error('Recording MERGED & VERIFIED is turned off in YallaFlow 1.5.0, with Automated Merge. Merge lanes by hand; the work items stay DONE. No files were changed.');
    // eslint-disable-next-line no-unreachable
    if (!options.file) throw new Error('Usage: yallaflow integration record <work-id> --file <record.json> [--accept-minimum-version 1.5.0]');
    const entry = JSON.parse(await readFile(options.file, 'utf8'));
    const result = await recordIntegration(root, workId, entry, { acceptMinimumVersion: options['accept-minimum-version'] });
    if (result.already) console.log(`${workId}: merge ${entry.merge.slice(0, 12)} is already recorded. Nothing changed.`);
    else console.log(`${workId}: MERGED & VERIFIED recorded (merge ${entry.merge.slice(0, 12)} into ${entry.target}).${result.raisedMinimumVersion ? ' This project now requires YallaFlow >= 1.5.0.' : ''}`);
    return;
  }
  const record = await loadIntegration(root, workId);
  if (!record?.integrations?.length) {
    console.log(`${workId} has no recorded integration.`);
    return;
  }
  for (const entry of record.integrations) console.log(`${entry.at} ${entry.state.toUpperCase()} merge ${entry.merge.slice(0, 12)} into ${entry.target} from ${entry.lane} (checks: ${entry.checks.map((check) => check.name).join(', ') || 'none'}; CI ${entry.ci})`);
}

// yallaflow execution checks set|show (PF-0112, D9): the project's required merge checks.
export async function executionChecksCommand(action, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (action === 'set') {
    if (!options.file) throw new Error('Usage: yallaflow execution checks set --file <checks.json> [--accept-minimum-version 1.5.0]');
    const checks = JSON.parse(await readFile(options.file, 'utf8'));
    const result = await setMergeChecks(root, Array.isArray(checks) ? checks : checks.mergeChecks, { acceptMinimumVersion: options['accept-minimum-version'] });
    console.log(`Merge checks recorded: ${result.checks.map((check) => `${check.name}${check.required ? '' : ' (optional)'}`).join(', ') || 'none'}.${result.raisedMinimumVersion ? ' This project now requires YallaFlow >= 1.5.0.' : ''}`);
    console.log('Commit .yallaflow/config.yaml to share them with your team.');
    return;
  }
  const checks = await loadMergeChecks(root);
  if (!checks) {
    console.log('No merge checks declared. Review & Merge is blocked while Git hooks or CI exist and no checks are declared.');
    return;
  }
  for (const check of checks) console.log(`${check.name}${check.required ? '' : ' (optional)'}: ${check.argv.join(' ')}`);
}
