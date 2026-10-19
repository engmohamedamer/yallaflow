// v1.1.0 (Skill Registry v9): on-demand skills are outside every Behavior Contract.
// The developer can ask for one on any routed work item, at any stage, DONE included,
// without rerouting or reopening it; no workflow ever requires one.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { workspacePath } from '../src/core/workspace.js';
import { SKILL_REGISTRY, isOnDemandSkill } from '../src/skills/registry.js';
import { REGISTRY_VERSION } from '../src/skills/constants.js';
import { resolveSkills } from '../src/skills/resolver.js';
import { resolveWorkflowPolicy } from '../src/behavior/policy.js';
import { SCOPES, WORK_TYPES } from '../src/behavior/constants.js';
import { validateRegistryStructure } from '../src/skills/validation.js';
import { createdWork, driveChangeToDone, freshProject, routedBoundedChange, run, workspaceHash } from '../test-support/optional.js';

const onDemand = SKILL_REGISTRY.filter(isOnDemandSkill);

test('registry v9 declares on-demand skills, and no workflow policy requires any of them', () => {
  assert.equal(REGISTRY_VERSION, 9);
  assert.ok(onDemand.some((entry) => entry.id === 'requirement-import'));
  for (const type of WORK_TYPES) {
    for (const scope of SCOPES) {
      let policy;
      try { policy = resolveWorkflowPolicy(type, scope); } catch { continue; }
      const skills = resolveSkills(policy.requiredCapabilities);
      for (const entry of onDemand) assert.ok(!skills.includes(entry.id), `${type}/${scope} must not require ${entry.id}`);
    }
  }
  assert.throws(() => resolveSkills(['import']), /on-demand skill requirement-import and cannot be required/);
});

test('the invocation field is validated', () => {
  const broken = SKILL_REGISTRY.map((entry) => (entry.id === 'requirement-import' ? { ...entry, invocation: 'sometimes' } : entry));
  assert.throws(() => validateRegistryStructure(broken), /invocation must be one of: required, on-demand/);
});

test('an on-demand skill is served for DONE work and for work pinned to an older registry, without changing it', async () => {
  const root = await freshProject();
  const done = routedBoundedChange(root);
  driveChangeToDone(root, done);
  const metaFile = path.join(workspacePath(root), 'work', done, 'meta.yaml');
  const meta = await readYaml(metaFile);
  await writeYaml(metaFile, { ...meta, behaviorContract: { ...meta.behaviorContract, registryVersion: 8 } });
  const before = await workspaceHash(root);
  const result = run(root, ['skill', 'requirement-import', '--work', done]);
  assert.match(result.stdout, /Invocation: on-demand — used only when the developer asks for it; never a required stage\. For PF-0001 \(DONE\); its Behavior Contract and stage are unchanged/);
  assert.match(result.stdout, /Instruction sha256: [0-9a-f]{64}/);
  assert.match(result.stdout, /# Requirement Import/);
  assert.equal(await workspaceHash(root), before, 'serving an on-demand skill writes nothing');
});

test('an on-demand skill is never checkpointed into the lifecycle, and pending work must be routed first', async () => {
  const root = await freshProject();
  const id = routedBoundedChange(root);
  const checkpoint = run(root, ['checkpoint', id, '--skill', 'requirement-import', '--complete', '--summary', 'x'], { ok: false });
  assert.equal(checkpoint.status, 1);
  const pending = createdWork(run(root, ['start', 'Something else']).stdout);
  assert.match(run(root, ['skill', 'requirement-import', '--work', pending], { ok: false }).stderr, /awaiting routing/);
  assert.match(run(root, ['skill', 'requirement-import']).stdout, /Invocation: on-demand/);
});
