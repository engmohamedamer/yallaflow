import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { loadWorkMetaOrThrow, workspacePath } from '../core/workspace.js';
import { appendRedactedText } from '../security/redact.js';

// Discovery purpose and preservation intent (v0.3.10) — work/bootstrap intent, never
// timeless project truth. A baseline (or any work item) can record WHAT the
// understanding is FOR, so the Agent deepens discovery where it matters:
//
//   Canonical core baseline          broad, reusable project understanding (always)
//   + purpose-specific discovery lens extra depth for the stated objective
//
// Stored only in work/<id>/purpose.yaml. It is never written into the project-context
// ledger, PROJECT.md, or context/*.md, and baseline approval never promotes it.
// YallaFlow does no keyword matching on it: the Agent reasons about the objective;
// YallaFlow persists the structured contract and shows it back.
//
// Discovery modes:
//   bootstrap  wide initial understanding (repository → approved durable memory)
//   intent     targeted deep dive for a new objective on top of existing memory
//   freshness  targeted revalidation of facts whose supporting evidence changed
export const PURPOSE_SCHEMA_VERSION = 1;
export const DISCOVERY_MODES = Object.freeze(['bootstrap', 'intent', 'freshness']);
const MAX_TEXT = 500;
const MAX_ITEMS = 30;

export function purposeFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'purpose.yaml');
}

export async function loadWorkPurpose(root, workId) {
  const file = purposeFilePath(root, workId);
  if (!await exists(file)) return null;
  return readYaml(file);
}

function cleanList(values, label) {
  const list = (values ?? []).map((value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value));
  if (list.some((value) => typeof value !== 'string' || !value || value.length > MAX_TEXT)) throw new Error(`--${label} values must be non-empty text of at most ${MAX_TEXT} characters.`);
  if (list.length > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} --${label} values.`);
  return [...new Set(list)];
}

// Records (or replaces, keeping history) the discovery purpose of a work item.
export async function setWorkPurpose(root, workId, input, now = new Date().toISOString()) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  const objective = typeof input.objective === 'string' ? input.objective.trim().replace(/\s+/g, ' ') : '';
  if (!objective) throw new Error('A discovery purpose requires a non-empty --objective (what the understanding is for).');
  if (objective.length > MAX_TEXT) throw new Error(`--objective must be at most ${MAX_TEXT} characters.`);
  const mode = input.mode ?? (meta.baseline ? 'bootstrap' : 'intent');
  if (!DISCOVERY_MODES.includes(mode)) throw new Error(`--mode must be one of: ${DISCOVERY_MODES.join(', ')}.`);
  const preservation = cleanList(input.preserve, 'preserve');
  const focus = cleanList(input.focus, 'focus');
  const previous = await loadWorkPurpose(root, workId);
  const record = {
    schemaVersion: PURPOSE_SCHEMA_VERSION,
    workId,
    mode,
    objective,
    preservation,
    focus,
    history: [
      ...(previous?.history ?? []),
      ...(previous ? [{ action: 'replaced', at: now, previous: { mode: previous.mode, objective: previous.objective, preservation: previous.preservation, focus: previous.focus } }] : [{ action: 'recorded', at: now }])
    ],
    recordedAt: previous?.recordedAt ?? now,
    updatedAt: now
  };
  const errors = validatePurpose(record, workId);
  if (errors.length) throw new Error(errors.join('\n'));
  await writeYaml(purposeFilePath(root, workId), record);
  await appendRedactedText(path.join(workspacePath(root), 'work', workId, 'progress.md'), `- ${now} Discovery purpose ${previous ? 'updated' : 'recorded'} (${mode}): ${objective}\n`, 'utf8');
  return { meta, purpose: record, replaced: Boolean(previous) };
}

export function validatePurpose(record, workId) {
  const errors = [];
  const label = `${workId} purpose.yaml`;
  if (!record || typeof record !== 'object') return [`${label} must be an object.`];
  const allowed = new Set(['schemaVersion', 'workId', 'mode', 'objective', 'preservation', 'focus', 'history', 'recordedAt', 'updatedAt']);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length) errors.push(`${label} has unknown field(s): ${unknown.join(', ')}.`);
  if (record.schemaVersion !== PURPOSE_SCHEMA_VERSION) errors.push(`${label} schemaVersion must be ${PURPOSE_SCHEMA_VERSION}.`);
  if (record.workId !== workId) errors.push(`${label} names work ${JSON.stringify(record.workId)}.`);
  if (!DISCOVERY_MODES.includes(record.mode)) errors.push(`${label} has unknown mode ${JSON.stringify(record.mode)}.`);
  if (typeof record.objective !== 'string' || !record.objective.trim()) errors.push(`${label} requires an objective.`);
  for (const key of ['preservation', 'focus']) {
    if (!Array.isArray(record[key]) || record[key].some((value) => typeof value !== 'string' || !value.trim())) errors.push(`${label} ${key} must be a list of text.`);
  }
  if (!Array.isArray(record.history) || !record.history.length) errors.push(`${label} requires history.`);
  return errors;
}

// One line for brief/resume/handoff.
export function describePurpose(purpose) {
  if (!purpose) return null;
  const parts = [`${purpose.mode} discovery for: ${purpose.objective}`];
  if (purpose.preservation.length) parts.push(`preserve: ${purpose.preservation.join(', ')}`);
  if (purpose.focus.length) parts.push(`deepen: ${purpose.focus.join(', ')}`);
  return parts.join(' · ');
}
