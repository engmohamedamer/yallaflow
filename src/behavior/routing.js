import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { CONFIDENCE_LEVELS, SCOPES, WORK_TYPES } from './constants.js';
import { resolveWorkflowPolicy } from './policy.js';
import { ensureDir, exists, readText, writeText } from '../utils/fs.js';
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

export async function createPendingIntake(root, rawRequest) {
  if (typeof rawRequest !== 'string' || !rawRequest.trim()) {
    throw new Error('A non-empty raw request is required.');
  }

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
    knowledgePolicy: {
      version: KNOWLEDGE_POLICY_VERSION,
      reviewRequired: true
    },
    createdAt: now,
    updatedAt: now
  };
  const workDir = path.join(workspacePath(root), 'work', id);
  await ensureDir(path.join(workDir, 'attachments'));
  await ensureDir(path.join(workDir, 'evidence'));
  await ensureDir(path.join(workDir, 'execution'));
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
  const title = decision.title ?? `${capitalize(decision.work_type)} work`;
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

function pendingWorkTemplate(meta) {
  return `# ${meta.id} — Pending Intake\n\n## Raw Request\n\n${meta.rawRequest}\n\n## Routing\n\n**Status:** pending\n\nThe coding agent must classify this request using the YallaFlow routing contract.\n`;
}

function routedWorkAppendix(meta) {
  return `\n## Routing Decision\n\n**Status:** routed\n**Work type:** ${meta.type}\n**Scope:** ${meta.scope}\n**Confidence:** ${meta.routingConfidence}\n**Reason:** ${meta.routingReason}\n**Timestamp:** ${meta.routedAt}\n**Workflow:** ${meta.workflow}\n**Required capabilities:** ${meta.requiredCapabilities.join(', ')}\n**Behavior contract:** registry v${meta.behaviorContract.registryVersion}\n**Skills:** ${meta.behaviorContract.skills.join(', ')}\n**Read-only:** ${meta.readOnly ? 'yes' : 'no'}\n\n${workSections(meta.workflow, meta.scope)}`;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
