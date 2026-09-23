import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { CONFIDENCE_LEVELS, SCOPES, WORK_TYPES } from './constants.js';
import { resolveWorkflowPolicy } from './policy.js';
import { exists, readText, writeText } from '../utils/fs.js';
import { nextWorkId, workSections, workspacePath } from '../core/workspace.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { REGISTRY_VERSION } from '../skills/constants.js';
import { resolveSkills } from '../skills/resolver.js';
import { KNOWLEDGE_POLICY_VERSION } from '../knowledge/constants.js';

const ROUTING_FIELDS = new Set(['work_type', 'scope', 'confidence', 'reason', 'title']);

export function validateRoutingDecision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Routing decision must be an object.');
  }

  const unknown = Object.keys(input).filter((key) => !ROUTING_FIELDS.has(key));
  if (unknown.length) throw new Error(`Unknown routing field(s): ${unknown.join(', ')}.`);
  if (!WORK_TYPES.includes(input.work_type)) {
    throw new Error(`work_type must be one of: ${WORK_TYPES.join(', ')}; received ${JSON.stringify(input.work_type)}.`);
  }
  if (!SCOPES.includes(input.scope)) {
    throw new Error(`scope must be one of: ${SCOPES.join(', ')}; received ${JSON.stringify(input.scope)}.`);
  }
  if (!CONFIDENCE_LEVELS.includes(input.confidence)) {
    throw new Error(`confidence must be one of: ${CONFIDENCE_LEVELS.join(', ')}; received ${JSON.stringify(input.confidence)}.`);
  }
  if (typeof input.reason !== 'string' || !input.reason.trim()) {
    throw new Error('reason must be a non-empty string.');
  }
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) {
    throw new Error('title must be a non-empty string when supplied.');
  }

  return {
    work_type: input.work_type,
    scope: input.scope,
    confidence: input.confidence,
    reason: input.reason,
    ...(input.title !== undefined ? { title: input.title.trim() } : {})
  };
}

// The one canonical way to create classified work: exactly `start` → `route`
// (createPendingIntake + routeWorkItem), so every entry path — `start`/`route`,
// file intake, and the direct `feature`/`bug`/`investigate`/... shortcuts — gets the
// same workflow policy, pinned Behavior Contract, Skill Registry version, read-only
// policy, knowledge policy, and initial stage. The decision and its policy are
// validated before anything is written, so an invalid classification mutates nothing.
export async function createRoutedWork(root, rawRequest, decision, options = {}) {
  const validated = validateRoutingDecision(decision);
  resolveWorkflowPolicy(validated.work_type, validated.scope);
  const pending = await createPendingIntake(root, rawRequest, options);
  return routeWorkItem(root, pending.id, decision);
}

export async function createPendingIntake(root, rawRequest, options = {}) {
  if (typeof rawRequest !== 'string' || !rawRequest.trim()) {
    throw new Error('A non-empty raw request is required.');
  }
  // A work item may reference more than one source at once (`yallaflow intake
  // file1.docx file2.xlsx`) and more over time (`yallaflow intake add`); `sources`
  // is therefore always an array.
  const linkedAt = new Date().toISOString();
  const sources = options.sources !== undefined
    ? options.sources.map((source) => validateSourceRef({ ...source, linkedAt, workStatusAtLink: 'PENDING', relationship: 'work-input' }))
    : undefined;
  const titleHint = options.titleHint !== undefined ? normalizeTitleHint(options.titleHint) : undefined;

  const id = await nextWorkId(root);
  const now = new Date().toISOString();
  const meta = {
    id,
    type: null,
    scope: null,
    routingStatus: 'pending',
    rawRequest,
    status: null,
    readOnly: true,
    ...(sources?.length ? { sources } : {}),
    ...(titleHint ? { titleHint } : {}),
    knowledgePolicy: {
      version: KNOWLEDGE_POLICY_VERSION,
      reviewRequired: true
    },
    createdAt: now,
    updatedAt: now
  };
  const workDir = path.join(workspacePath(root), 'work', id);
  // Sparse workspace (v0.3.6): no optional artifact directory (evidence/, attachments/,
  // execution/) exists until the first artifact that needs it is written.
  await writeYaml(path.join(workDir, 'meta.yaml'), meta);
  await writeText(path.join(workDir, 'work.md'), pendingWorkTemplate(meta));
  await writeText(path.join(workDir, 'progress.md'), `# Work Ledger — ${id}\n\nCreated: ${now}\n\n- ${now} Routing: pending\n`);
  await writeYaml(path.join(workspacePath(root), 'state', 'current.yaml'), {
    schemaVersion: 1,
    activeWork: id,
    stage: null,
    updatedAt: now
  });
  return meta;
}

export async function routeWorkItem(root, workId, input) {
  const decision = validateRoutingDecision(input);
  const policy = resolveWorkflowPolicy(decision.work_type, decision.scope);
  const workDir = path.join(workspacePath(root), 'work', workId);
  const metaFile = path.join(workDir, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);

  const meta = await readYaml(metaFile);
  if (meta.routingStatus !== 'pending') {
    throw new Error(`${workId} is not awaiting routing.`);
  }

  const now = new Date().toISOString();
  const behaviorContract = {
    registryVersion: REGISTRY_VERSION,
    skills: resolveSkills(policy.requiredCapabilities)
  };
  const title = decision.title ?? meta.titleHint ?? `${capitalize(decision.work_type)} work`;
  Object.assign(meta, {
    title,
    type: decision.work_type,
    scope: decision.scope,
    routingStatus: 'routed',
    routingConfidence: decision.confidence,
    routingReason: decision.reason,
    routedAt: now,
    workflow: policy.workflow,
    requiredCapabilities: policy.requiredCapabilities,
    behaviorContract,
    status: policy.initialStage,
    readOnly: policy.readOnly,
    updatedAt: now
  });
  await writeYaml(metaFile, meta);
  const workFile = path.join(workDir, 'work.md');
  const currentWork = await readText(workFile);
  await writeText(workFile, currentWork.replace(/^# .*$/m, `# ${meta.id} — ${title}`));
  await appendFile(workFile, routedWorkAppendix(meta), 'utf8');
  await appendFile(path.join(workDir, 'progress.md'), `- ${now} Routing: routed as ${meta.type} + ${meta.scope} (${meta.routingConfidence})\n`, 'utf8');
  await writeYaml(path.join(workspacePath(root), 'state', 'current.yaml'), {
    schemaVersion: 1,
    activeWork: workId,
    stage: policy.initialStage,
    updatedAt: now
  });
  return meta;
}

// Attaches an additional source to an existing work item (pending or already routed)
// without disturbing anything else about it — the missing half of the source-input
// model that per-file `intake` alone doesn't cover (`yallaflow intake add`).
// Every link records when it was made and the work's status at that moment. A source
// attached after DONE is a recovered source: it requires a reason, is marked as such,
// and never reopens or rewrites the completed work — work.md (the historical record of
// the work as executed) is left untouched; only the append-only progress ledger and
// the source list gain an entry, so it can never look as if it existed during
// execution.
export function assertSourceLinkAllowed(meta, reason) {
  if (meta.status === 'DONE' && !isNonEmptyString(reason)) {
    throw new Error(
      `${meta.id} is DONE. Attaching a source now records it as a recovered source (added after completion) and requires --reason, ` +
      `e.g. yallaflow intake add ${meta.id} <file> --reason "Original screenshot from the request was not captured during the work."\n\nNo files were changed.`
    );
  }
}

export async function addSourceToWork(root, workId, source, now = new Date().toISOString(), { reason } = {}) {
  const workDir = path.join(workspacePath(root), 'work', workId);
  const metaFile = path.join(workDir, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  assertSourceLinkAllowed(meta, reason);
  const recovered = meta.status === 'DONE';
  const validated = validateSourceRef({
    ...source,
    linkedAt: now,
    workStatusAtLink: meta.routingStatus === 'pending' ? 'PENDING' : meta.status,
    relationship: recovered ? 'recovered-source' : 'work-input',
    ...(isNonEmptyString(reason) ? { reason: reason.trim() } : {})
  });

  meta.sources = [...(meta.sources ?? []), validated];
  meta.updatedAt = now;
  await writeYaml(metaFile, meta);
  if (recovered) {
    await appendFile(path.join(workDir, 'progress.md'), `- ${now} Recovered source attached after DONE: ${validated.id} (${validated.name}) — ${validated.reason}\n`, 'utf8');
  } else {
    await appendFile(path.join(workDir, 'work.md'), sourceAddedSection(validated), 'utf8');
    await appendFile(path.join(workDir, 'progress.md'), `- ${now} Source attached: ${validated.id} (${validated.name})\n`, 'utf8');
  }
  return meta;
}

// GAP-CLI-002: the only supported way to correct a pending/unrouted work item's raw
// request — never hand-editing meta.yaml. Only valid before routing; once routed, the
// original intake is durable history, not a mutable field. History is preserved, and
// file-backed sources (if any) are never touched — only the raw request text changes.
export async function reviseRequest(root, workId, input, now = new Date().toISOString()) {
  const workDir = path.join(workspacePath(root), 'work', workId);
  const metaFile = path.join(workDir, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const meta = await readYaml(metaFile);
  if (meta.routingStatus !== 'pending') {
    throw new Error(`${workId} is already routed; its original request cannot be rewritten through this operation.`);
  }
  if (!isNonEmptyString(input.text)) throw new Error('--text must be a non-empty replacement request.');
  if (!isNonEmptyString(input.reason)) throw new Error('Revising a pending request requires a non-empty --reason.');

  const previousRequest = meta.rawRequest;
  const nextRequest = input.text.trim();
  meta.requestHistory = [...(meta.requestHistory ?? []), { previousRequest, reason: input.reason.trim(), revisedAt: now }];
  meta.rawRequest = nextRequest;
  meta.updatedAt = now;
  await writeYaml(metaFile, meta);
  await appendFile(path.join(workDir, 'work.md'), requestRevisedSection(previousRequest, nextRequest, input.reason, now), 'utf8');
  await appendFile(path.join(workDir, 'progress.md'), `- ${now} Request revised: ${input.reason.trim()}\n`, 'utf8');
  return meta;
}

function requestRevisedSection(previousRequest, nextRequest, reason, now) {
  return `\n## Request Revised\n\n**Previous request:** ${previousRequest}\n**Revised request:** ${nextRequest}\n**Reason:** ${reason.trim()}\n**Timestamp:** ${now}\n`;
}

function pendingWorkTemplate(meta) {
  const intakeSection = meta.sources?.length
    ? `## Sources\n\n${meta.sources.map(sourceDetail).join('\n\n')}\n`
    : `## Raw Request\n\n${meta.rawRequest}\n`;
  return `# ${meta.id} — Pending Intake\n\n${intakeSection}\n## Routing\n\n**Status:** pending\n\nThe coding agent must classify this request using the YallaFlow routing contract.\n`;
}

export const SOURCE_RELATIONSHIPS = Object.freeze(['work-input', 'recovered-source']);

function sourceAddedSection(source) {
  return `\n## Source Added\n\n${sourceDetail(source)}\n`;
}

function sourceDetail(source) {
  return `**Source ID:** ${source.id}\n**Type:** ${source.type}\n**Name:** ${source.name}\n\nRaw source preserved in: \`.yallaflow/sources/${source.id}/${source.name}\`. Read it directly; it is not duplicated here.`;
}

function validateSourceRef(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('source must be an object.');
  const { id, type, name, detectedFormat, contentAvailability, linkedAt, workStatusAtLink, relationship, reason } = source;
  if (!isNonEmptyString(id) || !isNonEmptyString(type) || !isNonEmptyString(name)) {
    throw new Error('source requires non-empty id, type, and name.');
  }
  if (relationship !== undefined && !SOURCE_RELATIONSHIPS.includes(relationship)) {
    throw new Error(`source relationship must be one of: ${SOURCE_RELATIONSHIPS.join(', ')}.`);
  }
  return {
    id, type, name,
    ...(detectedFormat !== undefined ? { detectedFormat } : {}),
    ...(contentAvailability !== undefined ? { contentAvailability } : {}),
    // v0.3.6 link audit metadata (absent on earlier links, which are treated as work inputs).
    ...(linkedAt !== undefined ? { linkedAt } : {}),
    ...(workStatusAtLink !== undefined ? { workStatusAtLink } : {}),
    ...(relationship !== undefined ? { relationship } : {}),
    ...(reason !== undefined ? { reason } : {})
  };
}

function normalizeTitleHint(value) {
  if (!isNonEmptyString(value)) throw new Error('titleHint must be a non-empty string when supplied.');
  return value.trim();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function routedWorkAppendix(meta) {
  return `\n## Routing Decision\n\n**Status:** routed\n**Work type:** ${meta.type}\n**Scope:** ${meta.scope}\n**Confidence:** ${meta.routingConfidence}\n**Reason:** ${meta.routingReason}\n**Timestamp:** ${meta.routedAt}\n**Workflow:** ${meta.workflow}\n**Required capabilities:** ${meta.requiredCapabilities.join(', ')}\n**Behavior contract:** registry v${meta.behaviorContract.registryVersion}\n**Skills:** ${meta.behaviorContract.skills.join(', ')}\n**Read-only:** ${meta.readOnly ? 'yes' : 'no'}\n\n${workSections(meta.workflow, meta.scope)}`;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
