// Test support for v0.3.8 delivery state: fixtures that drive feature work (and
// architectural changes) through their lifecycle record the minimal structured intent
// and a satisfied convergence assessment the Registry v5 contract requires — through
// the same public operations an Agent uses, never by writing ledgers directly.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordRequirements, resolveDeliveryCriteria } from '../src/delivery/requirements.js';
import { convergenceRequired, intentSkill } from '../src/delivery/policy.js';
import { resolveBehaviorContract } from '../src/skills/resolver.js';
import { recordConvergence, evaluateConvergence } from '../src/delivery/convergence.js';
import { checkpointWork } from '../src/core/progress.js';
import { loadWorkMetaOrThrow } from '../src/core/workspace.js';
import { cli } from './legacy-context.js';

export const MINIMAL_INTENT = Object.freeze({
  requirements: [{ id: 'REQ-001', statement: 'The requested behavior is delivered.', provenance: [{ type: 'request' }] }],
  acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'The requested behavior can be observed.', provenance: [{ type: 'request' }] }]
});

// In-process: record REQ-001/AC-001 for a work item (before its intent checkpoint).
export async function recordIntent(root, workId, intent = null) {
  return recordRequirements(root, workId, intent ? structuredClone(intent) : await minimalIntentFor(root, workId));
}

// Minimal intent citing where it came from: the raw request, or — for a decomposed
// child, which has none — the child's own work section.
export async function minimalIntentFor(root, workId) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  const provenance = meta.rawRequest ? [{ type: 'request' }] : [{ type: 'specification', section: meta.title }];
  return {
    requirements: MINIMAL_INTENT.requirements.map((entry) => ({ ...entry, provenance })),
    acceptanceCriteria: MINIMAL_INTENT.acceptanceCriteria.map((entry) => ({ ...entry, provenance }))
  };
}

// In-process: record every active criterion as satisfied and complete the
// delivery-convergence checkpoint (after verification).
export async function convergeAll(root, workId, { complete = true } = {}) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  const view = await evaluateConvergence(root, meta);
  const findings = view.criteria.filter((entry) => entry.status !== 'satisfied' || entry.stale)
    .map((entry) => ({ criterion: entry.ref, status: 'satisfied', reason: 'Observed in the delivered implementation.', evidence: ['runtime: observed during the test scenario'] }));
  if (findings.length) await recordConvergence(root, workId, { findings });
  if (complete) await checkpointWork(root, workId, { skillId: 'delivery-convergence', status: 'completed', summary: 'Converged.' });
}

async function jsonFile(value) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-delivery-input-'));
  const file = path.join(dir, 'input.json');
  await writeFile(file, JSON.stringify(value));
  return file;
}

// CLI variants for process-level scenario tests.
export async function cliRecordIntent(root, workId, intent = MINIMAL_INTENT, run = cli) {
  return run(root, ['requirement', 'record', workId, '--file', await jsonFile(intent)]);
}

export async function cliConvergeAll(root, workId, { criteria = ['AC-001'], complete = true, run = cli } = {}) {
  const findings = criteria.map((criterion) => ({ criterion, status: 'satisfied', reason: 'Observed in the delivered implementation.', evidence: ['runtime: observed during the test scenario'] }));
  run(root, ['convergence', 'record', workId, '--file', await jsonFile({ findings })]);
  if (complete) run(root, ['checkpoint', workId, '--skill', 'delivery-convergence', '--complete', '--summary', 'Converged.']);
}

// For generic fixture helpers that complete checkpoints by skill: before the intent
// checkpoint of a delivery-convergence contract, make sure minimal intent exists.
// A no-op for every other skill and every other contract.
export async function ensureIntentFor(root, workId, skillId) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  const contract = resolveBehaviorContract(meta);
  if (!convergenceRequired(contract) || skillId !== intentSkill(contract)) return;
  if ((await resolveDeliveryCriteria(root, meta)).criteria.length) return;
  await recordIntent(root, workId);
}

// Controlled compatibility fixture: turn a freshly routed work item into one routed by
// v0.3.7 (Skill Registry v4, no delivery-convergence), exactly as such a workspace
// stores it. Used by tests that pin pre-v0.3.8 behavior (e.g. free-form
// decomposition traceability) which remains supported for such work.
export async function pinRegistryV4Contract(root, workId) {
  const file = path.join(root, '.yallaflow', 'work', workId, 'meta.yaml');
  const meta = JSON.parse(await readFile(file, 'utf8'));
  meta.requiredCapabilities = meta.requiredCapabilities.filter((capability) => capability !== 'converge');
  meta.behaviorContract = { registryVersion: 4, skills: meta.behaviorContract.skills.filter((skill) => skill !== 'delivery-convergence') };
  await writeFile(file, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}
