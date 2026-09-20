import { findProjectRoot, loadWorkMetaOrThrow } from '../core/workspace.js';
import { childProgressView, loadDecomposition } from '../decomposition/store.js';

export async function projectProgressCommand(parentId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!parentId) throw new Error('Usage: yallaflow progress <parent-id>');
  const meta = await loadWorkMetaOrThrow(root, parentId);
  const { exists: hasDecomposition, ledger } = await loadDecomposition(root, parentId);
  if (!hasDecomposition) {
    console.log(`${parentId} — ${meta.title ?? 'work item'} has no decomposition; it is a normal single work item.`);
    return;
  }

  const view = await childProgressView(root, ledger);
  const required = view.filter((child) => child.required !== false);
  const doneCount = required.filter((child) => child.state === 'done').length;

  console.log(`${parentId} — ${meta.title ?? 'Decomposed work'}`);
  console.log(`\nRequired work: ${required.length}`);
  for (const child of view) {
    const marker = { done: '✓', active: '→', ready: '○', blocked: '⊘', not_created: '·' }[child.state] ?? '?';
    const suffix = child.state === 'blocked' ? ` — blocked by ${child.blockedBy.join(', ')}` : '';
    console.log(`${marker} ${child.workId ?? child.key} ${child.title}${child.required ? '' : ' (optional)'}${suffix}`);
  }
  console.log(`\nProgress:\n${doneCount} / ${required.length} DONE`);
}
