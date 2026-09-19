import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import { loadWorkMeta } from '../knowledge/store.js';
import { loadWorkReadiness } from '../behavior/readiness.js';

export async function readyCommand(requestedWorkId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item. Provide a work ID: `yallaflow ready PF-0001`.');
  const meta = await loadWorkMeta(root, workId);
  if (meta.routingStatus === 'pending') throw new Error(`${workId} is awaiting routing.`);
  const readiness = await loadWorkReadiness(root, meta);

  console.log(`${meta.id} — ${meta.title ?? `${capitalize(meta.type)} work`}`);
  console.log(`Delivery status: ${readiness.deliveryStatus ?? 'NOT_READY'}`);
  printReadiness('Specification readiness', readiness.specification);
  printReadiness('Plan readiness', readiness.plan);
  console.log(`Application implementation: ${readiness.implementation.status.replaceAll('_', ' ')}`);
  console.log(`Open material decisions: ${readiness.questions.materialOpen.length}`);
}

function printReadiness(label, result) {
  console.log(`\n${label}: ${result.status.replaceAll('_', ' ')}`);
  for (const blocker of result.blockers) console.log(`- ${blocker}`);
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
