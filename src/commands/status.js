import { findProjectRoot, getCurrentState, listWork } from '../core/workspace.js';
import { loadWorkProgress } from '../core/progress.js';
import { buildBehaviorGuidance } from '../behavior/guidance.js';
import { loadWorkReadiness } from '../behavior/readiness.js';
import { formatSourceList } from '../intake/normalize.js';

export async function statusCommand() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const [state, work] = await Promise.all([getCurrentState(root), listWork(root)]);
  console.log(`Active work: ${state.activeWork ?? 'none'}`);
  console.log(`Stage: ${state.stage ?? 'none'}`);
  console.log(`Work items: ${work.length}`);
  for (const item of work) {
    if (item.routingStatus === 'pending') {
      console.log(`\n${item.id}`);
      console.log('Routing: pending');
      if (item.sources?.length) console.log(`Source: ${formatSourceList(item.sources)}`);
      else console.log(`Raw request: ${item.rawRequest}`);
      console.log('Next: classify work type and scope');
      continue;
    }
    if (item.routingStatus === 'routed') {
      const stage = item.id === state.activeWork ? state.stage : item.status;
      const progress = await loadWorkProgress(root, item);
      const guidance = buildBehaviorGuidance(item, stage, progress.ledger);
      const readiness = await loadWorkReadiness(root, { ...item, status: stage });
      console.log(`\n${item.id} — ${item.title ?? `${capitalize(item.type)} work`}`);
      console.log(`${item.type} / ${item.scope}`);
      if (item.sources?.length) console.log(`Source: ${formatSourceList(item.sources)}`);
      console.log(`Stage: ${stage}`);
      console.log(`Behavior: ${guidance.progress.completedCount}/${guidance.progress.totalCount} completed`);
      console.log(`Current skill: ${guidance.progress.current?.skillId ?? 'none'}`);
      console.log(`Delivery: ${readiness.deliveryStatus ?? 'not ready'}`);
      console.log(`Write access: ${guidance.modification.authorized ? 'authorized' : 'blocked'}`);
      continue;
    }
    const scope = item.scope ?? item.complexity ?? 'unspecified';
    console.log(`- ${item.id} [${item.type}] ${item.status} (${scope}) — ${item.title}`);
  }
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
