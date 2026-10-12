import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import { describePurpose, loadWorkPurpose, setWorkPurpose } from '../purpose/store.js';

// yallaflow purpose set|show — the discovery purpose and preservation intent of a work
// item (work/<id>/purpose.yaml). Never project truth; never promoted.
export async function purposeCommand(action, requestedWorkId, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const workId = requestedWorkId ?? (await getCurrentState(root)).activeWork;
  if (!workId) throw new Error(`No active work item. Provide a work ID: \`yallaflow purpose ${action} <work-id> ...\`.`);
  if (action === 'set') {
    const { purpose, replaced } = await setWorkPurpose(root, workId, options);
    console.log(`Discovery purpose ${replaced ? 'updated' : 'recorded'} for ${workId}: ${describePurpose(purpose)}`);
    console.log('Work intent only: it guides discovery depth and later delivery checks, and is never promoted into project memory.');
    return;
  }
  const purpose = await loadWorkPurpose(root, workId);
  if (!purpose) {
    console.log(`${workId} has no recorded discovery purpose (canonical core discovery only).`);
    return;
  }
  console.log(`${workId} discovery purpose`);
  console.log(`Mode: ${purpose.mode}`);
  console.log(`Objective: ${purpose.objective}`);
  console.log(`Preserve: ${purpose.preservation.length ? purpose.preservation.join('; ') : '(none recorded)'}`);
  console.log(`Deepen: ${purpose.focus.length ? purpose.focus.join('; ') : '(Agent-derived from the objective)'}`);
}
