// Execution store (PF-0112): the console's runs for one checkout, personal runtime state in
// .yallaflow/local/execution/ (git-ignored; never project memory, never committed).
//
// - runs.json is written whole through a temporary file and a rename (safeWriteFile), so a
//   crash leaves either the old or the new file, never a half-written one.
// - events.jsonl is an append-only audit of scheduler decisions (best effort).
// - An unreadable runs.json is reported and never overwritten: the developer looks first.
// - Only the console that owns the checkout (the agent-console lock) writes here; the
//   manager checks that before every save.
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { safeAppendFile, safeLocalDir, safeWriteFile } from '../agents/local-files.js';
import { ensureLocalIgnored } from '../agents/bridge.js';
import { personalLocalFile } from '../agents/settings.js';
import { EXECUTION_SCHEMA, RUN_MODES, TASK_STATES } from './model.js';

const RUNS_FILE = 'runs.json';
const EVENTS_FILE = 'events.jsonl';

// Where a checkout's runs live: `{ root, sub }`. A lane's runs are kept in its HOME checkout
// (sub = ['lane-runs', <lane id>]), never inside the lane, where the lane's agent can write
// (review H7). A plain string is the checkout root itself.
const where = (location) => (typeof location === 'string' ? { root: location, sub: [] } : { root: location.root, sub: location.sub ?? [] });
export function executionDir(location) {
  const { root, sub } = where(location);
  return path.join(root, '.yallaflow', 'local', 'execution', ...sub);
}

// Review H7/M1: a loaded run must have exactly the shapes YallaFlow writes.
const RUN_ID = /^r-[0-9a-f]{6,12}$/;
const TASK_ID = /^t-[0-9a-f]{6,12}$/;
const WORK_ID = /^PF-[A-Za-z0-9-]{1,40}$/;
const WORD = /^[a-z][a-z0-9-]{0,39}$/;
const RUN_STATES = ['running', 'paused', 'finished', 'cancelled'];
function validTask(task) {
  return task && typeof task === 'object' && TASK_ID.test(String(task.id)) && WORK_ID.test(String(task.workId)) && WORD.test(String(task.provider)) && TASK_STATES.includes(task.state) && (task.reason == null || (typeof task.reason === 'string' && task.reason.length <= 200)) && Number.isInteger(task.attempt) && task.attempt >= 0;
}
export function validRun(run) {
  if (!run || typeof run !== 'object' || !RUN_ID.test(String(run.id)) || !RUN_MODES.includes(run.mode) || !RUN_STATES.includes(run.state)) return false;
  const options = run.options ?? {};
  if (typeof options !== 'object' || (options.message != null && (typeof options.message !== 'string' || options.message.length > 4000)) || (options.lang != null && !['ar', 'en'].includes(options.lang)) || (options.provider != null && !WORD.test(String(options.provider))) || (options.mode != null && !WORD.test(String(options.mode))) || (options.agentConfig != null && !/^(?:none|[0-9a-f]{64})$/.test(String(options.agentConfig)))) return false;
  return Array.isArray(run.lanes) && run.lanes.length > 0 && run.lanes.every((lane) => lane && typeof lane.root === 'string' && Array.isArray(lane.tasks) && lane.tasks.every(validTask));
}

// → { state: 'empty' | 'ok' | 'unreadable', runs, error? }. Reading never creates anything.
// A file YallaFlow could not have written (tracked by Git, not yours, readable by others, a
// link) or with an unexpected shape is unreadable: reported, never trusted, never overwritten.
export async function loadRuns(location) {
  const file = path.join(executionDir(location), RUNS_FILE);
  let raw;
  try {
    const info = await lstat(file);
    if (!info.isFile()) return { state: 'unreadable', runs: [], error: 'runs.json is not a regular file' };
    const refused = await personalLocalFile(where(location).root, file);
    if (refused) return { state: 'unreadable', runs: [], error: `runs.json was not written by YallaFlow here (${refused})` };
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'empty', runs: [] };
    return { state: 'unreadable', runs: [], error: error.message };
  }
  try {
    const data = JSON.parse(raw);
    if (data?.schema !== EXECUTION_SCHEMA || !Array.isArray(data.runs)) return { state: 'unreadable', runs: [], error: `unexpected schema ${JSON.stringify(data?.schema ?? null)}` };
    if (!data.runs.every(validRun)) return { state: 'unreadable', runs: [], error: 'runs.json holds an entry YallaFlow does not write' };
    return { state: 'ok', runs: data.runs };
  } catch (error) {
    return { state: 'unreadable', runs: [], error: `not valid JSON (${error.message})` };
  }
}

async function dir(location) {
  const { root, sub } = where(location);
  await ensureLocalIgnored(root);
  return safeLocalDir(root, '.yallaflow', 'local', 'execution', ...sub);
}

export async function saveRuns(location, runs) {
  await safeWriteFile(await dir(location), RUNS_FILE, `${JSON.stringify({ schema: EXECUTION_SCHEMA, runs }, null, 1)}\n`);
}

export async function appendEvent(location, entry) {
  try {
    await safeAppendFile(await dir(location), EVENTS_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // the audit log is best effort; the run state itself is in runs.json
  }
}
