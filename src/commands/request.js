import { reviseRequest } from '../behavior/routing.js';
import { findProjectRoot } from '../core/workspace.js';

export async function requestReviseCommand(workId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!workId) throw new Error('Usage: yallaflow request revise <work-id> --text TEXT --reason TEXT');
  const meta = await reviseRequest(root, workId, input);
  console.log(`${workId} — request revised.`);
  console.log(`Raw request: ${meta.rawRequest}`);
  console.log(`Reason: ${input.reason}`);
}
