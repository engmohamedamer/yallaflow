// v0.3.6 invariant: every newly created routed work item is governed by the same
// workflow policy, Skill Registry, Behavior Contract, knowledge policy, and integrity
// rules regardless of which public CLI entry path created it. The direct shortcuts
// (`feature|bug|investigate|change|refactor|release`) require an explicit --scope and
// go through the canonical start → route path; they can no longer create
// contract-less legacy work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import * as workspace from '../src/core/workspace.js';
import { readYaml } from '../src/core/yaml.js';
import { resolveWorkflowPolicy } from '../src/behavior/policy.js';
import { SCOPES, WORK_TYPES } from '../src/behavior/constants.js';
import { REGISTRY_VERSION } from '../src/skills/constants.js';
import { KNOWLEDGE_POLICY_VERSION } from '../src/knowledge/constants.js';
import { createLegacyWorkItem } from '../test-support/legacy-work.js';

const { workspacePath } = workspace;
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const COMMAND_FOR = { feature: 'feature', bug: 'bug', investigation: 'investigate', change: 'change', refactor: 'refactor', release: 'release' };
const GOVERNED_FIELDS = ['type', 'scope', 'routingStatus', 'workflow', 'requiredCapabilities', 'behaviorContract', 'readOnly', 'knowledgePolicy', 'status'];

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

async function freshRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-direct-'));
  run(root, ['init', '--type', 'greenfield']);
  return root;
}

async function meta(root, id) {
  return readYaml(path.join(workspacePath(root), 'work', id, 'meta.yaml'));
}

function governed(item) {
  return Object.fromEntries(GOVERNED_FIELDS.map((field) => [field, item[field]]));
}

async function direct(root, type, title, scope) {
  const result = run(root, [COMMAND_FOR[type], title, '--scope', scope]);
  return meta(root, /Created (PF-\d+)/.exec(result.stdout)[1]);
}

async function startRoute(root, type, title, scope) {
  const id = /Created (PF-\d+)/.exec(run(root, ['start', title]).stdout)[1];
  run(root, ['route', id, '--type', type, '--scope', scope, '--confidence', 'high', '--reason', 'Agent classification.']);
  return meta(root, id);
}

async function snapshot(root) {
  const files = {};
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[path.relative(root, full)] = await readFile(full, 'utf8');
    }
  };
  await walk(workspacePath(root));
  return files;
}

test('direct feature --scope bounded creates routed work with a pinned Behavior Contract', async () => {
  const root = await freshRoot();
  const result = run(root, ['feature', 'Add guest checkout', '--scope', 'bounded']);
  assert.match(result.stdout, /Created PF-0001: Add guest checkout/);
  assert.match(result.stdout, new RegExp(`Behavior contract: registry v${REGISTRY_VERSION} \\(pinned\\)`));
  const item = await meta(root, 'PF-0001');
  assert.equal(item.routingStatus, 'routed');
  assert.equal(item.workflow, 'feature');
  assert.equal(item.scope, 'bounded');
  assert.equal(item.behaviorContract.registryVersion, REGISTRY_VERSION);
  assert.deepEqual(item.behaviorContract.skills, ['context-discovery', 'requirement-clarification', 'implementation', 'verification']);
  assert.deepEqual(item.requiredCapabilities, resolveWorkflowPolicy('feature', 'bounded').requiredCapabilities);
  assert.deepEqual(item.knowledgePolicy, { version: KNOWLEDGE_POLICY_VERSION, reviewRequired: true });
  assert.equal(item.readOnly, false);
  assert.equal(item.status, 'INTAKE');
  assert.equal(item.routingConfidence, 'high');
  assert.match(item.routingReason, /Explicitly classified by the user: `yallaflow feature --scope bounded`/);
  assert.equal(item.rawRequest, 'Add guest checkout');
});

test('direct investigate --scope bounded is read-only with a pinned read-only contract', async () => {
  const root = await freshRoot();
  const item = await direct(root, 'investigation', 'Why is deployment slow?', 'bounded');
  assert.equal(item.workflow, 'investigation');
  assert.equal(item.readOnly, true);
  assert.deepEqual(item.behaviorContract.skills, ['context-discovery', 'systematic-debugging', 'verification']);
  const guide = run(root, ['guide', item.id]);
  assert.match(guide.stdout, /Application code modification: NOT AUTHORIZED/);
  assert.match(guide.stdout, /work policy is read-only/);
});

test('direct bug --scope spike gets the read-only investigation workflow contract', async () => {
  const root = await freshRoot();
  const item = await direct(root, 'bug', 'Diagnose queue latency', 'spike');
  assert.equal(item.type, 'bug');
  assert.equal(item.workflow, 'investigation');
  assert.equal(item.readOnly, true);
  assert.deepEqual(item.requiredCapabilities, resolveWorkflowPolicy('bug', 'spike').requiredCapabilities);
  assert.deepEqual(item.behaviorContract.skills, ['context-discovery', 'systematic-debugging', 'verification']);
});

test('every direct type/scope uses the canonical policy: governed fields equal start → route', async () => {
  for (const type of WORK_TYPES) {
    for (const scope of SCOPES) {
      let supported = true;
      try { resolveWorkflowPolicy(type, scope); } catch { supported = false; }
      const root = await freshRoot();
      if (!supported) {
        const before = await snapshot(root);
        const refused = run(root, [COMMAND_FOR[type], `Unsupported ${type} ${scope}`, '--scope', scope], false);
        assert.notEqual(refused.status, 0, `${type}/${scope} should be refused`);
        assert.deepEqual(await snapshot(root), before, `${type}/${scope} refusal must not mutate`);
        continue;
      }
      const viaDirect = await direct(root, type, `Direct ${type} ${scope}`, scope);
      const viaRoute = await startRoute(root, type, `Routed ${type} ${scope}`, scope);
      assert.deepEqual(governed(viaDirect), governed(viaRoute), `${type}/${scope}`);
      assert.ok(viaDirect.behaviorContract?.skills?.length, `${type}/${scope} has a pinned contract`);
    }
  }
});

test('guide works immediately on direct-created work', async () => {
  const root = await freshRoot();
  const item = await direct(root, 'change', 'Final approval requires one approved well', 'bounded');
  const guide = run(root, ['guide', item.id]);
  assert.match(guide.stdout, /Behavior contract: registry v\d+ \(pinned\)/);
  assert.match(guide.stdout, /○ context-discovery/);
  assert.match(guide.stdout, new RegExp(`NEXT VALID ACTION:\\nyallaflow advance ${item.id}`));
});

test('verification and knowledge gates are identical to routed work, and doctor is healthy after correct completion', async () => {
  const root = await freshRoot();
  const item = await direct(root, 'feature', 'Add CSV export', 'bounded');
  const id = item.id;
  for (let i = 0; i < 4; i++) run(root, ['advance', id]);
  assert.match(run(root, ['advance', id], false).stderr, /complete required checkpoint\(s\) first: context-discovery, requirement-clarification/);
  for (const skill of ['context-discovery', 'requirement-clarification']) run(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', 'ok']);
  run(root, ['advance', id]);
  run(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'Implemented.']);
  run(root, ['advance', id]);
  assert.match(run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'x'], false).stderr, /Completing verification requires fresh successful evidence/);
  assert.match(run(root, ['advance', id], false).stderr, /verification checkpoint is pending/);
  run(root, ['verify', id, '--', process.execPath, '-e', 'process.exit(0)']);
  run(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'Verified.']);
  assert.match(run(root, ['advance', id], false).stderr, /project knowledge review is complete/);
  run(root, ['knowledge', 'review', id, '--none']);
  assert.match(run(root, ['advance', id]).stdout, /VERIFICATION → DONE/);
  const doctor = run(root, ['doctor']);
  assert.match(doctor.stdout, /Workspace healthy\./);
  assert.doesNotMatch(doctor.stdout, /FAIL/);
});

test('a direct command without --scope creates nothing and mutates zero workspace state', async () => {
  const root = await freshRoot();
  const before = await snapshot(root);
  for (const command of Object.values(COMMAND_FOR)) {
    const result = run(root, [command, 'Add guest checkout'], false);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Direct work commands require --scope because work classification includes both type and scope\./);
    assert.match(result.stderr, new RegExp(`yallaflow ${command} "Add guest checkout" --scope bounded`));
    assert.match(result.stderr, /yallaflow start "Add guest checkout"/);
    assert.match(result.stderr, /No work item was created\./);
  }
  const legacyComplexity = run(root, ['feature', 'Add guest checkout', '--complexity', 'unknown'], false);
  assert.match(legacyComplexity.stderr, /require --scope/);
  assert.deepEqual(await snapshot(root), before);
});

test('old contract-less legacy work remains readable', async () => {
  const root = await freshRoot();
  const legacy = await createLegacyWorkItem(root, 'feature', 'Legacy shortcut work', 'bounded');
  assert.equal(legacy.behaviorContract, undefined);
  for (const args of [['status'], ['resume', legacy.id], ['guide', legacy.id], ['handoff', legacy.id], ['ready', legacy.id]]) run(root, args);
  assert.match(run(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.match(run(root, ['guide', legacy.id]).stdout, /Stage: INTAKE/);
});

test('no v0.3.6 creation path can produce contract-less work', async () => {
  assert.equal(workspace.createWorkItem, undefined); // the legacy creator is gone from product code
  const root = await freshRoot();
  const ids = [];
  for (const type of WORK_TYPES) ids.push((await direct(root, type, `Direct ${type}`, 'bounded')).id);
  ids.push((await startRoute(root, 'feature', 'Routed feature', 'bounded')).id);
  await writeFile(path.join(root, 'req.md'), '# Requirement\n');
  const intakeId = /Work created: (PF-\d+)/.exec(run(root, ['intake', 'req.md']).stdout)[1];
  run(root, ['route', intakeId, '--type', 'bug', '--scope', 'bounded', '--confidence', 'medium', '--reason', 'From file.']);
  ids.push(intakeId);
  for (const id of ids) {
    const item = await meta(root, id);
    assert.equal(item.routingStatus, 'routed', id);
    assert.equal(item.behaviorContract?.registryVersion, REGISTRY_VERSION, id);
    assert.ok(item.behaviorContract.skills.length, id);
    assert.deepEqual(item.knowledgePolicy, { version: KNOWLEDGE_POLICY_VERSION, reviewRequired: true }, id);
  }
  for (const item of await workspace.listWork(root)) {
    assert.ok(item.routingStatus === 'routed' && item.behaviorContract, `${item.id} must be routed with a contract`);
  }
});
