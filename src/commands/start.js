import { findProjectRoot, getConfig, getCurrentState } from '../core/workspace.js';
import { understandingNotice } from '../baseline/understanding.js';
import { activateWorkItem, createPendingIntake, findWorkByRequestId } from '../behavior/routing.js';
import { CONFIDENCE_LEVELS, SCOPES, WORK_TYPES } from '../behavior/constants.js';

// keepActive (v1.2.0, opt-in): create without activating; the checkout's focus is unchanged.
// via/requestId (v1.2.0): record who asked (an unverified console attestation, Q-004) and
// make a retried request return the item it already created instead of a duplicate.
export async function startCommand(rawRequest = '', { keepActive = false, via = null, requestId = null } = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (rawRequest) {
    if (requestId) {
      const existing = await findWorkByRequestId(root, requestId);
      if (existing) {
        console.log(`Already created ${existing.id} for request ${requestId}; nothing new was created.`);
        return;
      }
    }
    const item = await createPendingIntake(root, rawRequest, { keepActive, ...(via ? { attestation: { recordedVia: via, requestId } } : {}) });
    console.log(`Created ${item.id}`);
    if (item.activation?.deferred) console.log(`Not made active${item.activation.keptActive ? `: ${item.activation.keptActive} stays the active work item in this checkout` : ' (no work item is active in this checkout)'}. Work on ${item.id} by its ID, or run \`yallaflow activate ${item.id}\`.`);
    console.log('Routing: pending');
    console.log(`Raw request: ${item.rawRequest}`);
    console.log('\nAgent routing contract:');
    console.log(`  work_type: ${WORK_TYPES.join(' | ')}`);
    console.log(`  scope: ${SCOPES.join(' | ')}`);
    console.log(`  confidence: ${CONFIDENCE_LEVELS.join(' | ')}`);
    console.log('  reason: non-empty explanation');
    console.log(`\nNext: yallaflow route ${item.id} --type TYPE --scope SCOPE --confidence LEVEL --reason "REASON" --title "CONCISE TITLE"`);
    const notice = await understandingNotice(root, { kind: (await getConfig(root)).project?.kind });
    if (notice.length) console.log(`\n${notice.join('\n')}`);
    return;
  }
  const state = await getCurrentState(root);
  console.log('YallaFlow is ready.');
  if (state.activeWork) console.log(`There is active work (${state.activeWork}). Use: yallaflow resume`);
  console.log('\nChoose the engineering intent (type and scope are both required; scope: spike | bounded | architectural):');
  console.log('  yallaflow feature "<title>" --scope SCOPE      New functionality');
  console.log('  yallaflow bug "<title>" --scope SCOPE          Something is broken');
  console.log('  yallaflow investigate "<title>" --scope SCOPE  Read-only root-cause / feasibility investigation');
  console.log('  yallaflow change "<title>" --scope SCOPE       Existing requirement changed');
  console.log('  yallaflow refactor "<title>" --scope SCOPE     Behavior-preserving code improvement');
  console.log('  yallaflow release "<title>" --scope SCOPE      Release work');
  console.log('  yallaflow status                   Project engineering status');
  console.log('\nOr create an unclassified intake: yallaflow start "<request>"');
}

// `yallaflow activate <work-id>` (v1.2.0): the explicit focus switch.
export async function activateCommand(workId) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!workId) throw new Error('Usage: yallaflow activate <work-id>');
  const result = await activateWorkItem(root, workId);
  console.log(result.previous === result.id ? `${result.id} is already the active work item.` : `${result.id} is now the active work item${result.previous ? ` (was ${result.previous})` : ''}.`);
  console.log(`Next: yallaflow guide ${result.id}`);
}
