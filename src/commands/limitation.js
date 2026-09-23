import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import { addLimitation, loadWorkLimitations } from '../limitations/store.js';

export async function limitationCommand(action, requestedWorkId, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error(`No active work item. Provide a work ID: \`yallaflow limitation ${action} PF-0001 ...\`.`);

  if (action === 'add') {
    const entry = await addLimitation(root, workId, options);
    console.log(`Recorded ${entry.id} [${entry.type}] ${entry.area} — ${entry.summary}`);
    console.log('Work-scoped discovery limitation: it describes this investigation, not the project, and is never promoted into project context.');
    return;
  }
  if (action === 'list') {
    const { ledger } = await loadWorkLimitations(root, workId);
    if (!ledger.limitations.length) {
      console.log(`${workId}: no discovery limitations recorded.`);
      return;
    }
    console.log(`${workId} discovery limitations (work-scoped, not project facts):`);
    for (const entry of ledger.limitations) console.log(`${entry.id} [${entry.type}] ${entry.area} — ${entry.summary} (reason: ${entry.reason})`);
    return;
  }
  throw new Error(`Unknown limitation action: ${action}. Use add or list.`);
}
