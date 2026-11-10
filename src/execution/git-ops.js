// Git execution layer (PF-0112, v1.5.0; owner Checkpoint C, SRC-0058). The ONLY module in
// YallaFlow allowed to run Git commands that change a repository. Every call:
// - runs `git` with argv (never a shell), a timeout, and the fixed prefix GIT_PREFIX: hooks,
//   fsmonitor, the untracked cache and automatic maintenance off, pathspecs literal, no pager
//   (M3a evidence E5, E7, E8, E12);
// - runs in a sanitised environment: no inherited GIT_* redirection, editor, pager, askpass,
//   ssh or external diff; prompts off; C locale (E12);
// - takes only validated arguments: slugs, absolute paths under a known root, object ids that
//   exist (FR36). Callers never pass raw argv.
// Mutating operations also refuse to run (fail closed) unless the platform and Git version
// are verified (A2, FR33) and the repository references no external filter or merge driver
// (A4, FR34). YallaFlow never pushes, pulls, fetches, rebases, resets, reverts, stashes,
// cleans, checks out, deletes branches or edits refs directly.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeLocalDir } from '../agents/local-files.js';

export const GIT_PREFIX = Object.freeze(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'diff.ignoreSubmodules=all', '--literal-pathspecs', '--no-pager']);
// Platforms and Git versions on which test/git-transaction.test.js has passed (A2). Extended
// only with a recorded passing run.
export const VERIFIED = Object.freeze({ platforms: Object.freeze(['linux']), git: Object.freeze(['2.43']) });
export const MINIMUM_GIT = Object.freeze([2, 38]);
const TIMEOUT_MS = 120_000;
// Inherited Git redirection and helpers are removed (E12). Which config FILES Git reads
// (GIT_CONFIG_GLOBAL / GIT_CONFIG_SYSTEM / GIT_CONFIG_NOSYSTEM) is the developer's own choice
// and stays; those files are covered by the configuration fingerprint.
const KEEP = new Set(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']);
const STRIP = /^(GIT_\w+|PAGER|EDITOR|VISUAL|SSH_ASKPASS|SSH_AUTH_SOCK|GPG_AGENT_INFO|LANGUAGE|LC_\w+|LANG)$/;
export const SLUG = /^[a-z0-9][a-z0-9._-]{0,48}$/;
// Characters that are invisible, look like a space, or change how text around them reads (controls,
// C1, no-break and other spaces, soft hyphen, combining grapheme joiner, Arabic letter mark,
// fillers, zero-width, bidi embeddings and isolates, line separators, Braille blank, variation
// selectors, BOM, interlinear annotations, tag characters): a file name holding one can make a
// review or a prompt say something other than it seems (re-verification round 3).
export const INVISIBLE = /[\u0000-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2069\u2800\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class GitOpsError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const invalid = (message) => new GitOpsError('GIT_ARG_INVALID', message, 400);

export function gitEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) if (KEEP.has(key) || !STRIP.test(key)) env[key] = value;
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_EDITOR: ':', LC_ALL: 'C' };
}

// Defence in depth for A4 (review H2–H4): every filter and merge driver configured for this
// checkout — in any scope Git reads — is overridden with an empty command for each call, so
// Git can never run one, even if an attribute source is missed by externalDrivers. The names
// are read immediately before each call (a config read runs nothing); overrides travel through
// GIT_CONFIG_COUNT/KEY/VALUE, so no subsection name can be misparsed as `key=value`.
const DRIVER_KEY = /^(?:filter\.(.+)\.(?:clean|smudge|process)|merge\.(.+)\.driver)$/i;
// Lanes verified by assertLaneOf: later Git calls there use the verified Git directory inside the
// home repository (GIT_DIR, GIT_WORK_TREE), never the lane's own .git file again
// (re-verification round 3: the file could be swapped between steps).
const PINNED = new Map();
function pinnedEnv(cwd) {
  const dir = PINNED.get(path.resolve(cwd));
  return dir ? { GIT_DIR: dir, GIT_WORK_TREE: path.resolve(cwd) } : {};
}
function neutralisers(cwd) {
  const result = spawnSync('git', [...GIT_PREFIX, 'config', '-z', '--name-only', '--get-regexp', '^(filter|merge)\\.'], { cwd, env: { ...gitEnv(), ...pinnedEnv(cwd) }, encoding: 'utf8', timeout: TIMEOUT_MS, shell: false });
  if (result.error) throw new GitOpsError('GIT_FAILED', `git config could not run: ${result.error.message}`, 500);
  if (result.status !== 0 && result.status !== 1) throw new GitOpsError('GIT_FAILED', `git config failed: ${String(result.stderr).trim().split('\n')[0] || `exit ${result.status}`}`, 409);
  const keys = new Set();
  for (const name of String(result.stdout ?? '').split('\0')) {
    const match = DRIVER_KEY.exec(name);
    if (!match) continue;
    const prefix = name.slice(0, name.lastIndexOf('.'));
    if (match[1] !== undefined) for (const kind of ['clean', 'smudge', 'process']) keys.add(`${prefix}.${kind}`);
    else keys.add(`${prefix}.driver`);
  }
  const env = { GIT_CONFIG_COUNT: String(keys.size) };
  [...keys].forEach((key, index) => { env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = ''; });
  return env;
}

// The single place a Git process is started. `args` come only from the named operations
// below; `extraEnv` only carries a private GIT_INDEX_FILE (M3) or a signing agent socket.
function git(cwd, args, { extraEnv = {}, binary = false } = {}) {
  const result = spawnSync('git', [...GIT_PREFIX, ...args], { cwd, env: { ...gitEnv(), ...pinnedEnv(cwd), ...neutralisers(cwd), ...extraEnv }, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT_MS, shell: false });
  if (result.error) throw new GitOpsError('GIT_FAILED', `git ${args[0]} could not run: ${result.error.message}`, 500);
  return { status: result.status, stdout: result.stdout, stderr: binary ? String(result.stderr) : result.stderr };
}
// NUL-separated output is never trimmed: a status record starts with a space (" M path"),
// and a file name may start with whitespace.
function okZ(result, what) {
  if (result.status !== 0) throw new GitOpsError('GIT_FAILED', `git ${what} failed: ${String(result.stderr || result.stdout).trim().split('\n')[0] || `exit ${result.status}`}`, 409);
  return String(result.stdout ?? '');
}
function ok(result, what) {
  if (result.status !== 0) throw new GitOpsError('GIT_FAILED', `git ${what} failed: ${String(result.stderr || result.stdout).trim().split('\n')[0] || `exit ${result.status}`}`, 409);
  return typeof result.stdout === 'string' ? result.stdout.trim() : result.stdout;
}

// ----- argument validation (FR36) -----
export function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug) || slug.includes('..')) throw invalid('A lane name uses lowercase letters, digits, dot, dash or underscore (up to 49 characters), starting with a letter or digit.');
  return slug;
}
export async function assertDirectory(dir, { label = 'folder' } = {}) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.includes('\0')) throw invalid(`The ${label} must be an absolute path.`);
  let info;
  try { info = await lstat(dir); } catch { throw invalid(`The ${label} ${dir} does not exist.`); }
  if (info.isSymbolicLink() || !info.isDirectory()) throw invalid(`The ${label} ${dir} must be a real folder, not a link or a file.`);
  if ((await realpath(dir)) !== path.resolve(dir)) throw invalid(`The ${label} ${dir} goes through a symbolic link.`);
  return dir;
}
export function assertObject(cwd, oid, type = 'commit') {
  if (typeof oid !== 'string' || !OID.test(oid)) throw invalid('An object id is 40 (or 64) lowercase hexadecimal characters.');
  if (git(cwd, ['cat-file', '-e', `${oid}^{${type}}`]).status !== 0) throw invalid(`${oid.slice(0, 12)} is not a ${type} in this repository.`);
  return oid;
}

// ----- read-only probes -----
export function gitVersion(env = process.env) {
  const result = spawnSync('git', ['--version'], { env: gitEnv(env), encoding: 'utf8', timeout: 10_000 });
  const match = /git version (\d+)\.(\d+)/.exec(result.stdout ?? '');
  return match ? { major: Number(match[1]), minor: Number(match[2]), text: `${match[1]}.${match[2]}` } : null;
}

// A2 / FR33: automated Git mutation only on a verified platform and Git version.
export function platformCheck({ platform = process.platform, version = gitVersion() } = {}) {
  if (!version) return { ok: false, reason: 'Git is not available.' };
  if (version.major < MINIMUM_GIT[0] || (version.major === MINIMUM_GIT[0] && version.minor < MINIMUM_GIT[1])) return { ok: false, reason: `Git ${version.text} is older than ${MINIMUM_GIT.join('.')}.`, version: version.text };
  if (!VERIFIED.platforms.includes(platform)) return { ok: false, reason: `Automated Git operations are verified on Linux only; this is ${platform}.`, version: version.text };
  if (!VERIFIED.git.includes(version.text)) return { ok: false, reason: `Automated Git operations are verified with Git ${VERIFIED.git.join(', ')}; this is Git ${version.text}.`, version: version.text };
  return { ok: true, version: version.text };
}

export function head(cwd) {
  return ok(git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']), 'rev-parse HEAD');
}
export function currentBranch(cwd) {
  const result = git(cwd, ['symbolic-ref', '-q', 'HEAD']);
  return result.status === 0 ? result.stdout.trim().replace(/^refs\/heads\//, '') : null;
}
export function branchExists(cwd, branch) {
  return git(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]).status === 0;
}
export function isAncestor(cwd, ancestor, descendant) {
  return git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}
function gitPath(cwd, flag) {
  return path.resolve(cwd, ok(git(cwd, ['rev-parse', flag]), `rev-parse ${flag}`));
}
// Staged, unstaged and untracked entries (porcelain v1, NUL separated), without ignored files.
export function statusEntries(cwd, { ignored = false } = {}) {
  const out = okZ(git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all', ...(ignored ? ['--ignored=matching'] : [])]), 'status');
  const records = out.split('\0');
  const entries = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.length < 4) continue;
    const entry = { code: record.slice(0, 2), path: record.slice(3) };
    if (/[RC]/.test(entry.code)) entry.from = records[++index] ?? null;
    if (entry.path.includes('\uFFFD') || entry.from?.includes('\uFFFD')) throw new GitOpsError('GIT_PATH_ENCODING', 'A file name here is not valid UTF-8; YallaFlow 1.5.0 cannot review it exactly. Rename it, or commit and merge by hand.');
    entries.push(entry);
  }
  return entries;
}

// The configuration fingerprint (E12): every config scope with its origin, plus the
// attribute files outside the tree. Any change between steps stops an integration (S2).
export async function configFingerprint(cwd) {
  const hash = createHash('sha256');
  hash.update(ok(git(cwd, ['config', '--list', '--show-origin', '--show-scope', '-z']), 'config --list'));
  for (const file of await outOfTreeAttributes(cwd)) {
    hash.update(`\0${file}\0`);
    try { hash.update(await readFile(file)); } catch { hash.update('(missing)'); }
  }
  return hash.digest('hex');
}

// Every attribute file outside the tree that Git reads here: info/attributes, the global file
// (core.attributesFile, else the XDG default) and the system file, as Git itself names them.
async function outOfTreeAttributes(cwd) {
  const files = [path.join(gitPath(cwd, '--git-common-dir'), 'info', 'attributes')];
  const configured = git(cwd, ['config', '--get', '--type=path', 'core.attributesFile']);
  if (configured.status === 0 && configured.stdout.trim()) files.push(path.resolve(cwd, configured.stdout.trim()));
  for (const name of ['GIT_ATTR_GLOBAL', 'GIT_ATTR_SYSTEM']) {
    const found = git(cwd, ['var', name]);
    if (found.status === 0 && found.stdout.trim()) files.push(path.resolve(cwd, found.stdout.trim()));
  }
  const xdg = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'git', 'attributes') : path.join(os.homedir(), '.config', 'git', 'attributes');
  files.push(xdg);
  return [...new Set(files)];
}

function attributeNames(text) {
  const names = { filter: new Set(), merge: new Set() };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    for (const token of line.split(/\s+/).slice(1)) {
      const match = /^(filter|merge)=(.+)$/.exec(token);
      if (match) names[match[1]].add(match[2]);
    }
  }
  return names;
}

// A4 / FR34: the external filters and merge drivers the repository would run. A configured
// `filter.<n>.clean|smudge|process` or `merge.<n>.driver` counts when an attribute file in
// the working tree, in one of `commits`, or outside the tree references <n>.
export async function externalDrivers(cwd, { commits = [] } = {}) {
  const configured = { filter: new Set(), merge: new Set() };
  const filters = git(cwd, ['config', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$']);
  for (const line of filters.status === 0 ? filters.stdout.split('\n') : []) { const match = /^filter\.(.+)\.(?:clean|smudge|process) /.exec(line); if (match) configured.filter.add(match[1]); }
  const merges = git(cwd, ['config', '--get-regexp', '^merge\\..*\\.driver$']);
  for (const line of merges.status === 0 ? merges.stdout.split('\n') : []) { const match = /^merge\.(.+)\.driver /.exec(line); if (match) configured.merge.add(match[1]); }
  if (!configured.filter.size && !configured.merge.size) return { filters: [], mergeDrivers: [] };
  const referenced = { filter: new Set(), merge: new Set() };
  const add = (text) => { const names = attributeNames(text); for (const kind of ['filter', 'merge']) for (const name of names[kind]) referenced[kind].add(name); };
  for (const file of await outOfTreeAttributes(cwd)) { try { add(await readFile(file, 'utf8')); } catch { /* none */ } }
  const isAttr = (entry) => entry === '.gitattributes' || entry.endsWith('/.gitattributes');
  // The index copy (Git reads it, e.g. when the work-tree file is deleted), the work-tree copy
  // of tracked, untracked and ignored files.
  const cached = okZ(git(cwd, ['ls-files', '-z', '--cached']), 'ls-files').split('\0').filter(isAttr);
  for (const file of cached) { const blob = git(cwd, ['cat-file', 'blob', `:${file}`]); if (blob.status === 0) add(blob.stdout); }
  const others = okZ(git(cwd, ['ls-files', '-z', '--others']), 'ls-files --others').split('\0').filter(isAttr);
  for (const file of new Set([...cached, ...others])) { try { add(await readFile(path.join(cwd, file), 'utf8')); } catch { /* not in the work tree */ } }
  for (const commit of commits) {
    const listed = okZ(git(cwd, ['ls-tree', '-r', '-z', '--name-only', commit]), 'ls-tree').split('\0').filter((entry) => entry === '.gitattributes' || entry.endsWith('/.gitattributes'));
    for (const file of listed) { const blob = git(cwd, ['cat-file', 'blob', `${commit}:${file}`]); if (blob.status === 0) add(blob.stdout); }
  }
  return { filters: [...configured.filter].filter((name) => referenced.filter.has(name)).sort(), mergeDrivers: [...configured.merge].filter((name) => referenced.merge.has(name)).sort() };
}

// Submodules (gitlinks) in the index or in `commits` (review re-verification): a nested
// repository brings its own configuration, which a lane's agent can write. Automated lanes and
// merges refuse them, like filters and merge drivers.
export function gitlinks(cwd, { commits = [] } = {}) {
  const found = new Set();
  for (const line of okZ(git(cwd, ['ls-files', '-s', '-z']), 'ls-files -s').split('\0')) if (line.startsWith('160000 ')) found.add(line.slice(line.indexOf('\t') + 1));
  for (const commit of commits) {
    assertObject(cwd, commit, 'commit');
    for (const line of okZ(git(cwd, ['ls-tree', '-r', '-z', commit]), 'ls-tree').split('\0')) if (line.startsWith('160000 ')) found.add(line.slice(line.indexOf('\t') + 1));
  }
  return [...found].sort();
}

// Every mutating operation calls this first (fail closed).
export async function assertAutomationAllowed(cwd, { commits = [] } = {}) {
  const platform = platformCheck();
  if (!platform.ok) throw new GitOpsError('GIT_UNVERIFIED_PLATFORM', `${platform.reason} Use the manual Git steps instead.`, 409);
  const links = gitlinks(cwd, { commits });
  if (links.length) throw new GitOpsError('GIT_SUBMODULES', `This repository has submodules (${links.slice(0, 3).join(', ')}${links.length > 3 ? ', …' : ''}). YallaFlow 1.5.0 does not automate lanes or merges with submodules; use the manual Git steps instead.`, 409);
  const drivers = await externalDrivers(cwd, { commits });
  if (drivers.filters.length || drivers.mergeDrivers.length) {
    const named = [...drivers.filters.map((name) => `filter "${name}"`), ...drivers.mergeDrivers.map((name) => `merge driver "${name}"`)].join(', ');
    throw new GitOpsError('GIT_EXTERNAL_DRIVERS', `This repository uses ${named}. YallaFlow 1.5.0 never runs repository-defined Git filters or merge drivers; use the manual Git steps instead.`, 409);
  }
  return platform;
}

// Review H2: a lane is trusted only while it is still a worktree of the home repository. Its
// `.git` must be a regular file pointing at <home common dir>/worktrees/<name>, whose
// `gitdir` points back at it, and Git must agree on the common dir and the top level.
export async function assertLaneOf(home, lane) {
  await assertDirectory(home, { label: 'project folder' });
  await assertDirectory(lane, { label: 'lane folder' });
  PINNED.delete(path.resolve(lane)); // verified afresh from the files every time
  const notLane = () => new GitOpsError('LANE_NOT_WORKTREE', `${lane} is no longer a worktree of ${home}; YallaFlow stopped without running Git there.`);
  const dotGit = path.join(lane, '.git');
  const info = await lstat(dotGit).catch(() => null);
  if (!info?.isFile()) throw notLane();
  const pointer = /^gitdir: (.+)\n?$/.exec(await readFile(dotGit, 'utf8').catch(() => ''));
  if (!pointer) throw notLane();
  const common = await realpath(gitPath(home, '--git-common-dir'));
  const adminDir = path.resolve(lane, pointer[1]);
  if (path.dirname(adminDir) !== path.join(common, 'worktrees')) throw notLane();
  const back = (await readFile(path.join(adminDir, 'gitdir'), 'utf8').catch(() => '')).trim();
  if (path.resolve(back) !== dotGit) throw notLane();
  if (await realpath(gitPath(lane, '--git-common-dir')).catch(() => null) !== common) throw notLane();
  if (await realpath(ok(git(lane, ['rev-parse', '--show-toplevel']), 'rev-parse --show-toplevel')).catch(() => null) !== lane) throw notLane();
  PINNED.set(path.resolve(lane), adminDir);
  return adminDir; // the lane's Git directory inside the home repository: pin it (GIT_DIR) instead of trusting the lane's .git file
}

// ----- G1: create a lane (a new branch yf/<slug> and its worktree) -----
export async function createLaneWorktree({ home, lanesRoot, slug, base }) {
  await assertDirectory(home, { label: 'project folder' });
  await assertDirectory(lanesRoot, { label: 'lanes folder' });
  assertSlug(slug);
  assertObject(home, base, 'commit');
  const target = path.join(lanesRoot, slug);
  const branch = `yf/${slug}`;
  if (await lstat(target).then(() => true, () => false)) throw new GitOpsError('LANE_EXISTS', `${target} already exists.`);
  if (branchExists(home, branch)) throw new GitOpsError('BRANCH_EXISTS', `The branch ${branch} already exists.`);
  await assertAutomationAllowed(home, { commits: [base] });
  ok(git(home, ['worktree', 'add', '-q', '-b', branch, target, base]), 'worktree add');
  if (head(target) !== base || currentBranch(target) !== branch) throw new GitOpsError('GIT_INCONSISTENT', `The new lane at ${target} is not at ${base.slice(0, 12)} on ${branch}; stopped without changing anything else.`);
  return { path: target, branch, base };
}

// ----- G2: remove a lane folder (never --force; the branch stays) -----
// The caller (lanes.js) has already checked every Clean up guard (FR13).
// `ignoredAllowed`: the exact ignored entries the developer confirmed for deletion. They are
// listed again here, immediately before Git removes the folder (review M8): `worktree remove`
// itself deletes every ignored file and does not see hidden (skip-worktree) edits.
export async function removeLaneWorktree({ home, lane, ignoredAllowed = [], keep = ['.yallaflow/local/'] }) {
  if (path.resolve(lane) === path.resolve(home)) throw invalid('The main checkout is never removed.');
  try { await assertLaneOf(home, lane); } catch (error) { throw invalid(`${lane} is not a worktree of this repository. ${error.message}`); }
  await assertAutomationAllowed(home);
  const allowed = new Set(ignoredAllowed);
  const kept = (entry) => keep.some((prefix) => entry === prefix || entry.startsWith(prefix));
  const changed = statusEntries(lane);
  const hidden = hiddenEntries(lane);
  const ignored = statusEntries(lane, { ignored: true }).filter((entry) => entry.code === '!!' && !kept(entry.path) && !allowed.has(entry.path));
  if (changed.length || hidden.length || ignored.length) {
    const named = [...changed.map((entry) => entry.path), ...hidden, ...ignored.map((entry) => entry.path)].slice(0, 5).join(', ');
    throw new GitOpsError('SCOPE_CHANGED', `Files appeared in the lane since you confirmed Clean up (${named}); nothing was deleted. Review it again.`);
  }
  ok(git(home, ['worktree', 'remove', lane]), 'worktree remove');
  return { removed: lane };
}

// ----- G3: in-memory merge preview (objects only) -----
// Git 2.43 exits 1 both for a conflict and for an invalid commit (E9): both inputs are
// validated first, and a conflict also needs a valid tree id on stdout.
export function previewMerge(cwd, ours, theirs) {
  assertObject(cwd, ours, 'commit');
  assertObject(cwd, theirs, 'commit');
  const result = git(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', ours, theirs]);
  const parts = String(result.stdout ?? '').split('\0').filter(Boolean);
  const tree = parts[0]?.trim() ?? '';
  const isTree = OID.test(tree) && git(cwd, ['cat-file', '-e', `${tree}^{tree}`]).status === 0;
  if (result.status === 0 && isTree) return { result: 'no-conflict', tree, conflicts: [] };
  if (result.status === 1 && isTree) return { result: 'conflict', tree, conflicts: parts.slice(1) };
  return { result: 'error', tree: null, conflicts: [], message: String(result.stderr ?? '').trim().split('\n')[0] || `exit ${result.status}` };
}

// Read-only: a file's content at a commit (cat-file), or null when it is not there.
export function showFile(cwd, commit, file) {
  assertObject(cwd, commit, 'commit');
  if (typeof file !== 'string' || !file || file.startsWith('-') || file.includes('\0') || path.isAbsolute(file)) throw invalid('A repository-relative file path is required.');
  const result = git(cwd, ['cat-file', 'blob', `${commit}:${file}`]);
  return result.status === 0 ? result.stdout : null;
}

// ===== M3: Review & Merge (G4–G10). Called only by src/execution/merge.js and review.js. =====
// Private files (temporary indexes, NUL pathspec lists, commit messages) live under the HOME
// checkout's .yallaflow/local/execution/tmp/, are created here with mode 0600 and removed
// after use. Only absolute paths inside that folder are ever handed to Git.
async function privateDir(home) {
  const tmp = await safeLocalDir(home, '.yallaflow', 'local', 'execution', 'tmp');
  return mkdtemp(path.join(tmp, 'g-'));
}
async function withPrivate(home, fn) {
  const dir = await privateDir(home);
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function assertPaths(paths) {
  if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== 'string' || !entry || entry.includes('\0') || path.isAbsolute(entry) || entry.endsWith('/') || entry.split('/').some((part) => part === '' || part === '.' || part === '..'))) throw invalid('Approved paths are repository-relative file paths.');
  return paths;
}
async function pathspecFile(dir, paths) {
  const file = path.join(dir, 'paths');
  await writeFile(file, Buffer.from(paths.map((entry) => `${entry}\0`).join('')), { mode: 0o600 });
  return file;
}
async function messageFile(dir, message) {
  if (typeof message !== 'string' || !message.trim() || message.length > 20_000) throw invalid('A commit message is required (up to 20,000 characters).');
  const file = path.join(dir, 'message');
  await writeFile(file, message, { mode: 0o600 });
  return file;
}

// Read-only helpers for the merge journal.
export function treeOf(cwd, rev) {
  if (typeof rev !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64}|HEAD)$/.test(rev)) throw invalid('A commit id or HEAD is required.');
  return ok(git(cwd, ['rev-parse', '--verify', '-q', `${rev}^{tree}`]), 'rev-parse tree');
}
export function parentsOf(cwd, commit) {
  assertObject(cwd, commit, 'commit');
  return ok(git(cwd, ['rev-parse', `${commit}^@`]), 'rev-parse parents').split('\n').filter(Boolean);
}
export function changedBetween(cwd, from, to) {
  for (const oid of [from, to]) if (!OID.test(String(oid))) throw invalid('Object ids are required.');
  const names = okZ(git(cwd, ['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=all', from, to]), 'diff --name-only').split('\0').filter(Boolean);
  if (names.some((name) => name.includes('\uFFFD'))) throw new GitOpsError('GIT_PATH_ENCODING', 'A file name here is not valid UTF-8; YallaFlow 1.5.0 cannot review it exactly. Rename it, or commit and merge by hand.');
  return names;
}
// Every file version the lane adds to the target's history: each blob reachable from `to` but
// not from `from` or any of `exclude` (re-verification round 2): versions later removed or
// replaced, versions brought in only by a merge commit, binary and large files alike.
export function blobsIntroduced(cwd, from, to, { exclude = [] } = {}) {
  for (const oid of [from, to, ...exclude]) if (!OID.test(String(oid))) throw invalid('Object ids are required.');
  const out = ok(git(cwd, ['rev-list', '--objects', '--filter=object:type=blob', to, `^${from}`, ...exclude.map((oid) => `^${oid}`)]), 'rev-list --objects');
  const found = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const match = /^([0-9a-f]{40}|[0-9a-f]{64})(?: (.*))?$/.exec(line);
    // A line Git did not write as "<id> <path>" (a name with a line break) is never guessed at.
    if (!match || (match[2] ?? '').includes('\uFFFD')) throw new GitOpsError('GIT_PATH_ENCODING', 'A file name in the lane\'s commits cannot be read exactly; YallaFlow 1.5.0 cannot review it. Rename it, or commit and merge by hand.');
    if (match[2] !== undefined) found.push({ path: match[2], blob: match[1] });
  }
  return found;
}
// Every path the commits in to ^from ^exclude touch, merge commits included (against each parent).
// A secret-looking name is caught on every path, not only the first one Git lists a blob under.
export function pathsTouched(cwd, from, to, { exclude = [] } = {}) {
  for (const oid of [from, to, ...exclude]) if (!OID.test(String(oid))) throw invalid('Object ids are required.');
  const out = okZ(git(cwd, ['log', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-merges=separate', '--name-only', '-z', '--format=', to, `^${from}`, ...exclude.map((oid) => `^${oid}`)]), 'log --name-only');
  const names = new Set(out.split('\0').map((entry) => entry.replace(/^\n+/, '')).filter(Boolean));
  if ([...names].some((name) => name.includes('\uFFFD'))) throw new GitOpsError('GIT_PATH_ENCODING', 'A file name in the lane\'s commits cannot be read exactly; YallaFlow 1.5.0 cannot review it. Rename it, or commit and merge by hand.');
  return [...names];
}
// The messages and the author and committer fields of those commits, one text per commit.
export function commitTexts(cwd, from, to, { exclude = [] } = {}) {
  for (const oid of [from, to, ...exclude]) if (!OID.test(String(oid))) throw invalid('Object ids are required.');
  return okZ(git(cwd, ['log', '--format=%an <%ae>%n%cn <%ce>%n%B%x00', to, `^${from}`, ...exclude.map((oid) => `^${oid}`)]), 'log --format').split('\0').map((text) => text.trim()).filter(Boolean);
}
// A blob's bytes (read-only), or null.
export function blobBytes(cwd, blob) {
  if (!/^[0-9a-f]{40,64}$/.test(String(blob))) throw invalid('A blob id is required.');
  const result = git(cwd, ['cat-file', 'blob', blob], { binary: true });
  return result.status === 0 ? result.stdout : null;
}
// The index tree of a checkout (G6 on the real index): objects only.
export function indexTree(cwd) {
  return ok(git(cwd, ['write-tree']), 'write-tree');
}
// Entries hidden from Git's own overwrite checks (assume-unchanged: lowercase tag; skip-worktree: S).
export function hiddenEntries(cwd) {
  const out = okZ(git(cwd, ['ls-files', '-z', '-v', '-t']), 'ls-files -v -t').split('\0').filter(Boolean);
  return out.filter((line) => /^[a-z]/.test(line) || line.startsWith('S ')).map((line) => line.slice(2));
}
// In-progress operations or a present index lock (stop conditions S5/S7).
export async function inProgress(cwd) {
  const gitDir = gitPath(cwd, '--absolute-git-dir');
  const common = gitPath(cwd, '--git-common-dir');
  const exists = (file) => lstat(file).then(() => true, () => false);
  const found = [];
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply', 'sequencer', 'index.lock', 'HEAD.lock']) {
    if (await exists(path.join(gitDir, name))) found.push(name);
  }
  if (await exists(path.join(common, 'packed-refs.lock'))) found.push('packed-refs.lock');
  const branch = currentBranch(cwd);
  if (branch && await exists(path.join(common, 'refs', 'heads', `${branch}.lock`))) found.push(`refs/heads/${branch}.lock`);
  return found;
}
export function stagedChanges(cwd) {
  return git(cwd, ['diff', '--cached', '--quiet', '--no-ext-diff', '--ignore-submodules=all']).status !== 0;
}
// A5 / FR35: the signing path of this repository: null (not signing), 'ssh', 'openpgp', or
// the unsupported format name.
export function signingMode(cwd) {
  const sign = git(cwd, ['config', '--get', '--type=bool', 'commit.gpgSign']);
  if (sign.status !== 0 || sign.stdout.trim() !== 'true') return null;
  const format = git(cwd, ['config', '--get', 'gpg.format']);
  return format.status === 0 && format.stdout.trim() ? format.stdout.trim() : 'openpgp';
}
// Review M10: a signing key held by an agent (ssh-agent, gpg-agent) stays usable for the
// two commit operations only; no network operation exists here to use the socket otherwise.
function signingEnv() {
  const env = {};
  for (const key of ['SSH_AUTH_SOCK', 'GPG_AGENT_INFO']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
export const SIGNING_ALLOWED = Object.freeze(['ssh', 'openpgp']); // openpgp only with the permanent GPG test (AC-047)
export function assertSigningAllowed(cwd) {
  const mode = signingMode(cwd);
  if (mode && !SIGNING_ALLOWED.includes(mode)) throw new GitOpsError('SIGNING_UNSUPPORTED', `Commits here are signed with ${mode}; YallaFlow 1.5.0 signs only with SSH or OpenPGP. Commit and merge by hand.`, 409);
  return mode;
}

// G4–G6 on a private index: the approved tree A = lane HEAD + exactly the approved paths
// (C1: paths already absent from both the work tree and the index are skipped).
export async function approvedTree({ home, lane, paths }) {
  if (path.resolve(lane) === path.resolve(home)) await assertDirectory(home, { label: 'project folder' });
  else await assertLaneOf(home, lane);
  assertPaths(paths);
  await assertAutomationAllowed(lane);
  return withPrivate(home, async (dir) => {
    const index = path.join(dir, 'index');
    const extraEnv = { GIT_INDEX_FILE: index };
    ok(git(lane, ['read-tree', head(lane)], { extraEnv }), 'read-tree');
    // Presence is judged against this private index (lane HEAD), so a staged deletion stays.
    const present = await stageablePaths(lane, paths, extraEnv);
    if (present.length) ok(git(lane, ['add', '-A', `--pathspec-from-file=${await pathspecFile(dir, present)}`, '--pathspec-file-nul'], { extraEnv }), 'add (private index)');
    return ok(git(lane, ['write-tree'], { extraEnv }), 'write-tree (private index)');
  });
}
async function stageablePaths(cwd, paths, extraEnv = {}) {
  const inIndex = new Set(okZ(git(cwd, ['ls-files', '-z', '--cached'], { extraEnv }), 'ls-files').split('\0').filter(Boolean));
  const keep = [];
  for (const entry of paths) if (inIndex.has(entry) || await lstat(path.join(cwd, entry)).then(() => true, () => false)) keep.push(entry);
  return keep;
}

// G8: stage exactly the approved paths in a checkout's real index (C1 idempotent).
// In a lane, every writing operation checks again that the lane is still a worktree of home
// (re-verification round 2: a lane's .git could be swapped between steps).
async function assertCheckout(home, cwd) {
  if (home && path.resolve(cwd) !== path.resolve(home)) await assertLaneOf(home, cwd);
  else await assertDirectory(cwd, { label: 'working folder' });
}

export async function stageApproved({ home, cwd, paths }) {
  await assertCheckout(home, cwd);
  assertPaths(paths);
  await assertAutomationAllowed(cwd);
  await withPrivate(home, async (dir) => {
    const present = await stageablePaths(cwd, paths);
    if (present.length) ok(git(cwd, ['add', '-A', `--pathspec-from-file=${await pathspecFile(dir, present)}`, '--pathspec-file-nul']), 'add');
  });
  return indexTree(cwd);
}

// G9: commit exactly the verified index — only when its tree equals `expectedTree` (checked
// here again, immediately before), then HEAD's tree must equal it too.
export async function commitIndex({ home, cwd, expectedTree, message }) {
  await assertCheckout(home, cwd);
  if (!OID.test(String(expectedTree))) throw invalid('The expected tree id is required.');
  await assertAutomationAllowed(cwd);
  assertSigningAllowed(cwd);
  if (indexTree(cwd) !== expectedTree) throw new GitOpsError('INDEX_MISMATCH', 'The staged content differs from what you approved; nothing was committed.');
  const before = head(cwd);
  await withPrivate(home, async (dir) => {
    ok(git(cwd, ['commit', '-q', '--cleanup=verbatim', '-F', await messageFile(dir, message)], { extraEnv: signingEnv() }), 'commit');
  });
  const after = head(cwd);
  if (after === before || treeOf(cwd, 'HEAD') !== expectedTree || !parentsOf(cwd, after).includes(before)) throw new GitOpsError('GIT_INCONSISTENT', 'The new commit does not match the approved content; stopped without changing anything else.');
  return after;
}

// G7: an unreferenced commit object (C′ or M); `-S` exactly when this repository signs (C5).
// `sign: false` only for the review preview C′, an object never referenced by any branch.
export async function commitTree({ home, cwd, tree, parents, message, sign = true }) {
  assertObject(cwd, tree, 'tree');
  if (!Array.isArray(parents) || !parents.length || parents.length > 2) throw invalid('One or two parents are required.');
  for (const parent of parents) assertObject(cwd, parent, 'commit');
  const signing = sign === false ? null : assertSigningAllowed(cwd);
  const args = ['commit-tree', tree];
  for (const parent of parents) args.push('-p', parent);
  if (signing) args.push('-S');
  return withPrivate(home, async (dir) => {
    args.push('-F', await messageFile(dir, message));
    const oid = ok(git(cwd, args, { extraEnv: signing ? signingEnv() : {} }), 'commit-tree');
    if (!OID.test(oid) || treeOf(cwd, oid) !== tree) throw new GitOpsError('GIT_INCONSISTENT', 'The created commit does not carry the expected tree.');
    return oid;
  });
}

// G10: fast-forward a checkout to a commit, then verify HEAD, its tree and the index (C4).
export async function fastForward({ cwd, to, home = null }) {
  await assertCheckout(home, cwd);
  assertObject(cwd, to, 'commit');
  await assertAutomationAllowed(cwd, { commits: [to] });
  const busy = await inProgress(cwd);
  if (busy.length) throw new GitOpsError('GIT_BUSY', `Git is busy in ${cwd} (${busy.join(', ')}); nothing was changed. Finish or clear that yourself, then continue.`);
  ok(git(cwd, ['merge', '--ff-only', '--no-overwrite-ignore', '-q', to]), 'merge --ff-only');
  const tree = treeOf(cwd, to);
  if (head(cwd) !== to || treeOf(cwd, 'HEAD') !== tree || indexTree(cwd) !== tree) throw new GitOpsError('GIT_INCONSISTENT', `After the fast-forward, ${cwd} is not exactly at ${to.slice(0, 12)} (another Git process may be running here). Stopped; nothing is repaired automatically.`);
  return to;
}
