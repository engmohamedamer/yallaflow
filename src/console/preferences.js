// The developer's own preferences on this machine (PF-0159): preferences.json beside the
// console's project list (console.json), mode 0600, never inside a repository.
//
// - It is a separate file on purpose: console.json is rewritten whole by every console
//   version (unknown keys are dropped), so preferences kept there would be lost when an older
//   console saves its list. Project state and project settings stay where they are
//   (.yallaflow and .yallaflow/local); nothing here duplicates them.
// - Only the fields below are stored, each typed and bounded. There is no free-form value, so
//   a credential, token or key can never be saved here. Whether an agent is installed or
//   signed in is never stored either: it is checked again whenever it matters.
// - A missing, unreadable or invalid file means "no preferences": defaults apply and the next
//   save replaces it. Keys this version does not know (written by a newer one) are kept.
import { lstat, mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { registryPath } from './registry.js';
import { AGENT_IDS } from '../agents/machine-readiness.js';

export const PREFERENCES_SCHEMA = 1;
export const PREFERENCES_FILE = 'preferences.json';
export const LANGUAGES = Object.freeze(['ar', 'en']);
export const THEMES = Object.freeze(['light', 'dark']);
export const AGENTS = AGENT_IDS; // provider names stay in src/agents
export const INTENTS = Object.freeze(['monitor', 'create', 'manage']);
const MAX_PATH = 4096;
const MAX_BYTES = 64 * 1024;

export const DEFAULT_PREFERENCES = Object.freeze({ language: null, theme: null, preferredAgent: null, lastFolder: null, recentFolders: null, saveChatHistory: null, onboarding: Object.freeze({ completed: false, intent: null }) });
const MAX_RECENT = 6;

export function preferencesPath(env = process.env) {
  return path.join(path.dirname(registryPath(env)), PREFERENCES_FILE);
}

class PreferencesError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = 'BAD_PREFERENCES';
  }
}

const oneOf = (list) => (value) => value === null || list.includes(value);
const folderPath = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !/[\u0000-\u001f\u007f]/.test(value) && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
const FIELDS = Object.freeze({
  language: oneOf(LANGUAGES),
  theme: oneOf(THEMES),
  preferredAgent: oneOf(AGENTS),
  // An absolute folder path as text; it is only ever offered back as a starting point and is
  // checked by the folder chooser's own rules when used.
  lastFolder: (value) => value === null || folderPath(value),
  // PF-0175: the folder chooser's recent folders (browser storage is per port, so they were
  // lost when the console came back on another port). Absolute paths only, at most six.
  recentFolders: (value) => value === null || (Array.isArray(value) && value.length <= MAX_RECENT && value.every(folderPath)),
  // PF-0165: keep the agent chat on disk in each project's .yallaflow/local (null: the
  // default, on). false stops saving new messages; what is already saved stays until cleared.
  saveChatHistory: (value) => value === null || typeof value === 'boolean'
});
const ONBOARDING_FIELDS = Object.freeze({
  completed: (value) => typeof value === 'boolean',
  intent: oneOf(INTENTS)
});

// The known fields of a stored document, each valid or its default.
function view(raw) {
  const out = { language: null, theme: null, preferredAgent: null, lastFolder: null, recentFolders: null, saveChatHistory: null, onboarding: { completed: false, intent: null } };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, valid] of Object.entries(FIELDS)) if (key in raw && raw[key] !== null && valid(raw[key])) out[key] = raw[key];
  const onboarding = raw.onboarding;
  if (onboarding && typeof onboarding === 'object' && !Array.isArray(onboarding)) {
    if (onboarding.completed === true) out.onboarding.completed = true;
    if (onboarding.intent !== null && INTENTS.includes(onboarding.intent)) out.onboarding.intent = onboarding.intent;
  }
  return out;
}

async function readRaw(file) {
  try {
    // A link or anything that is not a regular file here is never read.
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_BYTES) return { raw: null, problem: 'The saved preferences were ignored (not a regular file).' };
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { raw: null, problem: 'The saved preferences were ignored (not readable).' };
    return { raw, problem: null };
  } catch (error) {
    if (error.code === 'ENOENT') return { raw: null, problem: null };
    return { raw: null, problem: 'The saved preferences were ignored (not readable).' };
  }
}

// → { ...known fields, saved: boolean, problem?: string }. Never throws.
export async function loadPreferences(file = preferencesPath()) {
  const { raw, problem } = await readRaw(file);
  return { ...view(raw), saved: Boolean(raw), ...(problem ? { problem } : {}) };
}

// Validates a change: only known fields, each of its own type. Returns the cleaned patch.
export function validatePreferencesPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PreferencesError('Send a JSON object of preferences.');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'onboarding') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PreferencesError('onboarding must be an object.');
      clean.onboarding = {};
      for (const [name, entry] of Object.entries(value)) {
        if (!(name in ONBOARDING_FIELDS)) throw new PreferencesError(`Unknown onboarding preference: ${String(name).slice(0, 40)}.`);
        if (!ONBOARDING_FIELDS[name](entry)) throw new PreferencesError(`onboarding.${name} has an invalid value.`);
        clean.onboarding[name] = entry;
      }
    } else if (key in FIELDS) {
      if (!FIELDS[key](value)) throw new PreferencesError(`${key} has an invalid value.`);
      clean[key] = value;
    } else {
      throw new PreferencesError(`Unknown preference: ${String(key).slice(0, 40)}.`);
    }
  }
  return clean;
}

// Merges a validated change into the file (atomic replace, 0600) and returns the new view.
export async function savePreferences(patch, file = preferencesPath()) {
  const clean = validatePreferencesPatch(patch);
  const { raw } = await readRaw(file);
  const current = raw ?? {};
  const next = {
    ...current,
    ...clean,
    ...(clean.onboarding ? { onboarding: { ...(current.onboarding && typeof current.onboarding === 'object' && !Array.isArray(current.onboarding) ? current.onboarding : {}), ...clean.onboarding } } : {}),
    schemaVersion: PREFERENCES_SCHEMA,
    updatedAt: new Date().toISOString()
  };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(temp, 0o600).catch(() => {});
  // rename replaces the name itself: a link placed at preferences.json is replaced, never followed.
  await rename(temp, file);
  return { ...view(next), saved: true };
}
