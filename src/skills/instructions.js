import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PACKAGE_ROOT } from './registry.js';

// Immutable skill instructions (v0.3.10, Skill Registry v6).
//
// A work item pins its Behavior Contract as { registryVersion, skills }. Before v6 the
// skill text itself was not pinned: `yallaflow skill <id>` read whatever the installed
// package shipped, so editing an instruction file silently changed the behavior of
// work created earlier (v0.3.9 had already refined repository-baseline under v5).
//
// From v6 every (skill, instruction version) is fixed bytes with a recorded SHA-256,
// and each Skill Registry version names the instruction version it pins. Changing the
// text of a released version fails validation (`doctor`, `yallaflow skill`, the test
// suite); a behavior change ships as a new instruction version under a new registry
// version, and older work keeps resolving the exact text it was created with.
//
// Registry v1–v5 pin every skill at instruction v1, whose bytes are the last ones those
// registries shipped (v0.3.9-internal.1). Work created under v5 by v0.3.8 read an
// earlier repository-baseline text that v0.3.9 had already replaced in place; that
// pre-v6 drift cannot be recovered from the pin and is documented, not hidden.
export const SKILL_INSTRUCTION_VERSIONS = Object.freeze({
  'code-review': { 1: { path: 'resources/skills/code-review.md', sha256: '35e1491831c7c8d4a6540a0c0ec0f3e21cc30a1656bb1c8132f8ce12a98a22b1' } },
  'context-discovery': {
    1: { path: 'resources/skills/archive/context-discovery.v1.md', sha256: '92bd36765f1d11f33471f86859fabd3aca6ba817ed1163365aa31e01c990aa5c' },
    2: { path: 'resources/skills/context-discovery.md', sha256: '9f4068bf1b54b75c253101743677a1d267ff32eee75d953241961cc0936a677b' }
  },
  'context-reconciliation': { 1: { path: 'resources/skills/context-reconciliation.md', sha256: '2167f26d60883018c7f70d7c2f1a01c4ec473b7fe18d0fff98538d4da9db318e' } },
  'delivery-convergence': { 1: { path: 'resources/skills/delivery-convergence.md', sha256: 'd6d390fcf2c3b19354596bc02803def7f9fdbe71e57c5649d6208df0c4be9fce' } },
  'design-exploration': { 1: { path: 'resources/skills/design-exploration.md', sha256: '4e6c3ceed68ee6f4fa0471e9074c77472e22e06f2b6f3e00cc7cca491e9dc806' } },
  implementation: { 1: { path: 'resources/skills/implementation.md', sha256: '0d01d694ed41b297515c08f3ad07219f0c4afba11edd3357bff036a4c36e4ec9' } },
  'implementation-planning': { 1: { path: 'resources/skills/implementation-planning.md', sha256: '158e79e9ef51feb4fb166b2e57f7173e1a0ac67059d842c566751fa744819048' } },
  'repository-baseline': {
    1: { path: 'resources/skills/archive/repository-baseline.v1.md', sha256: '4bf7cf6816fe0f5cd3de763bb1116af348d9f8bb6d53df1b5e7a2db3b5b906a2' },
    2: { path: 'resources/skills/archive/repository-baseline.v2.md', sha256: '6a169a7dfb07ef8b77ef85bafb1fc657433f777571c7e683a095be276e7a3ee5' },
    3: { path: 'resources/skills/archive/repository-baseline.v3.md', sha256: '67f5c0cfa5b9aeee15bf20c1173477c6471ed9d5ce8d42bd59fa50db9a9a9972' },
    4: { path: 'resources/skills/repository-baseline.md', sha256: '99b749b793155306078cf5ee1c574e8a6d3ee72489bf4850c56d5556319728ae' }
  },
  'requirement-clarification': { 1: { path: 'resources/skills/requirement-clarification.md', sha256: '6e980db5f14632b56b158f12c4720c022710b8fe0b499bb3fb26692c451c72af' } },
  specification: { 1: { path: 'resources/skills/specification.md', sha256: '2e5427c9767a8ebbf73d6c5cdc1024f8fbd0aafe6191bf2bac1c09b13f478702' } },
  'systematic-debugging': { 1: { path: 'resources/skills/systematic-debugging.md', sha256: '98f9d81cc91dead9eef8b77c7e6e4ed96449cd0bcde8ab28de57dbd76d21c816' } },
  verification: { 1: { path: 'resources/skills/verification.md', sha256: 'a2777bd2ed24f4ba6579654097dea4d2881cdafc56427abf2f3f7cdc68b853e4' } }
});

// Instruction versions that differ from v1, keyed by the registry version that
// introduced them. A registry version pins the newest entry at or below it.
export const REGISTRY_INSTRUCTION_VERSIONS = Object.freeze({
  6: Object.freeze({ 'context-discovery': 2, 'repository-baseline': 2 }),
  7: Object.freeze({ 'repository-baseline': 3 }),
  8: Object.freeze({ 'repository-baseline': 4 })
});

export function pinnedInstructionVersion(registryVersion, skillId) {
  let version = 1;
  for (const [introducedIn, versions] of Object.entries(REGISTRY_INSTRUCTION_VERSIONS).sort(([a], [b]) => Number(a) - Number(b))) {
    if (Number.isInteger(registryVersion) && registryVersion >= Number(introducedIn) && versions[skillId]) version = versions[skillId];
  }
  return version;
}

export function latestInstructionVersion(skillId) {
  return Math.max(...Object.keys(SKILL_INSTRUCTION_VERSIONS[skillId] ?? { 0: null }).map(Number));
}

// The exact bytes of one pinned instruction version, verified against its hash.
export async function loadSkillInstructions(skillId, version, packageRoot = PACKAGE_ROOT) {
  const entry = SKILL_INSTRUCTION_VERSIONS[skillId]?.[version];
  if (!entry) throw new Error(`Skill ${skillId} has no instruction version ${version}.`);
  let text;
  try {
    text = await readFile(path.resolve(packageRoot, entry.path), 'utf8');
  } catch {
    throw new Error(`Skill ${skillId} instruction v${version} is missing: ${entry.path}.`);
  }
  const actual = createHash('sha256').update(text).digest('hex');
  if (actual !== entry.sha256) {
    throw new Error(
      `Skill ${skillId} instruction v${version} (${entry.path}) no longer matches its released bytes. ` +
      'Released skill instructions are immutable: ship a new instruction version under a new Skill Registry version instead.'
    );
  }
  return { version, path: entry.path, sha256: entry.sha256, text };
}
