import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { listWork, workspacePath } from '../core/workspace.js';
import { LIMITATION_AREAS, LIMITATION_SCHEMA_VERSION, LIMITATION_TYPES } from '../context/constants.js';

// Discovery limitations record what an investigation could NOT inspect ("production
// DB schema was not inspected — no production access"). They describe the session,
// not the project, so they stay work-scoped in work/<id>/discovery.yaml and are never
// promoted into project context. The file is created only by the first explicit
// `yallaflow limitation add`; reads never create it.

export function limitationsFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'discovery.yaml');
}

export async function loadWorkLimitations(root, workId) {
  const file = limitationsFilePath(root, workId);
  if (!await exists(file)) return { exists: false, ledger: { schemaVersion: LIMITATION_SCHEMA_VERSION, limitations: [], updatedAt: null } };
  return { exists: true, ledger: await readYaml(file) };
}

export function normalizeLimitation(input, id, now) {
  return {
    id,
    type: input?.type,
    area: input?.area,
    summary: typeof input?.summary === 'string' ? input.summary.trim().replace(/\s+/g, ' ') : input?.summary,
    reason: typeof input?.reason === 'string' ? input.reason.trim() : input?.reason,
    recordedAt: now
  };
}

export function validateLimitation(entry, label = 'limitation') {
  const errors = [];
  if (!LIMITATION_TYPES.includes(entry.type)) errors.push(`${label}: type must be one of: ${LIMITATION_TYPES.join(', ')}.`);
  if (!LIMITATION_AREAS.includes(entry.area)) errors.push(`${label}: area must be one of: ${LIMITATION_AREAS.join(', ')}.`);
  if (typeof entry.summary !== 'string' || !entry.summary.trim()) errors.push(`${label}: summary must be a non-empty string.`);
  if (typeof entry.reason !== 'string' || !entry.reason.trim()) errors.push(`${label}: reason must be a non-empty string.`);
  return errors;
}

export function nextLimitationId(limitations) {
  const highest = limitations.reduce((max, entry) => Math.max(max, Number(/^DL-(\d+)$/.exec(entry.id ?? '')?.[1]) || 0), 0);
  return `DL-${String(highest + 1).padStart(3, '0')}`;
}

export async function addLimitation(root, workId, input, now = new Date().toISOString()) {
  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  const { ledger } = await loadWorkLimitations(root, workId);
  const entry = normalizeLimitation(input, nextLimitationId(ledger.limitations), now);
  const errors = validateLimitation(entry);
  if (errors.length) throw new Error(errors.join('\n'));
  ledger.limitations.push(entry);
  ledger.updatedAt = now;
  await writeYaml(limitationsFilePath(root, workId), ledger);
  return entry;
}

// Every recorded limitation in the workspace — work-scoped discovery.yaml files plus
// baseline drafts' `limitations` — used to keep them out of project context.
export async function listAllLimitations(root) {
  const all = [];
  for (const meta of await listWork(root)) {
    const { ledger } = await loadWorkLimitations(root, meta.id);
    for (const entry of ledger.limitations ?? []) all.push({ ...entry, workId: meta.id });
    if (meta.baseline) {
      const baselineFile = path.join(workspacePath(root), 'work', meta.id, 'baseline.yaml');
      if (await exists(baselineFile)) {
        const baseline = await readYaml(baselineFile);
        for (const entry of baseline.limitations ?? []) all.push({ ...entry, workId: meta.id });
      }
    }
  }
  return all;
}

export function sameStatement(a, b) {
  const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}
