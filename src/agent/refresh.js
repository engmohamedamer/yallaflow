// Safe refresh of the YallaFlow integration files in an existing project (PF-0183, 1.5.5).
// Check for updates, Preview changes, Refresh YallaFlow integration, Restore.
//
// Ownership rule. YallaFlow refreshes only text it can prove it wrote:
// - .yallaflow/AGENT.md: the managed contract block, whose begin marker records the SHA-256 of
//   the text YallaFlow wrote (an edit inside it is detected), or a whole file that is byte-for-
//   byte one of the generated templates of an earlier release (LEGACY_GENERATED_CONTRACTS).
// - AGENTS.md and CLAUDE.md: the YallaFlow bootstrap block only, hash-recorded the same way.
// Text outside a managed block is never changed. Everything else in the project — work records,
// progress and evidence ledgers, project memory, decisions, sources, preferences, runtime
// settings, the developer's own files — is never read for writing.
//
// - An edited block is a conflict: it is left alone unless the developer resolves it explicitly
//   (--resolve FILE=keep leaves it; FILE=preserve installs the current block and keeps the
//   edited text verbatim after it). A newer, malformed, or unsafe file is refused with a reason.
// - Before the first write, every file to change is copied to .yallaflow/local/backups/<id>/
//   (personal, git-ignored) with a manifest; the manifest records each file's hash before, the
//   hash it is about to get, and the hash it got. An interrupted refresh leaves the manifest in
//   state "started": `health` reports it and `refresh restore` puts the files back.
// - Writes go through writeManaged (link-safe, atomic rename); after writing, every file is
//   inspected again and must be current. Git is never run.
import { createHash, randomBytes } from 'node:crypto';
import { lstat, readdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { AGENT_CONTRACT_VERSION, inspectAgentContract, refreshAgentContract } from './contract.js';
import { BOOTSTRAP_PROVIDERS, BOOTSTRAP_VERSION, inspectBootstrap, setupBootstrap } from './bootstrap.js';
import { resolveManagedFile, writeManaged } from './managed-files.js';
import { safeLocalDir, safeWriteFile } from '../agents/local-files.js';
import { PACKAGE_VERSION } from '../version.js';

export const BACKUP_SCHEMA = 'yallaflow.refresh-backup/1';
const BACKUP_ID = /^refresh-\d{8}T\d{6}Z-[0-9a-f]{6}$/;
const AGENT_FILE = path.join('.yallaflow', 'AGENT.md');
const sha = (text) => createHash('sha256').update(text).digest('hex');
// The only files a refresh writes, and so the only ones a restore may write (review, 1.5.5).
export const MANAGED_PATHS = Object.freeze(['.yallaflow/AGENT.md', ...Object.values(BOOTSTRAP_PROVIDERS).map((provider) => provider.file)]);
const HASH = /^[0-9a-f]{64}$/;
const BACKUP_NAME = /^\d{1,2}\.bak$/;

class RefreshError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// Every managed file and what a refresh would do with it. Read-only.
//
// item.action:
//   none            current (or the other provider's file through a link): nothing to do
//   update          an unmodified managed block of an older version: replace the block only
//   replace         AGENT.md is an unmodified generated template of an earlier release
//   create          AGENT.md is missing (required)
//   add             a bootstrap block is not set up (optional: only with addMissing)
//   conflict        the managed text was edited by hand: needs --resolve FILE=keep|preserve
//   keep            a conflict the developer resolved by keeping the file as it is
//   preserve        a conflict resolved by installing the current block, edited text kept
//   refuse          newer, malformed or unsafe: never written (item.severity says why)
export async function planRefresh(root, { addMissing = false, resolve = {} } = {}) {
  const items = [];
  const contract = await inspectAgentContract(root);
  items.push(classify({ file: AGENT_FILE.split(path.sep).join('/'), kind: 'contract', status: contract, installed: AGENT_CONTRACT_VERSION }, resolve, addMissing));
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) {
    const status = await inspectBootstrap(root, provider);
    items.push(classify({ file: provider.file, kind: 'bootstrap', provider: provider.id, status, installed: BOOTSTRAP_VERSION }, resolve, addMissing));
  }
  for (const key of Object.keys(resolve)) {
    if (!items.some((item) => item.file === key)) throw new RefreshError('REFRESH_BAD_RESOLVE', `--resolve names ${key}, which is not a file YallaFlow manages (${items.map((item) => item.file).join(', ')}).`);
  }
  const writes = items.filter((item) => WRITES.has(item.action));
  return {
    items,
    writes,
    conflicts: items.filter((item) => item.action === 'conflict'),
    refused: items.filter((item) => item.action === 'refuse'),
    optional: items.filter((item) => item.action === 'add' && !addMissing)
  };
}

const WRITES = new Set(['update', 'replace', 'create', 'preserve', 'add-now']);

function classify(base, resolve, addMissing) {
  const { status } = base;
  const item = { file: base.file, kind: base.kind, ...(base.provider ? { provider: base.provider } : {}), state: status.state, version: status.version ?? null, installed: base.installed };
  const resolution = resolve[base.file];
  const edited = ['modified', 'legacy-customized'].includes(status.state);
  if (resolution && !edited) throw new RefreshError('REFRESH_BAD_RESOLVE', `--resolve ${base.file}=${resolution}: ${base.file} has no hand edits to resolve (it is ${status.state}).`);
  switch (status.state) {
    case 'current':
    case 'shared':
      return { ...item, action: 'none', reason: status.state === 'shared' ? `the same file as the ${status.sharedWith} bootstrap` : 'current' };
    case 'outdated':
      return { ...item, action: 'update', reason: status.sameVersion ? `an earlier build of v${status.version}; the managed block gets the final text` : `v${status.version} → v${base.installed}; only the managed block changes` };
    case 'legacy-generated':
      return { ...item, action: 'replace', reason: `an unmodified ${status.legacy} template generated by an earlier YallaFlow` };
    case 'missing':
      return { ...item, action: 'create', reason: 'missing; YallaFlow creates it with the current contract' };
    case 'not-installed':
      return { ...item, action: addMissing ? 'add-now' : 'add', reason: status.fileExists ? `${base.file} has no YallaFlow block (optional; added with --add-missing, the existing text unchanged)` : `${base.file} is not set up (optional; created with --add-missing)` };
    case 'modified':
    case 'legacy-customized':
      if (resolution === 'keep') return { ...item, action: 'keep', reason: 'edited by hand; kept as it is (--resolve keep)' };
      if (resolution === 'preserve') return { ...item, action: 'preserve', reason: 'edited by hand; the current block is installed and the edited text kept verbatim after it (--resolve preserve)' };
      return { ...item, action: 'conflict', reason: status.state === 'modified' ? 'the YallaFlow-managed block was edited by hand' : 'AGENT.md predates versioned contracts and has custom content' };
    case 'newer':
      return { ...item, action: 'refuse', severity: 'unsafe', reason: `written by a newer YallaFlow (v${status.version}; this one installs v${base.installed}); upgrade YallaFlow instead of downgrading it` };
    case 'broken':
      return { ...item, action: 'refuse', severity: 'manual', reason: 'the managed block is malformed (a begin marker without its end, or another provider\'s block); fix it by hand' };
    case 'unsafe-link':
      return { ...item, action: 'refuse', severity: 'unsafe', reason: `${status.reason}; YallaFlow never writes through it` };
    default:
      return { ...item, action: 'refuse', severity: 'manual', reason: `its state (${status.state}) cannot be classified safely` };
  }
}

async function readManaged(root, file) {
  const managed = await resolveManagedFile(root, path.join(root, file));
  if (!managed.safe) throw new RefreshError('MANAGED_FILE_UNSAFE', `${file} is ${managed.reason}; YallaFlow never writes through it. Nothing was changed.`);
  if (!managed.exists) return { managed, content: null };
  return { managed, content: await readFile(managed.realPath, 'utf8') };
}

// What one planned write produces, computed the same way the write does (dry run).
async function render(root, item, now) {
  if (item.kind === 'contract') return (await refreshAgentContract(root, { preserveExisting: item.action === 'preserve', dryRun: true }, now)).preview;
  return (await setupBootstrap(root, BOOTSTRAP_PROVIDERS[item.provider], { preserveExisting: item.action === 'preserve', dryRun: true }, now)).preview;
}

async function write(root, item, now) {
  if (item.kind === 'contract') return refreshAgentContract(root, { preserveExisting: item.action === 'preserve' }, now);
  return setupBootstrap(root, BOOTSTRAP_PROVIDERS[item.provider], { preserveExisting: item.action === 'preserve' }, now);
}

// Preview: the plan plus, for every planned write, the file's text before and after. Read-only.
export async function previewRefresh(root, options = {}, now = new Date().toISOString()) {
  const plan = await planRefresh(root, options);
  const changes = [];
  for (const item of plan.writes) {
    const { content } = await readManaged(root, item.file);
    changes.push({ file: item.file, action: item.action, before: content ?? '', after: await render(root, item, now) });
  }
  return { ...plan, changes };
}

function blockedMessage(plan) {
  const lines = [];
  for (const item of plan.refused) lines.push(`- ${item.file}: ${item.reason}.`);
  for (const item of plan.conflicts) lines.push(`- ${item.file}: ${item.reason}. Choose: --resolve ${item.file}=keep (leave it) or --resolve ${item.file}=preserve (install the current block, keep your text after it).`);
  return lines.join('\n');
}

const backupsRoot = (root) => path.join(root, '.yallaflow', 'local', 'backups');

// Reading backups never follows a link: each folder on the way must be a real folder.
async function realFolders(root) {
  let dir = root;
  for (const segment of ['.yallaflow', 'local', 'backups']) {
    dir = path.join(dir, segment);
    const info = await lstat(dir).catch(() => null);
    if (!info?.isDirectory()) return false;
  }
  return true;
}

async function backupDir(root, id) {
  await safeLocalDir(root, '.yallaflow', 'local');
  // .yallaflow/local is personal state; make sure Git ignores it even in an old workspace.
  const local = path.join(root, '.yallaflow', 'local');
  const ignore = await lstat(path.join(local, '.gitignore')).catch(() => null);
  if (!ignore) await safeWriteFile(local, '.gitignore', '*\n', 0o644);
  return safeLocalDir(root, '.yallaflow', 'local', 'backups', id);
}

function newBackupId(now) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `refresh-${stamp}-${randomBytes(3).toString('hex')}`;
}

// Refresh YallaFlow integration. Writes only when every managed file can be handled: an
// unresolved conflict, or a refused file, stops the refresh before anything is written.
// hooks.afterWrite(index) is a test seam for an interrupted refresh.
export async function applyRefresh(root, options = {}, now = new Date().toISOString(), hooks = {}) {
  const plan = await planRefresh(root, options);
  if (plan.refused.length || plan.conflicts.length) {
    throw new RefreshError(plan.refused.some((item) => item.severity === 'unsafe') ? 'REFRESH_UNSAFE' : 'REFRESH_CONFLICT', `Nothing was changed. These files need a decision first:\n${blockedMessage(plan)}`, { plan });
  }
  if (!plan.writes.length) return { ...plan, backup: null, written: [] };

  // Back up first: every file that will change, by its real path (CLAUDE.md may be a link to
  // AGENTS.md: one copy).
  const id = newBackupId(now);
  const dir = await backupDir(root, id);
  const files = [];
  const seen = new Map(); // real path → entry
  const entryByFile = new Map();
  for (const [index, item] of plan.writes.entries()) {
    const { managed, content } = await readManaged(root, item.file);
    const key = managed.realPath ?? path.join(root, item.file);
    const intended = sha(await render(root, item, now));
    if (seen.has(key)) {
      seen.get(key).intended.push(intended);
      entryByFile.set(item.file, seen.get(key));
      continue;
    }
    const entry = { file: item.file, action: item.action, existed: content !== null, before: content === null ? null : sha(content), intended: [intended], after: null, backup: null };
    if (content !== null) {
      entry.backup = `${index + 1}.bak`;
      await safeWriteFile(dir, entry.backup, content, 0o600);
    }
    files.push(entry);
    seen.set(key, entry);
    entryByFile.set(item.file, entry);
  }
  const manifest = { schema: BACKUP_SCHEMA, id, createdAt: now, yallaflowVersion: PACKAGE_VERSION, root: await realpath(root), state: 'started', files };
  const save = () => safeWriteFile(dir, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
  await save();

  const written = [];
  const stopped = (item, error) => new RefreshError(error.code === 'REFRESH_CHANGED_DURING' ? error.code : 'REFRESH_INTERRUPTED', `The refresh stopped at ${item.file}: ${String(error.message).replace(/\s*No files were changed\.?/g, '')}${written.length ? ` Already written: ${written.join(', ')}. Run \`yallaflow refresh restore ${id}\` to put them back.` : ' Nothing was written.'}`, { backup: id });
  for (const [index, item] of plan.writes.entries()) {
    const entry = entryByFile.get(item.file);
    // A file reached through a link to another managed file (CLAUDE.md -> AGENTS.md) is written once.
    if (entry.file !== item.file) continue;
    try {
      await hooks.beforeWrite?.(index);
      // The file must still be what was backed up: an edit made since is never overwritten.
      const current = await readManaged(root, item.file);
      if ((current.content === null ? null : sha(current.content)) !== entry.before) throw new RefreshError('REFRESH_CHANGED_DURING', `${item.file} changed while the refresh was running; it was not written.`);
      await write(root, item, now);
    } catch (error) {
      throw stopped(item, error);
    }
    written.push(item.file);
    const { content } = await readManaged(root, entry.file);
    entry.after = content === null ? null : sha(content);
    await save();
    await hooks.afterWrite?.(index);
  }

  // Verify: every file is current now (or deliberately kept / optional).
  const check = await planRefresh(root, { addMissing: false });
  const left = check.items.filter((item) => plan.writes.some((write) => write.file === item.file) && !['none'].includes(item.action));
  if (left.length) {
    manifest.state = 'failed-verification';
    manifest.problems = left.map((item) => `${item.file}: ${item.state}`);
    await save();
    throw new RefreshError('REFRESH_NOT_VERIFIED', `The refresh wrote ${written.join(', ')}, but ${left.map((item) => item.file).join(', ')} is not current afterwards. Run \`yallaflow refresh restore ${id}\` to put the files back.`, { backup: id });
  }
  manifest.state = 'complete';
  manifest.completedAt = new Date().toISOString();
  await save();
  return { ...plan, backup: id, written };
}

async function readManifest(root, id) {
  if (!BACKUP_ID.test(id)) return null;
  const dir = path.join(backupsRoot(root), id);
  const info = await lstat(dir).catch(() => null);
  if (!info?.isDirectory()) return null;
  try {
    const manifestInfo = await lstat(path.join(dir, 'manifest.json'));
    if (!manifestInfo.isFile() || manifestInfo.size > 1024 * 1024) return null;
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    if (!validManifest(manifest, id)) return null;
    // A backup belongs to the checkout that made it: one committed to a repository, or copied
    // from another folder, is never used.
    if (manifest.root !== await realpath(root)) return null;
    return { dir, manifest };
  } catch {
    return null;
  }
}

// Every field a restore acts on is checked: only the managed paths, once each, plain backup
// names, real hashes.
function validManifest(manifest, id) {
  if (!manifest || typeof manifest !== 'object' || manifest.schema !== BACKUP_SCHEMA || manifest.id !== id || typeof manifest.root !== 'string') return false;
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MANAGED_PATHS.length) return false;
  const files = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || !MANAGED_PATHS.includes(entry.file) || files.has(entry.file)) return false;
    files.add(entry.file);
    if (typeof entry.existed !== 'boolean') return false;
    if (entry.existed ? !(HASH.test(entry.before) && BACKUP_NAME.test(entry.backup)) : (entry.before !== null || entry.backup !== null)) return false;
    if (entry.after !== null && !HASH.test(entry.after)) return false;
    if (!Array.isArray(entry.intended) || !entry.intended.every((value) => HASH.test(value))) return false;
  }
  return true;
}

// Backups, newest first. Read-only; an unreadable entry is skipped.
export async function listRefreshBackups(root) {
  const base = backupsRoot(root);
  if (!(await realFolders(root))) return [];
  const out = [];
  for (const name of (await readdir(base)).filter((entry) => BACKUP_ID.test(entry)).sort().reverse()) {
    const found = await readManifest(root, name);
    if (found) out.push(found.manifest);
  }
  return out;
}

// Put the files of a refresh back. Every file is checked first; if one was changed after the
// refresh (its content is neither what the refresh wrote nor what it held before), nothing is
// restored. A file the refresh created is removed.
export async function restoreRefresh(root, id = null) {
  const backups = await listRefreshBackups(root);
  const chosen = id ? backups.find((backup) => backup.id === id) : backups.find((backup) => backup.state !== 'restored');
  if (!chosen) throw new RefreshError('REFRESH_NO_BACKUP', id ? `No refresh backup named ${id}.` : 'There is no refresh backup to restore.');
  if (chosen.state === 'restored') throw new RefreshError('REFRESH_ALREADY_RESTORED', `${chosen.id} was already restored.`);
  const { dir, manifest } = await readManifest(root, chosen.id);
  const steps = [];
  const changed = [];
  for (const entry of manifest.files) {
    const { content } = await readManaged(root, entry.file);
    const now = content === null ? null : sha(content);
    if (now === entry.before) { steps.push({ entry, op: 'same' }); continue; }
    const ours = now !== null && (now === entry.after || (entry.intended ?? []).includes(now));
    if (!ours) { changed.push(entry.file); continue; }
    steps.push({ entry, op: entry.existed ? 'write' : 'remove' });
  }
  if (changed.length) throw new RefreshError('REFRESH_CHANGED_SINCE', `Nothing was restored: ${changed.join(', ')} changed after the refresh. The copies from before it are in ${path.relative(root, dir)}; compare and restore by hand.`);
  const restored = [];
  for (const { entry, op } of steps) {
    if (op === 'same') continue;
    if (op === 'write') {
      const backupInfo = await lstat(path.join(dir, entry.backup));
      if (!backupInfo.isFile()) throw new RefreshError('REFRESH_BACKUP_DAMAGED', `The backup copy of ${entry.file} is missing.`);
      const content = await readFile(path.join(dir, entry.backup), 'utf8');
      if (sha(content) !== entry.before) throw new RefreshError('REFRESH_BACKUP_DAMAGED', `The backup copy of ${entry.file} does not match the hash recorded before the refresh; nothing more was restored.`);
      await writeManaged(root, path.join(root, entry.file), content);
    } else {
      const { managed } = await readManaged(root, entry.file);
      await rm(managed.realPath, { force: true });
    }
    restored.push(entry.file);
  }
  manifest.state = 'restored';
  manifest.restoredAt = new Date().toISOString();
  await safeWriteFile(await safeLocalDir(root, '.yallaflow', 'local', 'backups', manifest.id), 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
  return { id: manifest.id, restored };
}

// A compact line diff for the preview: the unchanged lines before and after are counted, the
// changed region shown (capped).
export function lineDiff(before, after, { maxLines = 60 } = {}) {
  const a = String(before).split('\n');
  const b = String(after).split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const removed = a.slice(start, endA + 1).map((line) => `- ${line}`);
  const added = b.slice(start, endB + 1).map((line) => `+ ${line}`);
  const body = [...removed, ...added];
  const shown = body.length > maxLines ? [...body.slice(0, maxLines), `… ${body.length - maxLines} more changed line(s)`] : body;
  return { unchangedBefore: start, unchangedAfter: a.length - 1 - endA, removed: removed.length, added: added.length, lines: shown };
}

// Plain-language text for bootstrap blocks that are not set up (used by the health check; the
// provider names stay in src/agent, AC-108).
export function missingBootstrapText(missing) {
  const name = (item) => (item.provider === 'claude' ? 'Claude Code' : 'Codex');
  if (missing.length > 1) return { repairable: `No agent bootstrap is set up: neither ${missing.map((item) => `${item.file} (${name(item)})`).join(' nor ')} points agents to YallaFlow.` };
  return { notes: missing.map((item) => `${item.file} has no YallaFlow block (${name(item)}). Add it with \`yallaflow refresh apply --add-missing\` if you use that agent.`) };
}
