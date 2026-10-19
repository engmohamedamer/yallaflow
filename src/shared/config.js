import path from 'node:path';
import { readYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { PACKAGE_VERSION } from '../version.js';
import { currentBranch } from './git.js';

// Shared Project policy (v0.3.10), recorded in .yallaflow/config.yaml by the one-time,
// explicit `yallaflow shared enable`:
//
//   schemaVersion: 2
//   yallaflow:
//     minimumVersion: 0.3.10-internal.1     every CLI touching this project must be >= this
//   shared:
//     enabled: true
//     enabledAt: <ISO time>
//     integrationBranch: main                the one branch where canonical memory is written
//     sources:
//       storage: git                         git (default) | external (declared policy; no cloud storage)
//       largeFileBytes: 10485760             files above this are reported as candidates for Git LFS
//
// Config schema v2 exists only to make an older YallaFlow notice: a v0.3.9 `doctor`
// fails "schema parsing" on it instead of reporting a shared workspace healthy. A
// single-user workspace keeps schema v1, byte-for-byte unchanged.
export const CONFIG_SCHEMA_V1 = 1;
export const CONFIG_SCHEMA_SHARED = 2;
export const SUPPORTED_CONFIG_SCHEMAS = Object.freeze([CONFIG_SCHEMA_V1, CONFIG_SCHEMA_SHARED]);
export const SOURCE_STORAGE_POLICIES = Object.freeze(['git', 'external']);
export const DEFAULT_LARGE_FILE_BYTES = 10 * 1024 * 1024;
// The first YallaFlow that understands Shared Project state.
export const SHARED_MINIMUM_VERSION = '0.3.10-internal.1';

const SHARED_FIELDS = new Set(['enabled', 'enabledAt', 'integrationBranch', 'sources']);
const SOURCES_FIELDS = new Set(['storage', 'largeFileBytes']);
const YALLAFLOW_FIELDS = new Set(['minimumVersion']);

export async function loadProjectConfig(root) {
  return readYaml(path.join(workspacePath(root), 'config.yaml'));
}

// { enabled: false } for a single-user workspace; the normalized policy otherwise.
export function sharedPolicy(config) {
  const shared = config?.shared;
  if (!shared || shared.enabled !== true) return { enabled: false, minimumVersion: config?.yallaflow?.minimumVersion ?? null };
  return {
    enabled: true,
    enabledAt: shared.enabledAt ?? null,
    integrationBranch: shared.integrationBranch ?? null,
    sources: {
      storage: shared.sources?.storage ?? 'git',
      largeFileBytes: shared.sources?.largeFileBytes ?? DEFAULT_LARGE_FILE_BYTES
    },
    minimumVersion: config?.yallaflow?.minimumVersion ?? null
  };
}

export async function loadSharedPolicy(root) {
  try {
    return sharedPolicy(await loadProjectConfig(root));
  } catch {
    return { enabled: false, minimumVersion: null, unreadable: true };
  }
}

export function validateProjectConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['config.yaml must be an object.'];
  if (!SUPPORTED_CONFIG_SCHEMAS.includes(config.schemaVersion)) {
    return [`config.yaml schemaVersion ${JSON.stringify(config.schemaVersion)} is not supported by YallaFlow ${PACKAGE_VERSION} (supported: ${SUPPORTED_CONFIG_SCHEMAS.join(', ')}).`];
  }
  if (config.yallaflow !== undefined) {
    const block = config.yallaflow;
    if (!block || typeof block !== 'object' || Array.isArray(block)) errors.push('config.yaml yallaflow must be an object.');
    else {
      const unknown = Object.keys(block).filter((key) => !YALLAFLOW_FIELDS.has(key));
      if (unknown.length) errors.push(`config.yaml yallaflow has unknown field(s): ${unknown.join(', ')}.`);
      if (block.minimumVersion !== undefined && !parseVersion(block.minimumVersion)) errors.push(`config.yaml yallaflow.minimumVersion ${JSON.stringify(block.minimumVersion)} is not a valid version.`);
    }
  }
  errors.push(...validateRequirementsConfig(config.requirements));
  errors.push(...validateQualityConfig(config.quality));
  if (config.shared === undefined) {
    if (config.schemaVersion === CONFIG_SCHEMA_SHARED) errors.push('config.yaml schema v2 requires a shared block (written by `yallaflow shared enable`).');
    return errors;
  }
  const shared = config.shared;
  if (!shared || typeof shared !== 'object' || Array.isArray(shared)) return [...errors, 'config.yaml shared must be an object.'];
  const unknown = Object.keys(shared).filter((key) => !SHARED_FIELDS.has(key));
  if (unknown.length) errors.push(`config.yaml shared has unknown field(s): ${unknown.join(', ')}.`);
  if (typeof shared.enabled !== 'boolean') errors.push('config.yaml shared.enabled must be true or false.');
  if (shared.enabled === true) {
    if (config.schemaVersion !== CONFIG_SCHEMA_SHARED) errors.push('an enabled Shared Project requires config.yaml schemaVersion 2.');
    if (!isBranchName(shared.integrationBranch)) errors.push('config.yaml shared.integrationBranch must name a Git branch.');
    if (typeof shared.enabledAt !== 'string' || Number.isNaN(Date.parse(shared.enabledAt))) errors.push('config.yaml shared.enabledAt must be an ISO timestamp.');
    if (!config.yallaflow?.minimumVersion) errors.push('an enabled Shared Project requires config.yaml yallaflow.minimumVersion.');
  }
  if (shared.sources !== undefined) {
    const sources = shared.sources;
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) errors.push('config.yaml shared.sources must be an object.');
    else {
      const extra = Object.keys(sources).filter((key) => !SOURCES_FIELDS.has(key));
      if (extra.length) errors.push(`config.yaml shared.sources has unknown field(s): ${extra.join(', ')}.`);
      if (sources.storage !== undefined && !SOURCE_STORAGE_POLICIES.includes(sources.storage)) errors.push(`config.yaml shared.sources.storage must be one of: ${SOURCE_STORAGE_POLICIES.join(', ')}.`);
      if (sources.largeFileBytes !== undefined && (!Number.isInteger(sources.largeFileBytes) || sources.largeFileBytes < 1)) errors.push('config.yaml shared.sources.largeFileBytes must be a positive integer.');
    }
  }
  return errors;
}

// Optional Connected Requirements settings (v1.1.0). Absent means defaults; nothing
// here enables network access — only `intake ticket --fetch` ever fetches.
//   requirements:
//     providers:
//       github:       { apiUrl: <GitHub Enterprise API URL, e.g. ghe.example.com/api/v3> }
//       jira:         { baseUrl: <site URL, e.g. example.atlassian.net> }
//       azure-devops: { baseUrl: <Azure DevOps Server collection URL> }
const PROVIDER_URL_FIELDS = Object.freeze({ github: 'apiUrl', jira: 'baseUrl', 'azure-devops': 'baseUrl' });

export function validateRequirementsConfig(block) {
  if (block === undefined) return [];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return ['config.yaml requirements must be an object.'];
  const errors = [];
  const extra = Object.keys(block).filter((key) => key !== 'providers');
  if (extra.length) errors.push(`config.yaml requirements has unknown field(s): ${extra.join(', ')}.`);
  if (block.providers === undefined) return errors;
  if (!block.providers || typeof block.providers !== 'object' || Array.isArray(block.providers)) return [...errors, 'config.yaml requirements.providers must be an object.'];
  for (const [provider, settings] of Object.entries(block.providers)) {
    const field = PROVIDER_URL_FIELDS[provider];
    if (!field) {
      errors.push(`config.yaml requirements.providers has unknown provider ${JSON.stringify(provider)} (known: ${Object.keys(PROVIDER_URL_FIELDS).join(', ')}).`);
      continue;
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      errors.push(`config.yaml requirements.providers.${provider} must be an object.`);
      continue;
    }
    const unknown = Object.keys(settings).filter((key) => key !== field);
    if (unknown.length) errors.push(`config.yaml requirements.providers.${provider} has unknown field(s): ${unknown.join(', ')} (credentials never belong in config; use environment variables).`);
    if (settings[field] !== undefined && !/^https?:\/\/[^\s]+$/.test(String(settings[field]))) errors.push(`config.yaml requirements.providers.${provider}.${field} must be an http(s) URL.`);
  }
  return errors;
}

// Optional quality settings (v1.1.0) inside the existing quality block:
//   quality:
//     qc:    { policy: advisory | strict }   default advisory; strict is an explicit opt-in
//     media: { commit: true | false }        default false: QC/demo media stays local
// Only these two sub-blocks are validated; other quality keys (testingStrategy) are untouched.
export function validateQualityConfig(block) {
  if (block === undefined) return [];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return ['config.yaml quality must be an object.'];
  const errors = [];
  if (block.qc !== undefined) {
    if (!block.qc || typeof block.qc !== 'object' || Array.isArray(block.qc)) errors.push('config.yaml quality.qc must be an object.');
    else {
      const extra = Object.keys(block.qc).filter((key) => key !== 'policy');
      if (extra.length) errors.push(`config.yaml quality.qc has unknown field(s): ${extra.join(', ')}.`);
      if (block.qc.policy !== undefined && !['advisory', 'strict'].includes(block.qc.policy)) errors.push('config.yaml quality.qc.policy must be advisory or strict.');
    }
  }
  if (block.media !== undefined) {
    if (!block.media || typeof block.media !== 'object' || Array.isArray(block.media)) errors.push('config.yaml quality.media must be an object.');
    else {
      const extra = Object.keys(block.media).filter((key) => key !== 'commit');
      if (extra.length) errors.push(`config.yaml quality.media has unknown field(s): ${extra.join(', ')}.`);
      if (block.media.commit !== undefined && typeof block.media.commit !== 'boolean') errors.push('config.yaml quality.media.commit must be true or false.');
    }
  }
  return errors;
}

export function isBranchName(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0 &&
    !/[\s~^:?*[\\]|\.\.|@\{|^\/|\/$|\.lock$|^-/.test(value);
}

// ---------------------------------------------------------------------------
// Version compatibility: major.minor.patch[-prerelease], semver precedence.

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] };
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Cannot compare versions ${JSON.stringify(a)} and ${JSON.stringify(b)}.`);
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// Read-only. { required, installed, compatible, reason? } — required is null when the
// project records no requirement (every single-user workspace before sharing).
export async function checkProjectCompatibility(root, installed = PACKAGE_VERSION) {
  let config;
  try {
    config = await loadProjectConfig(root);
  } catch {
    return { required: null, installed, compatible: true, unreadable: true };
  }
  if (Number.isInteger(config?.schemaVersion) && config.schemaVersion > CONFIG_SCHEMA_SHARED) {
    return { required: null, installed, compatible: false, reason: `config.yaml uses schema v${config.schemaVersion}, written by a newer YallaFlow` };
  }
  const required = config?.yallaflow?.minimumVersion ?? null;
  if (!required) return { required: null, installed, compatible: true };
  if (!parseVersion(required)) return { required, installed, compatible: false, reason: `the project requires an unreadable version ${JSON.stringify(required)}` };
  const compatible = compareVersions(installed, required) >= 0;
  return { required, installed, compatible, ...(compatible ? {} : { reason: `this project requires YallaFlow >= ${required}` }) };
}

export function describeCompatibility(compat) {
  return `Installed: ${compat.installed} · Project requires: ${compat.required ? `>= ${compat.required}` : 'no minimum recorded'}${compat.compatible ? '' : ' — INCOMPATIBLE'}`;
}

export function incompatibleMessage(compat) {
  return `This project cannot be changed with this YallaFlow.\n\n${describeCompatibility(compat)}\nReason: ${compat.reason}.\n\n` +
    'Install a compatible YallaFlow version (see docs/installation.md), then retry. YallaFlow never self-updates or downloads anything.\nNo files were changed.';
}

// The single-writer rule for canonical project memory in a Shared Project: the ledger
// (and its projection) is written only on the integration branch. Every canonical
// write — knowledge integration, baseline approval, reconciliation apply, adoption —
// passes through mutateContextLedger, which calls this first. Single-user workspaces
// are unaffected.
export async function assertCanonicalMemoryWritable(root) {
  const policy = await loadSharedPolicy(root);
  if (!policy.enabled) return;
  const branch = currentBranch(root);
  if (branch && branch === policy.integrationBranch) return;
  throw new Error(
    `This is a Shared Project: canonical project memory (.yallaflow/context/index.yaml) is written only on the integration branch (${policy.integrationBranch}); ` +
    `this checkout is on ${branch ?? 'a detached HEAD'}.\n\n` +
    'On a feature branch, reviewed knowledge is staged with its work item (yallaflow knowledge promote) and integrated after merge (yallaflow shared integrate). ' +
    'Baseline approval and legacy reconciliation are canonical writes: run them on the integration branch.\n\nNothing was changed.'
  );
}
