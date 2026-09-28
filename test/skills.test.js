import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { buildBehaviorGuidance } from '../src/behavior/guidance.js';
import { resolveWorkflowPolicy } from '../src/behavior/policy.js';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { SKILL_REGISTRY } from '../src/skills/registry.js';
import { resolveBehaviorContract, resolveSkills } from '../src/skills/resolver.js';
import { validateSkillRegistry } from '../src/skills/validation.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function mutableRegistry() {
  return SKILL_REGISTRY.map((entry) => ({ ...entry, prerequisites: [...entry.prerequisites] }));
}

async function routedWork(workType, scope) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-skills-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const intake = await createPendingIntake(root, `Route ${workType} ${scope}`);
  const meta = await routeWorkItem(root, intake.id, {
    work_type: workType,
    scope,
    confidence: 'high',
    reason: 'Deterministic test routing decision.'
  });
  return { root, meta };
}

test('built-in skill registry validates successfully', async () => {
  assert.deepEqual(await validateSkillRegistry(), { registryVersion: 5, skillCount: 12 });
});

test('skill registry rejects duplicate IDs', async () => {
  const registry = mutableRegistry();
  registry[1].id = registry[0].id;
  await assert.rejects(() => validateSkillRegistry(registry), /Duplicate skill id: context-discovery/);
});

test('skill registry rejects duplicate capability ownership', async () => {
  const registry = mutableRegistry();
  registry[1].capability = registry[0].capability;
  await assert.rejects(() => validateSkillRegistry(registry), /Duplicate capability ownership: discover/);
});

test('skill registry rejects unknown prerequisites', async () => {
  const registry = mutableRegistry();
  registry[0].prerequisites = ['missing-skill'];
  await assert.rejects(() => validateSkillRegistry(registry), /unknown prerequisite: missing-skill/);
});

test('skill registry rejects circular prerequisites', async () => {
  const registry = mutableRegistry();
  registry[0].prerequisites = ['requirement-clarification'];
  await assert.rejects(() => validateSkillRegistry(registry), /Circular skill prerequisite/);
});

test('skill registry rejects missing instruction files', async () => {
  const registry = mutableRegistry();
  registry[0].instructionPath = 'resources/skills/missing.md';
  await assert.rejects(() => validateSkillRegistry(registry), /instruction file is missing/);
});

test('skill registry rejects unsupported metadata values', async () => {
  for (const [field, value, pattern] of [
    ['phase', 'coding', /phase must be one of/],
    ['mode', 'automatic', /mode must be one of/],
    ['version', 0, /version must be a positive integer/],
    ['title', ' ', /title must be non-empty/]
  ]) {
    const registry = mutableRegistry();
    registry[0][field] = value;
    await assert.rejects(() => validateSkillRegistry(registry), pattern);
  }
});

test('bounded bug capabilities resolve in deterministic order', () => {
  const capabilities = resolveWorkflowPolicy('bug', 'bounded').requiredCapabilities;
  assert.deepEqual(resolveSkills(capabilities), [
    'context-discovery',
    'systematic-debugging',
    'implementation',
    'verification'
  ]);
});

test('architectural feature resolves design, specification, planning, and review chain', () => {
  const capabilities = resolveWorkflowPolicy('feature', 'architectural').requiredCapabilities;
  assert.deepEqual(resolveSkills(capabilities), [
    'context-discovery',
    'requirement-clarification',
    'design-exploration',
    'specification',
    'implementation-planning',
    'implementation',
    'verification',
    'delivery-convergence',
    'code-review'
  ]);
});

test('duplicate capabilities do not duplicate skills', () => {
  assert.deepEqual(resolveSkills(['discover', 'discover', 'verify', 'verify']), ['context-discovery', 'verification']);
});

test('unknown capabilities fail clearly', () => {
  assert.throws(() => resolveSkills(['discover', 'deploy']), /Unknown capability: "deploy"/);
});

test('skill prerequisites are inserted automatically', () => {
  assert.deepEqual(resolveSkills(['brainstorm']), [
    'context-discovery',
    'requirement-clarification',
    'design-exploration'
  ]);
});

test('new routed work receives a pinned registry v5 contract', async () => {
  const { meta } = await routedWork('bug', 'bounded');
  assert.deepEqual(meta.behaviorContract, {
    registryVersion: 5,
    skills: ['context-discovery', 'systematic-debugging', 'implementation', 'verification']
  });
  assert.equal(resolveBehaviorContract(meta).label, 'registry v5 (pinned)');
});

test('legacy routed work derives an unpinned contract without mutation', async () => {
  const { root, meta } = await routedWork('bug', 'bounded');
  const metaFile = path.join(workspacePath(root), 'work', meta.id, 'meta.yaml');
  const legacy = await readYaml(metaFile);
  delete legacy.behaviorContract;
  await writeFile(metaFile, `${JSON.stringify(legacy, null, 2)}\n`);
  const before = await readFile(metaFile, 'utf8');

  const loaded = await readYaml(metaFile);
  const contract = resolveBehaviorContract(loaded);
  const after = await readFile(metaFile, 'utf8');
  assert.equal(contract.label, 'derived (legacy v0.2.1)');
  assert.deepEqual(contract.skills, ['context-discovery', 'systematic-debugging', 'implementation', 'verification']);
  assert.equal(after, before);
});

test('investigation guidance never authorizes implementation', async () => {
  const { meta } = await routedWork('investigation', 'bounded');
  const guidance = buildBehaviorGuidance(meta, 'FINDINGS');
  assert.equal(guidance.modification.authorized, false);
  assert.equal(guidance.modification.reason, 'work policy is read-only');
});

test('bug spike guidance never authorizes implementation', async () => {
  const { meta } = await routedWork('bug', 'spike');
  const guidance = buildBehaviorGuidance(meta, 'FINDINGS');
  assert.equal(guidance.modification.authorized, false);
  assert.equal(guidance.modification.reason, 'work policy is read-only');
});

test('bug guidance blocks writes before confirmed root cause', async () => {
  const { meta } = await routedWork('bug', 'bounded');
  const guidance = buildBehaviorGuidance(meta, 'HYPOTHESIS');
  assert.equal(guidance.modification.authorized, false);
  assert.equal(guidance.modification.reason, 'systematic debugging/root-cause gate');
});

test('implementation stage authorizes writes when policy permits', async () => {
  const { meta } = await routedWork('bug', 'bounded');
  const guidance = buildBehaviorGuidance(meta, 'IMPLEMENTATION', {
    skills: {
      'context-discovery': { status: 'completed' },
      'systematic-debugging': { status: 'completed' },
      implementation: { status: 'pending' },
      verification: { status: 'pending' }
    }
  });
  assert.equal(guidance.modification.authorized, true);
  assert.equal(guidance.modification.reason, 'workflow and checkpoint implementation gates are open');
});

test('guide command uses active work and reports the behavior gate', async () => {
  const { root } = await routedWork('bug', 'bounded');
  const result = spawnSync(process.execPath, [cli, 'guide'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Behavior contract: registry v5 \(pinned\)/);
  assert.match(result.stdout, /○ systematic-debugging/);
  assert.match(result.stdout, /Application code modification: NOT AUTHORIZED/);
  assert.match(result.stdout, /systematic debugging\/root-cause gate/);
});

test('skill command prints installed package instructions', () => {
  const result = spawnSync(process.execPath, [cli, 'skill', 'systematic-debugging'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skill: systematic-debugging/);
  assert.match(result.stdout, /Mode: read-only-until-gate/);
  assert.match(result.stdout, /# Systematic Debugging/);
  assert.match(result.stdout, /Confirm Root Cause/i);
});

test('invalid skill returns an actionable error', () => {
  const result = spawnSync(process.execPath, [cli, 'skill', 'missing-skill'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown skill "missing-skill"/);
  assert.match(result.stderr, /Available skills:/);
});

test('doctor validates the built-in Skill Registry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-skills-'));
  await initWorkspace(root, 'demo', 'greenfield');
  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS built-in skill registry v5 \(12 skills\)/);
});
