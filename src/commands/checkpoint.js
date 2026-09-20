import { checkpointWork, reviseCheckpoint } from '../core/progress.js';
import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import { reconcileStageAfterCheckpointRevision } from '../core/transitions.js';

export async function checkpointCommand(requestedWorkId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item. Provide a work ID: `yallaflow checkpoint PF-0001 ...`.');

  const result = await checkpointWork(root, workId, input);
  if (result.checkpoint) {
    console.log(`${workId} — ${input.skillId}: ${result.checkpoint.status}`);
    if (result.unchanged) console.log('Checkpoint already completed; no changes recorded.');
    else console.log(`Progress: ${result.ledger.skills[input.skillId].status}`);
  }
  if (input.ruling) console.log(`Ruling recorded: ${input.ruling.decision}`);
  console.log('Ledger: .yallaflow/work/' + workId + '/progress.yaml');
}

export async function reviseCheckpointCommand(requestedWorkId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item. Provide a work ID: `yallaflow checkpoint revise PF-0001 ...`.');

  const result = await reviseCheckpoint(root, workId, input);
  const stageCorrection = await reconcileStageAfterCheckpointRevision(root, result.meta, input.skillId, input.reason);
  console.log(`${workId} — ${input.skillId}: ${result.ledger.history.at(-1).from} → ${input.status}`);
  console.log(`Reason: ${input.reason}`);
  if (stageCorrection) console.log(`Stage corrected: ${stageCorrection.from} → ${stageCorrection.to}`);
  console.log('Correction recorded in .yallaflow/work/' + workId + '/progress.yaml');
}
