// Project setup (PF-0069): the first-time guided setup and the saved scan of a project's
// stack. `.yallaflow/local/setup.json` is git-ignored and per checkout: when the stack was
// last scanned, what it held, which services the setup added, and which steps are done.
// The scan reads Core's read-only overview (repository evidence; .env is never read).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureLocalIgnored } from '../agents/bridge.js';
import { safeWriteFile } from '../agents/local-files.js';
import { personalLocalFile } from '../agents/settings.js';
import { HttpError } from './create.js';

export const SETUP_FILE = 'setup.json';
export const SETUP_STEPS = Object.freeze(['stack', 'services', 'agents']);
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 300;

export function setupPath(root) {
  return path.join(root, '.yallaflow', 'local', SETUP_FILE);
}

// → the saved record, or null when there is none (or it is unreadable: then the setup is
// offered again and the next scan replaces it).
export async function readSetup(root) {
  try {
    if (await personalLocalFile(root, setupPath(root))) return null;
    const value = JSON.parse(await readFile(setupPath(root), 'utf8'));
    if (!value || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.stack) || typeof value.steps !== 'object' || value.steps === null) return null;
    return value;
  } catch {
    return null;
  }
}

async function writeSetup(root, record) {
  await safeWriteFile(await ensureLocalIgnored(root), SETUP_FILE, `${JSON.stringify(record, null, 1)}\n`);
  return record;
}

const text = (value, max = 200) => (value === null || value === undefined ? null : String(value).slice(0, max));

// The stack entries the scan keeps: what, which version is declared, how it is known, where.
export function summarizeStack(overview) {
  const entries = Array.isArray(overview?.stack?.entries) ? overview.stack.entries : [];
  return entries.slice(0, MAX_ENTRIES).map((entry) => ({
    component: text(entry.component, 120),
    declared: text(entry.declared, 80),
    kind: text(entry.kind, 40),
    basis: text(entry.basis, 20),
    path: text(entry.path, 300)
  })).filter((entry) => entry.component);
}

const key = (entry) => `${entry.kind}\u0000${entry.component}\u0000${entry.path}`;

// What changed since the last scan: added, removed, and a different declared version.
export function diffStack(previous, next) {
  const before = new Map((previous ?? []).map((entry) => [key(entry), entry]));
  const after = new Map(next.map((entry) => [key(entry), entry]));
  const added = next.filter((entry) => !before.has(key(entry)));
  const removed = (previous ?? []).filter((entry) => !after.has(key(entry)));
  const changed = next.filter((entry) => before.has(key(entry)) && before.get(key(entry)).declared !== entry.declared)
    .map((entry) => ({ component: entry.component, kind: entry.kind, path: entry.path, from: before.get(key(entry)).declared, to: entry.declared }));
  return { added, removed, changed, any: Boolean(added.length || removed.length || changed.length) };
}

// Scan (or rescan): read the overview through Core, keep the summary, report the changes.
export async function scanSetup(root, runner) {
  const overview = await runner.readFresh(root, ['overview', '--json']);
  if (!overview || overview.error) throw new HttpError(422, overview?.error?.code ?? 'OVERVIEW_FAILED', overview?.error?.message ?? 'The project could not be scanned.');
  const stack = summarizeStack(overview);
  const previous = await readSetup(root);
  const changes = previous ? diffStack(previous.stack, stack) : null;
  const record = {
    schemaVersion: SCHEMA_VERSION,
    scannedAt: new Date().toISOString(),
    stack,
    modules: Array.isArray(overview.modules) ? overview.modules.length : 0,
    truncated: Boolean(overview.coverage?.truncated),
    servicesAdded: previous?.servicesAdded ?? [],
    steps: { ...(previous?.steps ?? {}), stack: true }
  };
  await writeSetup(root, record);
  return { record, changes };
}

// Marks a step done (or the whole setup skipped); records services the setup added.
export async function markSetup(root, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const keys = Object.keys(body);
  if (keys.some((name) => !['step', 'servicesAdded'].includes(name)) || !['skip', ...SETUP_STEPS].includes(body.step)) throw new HttpError(400, 'BAD_REQUEST', `Send { "step": "${['skip', ...SETUP_STEPS].join('" | "')}" }.`);
  if ('servicesAdded' in body && (!Array.isArray(body.servicesAdded) || body.servicesAdded.length > 32 || body.servicesAdded.some((id) => !/^[a-z][a-z0-9-]{0,31}$/.test(String(id))))) throw new HttpError(400, 'BAD_REQUEST', 'servicesAdded lists service ids.');
  const previous = await readSetup(root);
  const record = previous ?? { schemaVersion: SCHEMA_VERSION, scannedAt: null, stack: [], modules: 0, truncated: false, servicesAdded: [], steps: {} };
  if (body.step === 'skip') record.steps.skipped = true;
  else record.steps[body.step] = true;
  if (body.servicesAdded) record.servicesAdded = [...new Set([...(record.servicesAdded ?? []), ...body.servicesAdded])];
  record.updatedAt = new Date().toISOString();
  return writeSetup(root, record);
}

// Offered when there is no record, or neither finished nor skipped.
export function setupPending(record) {
  if (!record) return true;
  if (record.steps?.skipped) return false;
  return !SETUP_STEPS.every((step) => record.steps?.[step]);
}
