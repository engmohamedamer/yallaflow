// yallaflow refresh check | preview | apply | restore | backups (PF-0183).
// Check for updates, Preview changes, Refresh YallaFlow integration. See src/agent/refresh.js.
import { findProjectRoot } from '../core/workspace.js';
import { applyRefresh, lineDiff, listRefreshBackups, planRefresh, previewRefresh, restoreRefresh } from '../agent/refresh.js';

async function requireRoot() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found here. Run `yallaflow init` first.');
  return root;
}

export function parseResolve(values = []) {
  const resolve = {};
  for (const value of values) {
    const match = /^(.+)=(keep|preserve)$/.exec(String(value));
    if (!match) throw new Error(`--resolve takes FILE=keep or FILE=preserve (got ${value}).`);
    resolve[match[1]] = match[2];
  }
  return resolve;
}

const ACTION_TEXT = {
  none: 'up to date',
  update: 'will update the YallaFlow block only',
  replace: 'will replace the generated file',
  create: 'will create it',
  'add-now': 'will add the YallaFlow block',
  add: 'not set up (optional: --add-missing)',
  conflict: 'NEEDS YOUR DECISION',
  keep: 'kept as it is',
  preserve: 'will install the current block and keep your edited text after it',
  refuse: 'REFUSED'
};

function printPlan(plan) {
  for (const item of plan.items) console.log(`- ${item.file}: ${ACTION_TEXT[item.action]} — ${item.reason}`);
}

function printDecisions(plan) {
  if (plan.conflicts.length) {
    console.log('\nDecide for each edited file, then run the command again with:');
    for (const item of plan.conflicts) console.log(`  --resolve ${item.file}=keep       leave it exactly as it is\n  --resolve ${item.file}=preserve   install the current block, keep your text after it`);
  }
  if (plan.refused.length) console.log('\nRefused files are never written; fix them first (see each reason).');
}

// Check for updates. Read-only.
export async function refreshCheckCommand({ addMissing, resolve } = {}) {
  const root = await requireRoot();
  const plan = await planRefresh(root, { addMissing, resolve: parseResolve(resolve) });
  console.log('Check for updates — YallaFlow integration files');
  printPlan(plan);
  if (plan.refused.length || plan.conflicts.length) printDecisions(plan);
  else if (plan.writes.length) console.log(`\n${plan.writes.length} file(s) can be refreshed. Preview: yallaflow refresh preview`);
  else if (plan.optional.length) console.log('\nEverything that is set up is up to date. Optional blocks not set up are listed above (--add-missing).');
  else console.log('\nEverything is up to date.');
  console.log('Nothing was changed.');
}

// Preview changes. Read-only.
export async function refreshPreviewCommand({ addMissing, resolve } = {}) {
  const root = await requireRoot();
  const preview = await previewRefresh(root, { addMissing, resolve: parseResolve(resolve) });
  console.log('Preview changes — YallaFlow integration files');
  printPlan(preview);
  for (const change of preview.changes) {
    const diff = lineDiff(change.before, change.after);
    console.log(`\n--- ${change.file} (${change.action}): ${diff.removed} line(s) removed, ${diff.added} added; ${diff.unchangedBefore} line(s) before and ${diff.unchangedAfter} after the change are unchanged`);
    for (const line of diff.lines) console.log(line);
  }
  if (preview.refused.length || preview.conflicts.length) printDecisions(preview);
  else if (preview.writes.length) console.log('\nApply: yallaflow refresh apply (with the same --resolve / --add-missing options)');
  else console.log('\nEverything is up to date.');
  console.log('Nothing was changed.');
}

// Refresh YallaFlow integration.
export async function refreshApplyCommand({ addMissing, resolve } = {}) {
  const root = await requireRoot();
  const result = await applyRefresh(root, { addMissing, resolve: parseResolve(resolve) });
  if (!result.written.length) {
    console.log('Refresh YallaFlow integration: everything is already up to date; nothing changed.');
    for (const item of result.optional) console.log(`- ${item.file}: ${ACTION_TEXT.add}`);
    return;
  }
  console.log('Refresh YallaFlow integration: done and verified.');
  for (const file of result.written) console.log(`- ${file}: refreshed`);
  for (const item of result.items.filter((entry) => entry.action === 'keep')) console.log(`- ${item.file}: kept as it is`);
  console.log(`\nBackup of the previous files: .yallaflow/local/backups/${result.backup}`);
  console.log(`To undo: yallaflow refresh restore ${result.backup}`);
  console.log('Work records, project memory, decisions, evidence and sources were not touched.');
}

export async function refreshRestoreCommand(id) {
  const root = await requireRoot();
  const result = await restoreRefresh(root, id ?? null);
  console.log(result.restored.length ? `Restored from ${result.id}: ${result.restored.join(', ')}.` : `${result.id}: the files already match their state before that refresh; nothing to restore.`);
}

export async function refreshBackupsCommand() {
  const root = await requireRoot();
  const backups = await listRefreshBackups(root);
  if (!backups.length) return console.log('No refresh backups.');
  for (const backup of backups) console.log(`${backup.id}  ${backup.state}  ${backup.files.map((file) => file.file).join(', ')}`);
}
