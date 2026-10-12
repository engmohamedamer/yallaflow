import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { readYaml } from '../core/yaml.js';
import { listWork, workspacePath } from '../core/workspace.js';
import { listSources, sourceChecksum, sourceDirPath } from '../core/sources.js';
import { parseScopedId } from '../core/ids.js';
import { loadContextLedger } from '../context/ledger.js';
import { loadProjectConfig, checkProjectCompatibility, describeCompatibility, sharedPolicy, validateProjectConfig } from './config.js';
import { checkSharedMemoryIntegrity, planSharedIntegration } from './memory.js';
import { readLocalIdentity, LOCAL_DIR } from './identity.js';
import { insideGitWorkTree, isGitIgnored, trackedPaths } from './git.js';

// Shared Project integrity (v0.3.10) — consumed by `doctor` (structural) and
// `yallaflow shared check` (CI). Read-only and deterministic: local files and local Git
// only, never the network, never an LLM. No auto-repair.
//
//   errors    structurally unsafe shared state (doctor FAIL, shared check FAIL)
//   warnings  needs attention but is not corruption (doctor WARN)
//   blockers  pending memory deltas that cannot integrate safely (shared check FAIL,
//             doctor WARN — reconciliation is legitimate work, not corruption)
export async function collectSharedIntegrity(root) {
  const errors = [];
  const warnings = [];
  const blockers = [];
  let config;
  try {
    config = await loadProjectConfig(root);
  } catch (error) {
    return { enabled: false, errors: [`config.yaml is unreadable: ${error instanceof Error ? error.message : String(error)}`], warnings, blockers };
  }
  errors.push(...validateProjectConfig(config));
  const policy = sharedPolicy(config);
  const compat = await checkProjectCompatibility(root);
  if (!compat.compatible) errors.push(`YallaFlow version: ${describeCompatibility(compat)} (${compat.reason}). Stop before changing project state.`);
  if (!policy.enabled) return { enabled: false, policy, compat, errors, warnings, blockers };

  // Local-only state must stay local; shared state must stay shared.
  const base = workspacePath(root);
  if (insideGitWorkTree(root)) {
    const leaked = trackedPaths(root, `.yallaflow/${LOCAL_DIR}`);
    if (leaked.length) errors.push(`local-only state is committed: ${leaked.slice(0, 3).join(', ')}${leaked.length > 3 ? ` (+${leaked.length - 3} more)` : ''} — .yallaflow/local/ is personal (identity, active work); remove it from Git (git rm -r --cached .yallaflow/local).`);
    if (!isGitIgnored(root, `.yallaflow/${LOCAL_DIR}/identity.yaml`)) errors.push('.yallaflow/local/ is not gitignored; personal state could be committed. Restore .yallaflow/.gitignore (written by `yallaflow shared enable`).');
    for (const shared of ['.yallaflow/context/index.yaml', '.yallaflow/work', '.yallaflow/sources', '.yallaflow/config.yaml']) {
      if (isGitIgnored(root, shared)) errors.push(`${shared} is gitignored, but it is shared project state in a Shared Project.`);
    }
    if (trackedPaths(root, '.yallaflow/state/current.yaml').length) warnings.push('.yallaflow/state/current.yaml is still tracked; in a Shared Project active-work focus is personal (.yallaflow/local/state/). Remove it from Git (git rm --cached .yallaflow/state/current.yaml).');
  } else {
    errors.push('Shared Project Mode requires a Git work tree (Git is the collaboration transport).');
  }
  for (const misplaced of ['work', 'context', 'sources', 'decisions', 'config.yaml', 'PROJECT.md']) {
    if (await exists(path.join(base, LOCAL_DIR, misplaced))) errors.push(`.yallaflow/local/${misplaced} exists — shared project state stored under the local-only directory is invisible to the team.`);
  }
  const identity = await readLocalIdentity(root);
  if (identity?.invalid) errors.push('.yallaflow/local/identity.yaml is malformed; delete it and YallaFlow will create a new one.');

  // Branch-safe identifiers: anything created after sharing was enabled must use the
  // branch-safe form; a sequential ID created later came from a Shared-unaware CLI.
  const work = await listWork(root);
  for (const meta of work) {
    const parsed = parseScopedId('PF', meta.id);
    if (parsed?.form === 'legacy' && (meta.createdAt ?? '') > policy.enabledAt) {
      errors.push(`${meta.id} was created after this project became shared (${policy.enabledAt}) but uses a sequential ID that can collide across branches — it was created by a YallaFlow without Shared Project support (project requires >= ${policy.minimumVersion}).`);
    }
  }
  const sources = await listSources(root).catch(() => []);
  const bySum = new Map();
  for (const record of sources) {
    const parsed = parseScopedId('SRC', record.id);
    if (parsed?.form === 'legacy' && (record.capturedAt ?? '') > policy.enabledAt) {
      errors.push(`${record.id} was captured after this project became shared but uses a sequential ID that can collide across branches.`);
    }
    const sum = sourceChecksum(record);
    if (!bySum.has(sum)) bySum.set(sum, []);
    bySum.get(sum).push(record.id);
  }
  for (const ids of bySum.values()) {
    if (ids.length > 1) warnings.push(`sources ${ids.join(', ')} hold identical content (captured separately, e.g. on parallel branches); both are kept — sources are never merged or dropped.`);
  }
  // Repository-size policy for durable sources (Git by default; LFS/external storage
  // is a declared policy boundary — YallaFlow builds no storage service).
  if (policy.sources.storage === 'git') {
    for (const record of sources) {
      const size = await directorySize(sourceDirPath(root, record.id));
      if (size > policy.sources.largeFileBytes) warnings.push(`${record.id} (${record.sourceName}) is ${formatBytes(size)}, above the shared source threshold (${formatBytes(policy.sources.largeFileBytes)}); consider Git LFS for .yallaflow/sources (see docs/shared-projects.md).`);
    }
  }

  let ledger;
  try {
    ({ ledger } = await loadContextLedger(root));
  } catch (error) {
    errors.push(`project context ledger: ${error instanceof Error ? error.message : String(error)}`);
    return { enabled: true, policy, compat, errors, warnings, blockers };
  }
  const memory = await checkSharedMemoryIntegrity(root, { ledger, policy });
  errors.push(...memory.errors);
  warnings.push(...memory.warnings);

  try {
    const { plan } = await planSharedIntegration(root);
    for (const item of plan.blocked) blockers.push({ workId: item.workId, candidateId: item.candidateId, summary: item.summary, blockers: item.blockers });
  } catch (error) {
    errors.push(`pending memory deltas could not be assessed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { enabled: true, policy, compat, errors, warnings, blockers };
}

async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export async function sourcesFootprint(root) {
  const sources = await listSources(root).catch(() => []);
  let total = 0;
  let largest = null;
  for (const record of sources) {
    const size = await directorySize(sourceDirPath(root, record.id));
    total += size;
    if (!largest || size > largest.size) largest = { id: record.id, name: record.sourceName, size };
  }
  return { count: sources.length, total, largest };
}

// Read-only sanity of the work tree itself for the shared summary.
export async function workSummary(root) {
  const work = await listWork(root);
  const open = work.filter((item) => item.status !== 'DONE');
  return { total: work.length, open };
}

export async function readConfigSafe(root) {
  try {
    return await readYaml(path.join(workspacePath(root), 'config.yaml'));
  } catch {
    return null;
  }
}
