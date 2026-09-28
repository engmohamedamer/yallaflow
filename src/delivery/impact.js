import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { readYaml, writeYamlAtomic } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { IMPACT_ID, IMPACT_SCHEMA_VERSION, IMPACT_VERDICTS } from './constants.js';

// Change-impact records (v0.3.8). When the approved intent of in-flight work changes
// after it was fixed — a new source is attached, or its requirements change — YallaFlow
// raises a pending impact deterministically. It never judges what the change means:
// the Agent assesses which completed stages are affected (src/delivery/assess.js), and
// YallaFlow applies the existing, audited checkpoint-revision machinery to them.
// Nothing is deleted; prior verification, review, and convergence evidence stays.
//
// work/<id>/impact.yaml is append-oriented: impacts are never removed, and an assessed
// impact is immutable.

const LEDGER_FIELDS = new Set(['schemaVersion', 'impacts', 'updatedAt']);
const IMPACT_FIELDS = new Set(['id', 'status', 'raisedAt', 'stageAtRaise', 'triggers', 'assessment']);
const TRIGGER_TYPES = new Set(['source', 'requirements']);
const ASSESSMENT_FIELDS = new Set(['assessedAt', 'summary', 'stages', 'applied']);

export function impactFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'impact.yaml');
}

function emptyLedger() {
  return { schemaVersion: IMPACT_SCHEMA_VERSION, impacts: [], updatedAt: null };
}

export async function loadWorkImpacts(root, meta) {
  const file = impactFilePath(root, meta.id);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  const errors = validateImpactLedger(ledger);
  if (errors.length) throw new Error(`Impact ledger for ${meta.id} is invalid:\n- ${errors.join('\n- ')}`);
  return { exists: true, ledger: structuredClone(ledger) };
}

export function validateImpactLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['impact ledger must be an object'];
  unknown(ledger, LEDGER_FIELDS, 'impact ledger', errors);
  if (ledger.schemaVersion !== IMPACT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${IMPACT_SCHEMA_VERSION}`);
  if (!Array.isArray(ledger.impacts)) return [...errors, 'impacts must be an array'];
  const ids = new Set();
  let pending = 0;
  for (const impact of ledger.impacts) {
    const label = `impact ${impact?.id ?? '<unknown>'}`;
    if (!impact || typeof impact !== 'object') { errors.push(`${label} must be an object`); continue; }
    unknown(impact, IMPACT_FIELDS, label, errors);
    if (!IMPACT_ID.test(impact.id ?? '')) errors.push(`${label} has an invalid id (expected IM-###)`);
    if (ids.has(impact.id)) errors.push(`duplicate impact id ${impact.id}`);
    ids.add(impact.id);
    if (!['pending', 'assessed'].includes(impact.status)) errors.push(`${label} has an invalid status ${JSON.stringify(impact.status)}`);
    if (impact.status === 'pending') pending += 1;
    if (typeof impact.raisedAt !== 'string') errors.push(`${label} requires raisedAt`);
    if (!Array.isArray(impact.triggers) || !impact.triggers.length) errors.push(`${label} requires at least one trigger`);
    else for (const trigger of impact.triggers) {
      if (!TRIGGER_TYPES.has(trigger?.type)) errors.push(`${label} has a trigger of unknown type ${JSON.stringify(trigger?.type)}`);
      if (trigger?.type === 'source' && !/^SRC-\d+$/.test(trigger.source ?? '')) errors.push(`${label} source trigger requires a source SRC-####`);
      if (trigger?.type === 'requirements' && (!Array.isArray(trigger.changes) || !trigger.changes.length)) errors.push(`${label} requirements trigger requires changes`);
      if (typeof trigger?.at !== 'string') errors.push(`${label} trigger requires an at timestamp`);
    }
    if (impact.status === 'assessed') {
      const assessment = impact.assessment;
      if (!assessment || typeof assessment !== 'object') { errors.push(`${label} is assessed but has no assessment`); continue; }
      unknown(assessment, ASSESSMENT_FIELDS, `${label} assessment`, errors);
      if (typeof assessment.assessedAt !== 'string') errors.push(`${label} assessment requires assessedAt`);
      if (!assessment.stages || typeof assessment.stages !== 'object' || Array.isArray(assessment.stages)) errors.push(`${label} assessment requires stages`);
      else for (const [skill, verdict] of Object.entries(assessment.stages)) {
        if (!IMPACT_VERDICTS.includes(verdict?.verdict)) errors.push(`${label} stage ${skill} has an invalid verdict ${JSON.stringify(verdict?.verdict)}`);
        if (typeof verdict?.reason !== 'string' || !verdict.reason.trim()) errors.push(`${label} stage ${skill} requires a reason`);
      }
      if (!assessment.applied || !Array.isArray(assessment.applied.revised)) errors.push(`${label} assessment requires applied.revised`);
    } else if (impact.assessment !== undefined) {
      errors.push(`${label} is pending but carries an assessment`);
    }
  }
  if (pending > 1) errors.push(`${pending} impacts are pending; triggers raised while one is pending must join it`);
  return errors;
}

export function pendingImpact(ledger) {
  return ledger.impacts.find((impact) => impact.status === 'pending') ?? null;
}

// The latest point at which an assessment invalidated convergence (null when none did).
export function convergenceImpactBoundary(ledger) {
  return ledger.impacts
    .filter((impact) => impact.status === 'assessed' && impact.assessment?.applied?.convergenceInvalidated)
    .map((impact) => impact.assessment.assessedAt)
    .sort()
    .at(-1) ?? null;
}

// Deterministic trigger: joins the pending impact when there is one, otherwise opens
// a new IM-###. Written atomically before the triggering change is recorded, so a
// failure can only leave a (harmless, assessable) impact — never an unassessed change.
export async function raiseImpact(root, meta, trigger, now = new Date().toISOString()) {
  const loaded = await loadWorkImpacts(root, meta);
  const ledger = loaded.ledger;
  const entry = { ...trigger, at: now };
  let impact = pendingImpact(ledger);
  if (impact) {
    impact.triggers.push(entry);
  } else {
    impact = { id: nextImpactId(ledger.impacts), status: 'pending', raisedAt: now, stageAtRaise: meta.status, triggers: [entry] };
    ledger.impacts.push(impact);
  }
  ledger.updatedAt = now;
  await writeYamlAtomic(impactFilePath(root, meta.id), ledger);
  await appendFile(path.join(workspacePath(root), 'work', meta.id, 'progress.md'), `- ${now} Impact ${impact.id} pending: ${describeTrigger(entry)} changed approved intent after it was fixed\n`, 'utf8');
  return impact;
}

export function describeTrigger(trigger) {
  if (trigger.type === 'source') return `source ${trigger.source} attached`;
  return `requirements ${trigger.changes.map((change) => `${change.id} ${change.action}`).join(', ')}`;
}

function nextImpactId(impacts) {
  const highest = impacts.reduce((max, impact) => Math.max(max, Number(/^IM-(\d+)$/.exec(impact.id ?? '')?.[1]) || 0), 0);
  return `IM-${String(highest + 1).padStart(3, '0')}`;
}

export async function writeImpactLedger(root, workId, ledger) {
  await writeYamlAtomic(impactFilePath(root, workId), ledger);
}

export function pendingImpactMessage(workId, impact) {
  return `${workId} has a pending impact assessment (${impact.id}: ${impact.triggers.map(describeTrigger).join('; ')}). ` +
    `Assess which completed stages the change affects first: yallaflow impact status ${workId}, then yallaflow impact assess ${workId} --file impact.json.`;
}

function unknown(value, allowed, label, errors) {
  const extra = Object.keys(value).filter((field) => !allowed.has(field));
  if (extra.length) errors.push(`${label} has unknown field(s): ${extra.join(', ')}`);
}
