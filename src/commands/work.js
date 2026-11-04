import { findProjectRoot, getConfig } from '../core/workspace.js';
import { understandingNotice } from '../baseline/understanding.js';
import { createRoutedWork } from '../behavior/routing.js';
import { resolveWorkflowPolicy } from '../behavior/policy.js';
import { applySplit, planSplit } from '../core/split.js';

// Direct classified shortcuts (`yallaflow feature|bug|investigate|change|refactor|release`).
// The user states the classification explicitly — type from the command, scope from
// --scope — and the work is created through the same canonical routed path as
// `start` → `route`. Scope is never guessed: without it nothing is created.
export async function newWorkCommand(type, title, scope, commandName = type) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!scope) {
    throw new Error(
      'Direct work commands require --scope because work classification includes both type and scope.\n\n' +
      `Example:\nyallaflow ${commandName} ${JSON.stringify(title)} --scope bounded\n\n` +
      `Or use:\nyallaflow start ${JSON.stringify(title)}\n\nto let the Agent classify the request.\n\nNo work item was created.`
    );
  }
  resolveWorkflowPolicy(type, scope); // rejects an unsupported type/scope pair before any write
  const meta = await createRoutedWork(root, title, {
    work_type: type,
    scope,
    confidence: 'high',
    reason: `Explicitly classified by the user: \`yallaflow ${commandName} --scope ${scope}\`.`,
    title
  });
  console.log(`Created ${meta.id}: ${meta.title}`);
  console.log(`Type: ${meta.type} / Scope: ${meta.scope}`);
  console.log(`Workflow: ${meta.workflow}`);
  console.log(`Stage: ${meta.status}`);
  console.log(`Behavior contract: registry v${meta.behaviorContract.registryVersion} (pinned) — ${meta.behaviorContract.skills.join(', ')}`);
  if (meta.readOnly) console.log('Safety: read-only; application code changes are not authorized by this workflow.');
  console.log(`Path: .yallaflow/work/${meta.id}/work.md`);
  console.log(`Next: yallaflow guide ${meta.id}`);
  const notice = await understandingNotice(root, { kind: (await getConfig(root)).project?.kind, workMeta: meta });
  if (notice.length) console.log(`\n${notice.join('\n')}`);
}

// `yallaflow work split <PF-####>` / `yallaflow source split <SRC-####>` [--dry-run] —
// repairs an ID collision reported by doctor. Writes only under .yallaflow; never commits.
export async function splitCommand(kind, id, { dryRun = false } = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const label = kind === 'work' ? 'work item' : 'source';
  const plan = await planSplit(root, kind, id);
  console.log(`${id} holds ${plan.moves.length + 1} ${label}s from different branches.`);
  console.log(`Stays as ${id}: "${plan.current.title}" (${plan.current.identity})`);
  for (const item of plan.moves) console.log(`Moves to a new ID: "${item.title}" (${item.identity}) — ${item.files.length} file(s) restored from commit ${item.commit.slice(0, 12)}`);
  if (plan.remove.length) console.log(`Taken out of ${id} (they belong to the moved ${label}): ${plan.remove.join(', ')}`);
  if (plan.restore.length) console.log(`Restored in ${id} (the merge kept the other ${label}'s version): ${plan.restore.join(', ')}`);
  if (plan.references?.move.length) console.log(`Work items whose reference follows the moved source (by its file name): ${plan.references.move.map((entry) => entry.workId).join(', ')}`);
  if (plan.unresolved.length) {
    process.exitCode = 1;
    console.log(`\nCannot split: ${plan.unresolved.length} item(s) in ${id} cannot be attributed to one side mechanically:`);
    for (const item of plan.unresolved) console.log(`  - ${item}`);
    console.log('Files edited after the merge, or merged from both sides, match neither side\'s committed version. Bring each back to one side\'s version with Git (or move it out), then run the split again. Nothing was changed.');
    return;
  }
  if (dryRun) {
    console.log('\nPreview only — nothing was written. Re-run without --dry-run to split.');
    return;
  }
  const result = await applySplit(root, plan);
  console.log('');
  for (const item of result.moved) console.log(`Restored "${item.title}" as ${item.newId} (renumberedFrom records ${id}).`);
  if (result.references.length) {
    console.log(`\nThese files still name ${id}, which now means "${plan.current.title}". Check whether any of them meant the moved ${label}:`);
    for (const file of result.references) console.log(`  - ${file}`);
  }
  console.log('\nNothing was committed. Run `yallaflow doctor`, then commit .yallaflow/.');
}
