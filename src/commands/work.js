import { findProjectRoot } from '../core/workspace.js';
import { createRoutedWork } from '../behavior/routing.js';
import { resolveWorkflowPolicy } from '../behavior/policy.js';

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
}
