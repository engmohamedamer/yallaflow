// Runtime plans (PF-0072): what Analyze Project found (the scan plan) and what the agent
// proposed, kept side by side in the git-ignored .yallaflow/local/runtime-plan.json. A plan
// is data for the developer's review: it is never executable. Saving copies the services the
// developer ticked into the runtime profile as *untrusted* definitions — trust and start are
// separate, explicit steps (owner requirement: Save, Trust and Start are separate).
import { lstat, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { containsSecret, isSecretKey } from '../security/redact.js';
import { safeWriteFile } from '../agents/local-files.js';
import { localRuntimeDir } from './local.js';
import { LINK_URL, SERVICE_ID, addService, loadRuntimeProfiles, removeService, validateService } from './profile.js';

export const PLAN_FILE = 'runtime-plan.json';
const CONFIDENCE = Object.freeze(['confirmed', 'inferred', 'unresolved']);
// What an agent may propose. Observations (components, conflicts, running containers,
// blocking items) come from YallaFlow's own scan only (review finding 9).
const PLAN_SERVICE_FIELDS = Object.freeze(['id', 'name', 'kind', 'command', 'cwd', 'env', 'ports', 'ready', 'stopSignal', 'stopTimeoutSeconds', 'readyTimeoutSeconds', 'dependsOn', 'links', 'confidence', 'evidence', 'notes', 'shared']);
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'fish', 'ash', 'csh', 'tcsh']);
// The profile fields a plan service carries into a saved definition.
const PROFILE_FIELDS = Object.freeze(['id', 'name', 'kind', 'command', 'cwd', 'env', 'ports', 'ready', 'stopSignal', 'stopTimeoutSeconds', 'readyTimeoutSeconds', 'dependsOn', 'links', 'shared']);
const MAX_SERVICES = 16;
const OVERRIDABLE_FROM_PLAN = Object.freeze(['name', 'command', 'cwd', 'env', 'ports', 'ready', 'stopSignal', 'stopTimeoutSeconds', 'readyTimeoutSeconds', 'links', 'shared']);

function invalid(problems) {
  return Object.assign(new Error(`The runtime plan was not accepted:\n- ${problems.join('\n- ')}`), { code: 'RUNTIME_PLAN_INVALID', problems });
}

async function planDir(root) {
  return localRuntimeDir(root);
}

export async function readPlan(root) {
  try {
    const file = path.join(root, '.yallaflow', 'local', PLAN_FILE);
    const info = await lstat(file);
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return { schemaVersion: 1, scan: null, agent: null }; // never through a link
    const doc = JSON.parse(await readFile(file, 'utf8'));
    if (!doc || doc.schemaVersion !== 1 || typeof doc !== 'object') return { schemaVersion: 1, scan: null, agent: null };
    return { schemaVersion: 1, scan: doc.scan ?? null, agent: doc.agent ?? null };
  } catch {
    return { schemaVersion: 1, scan: null, agent: null };
  }
}

async function writePlan(root, doc) {
  await safeWriteFile(await planDir(root), PLAN_FILE, `${JSON.stringify({ schemaVersion: 1, scan: doc.scan ?? null, agent: doc.agent ?? null }, null, 1)}\n`, 0o600);
  return doc;
}

export async function storeScanPlan(root, scan) {
  const doc = await readPlan(root);
  const previous = doc.scan;
  doc.scan = scan;
  await writePlan(root, doc);
  return { plan: doc, changes: previous ? planChanges(previous, scan) : null };
}

export function planChanges(before, after) {
  const key = (service) => `${service.kind}|${service.cwd}|${service.command.join(' ')}`;
  const was = new Map((before.services ?? []).map((service) => [key(service), service]));
  const now = new Map((after.services ?? []).map((service) => [key(service), service]));
  const added = [...now.keys()].filter((k) => !was.has(k)).map((k) => now.get(k).name);
  const removed = [...was.keys()].filter((k) => !now.has(k)).map((k) => was.get(k).name);
  const changed = [...now.keys()].filter((k) => was.has(k) && JSON.stringify([was.get(k).ports, was.get(k).links?.map((l) => l.url), was.get(k).shared?.reasons]) !== JSON.stringify([now.get(k).ports, now.get(k).links?.map((l) => l.url), now.get(k).shared?.reasons])).map((k) => now.get(k).name);
  return { added, removed, changed, any: Boolean(added.length || removed.length || changed.length) };
}

// Secret-looking content anywhere is refused, by place only (never echoed).
function secretProblems(where, value, out) {
  if (typeof value === 'string') { if (containsSecret(value)) out.push(`${where} looks like it contains a secret value; plans hold names, never values`); return; }
  if (Array.isArray(value)) { value.forEach((entry, index) => secretProblems(`${where}[${index}]`, entry, out)); return; }
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) { if (isSecretKey(key)) out.push(`${where}.${key} is named like a secret`); else secretProblems(`${where}.${key}`, entry, out); }
}

const SHELL_STRING = /[;&|`$<>]|\b(?:sh|bash|zsh)\s+-c\b/;

// Validates a proposed plan (from the agent). Every problem is listed, so it can be fixed
// and proposed again; nothing is stored unless all pass.
export async function validatePlan(root, input, { home = os.homedir() } = {}) {
  const problems = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid(['the file must hold a JSON object { "services": [...], "unresolved": [...] }']);
  const unknownTop = Object.keys(input).filter((key) => !['services', 'unresolved', 'summary'].includes(key));
  if (unknownTop.length) problems.push(`unknown top-level field(s): ${unknownTop.join(', ')}`);
  if (!Array.isArray(input.services) || !input.services.length || input.services.length > MAX_SERVICES) problems.push(`services must be an array of 1-${MAX_SERVICES} services`);
  if (input.unresolved !== undefined && (!Array.isArray(input.unresolved) || input.unresolved.length > 100)) problems.push('unresolved must be an array (max 100)');
  if (input.summary !== undefined && (typeof input.summary !== 'string' || input.summary.length > 2000)) problems.push('summary must be text (max 2000 characters)');
  secretProblems('plan', input, problems);
  if (problems.length) throw invalid(problems);
  let realRoot;
  let realHome;
  try { realRoot = await realpath(root); realHome = await realpath(home); } catch { throw invalid(['the project or home folder could not be resolved']); }
  const ids = new Set();
  const services = [];
  for (const [index, raw] of input.services.entries()) {
    const at = `services[${index}]${raw?.id ? ` (${raw.id})` : ''}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push(`${at} must be an object`); continue; }
    const unknown = Object.keys(raw).filter((key) => !PLAN_SERVICE_FIELDS.includes(key));
    if (unknown.length) problems.push(`${at}: unknown field(s) ${unknown.join(', ')}`);
    if (!SERVICE_ID.test(String(raw.id ?? ''))) problems.push(`${at}: id must be lowercase letters, digits and dashes, starting with a letter (max 32)`);
    else if (ids.has(raw.id)) problems.push(`${at}: id ${raw.id} repeats`);
    else ids.add(raw.id);
    if (Array.isArray(raw.command) && ((raw.command.length <= 2 && raw.command.some((part) => typeof part === 'string' && SHELL_STRING.test(part))) || (typeof raw.command[0] === 'string' && SHELLS.has(path.basename(raw.command[0])) && raw.command.some((part) => /^-[A-Za-z]*c[A-Za-z]*$/.test(String(part)))))) problems.push(`${at}: command must be an argv array, not a shell string`);
    if (raw.shared !== undefined && (raw.shared === null || typeof raw.shared !== 'object' || Array.isArray(raw.shared) || Object.keys(raw.shared).some((key) => !['reasons', 'scope'].includes(key)) || [raw.shared.reasons ?? [], raw.shared.scope ?? []].some((list) => !Array.isArray(list) || list.length > 24 || list.some((entry) => typeof entry !== 'string' || entry.length > 200)))) problems.push(`${at}: shared must be { "reasons": [text], "scope": [text] }`);
    if (typeof raw.env === 'object' && !Array.isArray(raw.env) && raw.env !== undefined) problems.push(`${at}: env lists variable names only, never values`);
    if (Array.isArray(raw.env) && raw.env.some((entry) => typeof entry === 'string' && entry.includes('='))) problems.push(`${at}: env lists variable names only, never values`);
    if (!CONFIDENCE.includes(raw.confidence)) problems.push(`${at}: confidence must be one of ${CONFIDENCE.join(', ')}`);
    const evidence = Array.isArray(raw.evidence) ? raw.evidence : [];
    if (raw.evidence !== undefined && (!Array.isArray(raw.evidence) || raw.evidence.length > 40 || raw.evidence.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 300))) problems.push(`${at}: evidence must list file paths or runtime: observations`);
    if (raw.confidence === 'confirmed' && !evidence.length) problems.push(`${at}: a confirmed service needs evidence (a file it was read from, or a runtime: observation)`);
    if (raw.confidence === 'confirmed' && evidence.length) {
      const files = evidence.filter((entry) => !/^runtime:/.test(entry));
      let found = files.length < evidence.length;
      for (const entry of files) {
        const clean = entry.replace(/[#:].*$/, '');
        const full = clean.startsWith('~/') ? path.join(home, clean.slice(2)) : path.isAbsolute(clean) ? clean : path.join(root, clean);
        try { await lstat(full); found = true; break; } catch { /* next */ }
      }
      if (!found) problems.push(`${at}: none of the evidence for this confirmed service exists`);
    }
    if (raw.notes !== undefined && (!Array.isArray(raw.notes) || raw.notes.length > 20 || raw.notes.some((entry) => typeof entry !== 'string' || entry.length > 500))) problems.push(`${at}: notes must be short texts`);
    // The definition itself: the same rules as the runtime profile (personal file rules,
    // since an outside folder may only be saved there).
    const definition = Object.fromEntries(PROFILE_FIELDS.filter((key) => raw[key] !== undefined && raw[key] !== null && key !== 'shared').map((key) => [key, raw[key]]));
    if (raw.links) definition.links = raw.links.map((link) => (link && typeof link === 'object' ? { label: link.label, url: link.url } : link));
    try { validateService(definition, { personal: true, where: at }); } catch (error) { problems.push(error.message.replace(/^service [a-z0-9-]+: /, `${at}: `)); }
    if (raw.links?.some?.((link) => !LINK_URL.test(String(link?.url ?? '')))) problems.push(`${at}: links go to 127.0.0.1, localhost or a *.localhost name only`);
    if (typeof raw.cwd === 'string') {
      try {
        const folder = await realpath(path.isAbsolute(raw.cwd) ? raw.cwd : path.join(realRoot, raw.cwd));
        if (path.isAbsolute(raw.cwd) ? !folder.startsWith(`${realHome}${path.sep}`) : !(folder === realRoot || folder.startsWith(`${realRoot}${path.sep}`))) problems.push(`${at}: cwd resolves ${path.isAbsolute(raw.cwd) ? 'outside your home folder' : 'outside the repository'} (symbolic links are followed)`);
      } catch { problems.push(`${at}: cwd ${raw.cwd} does not exist`); }
    }
    services.push({ ...raw, evidence, notes: raw.notes ?? [] });
  }
  for (const service of services) for (const dep of service.dependsOn ?? []) if (!ids.has(dep)) problems.push(`service ${service.id} depends on ${dep}, which is not in the plan`);
  const visiting = new Set();
  const done = new Set();
  const cycle = (id) => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const found = (services.find((entry) => entry.id === id)?.dependsOn ?? []).some(cycle);
    visiting.delete(id);
    done.add(id);
    return found;
  };
  if (services.some((service) => cycle(service.id))) problems.push('dependsOn forms a cycle');
  for (const [index, item] of (input.unresolved ?? []).entries()) {
    if (!item || typeof item !== 'object' || typeof item.item !== 'string' || typeof item.reason !== 'string' || item.item.length > 200 || item.reason.length > 500) problems.push(`unresolved[${index}] must be { "item", "reason" }`);
  }
  if (problems.length) throw invalid(problems);
  return { services, unresolved: (input.unresolved ?? []).map((item) => ({ item: item.item, reason: item.reason, blocking: false })), summary: input.summary ?? null };
}

export async function storeAgentPlan(root, input) {
  const valid = await validatePlan(root, input);
  const doc = await readPlan(root);
  doc.agent = { schemaVersion: 1, source: 'agent', proposedAt: new Date().toISOString(), ...valid };
  await writePlan(root, doc);
  return doc;
}

export async function discardPlan(root, which) {
  const doc = await readPlan(root);
  if (which === 'agent' || which === 'all') doc.agent = null;
  if (which === 'scan' || which === 'all') doc.scan = null;
  await writePlan(root, doc);
  return doc;
}

// Save selected: copies plan services into the profile as untrusted definitions. Nothing is
// trusted and nothing runs. Outside-repository folders always go to the personal file.
// An id already in the profile is replaced only with `replace` (the caller confirmed).
export async function savePlanServices(root, ids, { from = 'agent', sharedProfile = false, replace = false } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_SERVICES || ids.some((id) => !SERVICE_ID.test(String(id)))) throw Object.assign(new Error('Name the plan services to save.'), { code: 'USAGE' });
  const doc = await readPlan(root);
  const plan = from === 'scan' ? doc.scan : doc.agent ?? doc.scan;
  if (!plan) throw Object.assign(new Error('There is no runtime plan yet. Run Analyze first.'), { code: 'RUNTIME_PLAN_MISSING' });
  const profiles = await loadRuntimeProfiles(root);
  const existing = new Set(profiles.services.map((service) => service.id));
  const picked = ids.map((id) => plan.services.find((service) => service.id === id) ?? (() => { throw Object.assign(new Error(`The plan has no service ${id}.`), { code: 'RUNTIME_PLAN_UNKNOWN' }); })());
  const clash = picked.filter((service) => existing.has(service.id));
  if (clash.length && !replace) throw Object.assign(new Error(`Already in the runtime profile: ${clash.map((service) => service.id).join(', ')}. Confirm replacing them; the new definitions will need trust again.`), { code: 'RUNTIME_PLAN_EXISTS', ids: clash.map((service) => service.id) });
  const saved = [];
  for (const picked1 of picked) {
    // The scan's own observation of a matching service (shared scope) travels with an agent's.
    const twin = plan === doc.agent ? (doc.scan?.services ?? []).find((y) => y.kind === picked1.kind && y.cwd === picked1.cwd && JSON.stringify(y.command) === JSON.stringify(picked1.command)) : null;
    const service = twin?.shared && !picked1.shared ? { ...picked1, shared: twin.shared } : picked1;
    const definition = Object.fromEntries(PROFILE_FIELDS.filter((key) => service[key] !== undefined && service[key] !== null).map((key) => [key, service[key]]));
    if (definition.links) definition.links = definition.links.map((link) => ({ label: link.label, url: link.url }));
    if (definition.shared) definition.shared = { scope: (definition.shared.scope?.length ? definition.shared.scope : definition.shared.reasons ?? ['shared']).slice(0, 24).map((entry) => String(entry).slice(0, 200)) };
    for (const key of ['env', 'ports', 'dependsOn', 'links']) if (Array.isArray(definition[key]) && !definition[key].length) delete definition[key];
    const personal = path.isAbsolute(definition.cwd) || !sharedProfile;
    const fromShared = (profiles.shared?.services ?? []).some((entry) => entry.id === service.id);
    const inLocal = (profiles.local?.services ?? []).some((entry) => entry.id === service.id);
    if (fromShared && personal) {
      // Review finding 8: the team's committed definition is never touched from a personal
      // save; the plan becomes a personal override of it.
      const { id, kind, ...fields } = definition;
      const override = { id, ...Object.fromEntries(Object.entries(fields).filter(([key]) => OVERRIDABLE_FROM_PLAN.includes(key))) };
      await addService(root, override, { local: true });
      saved.push({ id: service.id, profile: '.yallaflow/local/runtime.yaml (personal override)', trusted: false });
      continue;
    }
    // Replacing (confirmed): the definition is replaced where it lives — the personal file, or
    // the shared file only when the developer chose to save there.
    if (existing.has(service.id) && (personal ? inLocal : fromShared)) await removeService(root, service.id, { local: personal });
    else if (existing.has(service.id) && !personal && inLocal) await removeService(root, service.id, { local: true });
    await addService(root, definition, { local: personal });
    saved.push({ id: service.id, profile: personal ? '.yallaflow/local/runtime.yaml' : '.yallaflow/runtime.yaml', trusted: false });
  }
  return { saved };
}
