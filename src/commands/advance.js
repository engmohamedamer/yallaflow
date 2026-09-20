import { advanceActiveWork } from '../core/transitions.js';
import { findProjectRoot } from '../core/workspace.js';

export async function advanceCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const result = await advanceActiveWork(root, requestedWorkId);
  console.log(`${result.id}: ${result.from} → ${result.to}`);
  if (result.to === 'DONE') console.log('Work item closed. Durable work state has been recorded.');
}
