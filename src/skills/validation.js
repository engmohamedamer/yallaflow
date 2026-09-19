import path from 'node:path';
import { access } from 'node:fs/promises';
import { CAPABILITIES } from '../behavior/constants.js';
import { REGISTRY_VERSION, SKILL_MODES, SKILL_PHASES } from './constants.js';
import { instructionFilePath, PACKAGE_ROOT, SKILL_REGISTRY } from './registry.js';

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'version',
  'capability',
  'title',
  'phase',
  'mode',
  'prerequisites',
  'instructionPath'
]);

export function validateRegistryStructure(registry = SKILL_REGISTRY) {
  if (!Array.isArray(registry) || registry.length === 0) throw new Error('Skill registry must be a non-empty array.');

  const ids = new Map();
  const capabilities = new Map();
  for (const entry of registry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Each skill registry entry must be an object.');
    const missing = REQUIRED_FIELDS.filter((field) => !Object.hasOwn(entry, field));
    if (missing.length) throw new Error(`Skill registry entry is missing required field(s): ${missing.join(', ')}.`);
    const unknown = Object.keys(entry).filter((field) => !REQUIRED_FIELDS.includes(field));
    if (unknown.length) throw new Error(`Skill ${entry.id ?? '<unknown>'} has unknown field(s): ${unknown.join(', ')}.`);
    if (typeof entry.id !== 'string' || !entry.id.trim()) throw new Error('Skill id must be a non-empty string.');
    if (!Number.isInteger(entry.version) || entry.version < 1) throw new Error(`Skill ${entry.id} version must be a positive integer.`);
    if (typeof entry.capability !== 'string' || !CAPABILITIES.includes(entry.capability)) {
      throw new Error(`Skill ${entry.id} capability must be one of: ${CAPABILITIES.join(', ')}.`);
    }
    if (typeof entry.title !== 'string' || !entry.title.trim()) throw new Error(`Skill ${entry.id} title must be non-empty.`);
    if (!SKILL_PHASES.includes(entry.phase)) throw new Error(`Skill ${entry.id} phase must be one of: ${SKILL_PHASES.join(', ')}.`);
    if (!SKILL_MODES.includes(entry.mode)) throw new Error(`Skill ${entry.id} mode must be one of: ${SKILL_MODES.join(', ')}.`);
    if (!Array.isArray(entry.prerequisites) || entry.prerequisites.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new Error(`Skill ${entry.id} prerequisites must be an array of skill IDs.`);
    }
    if (typeof entry.instructionPath !== 'string' || !entry.instructionPath.trim()) {
      throw new Error(`Skill ${entry.id} instructionPath must be non-empty.`);
    }
    if (path.isAbsolute(entry.instructionPath) || entry.instructionPath.split(/[\\/]+/).includes('..')) {
      throw new Error(`Skill ${entry.id} instructionPath must stay within the package.`);
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate skill id: ${entry.id}.`);
    if (capabilities.has(entry.capability)) {
      throw new Error(`Duplicate capability ownership: ${entry.capability} is owned by ${capabilities.get(entry.capability)} and ${entry.id}.`);
    }
    ids.set(entry.id, entry);
    capabilities.set(entry.capability, entry.id);
  }

  for (const capability of CAPABILITIES) {
    if (!capabilities.has(capability)) throw new Error(`No skill owns capability: ${capability}.`);
  }
  for (const entry of registry) {
    for (const prerequisite of entry.prerequisites) {
      if (!ids.has(prerequisite)) throw new Error(`Skill ${entry.id} has unknown prerequisite: ${prerequisite}.`);
    }
  }

  detectCircularPrerequisites(ids);
  return true;
}

export async function validateSkillRegistry(registry = SKILL_REGISTRY, options = {}) {
  validateRegistryStructure(registry);
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  for (const entry of registry) {
    const file = instructionFilePath(entry, packageRoot);
    try {
      await access(file);
    } catch {
      throw new Error(`Skill ${entry.id} instruction file is missing: ${entry.instructionPath}.`);
    }
  }
  return { registryVersion: REGISTRY_VERSION, skillCount: registry.length };
}

function detectCircularPrerequisites(skillsById) {
  const visiting = new Set();
  const visited = new Set();

  function visit(skillId, chain) {
    if (visiting.has(skillId)) throw new Error(`Circular skill prerequisite: ${[...chain, skillId].join(' -> ')}.`);
    if (visited.has(skillId)) return;
    visiting.add(skillId);
    const entry = skillsById.get(skillId);
    for (const prerequisite of entry.prerequisites) visit(prerequisite, [...chain, skillId]);
    visiting.delete(skillId);
    visited.add(skillId);
  }

  for (const skillId of skillsById.keys()) visit(skillId, []);
}
