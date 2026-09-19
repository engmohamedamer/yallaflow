import { REGISTRY_VERSION } from './constants.js';
import { SKILL_REGISTRY } from './registry.js';
import { validateRegistryStructure } from './validation.js';

export function resolveSkills(capabilities, registry = SKILL_REGISTRY) {
  if (!Array.isArray(capabilities)) throw new Error('Capabilities must be an array.');
  validateRegistryStructure(registry);

  const skillsById = new Map(registry.map((entry) => [entry.id, entry]));
  const skillsByCapability = new Map(registry.map((entry) => [entry.capability, entry]));
  const resolved = [];
  const included = new Set();
  const visiting = new Set();

  function includeSkill(skillId, chain = []) {
    if (visiting.has(skillId)) throw new Error(`Circular skill prerequisite: ${[...chain, skillId].join(' -> ')}.`);
    if (included.has(skillId)) return;
    const entry = skillsById.get(skillId);
    if (!entry) throw new Error(`Unknown prerequisite skill: ${skillId}.`);
    visiting.add(skillId);
    for (const prerequisite of entry.prerequisites) includeSkill(prerequisite, [...chain, skillId]);
    visiting.delete(skillId);
    included.add(skillId);
    resolved.push(skillId);
  }

  for (const capability of capabilities) {
    const entry = skillsByCapability.get(capability);
    if (!entry) throw new Error(`Unknown capability: ${JSON.stringify(capability)}.`);
    includeSkill(entry.id);
  }
  return resolved;
}

export function resolveBehaviorContract(meta) {
  if (meta?.behaviorContract) {
    const contract = meta.behaviorContract;
    if (!Number.isInteger(contract.registryVersion) || contract.registryVersion < 1 || !Array.isArray(contract.skills)) {
      throw new Error(`Work item ${meta.id ?? '<unknown>'} has an invalid behavior contract.`);
    }
    return {
      registryVersion: contract.registryVersion,
      skills: [...contract.skills],
      pinned: true,
      label: `registry v${contract.registryVersion} (pinned)`
    };
  }
  if (Array.isArray(meta?.requiredCapabilities)) {
    return {
      registryVersion: REGISTRY_VERSION,
      skills: resolveSkills(meta.requiredCapabilities),
      pinned: false,
      label: 'derived (legacy v0.2.1)'
    };
  }
  return {
    registryVersion: null,
    skills: [],
    pinned: false,
    label: 'unavailable (legacy work without stored capabilities)'
  };
}
