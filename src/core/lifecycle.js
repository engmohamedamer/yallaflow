// Work lifecycle status (v1.4.0, PF-0041; owner decision SRC-0028).
//
// A work item's lifecycle status is separate from its workflow stage:
//   - meta.status stays the workflow stage and is never changed here;
//   - meta.lifecycle is ABSENT for open items (every existing record is open, unchanged),
//     { state: 'on_hold', since, reason } while on hold,
//     { state: 'closed', since, outcome, reason, by? } once closed without delivery.
// HOLD is temporary and preserves everything; resume returns to the same state.
// CLOSED is never DONE: never delivered, verified, or completed. DONE items can't be closed.
// Every change appends one event to work/<id>/lifecycle.yaml and one progress.md line.
//
// Compatibility: the first hold/close that would make the project require YallaFlow
// >= 1.4.0 refuses until the person confirms it (--accept-minimum-version 1.4.0); the
// raise is written atomically with the lifecycle change, and a failed operation restores
// every file it touched.
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { exists, writeTextAtomic } from '../utils/fs.js';
import { readYaml } from './yaml.js';
import { getCurrentState, currentStatePath, workspacePath } from './workspace.js';
import { compareVersions, parseVersion } from '../shared/config.js';
import { redactDeep, redactSecrets } from '../security/redact.js';

export const LIFECYCLE_MINIMUM_VERSION = '1.4.0';
export const CLOSE_OUTCOMES = Object.freeze(['cancelled', 'superseded', 'duplicate']);
const WORK_ID = /^PF-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export function lifecycleOf(meta) {
  const state = meta?.lifecycle?.state;
  return state === 'on_hold' || state === 'closed' ? state : 'open';
}

export function lifecycleLabel(meta) {
  const state = lifecycleOf(meta);
  if (state === 'on_hold') return `on hold since ${meta.lifecycle.since} (${meta.lifecycle.reason})`;
  if (state === 'closed') return `closed as ${meta.lifecycle.outcome}${meta.lifecycle.by ? ` by ${meta.lifecycle.by}` : ''} on ${meta.lifecycle.since} (${meta.lifecycle.reason})`;
  return 'open';
}

// The central guard: a held or closed item refuses every progress mutation.
export function assertProgressAllowed(meta, operation = 'this change') {
  const state = lifecycleOf(meta);
  if (state === 'open') return;
  const lift = state === 'on_hold'
    ? `Resume it first: yallaflow work resume ${meta.id}`
    : `Reopen it first: yallaflow reopen ${meta.id} --reason "..."`;
  throw Object.assign(new Error(`${meta.id} is ${lifecycleLabel(meta)}; ${operation} is not allowed.\n\n${lift}\n\nNo files were changed.`), { code: 'LIFECYCLE_BLOCKED', lifecycle: state });
}

export async function assertWorkProgressAllowed(root, workId, operation) {
  if (!WORK_ID.test(String(workId ?? ''))) return;
  const file = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(file)) return; // the command itself reports a missing item
  assertProgressAllowed(await readYaml(file), operation);
}

// ----- compatibility -----

export async function minimumVersionRaise(root) {
  const config = await readYaml(path.join(workspacePath(root), 'config.yaml'));
  const current = config?.yallaflow?.minimumVersion ?? null;
  const needed = !current || !parseVersion(current) || compareVersions(current, LIFECYCLE_MINIMUM_VERSION) < 0;
  return { needed, current, config };
}

export function compatibilityWarning(current, shared) {
  return `Holding or closing work makes this project require YallaFlow >= ${LIFECYCLE_MINIMUM_VERSION}` +
    ` (it currently requires ${current ? `>= ${current}` : 'no minimum version'}).\n\n` +
    `After this change, YallaFlow 1.3.x and older (every version from 0.3.10 checks this) can still read the project but will refuse to change it.` +
    (shared ? ' This is a Shared Project: the requirement reaches every teammate once this branch is merged.' : '') +
    `\n\nTo proceed, run the same command again with --accept-minimum-version ${LIFECYCLE_MINIMUM_VERSION}.\nNo files were changed.`;
}

// ----- atomic multi-file write with rollback -----

async function snapshot(file) {
  try {
    return { file, bytes: await readFile(file) };
  } catch (error) {
    if (error.code === 'ENOENT') return { file, bytes: null };
    throw error;
  }
}

// writes: [{ file, content(string) }]. Every file is captured before the first write; on
// any failure every captured file is restored (or removed when it did not exist).
// failAfter (tests only): throw after that many successful writes.
export async function writeAllOrNothing(writes, { failAfter = null } = {}) {
  const before = [];
  for (const write of writes) before.push(await snapshot(write.file));
  let done = 0;
  try {
    for (const write of writes) {
      if (failAfter !== null && done >= failAfter) throw Object.assign(new Error('injected failure'), { code: 'INJECTED' });
      await writeTextAtomic(write.file, write.content);
      done += 1;
    }
  } catch (error) {
    for (const saved of before.reverse()) {
      if (saved.bytes === null) await rm(saved.file, { force: true });
      else await writeTextAtomic(saved.file, saved.bytes.toString('utf8'));
    }
    throw error;
  }
}

// ----- operations -----

// Project-memory workflows (the Brownfield baseline and legacy context reconciliation)
// are never held or closed: their approval is a canonical memory write that must not be
// separated from their lifecycle.
function assertLifecycleApplies(meta) {
  if (meta.baseline) throw new Error(`${meta.id} is the project's understanding baseline; it can't be put on hold or closed. Give feedback with \`yallaflow baseline feedback\` instead. No files were changed.`);
  if (meta.reconciliation) throw new Error(`${meta.id} is a legacy context reconciliation; it can't be put on hold or closed. No files were changed.`);
}

function nonEmpty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required (a non-empty text).`);
  return value.trim();
}

async function loadItem(root, workId) {
  if (!WORK_ID.test(String(workId ?? ''))) throw new Error(`Invalid work item id: ${JSON.stringify(workId)}.`);
  const dir = path.join(workspacePath(root), 'work', workId);
  const metaFile = path.join(dir, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
  return { dir, metaFile, meta: await readYaml(metaFile) };
}

const json = (value) => `${JSON.stringify(redactDeep(value), null, 2)}\n`;

async function applyChange(root, item, { action, next, reason, extra = {}, accept, failAfter, shared, clearActive }) {
  const now = new Date().toISOString();
  const from = lifecycleOf(item.meta);
  const writes = [];
  // 1. config.yaml: the confirmed minimum-version raise (never lowered).
  if (next !== 'open') {
    const raise = await minimumVersionRaise(root);
    if (raise.needed) {
      if (accept !== LIFECYCLE_MINIMUM_VERSION) throw Object.assign(new Error(compatibilityWarning(raise.current, shared)), { code: 'CONFIRM_MINIMUM_VERSION', required: LIFECYCLE_MINIMUM_VERSION, current: raise.current });
      const config = { ...raise.config, yallaflow: { ...(raise.config.yallaflow ?? {}), minimumVersion: LIFECYCLE_MINIMUM_VERSION } };
      writes.push({ file: path.join(workspacePath(root), 'config.yaml'), content: json(config) });
    }
  }
  // 2. lifecycle.yaml: append-only audit ledger.
  const ledgerFile = path.join(item.dir, 'lifecycle.yaml');
  const ledger = await exists(ledgerFile) ? await readYaml(ledgerFile) : { schemaVersion: 1, workId: item.meta.id, events: [] };
  ledger.events = [...(ledger.events ?? []), { at: now, action, from, to: next, stage: item.meta.status ?? null, reason, ...extra }];
  writes.push({ file: ledgerFile, content: json(ledger) });
  // 3. meta.yaml: the lifecycle block (absent when open); the stage is untouched.
  const meta = { ...item.meta, updatedAt: now };
  if (next === 'open') delete meta.lifecycle;
  else meta.lifecycle = { state: next, since: now, reason, ...extra };
  writes.push({ file: item.metaFile, content: json(meta) });
  // 4. progress.md: one human-readable line.
  const progressFile = path.join(item.dir, 'progress.md');
  const progress = await exists(progressFile) ? await readFile(progressFile, 'utf8') : '';
  const detail = extra.outcome ? ` as ${extra.outcome}${extra.by ? ` by ${extra.by}` : ''}` : '';
  writes.push({ file: progressFile, content: `${progress}- ${now} Lifecycle: ${action}${detail} (${from} → ${next}; stage ${item.meta.status ?? 'none'} unchanged): ${redactSecrets(reason)}\n` });
  // 5. current.yaml: holding or closing the active item clears the active focus.
  let clearedActive = false;
  if (clearActive) {
    const state = await getCurrentState(root);
    if (state?.activeWork === item.meta.id) {
      writes.push({ file: await currentStatePath(root), content: json({ schemaVersion: 1, activeWork: null, stage: null, updatedAt: now }) });
      clearedActive = true;
    }
  }
  await writeAllOrNothing(writes, { failAfter });
  return { id: item.meta.id, from, to: next, stage: item.meta.status ?? null, clearedActive, raisedMinimumVersion: writes[0].file.endsWith('config.yaml') };
}

export async function holdWork(root, workId, { reason, acceptMinimumVersion, failAfter = null, shared = false } = {}) {
  const item = await loadItem(root, workId);
  const why = nonEmpty(reason, '--reason');
  assertLifecycleApplies(item.meta);
  if (item.meta.status === 'DONE') throw new Error(`${workId} is DONE; finished work can't be put on hold. No files were changed.`);
  const state = lifecycleOf(item.meta);
  if (state !== 'open') throw new Error(`${workId} is already ${lifecycleLabel(item.meta)}. No files were changed.`);
  return applyChange(root, item, { action: 'hold', next: 'on_hold', reason: why, accept: acceptMinimumVersion, failAfter, shared, clearActive: true });
}

export async function resumeWork(root, workId, { note, failAfter = null } = {}) {
  const item = await loadItem(root, workId);
  if (lifecycleOf(item.meta) !== 'on_hold') throw new Error(`${workId} is not on hold (${lifecycleLabel(item.meta)}). No files were changed.`);
  const why = typeof note === 'string' && note.trim() ? note.trim() : 'resumed';
  return applyChange(root, item, { action: 'resume', next: 'open', reason: why, failAfter, clearActive: false });
}

export async function closeWork(root, workId, { outcome, reason, by, acceptMinimumVersion, failAfter = null, shared = false } = {}) {
  const item = await loadItem(root, workId);
  const why = nonEmpty(reason, '--reason');
  if (!CLOSE_OUTCOMES.includes(outcome)) throw new Error(`--outcome must be one of: ${CLOSE_OUTCOMES.join(', ')}. No files were changed.`);
  assertLifecycleApplies(item.meta);
  if (item.meta.status === 'DONE') throw new Error(`${workId} is DONE; delivered work can't be closed without delivery. No files were changed.`);
  if (lifecycleOf(item.meta) === 'closed') throw new Error(`${workId} is already ${lifecycleLabel(item.meta)}. No files were changed.`);
  const extra = { outcome };
  if (outcome !== 'cancelled') {
    if (!by) throw new Error(`--by <work-id> is required when the outcome is ${outcome}. No files were changed.`);
    if (by === workId) throw new Error(`${workId} can't be ${outcome} by itself. No files were changed.`);
    const target = await loadItem(root, by);
    if (lifecycleOf(target.meta) === 'closed') throw new Error(`${by} is itself closed without delivery; ${workId} can't be ${outcome} by it. No files were changed.`);
    extra.by = by;
  } else if (by) {
    throw new Error('--by applies only to superseded or duplicate. No files were changed.');
  }
  return applyChange(root, item, { action: 'close', next: 'closed', reason: why, extra, accept: acceptMinimumVersion, failAfter, shared, clearActive: true });
}

// Reopening closed work: explicit, audited, back to the preserved stage. The existing
// stage rules apply from there on (exit blockers, gates, the understanding gate).
export async function reopenClosedWork(root, workId, { reason, failAfter = null } = {}) {
  const item = await loadItem(root, workId);
  const why = nonEmpty(reason, '--reason');
  if (lifecycleOf(item.meta) !== 'closed') throw new Error(`${workId} is not closed (${lifecycleLabel(item.meta)}). No files were changed.`);
  return applyChange(root, item, { action: 'reopen', next: 'open', reason: why, failAfter, clearActive: false });
}
