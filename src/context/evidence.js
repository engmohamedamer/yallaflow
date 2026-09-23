import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { gitHead } from '../core/git.js';
import { EVIDENCE_TYPES } from './constants.js';

// Normalizes the agent's `--evidence` references into structured, freshness-capable
// evidence. Nothing here reads meaning from content: a repository path records only
// its location, a content hash, and the Git commit current at verification time —
// never file contents, so secret values are never copied into the ledger.
//
// Accepted forms:
//   path/to/file[#Symbol | :12 | :12-40]   repository evidence (must exist under root)
//   runtime:<what was observed>            runtime evidence
//   verification:V-001                     runtime evidence backed by this work item's verification run
//   user:<what the user confirmed>         user-confirmed evidence
//   anything else                          free-text reference (no verification point)
export async function normalizeEvidenceRefs(root, refs, { workId = null, verificationRuns = [], adopted = false } = {}) {
  const head = adopted ? null : gitHead(root);
  const entries = [];
  for (const raw of refs) entries.push(await normalizeOne(root, String(raw).trim(), { workId, verificationRuns, head, adopted }));
  return entries;
}

async function normalizeOne(root, ref, { workId, verificationRuns, head, adopted }) {
  const runtime = /^runtime:\s*(.+)$/is.exec(ref);
  if (runtime) return { type: 'runtime', description: runtime[1].trim() };
  const user = /^(?:user|user-confirmed):\s*(.+)$/is.exec(ref);
  if (user) return { type: 'user-confirmed', description: user[1].trim() };
  const verification = /^verification:\s*(V-\d+)$/i.exec(ref);
  if (verification) {
    const runId = verification[1].toUpperCase();
    const run = verificationRuns.find((entry) => entry.id === runId);
    if (!run) throw new Error(`Evidence ${ref}: verification run ${runId} was not found${workId ? ` for ${workId}` : ''}.`);
    return {
      type: 'runtime',
      description: `${run.displayCommand ?? run.command} (${run.status ?? (run.success ? 'passed' : 'failed')})`,
      ...(workId ? { workId } : {}),
      verificationRunId: runId
    };
  }

  const repository = await resolveRepositoryPath(root, ref);
  if (repository) {
    if (adopted) {
      // Adopted legacy evidence was verified at an unknown point in time; recording a
      // hash now would falsely claim it was verified against today's content.
      return { type: 'repository', path: repository.path, ...repository.locator };
    }
    return {
      type: 'repository',
      path: repository.path,
      ...repository.locator,
      ...(repository.isFile ? { contentHash: await hashFile(repository.absolute) } : {}),
      ...(head ? { gitCommit: head } : {})
    };
  }
  return { type: 'reference', ref };
}

async function resolveRepositoryPath(root, ref) {
  let candidate = ref;
  const locator = {};
  const symbol = /^(.+?)#(.+)$/.exec(candidate);
  if (symbol) {
    candidate = symbol[1];
    locator.symbol = symbol[2].trim();
  } else {
    const range = /^(.+?):(\d+(?:-\d+)?)$/.exec(candidate);
    if (range) {
      candidate = range[1];
      locator.range = range[2];
    }
  }
  if (!candidate || /\s/.test(candidate) || path.isAbsolute(candidate)) return null;
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return null;
  }
  return { path: relative.split(path.sep).join('/'), absolute, isFile: info.isFile(), locator };
}

export async function hashFile(absolute) {
  const content = await readFile(absolute);
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

// A fact's provenance, derived only from its evidence types when not declared.
export function deriveProvenance(evidence) {
  if (evidence.some((entry) => entry.type === 'repository')) return 'repository';
  if (evidence.some((entry) => entry.type === 'runtime')) return 'runtime';
  if (evidence.some((entry) => entry.type === 'user-confirmed')) return 'user-confirmed';
  return 'unspecified';
}

// Knowledge evolution (supersede/reconfirm/dispute) must rest on evidence that is
// more than a free-text reference.
export function hasResolvableEvidence(evidence) {
  return evidence.some((entry) => entry.type !== 'reference');
}

export function formatEvidence(entry) {
  if (entry.type === 'repository') {
    const locator = entry.symbol ? `#${entry.symbol}` : entry.range ? `:${entry.range}` : '';
    const commit = entry.gitCommit ? ` @ ${entry.gitCommit.slice(0, 7)}` : '';
    return `${entry.path}${locator} (repository${commit})`;
  }
  if (entry.type === 'runtime') {
    return `${entry.description} (runtime${entry.verificationRunId ? `, ${entry.workId ? `${entry.workId} ` : ''}${entry.verificationRunId}` : ''})`;
  }
  if (entry.type === 'user-confirmed') return `${entry.description} (user-confirmed)`;
  return `${entry.ref} (reference)`;
}

export function validateEvidenceEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'evidence entry must be an object';
  if (!EVIDENCE_TYPES.includes(entry.type)) return `evidence entry has unknown type ${JSON.stringify(entry.type)}`;
  if (entry.type === 'repository') {
    if (!isNonEmptyString(entry.path)) return 'repository evidence requires a path';
    if (path.isAbsolute(entry.path) || entry.path.split('/').includes('..')) return `repository evidence path ${JSON.stringify(entry.path)} must be relative to the project root`;
    if (entry.contentHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(entry.contentHash)) return `repository evidence ${entry.path} has a malformed contentHash`;
    if (entry.gitCommit !== undefined && !/^[0-9a-f]{7,64}$/.test(entry.gitCommit)) return `repository evidence ${entry.path} has a malformed gitCommit`;
  }
  if (['runtime', 'user-confirmed'].includes(entry.type) && !isNonEmptyString(entry.description)) return `${entry.type} evidence requires a description`;
  if (entry.type === 'reference' && !isNonEmptyString(entry.ref)) return 'reference evidence requires a ref';
  return null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
