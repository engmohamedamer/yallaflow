import path from 'node:path';
import { exists, ensureDir, writeText } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { nextWorkId, workSections, workspacePath } from '../core/workspace.js';
import { loadWorkReadiness } from '../behavior/readiness.js';
import { resolveWorkflowPolicy } from '../behavior/policy.js';
import { WORK_TYPES, SCOPES } from '../behavior/constants.js';
import { REGISTRY_VERSION } from '../skills/constants.js';
import { resolveSkills } from '../skills/resolver.js';
import { KNOWLEDGE_POLICY_VERSION } from '../knowledge/constants.js';
import { invalidateGateIfApproved } from '../reviews/store.js';
import { DECOMPOSITION_SCHEMA_VERSION } from './constants.js';

function decompositionFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'decomposition.yaml');
}

export async function loadDecomposition(root, workId) {
  const file = decompositionFilePath(root, workId);
  if (!await exists(file)) return { exists: false, ledger: null };
  return { exists: true, ledger: await readYaml(file) };
}

// A large work item may become a parent once — and only once — its own planning
// reaches PLAN_READY (reusing behavior/readiness.js rather than inventing a second
// notion of "ready"). Decomposition itself never invents feature boundaries: the
// agent supplies the children; this only validates and persists them.
export async function proposeDecomposition(root, parentId, input, now = new Date().toISOString()) {
  const meta = await loadMeta(root, parentId);
  if (meta.routingStatus === 'pending') throw new Error(`${parentId} is awaiting routing.`);
  const readiness = await loadWorkReadiness(root, meta);
  if (readiness.deliveryStatus !== 'PLAN_READY') {
    throw new Error(`${parentId} is not ready for decomposition; delivery status is ${readiness.deliveryStatus ?? 'NOT_READY'}. Decomposition requires PLAN_READY.`);
  }

  const existing = await loadDecomposition(root, parentId);
  if (existing.exists && ['executing', 'complete'].includes(existing.ledger.status)) {
    throw new Error(`${parentId} decomposition is already ${existing.ledger.status}; children have been created and cannot be re-proposed.`);
  }

  const children = (input.children ?? []).map(normalizeChildInput);
  const errors = validateChildren(children);
  if (errors.length) throw new Error(`Decomposition proposal for ${parentId} is invalid:\n${errors.map((entry) => `- ${entry}`).join('\n')}`);

  const requirementsUniverse = normalizeStringArray(input.requirementsUniverse, 'requirementsUniverse');
  const acceptanceCriteriaUniverse = normalizeStringArray(input.acceptanceCriteriaUniverse, 'acceptanceCriteriaUniverse');

  const ledger = {
    schemaVersion: DECOMPOSITION_SCHEMA_VERSION,
    status: 'proposed',
    requirementsUniverse,
    acceptanceCriteriaUniverse,
    children,
    history: [...(existing.exists ? existing.ledger.history : []), { action: 'proposed', at: now }],
    proposedAt: now,
    updatedAt: now
  };
  await writeYaml(decompositionFilePath(root, parentId), ledger);

  if (existing.exists) {
    await invalidateGateIfApproved(root, parentId, 'decomposition', 'decomposition proposal changed', now);
  }
  return { meta, ledger };
}

export async function validateDecomposition(root, parentId, now = new Date().toISOString()) {
  const meta = await loadMeta(root, parentId);
  const existing = await loadDecomposition(root, parentId);
  if (!existing.exists) throw new Error(`${parentId} has no proposed decomposition. Run \`yallaflow decompose propose\` first.`);
  const ledger = existing.ledger;
  const errors = validateChildren(ledger.children);
  const coverage = computeTraceability(ledger);
  if (errors.length) return { meta, ledger, errors, coverage, valid: false };

  if (ledger.status === 'proposed') {
    ledger.status = 'validated';
    ledger.validatedAt = now;
    ledger.history.push({ action: 'validated', at: now });
    ledger.updatedAt = now;
    await writeYaml(decompositionFilePath(root, parentId), ledger);
  }
  return { meta, ledger, errors: [], coverage, valid: true };
}

// The explicit boundary between planning the project and executing its child work:
// this is the only place children are created, and only once (defensive against
// re-invocation — a child already assigned a workId is left untouched).
export async function executeDecomposition(root, parentId, now = new Date().toISOString()) {
  const meta = await loadMeta(root, parentId);
  const existing = await loadDecomposition(root, parentId);
  if (!existing.exists) throw new Error(`${parentId} has no decomposition to execute.`);
  const ledger = existing.ledger;
  if (['executing', 'complete'].includes(ledger.status)) {
    throw new Error(`${parentId} decomposition is already ${ledger.status}.`);
  }
  if (ledger.status !== 'validated') {
    throw new Error(`${parentId} decomposition must be validated before execution. Run \`yallaflow decompose validate ${parentId}\` first.`);
  }

  let created = false;
  for (const child of ledger.children) {
    if (child.workId) continue;
    const childMeta = await createChildWorkItem(root, parentId, child, now);
    child.workId = childMeta.id;
    created = true;
  }
  ledger.status = 'executing';
  ledger.executedAt = now;
  ledger.history.push({ action: 'executed', at: now, childrenCreated: created });
  ledger.updatedAt = now;
  await writeYaml(decompositionFilePath(root, parentId), ledger);
  return { meta, ledger };
}

// null = not a decomposed parent (caller should fall back to the normal
// implementation-checkpoint gate); [] = decomposed and all required children are
// DONE; non-empty = the blockers preventing the parent from leaving its write stage.
export async function decompositionBlockers(root, meta) {
  const { exists: hasDecomposition, ledger } = await loadDecomposition(root, meta.id);
  if (!hasDecomposition || !['executing', 'complete'].includes(ledger.status)) return null;
  const view = await childProgressView(root, ledger);
  const incomplete = view.filter((child) => child.required !== false && child.state !== 'done');
  return incomplete.map((child) => `required child ${child.workId ?? child.key} (${child.title}) is not DONE (${child.state})`);
}

export async function childProgressView(root, ledger) {
  const state = await readYaml(path.join(workspacePath(root), 'state', 'current.yaml'));
  const results = [];
  for (const child of ledger.children) {
    if (!child.workId) {
      results.push({ ...child, meta: null, state: 'not_created', blockedBy: [] });
      continue;
    }
    const childMeta = await readYaml(path.join(workspacePath(root), 'work', child.workId, 'meta.yaml'));
    const blockedBy = [];
    for (const depKey of child.dependsOn ?? []) {
      const dep = ledger.children.find((entry) => entry.key === depKey);
      if (!dep?.workId) { blockedBy.push(depKey); continue; }
      const depMeta = await readYaml(path.join(workspacePath(root), 'work', dep.workId, 'meta.yaml'));
      if (depMeta.status !== 'DONE') blockedBy.push(dep.workId);
    }
    const done = childMeta.status === 'DONE';
    const isActive = state.activeWork === child.workId;
    const status = done ? 'done' : blockedBy.length ? 'blocked' : isActive ? 'active' : 'ready';
    results.push({ ...child, meta: childMeta, state: status, blockedBy });
  }
  return results;
}

// The Agent decides which ready item to execute; this only reports the set — it
// never picks one, matching "YallaFlow must not make an AI prioritization decision."
export function readyChildren(view) {
  return view.filter((child) => child.state === 'ready');
}

export function computeTraceability(ledger) {
  const requirementCounts = tallyReferences(ledger.children, 'requirements');
  const acceptanceCounts = tallyReferences(ledger.children, 'acceptanceCriteria');
  return {
    requirements: coverageSummary(requirementCounts, ledger.requirementsUniverse),
    acceptanceCriteria: coverageSummary(acceptanceCounts, ledger.acceptanceCriteriaUniverse)
  };
}

function coverageSummary(counts, universe = []) {
  return {
    referenced: [...counts.keys()],
    duplicated: [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
    unassigned: universe.length ? universe.filter((id) => !counts.has(id)) : null
  };
}

function tallyReferences(children, field) {
  const counts = new Map();
  for (const child of children) {
    for (const ref of child[field] ?? []) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  return counts;
}

async function createChildWorkItem(root, parentId, child, now) {
  const id = await nextWorkId(root);
  const policy = resolveWorkflowPolicy(child.type, child.scope);
  const behaviorContract = { registryVersion: REGISTRY_VERSION, skills: resolveSkills(policy.requiredCapabilities) };
  const meta = {
    id,
    type: child.type,
    title: child.title,
    scope: child.scope,
    routingStatus: 'routed',
    routingConfidence: 'high',
    routingReason: `Decomposed from ${parentId}.`,
    routedAt: now,
    workflow: policy.workflow,
    requiredCapabilities: policy.requiredCapabilities,
    behaviorContract,
    status: policy.initialStage,
    readOnly: policy.readOnly,
    knowledgePolicy: { version: KNOWLEDGE_POLICY_VERSION, reviewRequired: true },
    parent: parentId,
    decompositionKey: child.key,
    ...(child.requirements.length ? { requirements: child.requirements } : {}),
    ...(child.acceptanceCriteria.length ? { acceptanceCriteria: child.acceptanceCriteria } : {}),
    createdAt: now,
    updatedAt: now
  };
  const dir = path.join(workspacePath(root), 'work', id);
  await ensureDir(path.join(dir, 'attachments'));
  await ensureDir(path.join(dir, 'evidence'));
  await ensureDir(path.join(dir, 'execution'));
  await writeYaml(path.join(dir, 'meta.yaml'), meta);
  await writeText(path.join(dir, 'work.md'), childWorkTemplate(meta, parentId));
  await writeText(path.join(dir, 'progress.md'), `# Work Ledger — ${id}\n\nCreated: ${now}\nDecomposed from: ${parentId}\n\n`);
  return meta;
}

function childWorkTemplate(meta, parentId) {
  const requirements = meta.requirements?.length ? `## Requirements\n\n${meta.requirements.join(', ')}\n\n` : '';
  const acceptance = meta.acceptanceCriteria?.length ? `## Acceptance Criteria\n\n${meta.acceptanceCriteria.join(', ')}\n\n` : '';
  return `# ${meta.id} — ${meta.title}\n\n**Type:** ${meta.type}\n**Status:** ${meta.status}\n**Scope:** ${meta.scope}\n**Parent:** ${parentId}\n**Read-only:** ${meta.readOnly ? 'yes' : 'no'}\n\n${requirements}${acceptance}${workSections(meta.workflow, meta.scope)}`;
}

function normalizeChildInput(child) {
  return {
    key: child?.key,
    title: child?.title,
    type: child?.type,
    scope: child?.scope,
    required: child?.required !== false,
    requirements: normalizeStringArray(child?.requirements, 'requirements'),
    acceptanceCriteria: normalizeStringArray(child?.acceptanceCriteria, 'acceptanceCriteria'),
    dependsOn: normalizeStringArray(child?.dependsOn, 'dependsOn'),
    workId: null
  };
}

export function validateChildren(children) {
  const errors = [];
  if (!Array.isArray(children) || !children.length) {
    return ['children must be a non-empty array.'];
  }
  const keys = new Set();
  for (const child of children) {
    const label = isNonEmptyString(child.key) ? child.key : '<missing key>';
    if (!isNonEmptyString(child.key)) errors.push('Each child requires a non-empty key.');
    else if (keys.has(child.key)) errors.push(`Duplicate child key ${child.key}.`);
    else keys.add(child.key);
    if (!isNonEmptyString(child.title)) errors.push(`Child ${label} requires a non-empty title.`);
    if (!WORK_TYPES.includes(child.type)) errors.push(`Child ${label} type must be one of: ${WORK_TYPES.join(', ')}.`);
    if (!SCOPES.includes(child.scope)) errors.push(`Child ${label} scope must be one of: ${SCOPES.join(', ')}.`);
  }
  for (const child of children) {
    const label = child.key ?? '<missing key>';
    for (const dep of child.dependsOn) {
      if (dep === child.key) errors.push(`Child ${label} cannot depend on itself.`);
      else if (!keys.has(dep)) errors.push(`Child ${label} depends on unknown key ${dep}.`);
    }
  }
  if (!errors.length) {
    const cycle = findDependencyCycle(children);
    if (cycle) errors.push(`Dependency cycle detected: ${cycle.join(' -> ')}.`);
  }
  return errors;
}

function findDependencyCycle(children) {
  const graph = new Map(children.map((child) => [child.key, child.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  function walk(key, chain) {
    if (visiting.has(key)) return [...chain, key];
    if (visited.has(key)) return null;
    visiting.add(key);
    for (const dep of graph.get(key) ?? []) {
      const found = walk(dep, [...chain, key]);
      if (found) return found;
    }
    visiting.delete(key);
    visited.add(key);
    return null;
  }
  for (const key of graph.keys()) {
    const found = walk(key, []);
    if (found) return found;
  }
  return null;
}

function normalizeStringArray(values, label) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((entry) => !isNonEmptyString(entry))) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return values.map((entry) => entry.trim());
}

async function loadMeta(root, workId) {
  const file = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(file)) throw new Error(`Work item ${workId} was not found.`);
  return readYaml(file);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
