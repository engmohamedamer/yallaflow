import { findSkill, SKILL_REGISTRY } from '../skills/registry.js';
import { validateSkillRegistry } from '../skills/validation.js';
import { loadSkillInstructions, pinnedInstructionVersion } from '../skills/instructions.js';
import { REGISTRY_VERSION } from '../skills/constants.js';
import { findProjectRoot, getCurrentState, loadWorkMetaOrThrow } from '../core/workspace.js';
import { resolveBehaviorContract } from '../skills/resolver.js';

// Prints the exact instructions a work item's Behavior Contract pinned (v0.3.10):
// `--work <id>`, else the active work item when its contract includes the skill,
// else the installed Skill Registry. Released instruction versions are immutable.
export async function skillCommand(skillId, { work } = {}) {
  await validateSkillRegistry();
  const entry = findSkill(skillId);
  if (!entry) {
    throw new Error(`Unknown skill ${JSON.stringify(skillId)}. Available skills: ${SKILL_REGISTRY.map((skill) => skill.id).join(', ')}.`);
  }
  const pin = await resolvePin(skillId, work);
  const instructions = await loadSkillInstructions(entry.id, pin ? pinnedInstructionVersion(pin.registryVersion, entry.id) : entry.version);
  console.log(`Skill: ${entry.id}`);
  console.log(`Version: ${instructions.version}`);
  console.log(`Pinned by: ${pin ? `${pin.workId} (Skill Registry v${pin.registryVersion})` : `installed Skill Registry v${REGISTRY_VERSION}`}`);
  console.log(`Capability: ${entry.capability}`);
  console.log(`Phase: ${entry.phase}`);
  console.log(`Mode: ${entry.mode}`);
  console.log('Prerequisites:');
  if (entry.prerequisites.length) entry.prerequisites.forEach((prerequisite) => console.log(`- ${prerequisite}`));
  else console.log('- none');
  console.log(`\n${instructions.text.trim()}\n`);
}

async function resolvePin(skillId, explicitWork) {
  const root = await findProjectRoot();
  if (!root) {
    if (explicitWork) throw new Error('No .yallaflow workspace found.');
    return null;
  }
  const workId = explicitWork ?? (await getCurrentState(root).catch(() => ({}))).activeWork;
  if (!workId) return null;
  const meta = await loadWorkMetaOrThrow(root, workId);
  const contract = resolveBehaviorContract(meta);
  if (!contract.pinned || !contract.skills.includes(skillId)) {
    if (explicitWork) throw new Error(`${workId}'s Behavior Contract does not include ${skillId} (${contract.label}).`);
    return null;
  }
  return { workId, registryVersion: contract.registryVersion };
}
