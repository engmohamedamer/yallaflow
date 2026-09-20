import { reopenWork } from '../core/transitions.js';
import { findProjectRoot } from '../core/workspace.js';

export async function reopenCommand(workId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!workId) throw new Error('Usage: yallaflow reopen <work-id> --to implementation|verification|review --reason "..."');
  const result = await reopenWork(root, workId, input);
  console.log(`${result.id}: ${result.from} → ${result.to}`);
  console.log(`Reason: ${result.reason}`);
  console.log('Work reactivated. Fresh verification (and review, where required) is required again before DONE.');
}
