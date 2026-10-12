import { routeWorkItem } from '../behavior/routing.js';
import { findProjectRoot, getConfig } from '../core/workspace.js';
import { understandingNotice } from '../baseline/understanding.js';

export async function routeCommand(workId, decision) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const item = await routeWorkItem(root, workId, decision);
  console.log(`Routed ${item.id}`);
  console.log(`Title: ${item.title}`);
  console.log(`Type: ${item.type}`);
  console.log(`Scope: ${item.scope}`);
  console.log(`Routing confidence: ${item.routingConfidence}`);
  console.log(`Workflow: ${item.workflow}`);
  console.log(`Required capabilities: ${item.requiredCapabilities.join(', ')}`);
  console.log(`Behavior contract: registry v${item.behaviorContract.registryVersion} (pinned)`);
  if (item.readOnly) console.log('Safety: read-only; application code changes are not authorized by this route.');
  console.log('Next: yallaflow resume');
  const notice = await understandingNotice(root, { kind: (await getConfig(root)).project?.kind, workMeta: item });
  if (notice.length) console.log(`\n${notice.join('\n')}`);
}
