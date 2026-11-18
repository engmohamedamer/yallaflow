// The unfinished New Project form, kept on this machine (PF-0175). Browser storage belongs to
// one origin, and the origin includes the port: a console that comes back on 4748 could not see
// a draft saved on 4747. The draft is therefore a user-level file beside preferences.json, never
// inside a repository, readable only by this user (0600), replaced atomically.
//
// Only the wizard's own fields are stored, each typed and bounded (the same rules as the page's
// cleanWizDraft): never file contents, never a plan confirmation. The free text is the
// developer's own project description, as typed in the form.
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registryPath } from './registry.js';

export const DRAFT_FILE = 'new-project-draft.json';
const TEXT = Object.freeze({ name: 64, description: 4000, requirements: 16000, parent: 4096, stack: 32, environment: 10, customStack: 120, agent: 10 });
const FLAGS = Object.freeze(['git', 'install', 'allowNested', 'noAgent']);
const MAX_BYTES = 64 * 1024;

export function draftPath(env = process.env) {
  return path.join(path.dirname(registryPath(env)), DRAFT_FILE);
}

class DraftError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = 'BAD_DRAFT';
  }
}

// → the cleaned draft, or null when nothing usable is in it.
export function cleanDraft(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.form || typeof raw.form !== 'object' || Array.isArray(raw.form)) return null;
  const form = {};
  for (const [key, max] of Object.entries(TEXT)) if (typeof raw.form[key] === 'string' && raw.form[key].length <= max && !raw.form[key].includes('\0')) form[key] = raw.form[key];
  for (const key of FLAGS) if (typeof raw.form[key] === 'boolean') form[key] = raw.form[key];
  if (!Object.keys(form).length) return null;
  const planId = typeof raw.planId === 'string' && /^NP-\d{14}-[0-9a-f]{6}$/.test(raw.planId) ? raw.planId : null;
  return {
    form,
    step: raw.step === 'progress' && planId ? 'progress' : [1, 2, 3, 4].includes(raw.step) ? raw.step : 1,
    planId,
    acknowledged: raw.acknowledged === true,
    hadFiles: raw.hadFiles === true,
    savedAt: typeof raw.savedAt === 'string' && raw.savedAt.length <= 40 ? raw.savedAt : null
  };
}

// → { draft } (null when there is none or it cannot be used). Never throws.
export async function loadDraft(file = draftPath()) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_BYTES) return { draft: null };
    return { draft: cleanDraft(JSON.parse(await readFile(file, 'utf8'))) };
  } catch {
    return { draft: null };
  }
}

// body: { draft: {...} } saves it; { draft: null } removes it.
export async function saveDraft(body, file = draftPath()) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('draft' in body)) throw new DraftError('Send { draft } (null removes it).');
  if (body.draft === null) {
    await rm(file, { force: true });
    return { draft: null };
  }
  const draft = cleanDraft(body.draft);
  if (!draft) throw new DraftError('The draft has no usable field.');
  const text = `${JSON.stringify(draft, null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) throw new DraftError('The draft is too large.');
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, text, { mode: 0o600, flag: 'wx' });
  await chmod(temp, 0o600).catch(() => {});
  await rename(temp, file);
  return { draft };
}
