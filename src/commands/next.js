import { findProjectRoot } from '../core/workspace.js';
import { childProgressView, loadDecomposition, readyChildren } from '../decomposition/store.js';

// Reports every ready child; it never picks one for the Agent — YallaFlow governs
// eligibility, the Agent orchestrates priority.
export async function nextCommand(parentId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!parentId) throw new Error('Usage: yallaflow next <parent-id>');
  const { exists: hasDecomposition, ledger } = await loadDecomposition(root, parentId);
  if (!hasDecomposition) {
    console.log(`${parentId} has no decomposition; there is no child work to select from.`);
    return;
  }
  const view = await childProgressView(root, ledger);
  const ready = readyChildren(view);
  if (!ready.length) {
    const activeCount = view.filter((child) => child.state === 'active').length;
    console.log(activeCount
      ? `${parentId}: no additional ready children; ${activeCount} already active.`
      : `${parentId}: no ready children (remaining work is done or blocked).`);
    return;
  }
  console.log(`${parentId} — ${ready.length} ready child work item(s):`);
  for (const child of ready) console.log(`- ${child.workId} — ${child.title}${child.required ? '' : ' (optional)'}`);
}
