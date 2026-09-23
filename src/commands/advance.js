import { advanceActiveWork, evaluateAdvance } from '../core/transitions.js';
import { findProjectRoot, loadWorkMetaOrThrow } from '../core/workspace.js';

export async function advanceCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const result = await advanceActiveWork(root, requestedWorkId);
  console.log(`${result.id}: ${result.from} → ${result.to}`);
  if (result.to === 'DONE') {
    console.log('Work item closed. Durable work state has been recorded.');
    return;
  }
  // Report the next boundary immediately (read-only) instead of making the agent
  // discover it with another advance/guide round-trip.
  const meta = await loadWorkMetaOrThrow(root, result.id);
  const verdict = await evaluateAdvance(root, meta, result.to, { mutate: false });
  console.log(verdict.allowed
    ? `Next valid action: yallaflow advance ${result.id} (no blocker for ${result.to} → ${verdict.next})`
    : `Blocker before ${verdict.next}: ${verdict.blocker}\nNext valid action: ${verdict.action}`);
}
