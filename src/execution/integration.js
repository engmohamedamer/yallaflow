// PF-0112 M3: the two tracked records Review & Merge adds (owner decisions D9, D10):
// - work/<id>/integration.yaml — a durable, team-visible, append-only record that a work
//   item's changes were MERGED & VERIFIED (written only after the merge, the post-merge
//   checks and knowledge integration succeeded; never claims more).
// - config.yaml `execution.mergeChecks` — the project's required merge checks (D9): YallaFlow
//   never assumes that task tests replace hooks or CI; the developer declares what must run.
// Both are written atomically (all files or none) and raise the project's minimum version to
// 1.5.0 only with explicit confirmation (as hold/close did for 1.4.0), so an older YallaFlow
// reports "requires 1.5.0" instead of misreading them.
import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { compareVersions, parseVersion } from '../shared/config.js';
import { redactDeep } from '../security/redact.js';
import { writeAllOrNothing } from '../core/lifecycle.js';
import { isWorkId } from '../core/ids.js';
import * as gitops from './git-ops.js';

export const EXECUTION_MINIMUM_VERSION = '1.5.0';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const json = (value) => `${JSON.stringify(redactDeep(value), null, 2)}\n`;
const refuse = (message, code = 'INVALID') => Object.assign(new Error(message), { code });

async function minimumVersionWrite(root, accept) {
  const configFile = path.join(workspacePath(root), 'config.yaml');
  const config = await readYaml(configFile);
  const current = config?.yallaflow?.minimumVersion ?? null;
  const needed = !current || !parseVersion(current) || compareVersions(current, EXECUTION_MINIMUM_VERSION) < 0;
  if (!needed) return { config, write: null };
  if (accept !== EXECUTION_MINIMUM_VERSION) {
    throw Object.assign(new Error(`Recording Review & Merge state makes this project require YallaFlow >= ${EXECUTION_MINIMUM_VERSION} (it currently requires ${current ? `>= ${current}` : 'no minimum version'}). Older versions can still read the project but will refuse to change it.\n\nTo proceed, run the same command again with --accept-minimum-version ${EXECUTION_MINIMUM_VERSION}.\nNo files were changed.`), { code: 'CONFIRM_MINIMUM_VERSION', required: EXECUTION_MINIMUM_VERSION, current });
  }
  const next = { ...config, yallaflow: { ...(config.yallaflow ?? {}), minimumVersion: EXECUTION_MINIMUM_VERSION } };
  return { config: next, write: { file: configFile, content: json(next) } };
}

// ----- integration.yaml -----
export function integrationFile(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'integration.yaml');
}

export function validateIntegration(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') return ['the record must be a JSON object'];
  for (const key of ['merge', 'tree', 'base']) if (!OID.test(String(entry[key] ?? ''))) errors.push(`${key} must be a full object id`);
  for (const key of ['target', 'lane', 'planHash', 'approvedBy']) if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 300) errors.push(`${key} is required`);
  if (entry.state !== 'verified') errors.push('state must be "verified": the record is written only after every post-merge step succeeded');
  if (!Array.isArray(entry.checks)) errors.push('checks must be a list');
  else for (const [index, check] of entry.checks.entries()) {
    if (typeof check?.name !== 'string' || !Array.isArray(check.argv) || !Number.isInteger(check.exitCode)) errors.push(`checks[${index}] needs name, argv and exitCode`);
    else if (check.exitCode !== 0) errors.push(`checks[${index}] (${check.name}) did not pass; a failed integration is never recorded as verified`);
  }
  if (!entry.postMerge || typeof entry.postMerge !== 'object') errors.push('postMerge is required');
  else for (const [name, result] of Object.entries(entry.postMerge)) if (result !== 'pass') errors.push(`postMerge.${name} is ${JSON.stringify(result)}, not "pass"`);
  if (!Array.isArray(entry.knowledge)) errors.push('knowledge must be a list (possibly empty)');
  return errors;
}

export async function loadIntegration(root, workId) {
  const file = integrationFile(root, workId);
  return (await exists(file)) ? readYaml(file) : null;
}

// Appends one verified integration; refuses a duplicate merge commit (idempotent re-runs
// detect "already recorded" first).
export async function recordIntegration(root, workId, entry, { acceptMinimumVersion } = {}) {
  if (!isWorkId(workId)) throw refuse('A work item id is required.');
  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!(await exists(metaFile))) throw refuse(`Work item ${workId} not found.`, 'WORK_NOT_FOUND');
  const errors = validateIntegration(entry);
  if (errors.length) throw refuse(`Invalid integration record:\n- ${errors.join('\n- ')}\nNo files were changed.`);
  // Review L14: the record must describe a real merge on the target branch of this repository.
  if (!/^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/.test(entry.target)) throw refuse('target must be a plain branch name.');
  try {
    gitops.assertObject(root, entry.merge, 'commit');
    if (gitops.treeOf(root, entry.merge) !== entry.tree) throw new Error(`the merge commit does not carry tree ${entry.tree.slice(0, 12)}`);
    if (!gitops.isAncestor(root, entry.merge, `refs/heads/${entry.target}`)) throw new Error(`${entry.target} does not contain the merge commit`);
  } catch (error) {
    throw refuse(`Invalid integration record: ${error.message}. No files were changed.`);
  }
  const current = (await loadIntegration(root, workId)) ?? { schemaVersion: 1, workId, integrations: [] };
  if (current.integrations.some((existing) => existing.merge === entry.merge)) return { recorded: false, already: true, record: current };
  const { write } = await minimumVersionWrite(root, acceptMinimumVersion);
  const at = new Date().toISOString();
  const next = { ...current, integrations: [...current.integrations, { at, ...entry, ci: 'not run by YallaFlow' }] };
  await writeAllOrNothing([...(write ? [write] : []), { file: integrationFile(root, workId), content: json(next) }]);
  return { recorded: true, already: false, record: next, raisedMinimumVersion: Boolean(write) };
}

// ----- execution.mergeChecks -----
export function validateMergeChecks(checks) {
  const errors = [];
  if (!Array.isArray(checks) || checks.length > 10) return ['mergeChecks must be a list of at most 10 checks'];
  const names = new Set();
  for (const [index, check] of checks.entries()) {
    const label = `check ${index + 1}`;
    if (typeof check?.name !== 'string' || !/^[\w .:/-]{1,60}$/.test(check.name)) errors.push(`${label}: name is 1-60 plain characters`);
    else if (names.has(check.name)) errors.push(`${label}: the name ${check.name} is used twice`);
    else names.add(check.name);
    if (!Array.isArray(check?.argv) || !check.argv.length || check.argv.length > 30 || check.argv.some((part) => typeof part !== 'string' || !part || part.length > 300 || part.includes('\0'))) errors.push(`${label}: argv is a list of 1-30 arguments (no shell)`);
    if (check?.required !== undefined && typeof check.required !== 'boolean') errors.push(`${label}: required is true or false`);
  }
  return errors;
}

export async function loadMergeChecks(root) {
  const config = await readYaml(path.join(workspacePath(root), 'config.yaml'));
  return Array.isArray(config?.execution?.mergeChecks) ? config.execution.mergeChecks : null;
}

export async function setMergeChecks(root, checks, { acceptMinimumVersion } = {}) {
  const errors = validateMergeChecks(checks);
  if (errors.length) throw refuse(`Invalid merge checks:\n- ${errors.join('\n- ')}\nNo files were changed.`);
  const { config, write } = await minimumVersionWrite(root, acceptMinimumVersion);
  const normalized = checks.map((check) => ({ name: check.name, argv: [...check.argv], required: check.required !== false }));
  const next = { ...config, execution: { ...(config.execution ?? {}), mergeChecks: normalized } };
  await writeAllOrNothing([{ file: path.join(workspacePath(root), 'config.yaml'), content: json(next) }]);
  return { checks: normalized, raisedMinimumVersion: Boolean(write) };
}
