// Runtime profiles (1.4.0): the reviewed definitions of a project's local development
// services.
//
//   .yallaflow/runtime.yaml         shared, committed, secret-free
//   .yallaflow/local/runtime.yaml   personal overrides (git-ignored)
//
// A service is argv only (never a shell). Environment variables are listed by NAME; their
// values come from the developer's environment at start and are never stored. Writing a
// profile never runs anything. Validation refuses anything that looks like a secret and
// never echoes the offending value.
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { readYaml, writeYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { containsSecret, isSecretKey } from '../security/redact.js';
import { safeWriteFile } from '../agents/local-files.js';
import { localRuntimeDir } from './local.js';
import { executionInputs } from './inputs.js';

export const RUNTIME_PROFILE_SCHEMA = 1;
export const SERVICE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
// Control and bidirectional-override characters could make the reviewed text differ from
// what runs (security review of PF-0047); they are refused everywhere in a definition.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f\u0080-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad\u061c\u2028\u2029]/;
const KINDS = Object.freeze(['process', 'docker-compose']);
const SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);
const SERVICE_FIELDS = Object.freeze(['id', 'name', 'kind', 'command', 'cwd', 'env', 'ports', 'ready', 'stopSignal', 'stopTimeoutSeconds', 'readyTimeoutSeconds', 'dependsOn']);
const OVERRIDABLE = Object.freeze(['name', 'command', 'cwd', 'env', 'ports', 'ready', 'stopSignal', 'stopTimeoutSeconds', 'readyTimeoutSeconds']);
const MAX_SERVICES = 32;

export function sharedProfilePath(root) {
  return path.join(workspacePath(root), 'runtime.yaml');
}
export function localProfilePath(root) {
  return path.join(workspacePath(root), 'local', 'runtime.yaml');
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'RUNTIME_PROFILE_INVALID' });
}

// Secret-looking content anywhere in a definition is refused by field name only.
function refuseSecrets(where, value) {
  if (typeof value === 'string') {
    if (containsSecret(value)) throw invalid(`${where} looks like it contains a secret value; profiles hold no secrets (list environment variable names under env instead).`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, index) => refuseSecrets(`${where}[${index}]`, entry));
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isSecretKey(key)) throw invalid(`${where}.${key} is named like a secret; profiles hold no secret values.`);
      refuseSecrets(`${where}.${key}`, entry);
    }
  }
}

function refuseUnsafeText(where, value) {
  if (typeof value === 'string') {
    if (UNSAFE_TEXT.test(value)) throw invalid(`${where} contains control or bidirectional-override characters; refused so the reviewed text is what runs.`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, index) => refuseUnsafeText(`${where}[${index}]`, entry));
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) refuseUnsafeText(`${where}.${key}`, entry);
}

function checkInteger(where, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(`${where} must be an integer from ${min} to ${max}.`);
}

// Validates one service (a full definition, or a partial override when partial = true).
export function validateService(input, { partial = false, where = 'service' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid(`${where} must be an object.`);
  const allowed = partial ? ['id', ...OVERRIDABLE] : SERVICE_FIELDS;
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw invalid(`${where} has unknown or non-overridable field(s): ${unknown.join(', ')}.`);
  if (!SERVICE_ID.test(String(input.id ?? ''))) throw invalid(`${where}.id must match ${SERVICE_ID} (lowercase letters, digits and dashes).`);
  const at = `service ${input.id}`;
  refuseSecrets(at, input);
  refuseUnsafeText(at, input);
  if (!partial || 'name' in input) if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw invalid(`${at}: name must be 1-80 characters.`);
  if (!partial) if (!KINDS.includes(input.kind)) throw invalid(`${at}: kind must be one of ${KINDS.join(', ')}.`);
  if (!partial || 'command' in input) {
    if (!Array.isArray(input.command) || !input.command.length || input.command.length > 64) throw invalid(`${at}: command must be an argv array (executable first, 1-64 elements).`);
    for (const [index, part] of input.command.entries()) {
      if (typeof part !== 'string' || !part.length || part.length > 1024 || part.includes('\0')) throw invalid(`${at}: command[${index}] must be a non-empty string without NUL (max 1024).`);
    }
  }
  if (!partial || 'cwd' in input) {
    if (typeof input.cwd !== 'string' || !input.cwd.length || input.cwd.length > 512 || path.isAbsolute(input.cwd) || input.cwd.split(/[\\/]/).includes('..') || input.cwd.includes('\0')) {
      throw invalid(`${at}: cwd must be a repository-relative path without "..".`);
    }
  }
  if ('env' in input) {
    if (!Array.isArray(input.env) || input.env.length > 64) throw invalid(`${at}: env must be an array of environment variable names.`);
    for (const name of input.env) if (typeof name !== 'string' || !ENV_NAME.test(name)) throw invalid(`${at}: env entries are variable names (letters, digits, underscore), never values.`);
  }
  if ('ports' in input) {
    if (!Array.isArray(input.ports) || input.ports.length > 16) throw invalid(`${at}: ports must be an array.`);
    input.ports.forEach((port, index) => checkInteger(`${at}: ports[${index}]`, port, 1, 65535));
    if (new Set(input.ports).size !== input.ports.length) throw invalid(`${at}: ports must not repeat.`);
  }
  if ('ready' in input && input.ready !== null) {
    const ready = input.ready;
    if (!ready || typeof ready !== 'object' || Array.isArray(ready) || Object.keys(ready).length !== 1) throw invalid(`${at}: ready must be { "port": N } or { "log": "text" }.`);
    if ('port' in ready) checkInteger(`${at}: ready.port`, ready.port, 1, 65535);
    else if ('log' in ready) { if (typeof ready.log !== 'string' || !ready.log.trim() || ready.log.length > 200) throw invalid(`${at}: ready.log must be 1-200 characters.`); }
    else throw invalid(`${at}: ready must be { "port": N } or { "log": "text" }.`);
  }
  if ('stopSignal' in input && !SIGNALS.includes(input.stopSignal)) throw invalid(`${at}: stopSignal must be one of ${SIGNALS.join(', ')}.`);
  if ('stopTimeoutSeconds' in input) checkInteger(`${at}: stopTimeoutSeconds`, input.stopTimeoutSeconds, 1, 120);
  if ('readyTimeoutSeconds' in input) checkInteger(`${at}: readyTimeoutSeconds`, input.readyTimeoutSeconds, 1, 600);
  if ('dependsOn' in input) {
    if (!Array.isArray(input.dependsOn) || input.dependsOn.length > 16 || input.dependsOn.some((id) => !SERVICE_ID.test(String(id)))) throw invalid(`${at}: dependsOn must list service ids.`);
    if (input.dependsOn.includes(input.id)) throw invalid(`${at}: a service cannot depend on itself.`);
  }
  return true;
}

function validateFile(doc, label, partial) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw invalid(`${label} must be an object.`);
  const unknown = Object.keys(doc).filter((key) => !['schemaVersion', 'services'].includes(key));
  if (unknown.length) throw invalid(`${label} has unknown field(s): ${unknown.join(', ')}.`);
  if (doc.schemaVersion !== RUNTIME_PROFILE_SCHEMA) throw invalid(`${label} schemaVersion must be ${RUNTIME_PROFILE_SCHEMA}.`);
  if (!Array.isArray(doc.services) || doc.services.length > MAX_SERVICES) throw invalid(`${label} services must be an array (max ${MAX_SERVICES}).`);
  const ids = new Set();
  for (const [index, service] of doc.services.entries()) {
    validateService(service, { partial, where: `${label} services[${index}]` });
    if (ids.has(service.id)) throw invalid(`${label}: service id ${service.id} is defined twice.`);
    ids.add(service.id);
  }
}

async function readOptional(file, label) {
  let doc;
  try {
    doc = await readYaml(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw invalid(`${label} could not be parsed.`);
  }
  return doc;
}

// Returns { shared, local, services } where services are the effective definitions with
// defaults applied and `overridden` naming the fields a personal override changed.
export async function loadRuntimeProfiles(root) {
  const shared = await readOptional(sharedProfilePath(root), '.yallaflow/runtime.yaml');
  const local = await readOptional(localProfilePath(root), '.yallaflow/local/runtime.yaml');
  if (shared) validateFile(shared, '.yallaflow/runtime.yaml', false);
  const sharedIds = new Set((shared?.services ?? []).map((service) => service.id));
  if (local) {
    // An override names an existing shared service (partial) or defines a personal one (full).
    if (!local || typeof local !== 'object' || Array.isArray(local) || local.schemaVersion !== RUNTIME_PROFILE_SCHEMA || !Array.isArray(local.services)) throw invalid('.yallaflow/local/runtime.yaml must have schemaVersion 1 and a services array.');
    for (const [index, service] of local.services.entries()) validateService(service, { partial: sharedIds.has(service?.id), where: `.yallaflow/local/runtime.yaml services[${index}]` });
  }
  const services = [];
  for (const base of shared?.services ?? []) {
    const override = local?.services.find((service) => service.id === base.id);
    const overridden = override ? Object.keys(override).filter((key) => key !== 'id') : [];
    services.push({ ...withDefaults({ ...base, ...(override ?? {}) }), source: 'shared', overridden });
  }
  for (const own of local?.services ?? []) {
    if (!sharedIds.has(own.id)) services.push({ ...withDefaults(own), source: 'local', overridden: [] });
  }
  const ids = new Set(services.map((service) => service.id));
  for (const service of services) {
    for (const dep of service.dependsOn) if (!ids.has(dep)) throw invalid(`service ${service.id} depends on unknown service ${dep}.`);
  }
  return { exists: Boolean(shared || local), shared, local, services };
}

function withDefaults(service) {
  return {
    id: service.id,
    name: service.name,
    kind: service.kind,
    command: [...service.command],
    cwd: service.cwd,
    env: [...(service.env ?? [])],
    ports: [...(service.ports ?? [])],
    ready: service.ready ?? null,
    stopSignal: service.stopSignal ?? (service.kind === 'docker-compose' ? 'SIGINT' : 'SIGTERM'),
    stopTimeoutSeconds: service.stopTimeoutSeconds ?? (service.kind === 'docker-compose' ? 30 : 10),
    readyTimeoutSeconds: service.readyTimeoutSeconds ?? 60,
    dependsOn: [...(service.dependsOn ?? [])]
  };
}

// The material definition: everything that changes what runs, where, with which
// environment names, ports, readiness and stop behaviour. Trust binds to its hash.
export async function definitionHash(root, service) {
  const material = {
    kind: service.kind, command: service.command, cwd: service.cwd, env: [...service.env].sort(), ports: [...service.ports].sort((a, b) => a - b),
    ready: service.ready, stopSignal: service.stopSignal, stopTimeoutSeconds: service.stopTimeoutSeconds,
    readyTimeoutSeconds: service.readyTimeoutSeconds, dependsOn: [...service.dependsOn].sort(), inputs: await executionInputs(root, service)
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(material)).digest('hex')}`;
}

// The cwd must resolve inside the repository (symbolic links are followed and checked).
export async function resolveServiceCwd(root, service) {
  const realRoot = await realpath(root);
  let resolved;
  try {
    resolved = await realpath(path.join(realRoot, service.cwd));
  } catch {
    throw Object.assign(new Error(`service ${service.id}: working directory ${service.cwd} does not exist.`), { code: 'RUNTIME_CWD' });
  }
  if (resolved !== realRoot && !resolved.startsWith(`${realRoot}${path.sep}`)) throw Object.assign(new Error(`service ${service.id}: working directory ${service.cwd} resolves outside the repository; refused.`), { code: 'RUNTIME_CWD' });
  if (!(await stat(resolved)).isDirectory()) throw Object.assign(new Error(`service ${service.id}: ${service.cwd} is not a directory.`), { code: 'RUNTIME_CWD' });
  return resolved;
}

// Writers: the only supported way to change a profile. Nothing runs.
export async function addService(root, service, { local = false } = {}) {
  const { shared, local: localDoc } = await loadRuntimeProfiles(root);
  if (local) {
    const doc = localDoc ?? { schemaVersion: RUNTIME_PROFILE_SCHEMA, services: [] };
    const partial = (shared?.services ?? []).some((entry) => entry.id === service.id);
    validateService(service, { partial });
    doc.services = [...doc.services.filter((entry) => entry.id !== service.id), service];
    const dir = await localRuntimeDir(root);
    await safeWriteFile(dir, 'runtime.yaml', `${JSON.stringify(doc, null, 2)}\n`, 0o600);
  } else {
    validateService(service);
    const doc = shared ?? { schemaVersion: RUNTIME_PROFILE_SCHEMA, services: [] };
    if (doc.services.some((entry) => entry.id === service.id)) throw invalid(`service ${service.id} already exists in .yallaflow/runtime.yaml; remove it first.`);
    doc.services = [...doc.services, service];
    validateFile(doc, '.yallaflow/runtime.yaml', false);
    await writeYaml(sharedProfilePath(root), doc);
  }
  return loadRuntimeProfiles(root);
}

export async function removeService(root, id, { local = false } = {}) {
  const { shared, local: localDoc } = await loadRuntimeProfiles(root);
  const doc = local ? localDoc : shared;
  if (!doc || !doc.services.some((entry) => entry.id === id)) throw Object.assign(new Error(`No service ${id} in ${local ? '.yallaflow/local/runtime.yaml' : '.yallaflow/runtime.yaml'}.`), { code: 'RUNTIME_UNKNOWN_SERVICE' });
  doc.services = doc.services.filter((entry) => entry.id !== id);
  if (local) {
    const dir = await localRuntimeDir(root);
    await safeWriteFile(dir, 'runtime.yaml', `${JSON.stringify(doc, null, 2)}\n`, 0o600);
  } else {
    await writeYaml(sharedProfilePath(root), doc);
  }
  return loadRuntimeProfiles(root);
}
