import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import { createPendingIntake } from '../behavior/routing.js';
import { CONFIDENCE_LEVELS, SCOPES, WORK_TYPES } from '../behavior/constants.js';

export async function startCommand(rawRequest = '') {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (rawRequest) {
    const item = await createPendingIntake(root, rawRequest);
    console.log(`Created ${item.id}`);
    console.log('Routing: pending');
    console.log(`Raw request: ${item.rawRequest}`);
    console.log('\nAgent routing contract:');
    console.log(`  work_type: ${WORK_TYPES.join(' | ')}`);
    console.log(`  scope: ${SCOPES.join(' | ')}`);
    console.log(`  confidence: ${CONFIDENCE_LEVELS.join(' | ')}`);
    console.log('  reason: non-empty explanation');
    console.log(`\nNext: yallaflow route ${item.id} --type TYPE --scope SCOPE --confidence LEVEL --reason "REASON" --title "CONCISE TITLE"`);
    return;
  }
  const state = await getCurrentState(root);
  console.log('YallaFlow is ready.');
  if (state.activeWork) console.log(`There is active work (${state.activeWork}). Use: yallaflow resume`);
  console.log('\nChoose the engineering intent:');
  console.log('  yallaflow feature "<title>"      New functionality');
  console.log('  yallaflow bug "<title>"          Something is broken');
  console.log('  yallaflow investigate "<title>"  Read-only root-cause / feasibility investigation');
  console.log('  yallaflow change "<title>"       Existing requirement changed');
  console.log('  yallaflow refactor "<title>"     Behavior-preserving code improvement');
  console.log('  yallaflow release "<title>"      Release work');
  console.log('  yallaflow status                   Project engineering status');
  console.log('\nOr create an unclassified intake: yallaflow start "<request>"');
}
