import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { workspacePath } from './workspace.js';

function evidenceFile(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'evidence', 'verification.json');
}

// v0.3.2 and earlier wrote a single overwritten record (no schemaVersion, no runs
// array). Normalizing is purely in-memory so a legacy file is never rewritten merely
// because it was read; it becomes run V-001 only once a new verification is appended.
function normalizeLedger(raw) {
  if (raw && raw.schemaVersion === 2 && Array.isArray(raw.runs)) return { runs: raw.runs };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      runs: [{
        id: 'V-001',
        ...raw,
        status: raw.status ?? (raw.success ? 'passed' : 'failed'),
        verifiedAt: raw.verifiedAt ?? raw.finishedAt ?? raw.startedAt
      }]
    };
  }
  return { runs: [] };
}

async function loadLedger(root, workId) {
  const file = evidenceFile(root, workId);
  if (!await exists(file)) return { runs: [] };
  return normalizeLedger(await readYaml(file));
}

function nextRunId(runs) {
  const highest = runs.reduce((max, run) => Math.max(max, Number(/^V-(\d+)$/.exec(run.id ?? '')?.[1]) || 0), 0);
  return `V-${String(highest + 1).padStart(3, '0')}`;
}

export async function nextVerificationRunId(root, workId) {
  const ledger = await loadLedger(root, workId);
  return nextRunId(ledger.runs);
}

// Append-only: every call adds a new run rather than overwriting. Old runs (including
// a normalized legacy record) are preserved as history in the same file.
export async function recordVerification(root, workId, record, now = new Date().toISOString()) {
  const ledger = await loadLedger(root, workId);
  const run = {
    id: nextRunId(ledger.runs),
    command: record.command,
    ...(record.executionMode ? { executionMode: record.executionMode } : {}),
    ...(record.executable !== undefined ? { executable: record.executable } : {}),
    ...(record.args !== undefined ? { args: record.args } : {}),
    ...(record.displayCommand ? { displayCommand: record.displayCommand } : {}),
    success: Boolean(record.success),
    status: record.success ? 'passed' : 'failed',
    exitCode: record.exitCode ?? null,
    startedAt: record.startedAt ?? now,
    finishedAt: record.finishedAt ?? now,
    verifiedAt: record.finishedAt ?? now,
    ...(record.summary ? { summary: record.summary } : {}),
    ...(record.log ? { log: record.log } : {})
  };
  ledger.runs.push(run);
  await writeYaml(evidenceFile(root, workId), { schemaVersion: 2, runs: ledger.runs });
  return run;
}

export async function listVerificationRuns(root, workId) {
  const ledger = await loadLedger(root, workId);
  return ledger.runs;
}

export async function latestVerification(root, workId) {
  const runs = await listVerificationRuns(root, workId);
  return runs.length ? runs[runs.length - 1] : null;
}

export async function hasAnyEvidence(root, workId) {
  const dir = path.join(workspacePath(root), 'work', workId, 'evidence');
  const entries = await readdir(dir);
  return entries.length > 0;
}
