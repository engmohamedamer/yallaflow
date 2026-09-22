import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function skill(definition) {
  return Object.freeze({
    ...definition,
    prerequisites: Object.freeze([...definition.prerequisites])
  });
}

export const SKILL_REGISTRY = Object.freeze([
  skill({
    id: 'context-discovery',
    version: 1,
    capability: 'discover',
    title: 'Context Discovery',
    phase: 'discovery',
    mode: 'read-only',
    prerequisites: [],
    instructionPath: 'resources/skills/context-discovery.md'
  }),
  skill({
    id: 'requirement-clarification',
    version: 1,
    capability: 'clarify',
    title: 'Requirement Clarification',
    phase: 'analysis',
    mode: 'read-only',
    prerequisites: ['context-discovery'],
    instructionPath: 'resources/skills/requirement-clarification.md'
  }),
  skill({
    id: 'design-exploration',
    version: 1,
    capability: 'brainstorm',
    title: 'Design Exploration',
    phase: 'design',
    mode: 'read-only',
    prerequisites: ['context-discovery', 'requirement-clarification'],
    instructionPath: 'resources/skills/design-exploration.md'
  }),
  skill({
    id: 'systematic-debugging',
    version: 1,
    capability: 'systematic-debugging',
    title: 'Systematic Debugging',
    phase: 'analysis',
    mode: 'read-only-until-gate',
    prerequisites: ['context-discovery'],
    instructionPath: 'resources/skills/systematic-debugging.md'
  }),
  skill({
    id: 'specification',
    version: 1,
    capability: 'specify',
    title: 'Specification',
    phase: 'design',
    mode: 'read-only',
    prerequisites: ['design-exploration'],
    instructionPath: 'resources/skills/specification.md'
  }),
  skill({
    id: 'implementation-planning',
    version: 1,
    capability: 'plan',
    title: 'Implementation Planning',
    phase: 'planning',
    mode: 'read-only',
    prerequisites: [],
    instructionPath: 'resources/skills/implementation-planning.md'
  }),
  skill({
    id: 'implementation',
    version: 1,
    capability: 'implement',
    title: 'Implementation',
    phase: 'execution',
    mode: 'write-allowed',
    prerequisites: [],
    instructionPath: 'resources/skills/implementation.md'
  }),
  skill({
    id: 'verification',
    version: 1,
    capability: 'verify',
    title: 'Verification',
    phase: 'verification',
    mode: 'verification-only',
    prerequisites: [],
    instructionPath: 'resources/skills/verification.md'
  }),
  skill({
    id: 'code-review',
    version: 1,
    capability: 'review',
    title: 'Code Review',
    phase: 'review',
    mode: 'review-only',
    prerequisites: [],
    instructionPath: 'resources/skills/code-review.md'
  }),
  skill({
    id: 'repository-baseline',
    version: 1,
    capability: 'baseline',
    title: 'Repository Baseline Discovery',
    phase: 'discovery',
    mode: 'read-only',
    prerequisites: [],
    instructionPath: 'resources/skills/repository-baseline.md'
  })
]);

export function findSkill(skillId, registry = SKILL_REGISTRY) {
  return registry.find((entry) => entry.id === skillId) ?? null;
}

export function instructionFilePath(entry, packageRoot = PACKAGE_ROOT) {
  return path.resolve(packageRoot, entry.instructionPath);
}
