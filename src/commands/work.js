import { createWorkItem, findProjectRoot } from '../core/workspace.js';

export async function newWorkCommand(type, title, scope = null) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const item = await createWorkItem(root, type, title, scope);
  console.log(`Created ${item.id}: ${item.title}`);
  console.log(`Workflow: ${item.type}`);
  console.log(`Scope: ${item.scope ?? 'unspecified'}`);
  console.log(`Stage: ${item.status}`);
  if (item.readOnly) console.log('Safety: read-only investigation; application code changes are not allowed until workflow conversion.');
  console.log(`Path: .yallaflow/work/${item.id}/work.md`);
}
