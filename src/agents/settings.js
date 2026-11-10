// The developer's agent choice for one project (PF-0069): `.yallaflow/local/agents.json`,
// git-ignored, per checkout. It is a local preference, never project memory and never a
// YallaFlow approval. A missing or unreadable file means "nothing chosen".
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureLocalIgnored } from './bridge.js';
import { safeWriteFile } from './local-files.js';
import { SAFE_GIT } from '../utils/git-safety.js';

export const AGENT_SETTINGS_FILE = 'agents.json';
const SCHEMA_VERSION = 1;

export function agentSettingsPath(root) {
  return path.join(root, '.yallaflow', 'local', AGENT_SETTINGS_FILE);
}

// A choice counts only when this developer made it in this checkout (security review,
// PF-0069): a regular file owned by this user, readable by nobody else (YallaFlow writes it
// 0600; a git checkout gives 0644), and not tracked by Git. A repository cannot commit an
// agents.json that switches agents or Claude Code on for whoever opens it.
export async function personalLocalFile(root, file) {
  const info = await lstat(file);
  if (!info.isFile()) return 'not a regular file';
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) return 'not owned by you';
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) return 'readable by others (not written by YallaFlow)';
  const tracked = spawnSync('git', [...SAFE_GIT, 'ls-files', '--error-unmatch', '--', path.relative(root, file)], { cwd: root, stdio: 'ignore' });
  if (tracked.status === 0) return 'tracked by Git';
  return null;
}

// → { chosen: false } | { chosen: true, agents, claude, updatedAt } | { chosen: false, error }
export async function readAgentSettings(root) {
  let text;
  try {
    // A symbolic link here is never followed (see local-files.js).
    const refused = await personalLocalFile(root, agentSettingsPath(root));
    if (refused) return { chosen: false, error: `The saved agent choice was ignored (${refused}); saving a choice replaces it.` };
    text = await readFile(agentSettingsPath(root), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { chosen: false };
    return { chosen: false, error: 'The saved agent choice could not be read.' };
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || value.schemaVersion !== SCHEMA_VERSION || typeof value.agents !== 'boolean' || typeof value.claude !== 'boolean') throw new Error('shape');
    // Claude needs agents on; an inconsistent file is read as agents off.
    return { chosen: true, agents: value.agents, claude: value.agents && value.claude, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null };
  } catch {
    return { chosen: false, error: 'The saved agent choice is invalid; saving a choice replaces it.' };
  }
}

export async function writeAgentSettings(root, { agents, claude }) {
  if (typeof agents !== 'boolean' || typeof claude !== 'boolean') throw Object.assign(new Error('Send { "agents": true|false, "claude": true|false }.'), { status: 400, code: 'BAD_REQUEST' });
  const value = { schemaVersion: SCHEMA_VERSION, agents, claude: agents && claude, updatedAt: new Date().toISOString() };
  await safeWriteFile(await ensureLocalIgnored(root), AGENT_SETTINGS_FILE, `${JSON.stringify(value, null, 1)}\n`);
  return { chosen: true, agents: value.agents, claude: value.claude, updatedAt: value.updatedAt };
}

// PF-0112 (owner decision D15): how long an agent's approval request waits for the developer
// in this project before it is DENIED — 5 (the default and today's behaviour), 15, 30 or 60
// minutes. `.yallaflow/local/approval.json`, personal like agents.json: a repository cannot
// commit a longer wait for whoever opens it. A timeout never approves anything.
export const APPROVAL_WAIT_FILE = 'approval.json';
export const APPROVAL_WAIT_CHOICES = Object.freeze([5, 15, 30, 60]);
export const DEFAULT_APPROVAL_WAIT_MINUTES = 5;

export async function readApprovalWait(root) {
  const file = path.join(root, '.yallaflow', 'local', APPROVAL_WAIT_FILE);
  try {
    const refused = await personalLocalFile(root, file);
    if (refused) return { minutes: DEFAULT_APPROVAL_WAIT_MINUTES, saved: false, error: `The saved approval wait was ignored (${refused}).` };
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (value?.schemaVersion !== 1 || !APPROVAL_WAIT_CHOICES.includes(value.minutes)) return { minutes: DEFAULT_APPROVAL_WAIT_MINUTES, saved: false, error: 'The saved approval wait is invalid; 5 minutes apply.' };
    return { minutes: value.minutes, saved: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { minutes: DEFAULT_APPROVAL_WAIT_MINUTES, saved: false };
    return { minutes: DEFAULT_APPROVAL_WAIT_MINUTES, saved: false, error: 'The saved approval wait could not be read; 5 minutes apply.' };
  }
}

export async function writeApprovalWait(root, minutes) {
  if (!APPROVAL_WAIT_CHOICES.includes(minutes)) throw Object.assign(new Error(`Choose ${APPROVAL_WAIT_CHOICES.join(', ')} minutes.`), { status: 400, code: 'BAD_REQUEST' });
  await safeWriteFile(await ensureLocalIgnored(root), APPROVAL_WAIT_FILE, `${JSON.stringify({ schemaVersion: 1, minutes, updatedAt: new Date().toISOString() }, null, 1)}\n`);
  return { minutes, saved: true };
}
