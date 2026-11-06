// `yallaflow work hold|resume|close` and `yallaflow reopen` of closed work (v1.4.0, PF-0041).
import { findProjectRoot, isSharedWorkspace } from '../core/workspace.js';
import { closeWork, holdWork, reopenClosedWork, resumeWork } from '../core/lifecycle.js';

async function rootOrThrow() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  return root;
}

function report(result, verb) {
  console.log(`${result.id}: ${verb} (stage ${result.stage ?? 'none'} unchanged).`);
  if (result.clearedActive) console.log(`${result.id} is no longer the active work item; activate another with \`yallaflow activate <work-id>\`.`);
  if (result.raisedMinimumVersion) console.log('This project now requires YallaFlow >= 1.4.0 (confirmed with --accept-minimum-version).');
}

export async function workLifecycleCommand(action, workId, values) {
  const root = await rootOrThrow();
  const shared = await isSharedWorkspace(root);
  if (action === 'hold') {
    const result = await holdWork(root, workId, { reason: values.reason, acceptMinimumVersion: values['accept-minimum-version'], shared });
    report(result, 'on hold');
    console.log(`Resume it with \`yallaflow work resume ${result.id}\`; nothing else about it changed.`);
    return;
  }
  if (action === 'resume') {
    const result = await resumeWork(root, workId, { note: values.note });
    report(result, 'resumed');
    console.log(`It is not activated automatically: \`yallaflow activate ${result.id}\` makes it the active work item.`);
    return;
  }
  const result = await closeWork(root, workId, { outcome: values.outcome, reason: values.reason, by: values.by, acceptMinimumVersion: values['accept-minimum-version'], shared });
  report(result, `closed without delivery as ${values.outcome}`);
  console.log('Closed work is never counted as done, delivered or verified. Reopen it with `yallaflow reopen ' + result.id + ' --reason "..."`.');
}

export async function reopenClosedCommand(workId, reason) {
  const root = await rootOrThrow();
  const result = await reopenClosedWork(root, workId, { reason });
  report(result, 'reopened from closure');
  console.log(`Continue from its stage; activate it with \`yallaflow activate ${result.id}\` when you work on it.`);
}
