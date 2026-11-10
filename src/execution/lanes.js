// Lanes (PF-0112 M2): parallel work in isolated Git worktrees, created and cleaned up only
// through src/execution/git-ops.js.
//
// - Lanes live in the sibling folder <repo>.lanes/<slug> (D3) on branches yf/<slug>.
// - A lane needs Shared Project Mode in its base commit (D1): branch-safe work ids and
//   staged memory deltas; otherwise lanes would collide on PF-#### and on tracked state.
// - Each lane carries a YallaFlow marker (.yallaflow/local/execution/lane.json) and is listed
//   in its home checkout's .yallaflow/local/execution/lanes.json; YallaFlow removes only lanes
//   it created, whose marker matches.
// - Clean up is a separate, explicit action (D12), refused unless every guard holds (FR13):
//   no session, no other console, nothing staged/unstaged/untracked, no ignored file except
//   positively identified reproducible dependencies (A6), and the lane's branch reachable
//   from the integration branch. The developer confirms the exact deletion list. YallaFlow's
//   own runtime records of the lane are copied into the home checkout first, never lost.
// - Default 2 lanes at a time, at most 4; more than 2 is labelled experimental (D5).
import { cp, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { safeLocalDir, safeWriteFile } from '../agents/local-files.js';
import { personalLocalFile } from '../agents/settings.js';
import { ensureLocalIgnored } from '../agents/bridge.js';
import { readCheckoutLock } from '../agents/checkout-lock.js';
import * as gitops from './git-ops.js';

export const LANES_SCHEMA = 'yallaflow.lanes/1';
export const MARKER_SCHEMA = 'yallaflow.lane/1';
export const DEFAULT_MAX_LANES = 2;
export const HARD_MAX_LANES = 4;
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

export function lanesRootFor(home) {
  return path.join(path.dirname(home), `${path.basename(home)}.lanes`);
}

// The sibling lanes folder: created one level deep only, never through a link (D3).
export async function ensureLanesRoot(home) {
  const root = lanesRootFor(home);
  await gitops.assertDirectory(path.dirname(root), { label: 'parent folder' });
  try {
    await mkdir(root, { mode: 0o755 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await gitops.assertDirectory(root, { label: 'lanes folder' });
  return root;
}

// ----- the home checkout's lane list (personal runtime state, git-ignored) -----
// Review H7: personal runtime files are read only when YallaFlow could have written them here
// (a regular file, owned by you, mode 0600, not tracked by Git); a lane record must match the
// shapes YallaFlow writes. Anything else is ignored, never trusted.
const LANE_ID = /^l-[0-9a-f]{8}$/;
const validLane = (lane) => lane && typeof lane === 'object' && LANE_ID.test(String(lane.id)) && gitops.SLUG.test(String(lane.slug)) && typeof lane.path === 'string' && path.isAbsolute(lane.path) && lane.branch === `yf/${lane.slug}` && /^[0-9a-f]{40,64}$/.test(String(lane.base));
export async function readLanes(home) {
  try {
    const file = path.join(home, '.yallaflow', 'local', 'execution', 'lanes.json');
    if (await personalLocalFile(home, file)) return [];
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data?.schema === LANES_SCHEMA && Array.isArray(data.lanes) ? data.lanes.filter(validLane) : [];
  } catch {
    return [];
  }
}
async function writeLanes(home, lanes) {
  await ensureLocalIgnored(home);
  const dir = await safeLocalDir(home, '.yallaflow', 'local', 'execution');
  await safeWriteFile(dir, 'lanes.json', `${JSON.stringify({ schema: LANES_SCHEMA, lanes }, null, 1)}\n`);
}
export async function readMarker(lane) {
  try {
    const file = path.join(lane, '.yallaflow', 'local', 'execution', 'lane.json');
    if (await personalLocalFile(lane, file)) return null;
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data?.schema === MARKER_SCHEMA && LANE_ID.test(String(data.id)) && typeof data.home === 'string' && path.isAbsolute(data.home) ? data : null;
  } catch {
    return null;
  }
}

// A lane's identity (review L2 and re-verification round 2) comes from where it is and from its
// home checkout's own lane list, never from files inside the lane, which its agent can delete or
// forge: lanes live at <home>.lanes/<slug> (D3), and the home's lanes.json must list this path.
export async function laneIdentity(lane) {
  const parent = path.dirname(path.resolve(lane));
  if (!path.basename(parent).endsWith('.lanes')) return null;
  const home = path.join(path.dirname(parent), path.basename(parent).slice(0, -'.lanes'.length));
  const real = async (dir) => realpath(dir).catch(() => path.resolve(dir));
  const target = await real(lane);
  for (const entry of await readLanes(home)) {
    if (entry.state === 'removed') continue;
    if ((await real(entry.path)) === target) return { schema: MARKER_SCHEMA, id: entry.id, home, slug: entry.slug, branch: entry.branch, base: entry.base, createdBy: 'yallaflow' };
  }
  return null;
}

// The Shared Project policy in a commit's .yallaflow/config.yaml (JSON-formatted YAML).
export function sharedPolicyAt(home, commit) {
  const text = gitops.showFile(home, commit, '.yallaflow/config.yaml');
  if (!text) return null;
  try {
    const config = JSON.parse(text);
    return config?.shared?.enabled === true ? { integrationBranch: config.shared.integrationBranch ?? null } : null;
  } catch {
    return null;
  }
}

// What creating lanes needs, read-only: → { ok, blockers[], base, integrationBranch, active, maxLanes, experimental }
export async function lanePreconditions(home, { count = 1, maxLanes = DEFAULT_MAX_LANES } = {}) {
  const blockers = [];
  const limit = Math.min(Math.max(1, Number(maxLanes) || DEFAULT_MAX_LANES), HARD_MAX_LANES);
  const platform = gitops.platformCheck();
  if (!platform.ok) blockers.push({ code: 'GIT_UNVERIFIED_PLATFORM', message: `${platform.reason} Use manual Git worktrees instead.` });
  let base = null;
  let integrationBranch = null;
  try {
    const head = gitops.head(home);
    const policy = sharedPolicyAt(home, head);
    if (!policy) blockers.push({ code: 'SHARED_REQUIRED', message: 'Parallel lanes need Shared Project Mode in a committed config: enable it, commit .yallaflow/, then create lanes.' });
    else {
      integrationBranch = policy.integrationBranch;
      if (gitops.currentBranch(home) !== integrationBranch) blockers.push({ code: 'NOT_ON_INTEGRATION_BRANCH', message: `Create lanes from the integration branch (${integrationBranch}); this checkout is on ${gitops.currentBranch(home) ?? 'a detached HEAD'}.` });
      base = head;
    }
  } catch (error) {
    blockers.push({ code: 'NO_COMMIT', message: `Lanes start from a commit: ${error.message}` });
  }
  if (base) {
    const links = gitops.gitlinks(home, { commits: [base] });
    if (links.length) blockers.push({ code: 'GIT_SUBMODULES', message: `This repository has submodules (${links.slice(0, 3).join(', ')}); YallaFlow 1.5.0 does not create lanes for it. Use manual Git worktrees instead.` });
    const drivers = await gitops.externalDrivers(home, { commits: [base] });
    if (drivers.filters.length || drivers.mergeDrivers.length) blockers.push({ code: 'GIT_EXTERNAL_DRIVERS', message: 'This repository uses Git filters or merge drivers; YallaFlow 1.5.0 does not run them. Use manual Git worktrees instead.' });
  }
  const active = (await readLanes(home)).filter((lane) => lane.state !== 'removed');
  if (active.length + count > limit) blockers.push({ code: 'MAX_LANES', message: `At most ${limit} lanes at a time (${active.length} open).` });
  return { ok: blockers.length === 0, blockers, base, integrationBranch, lanesRoot: lanesRootFor(home), active: active.length, maxLanes: limit, experimental: limit > DEFAULT_MAX_LANES, platform: platform.version ?? null };
}

// Creates one lane after the preconditions hold (each re-checked by git-ops itself).
// Review M5: lane creation is serialised per home checkout (check, create and record as one).
const creating = new Map();
export function createLane(home, options = {}) {
  const previous = creating.get(home) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => createLaneNow(home, options));
  creating.set(home, next);
  return next.finally(() => { if (creating.get(home) === next) creating.delete(home); });
}
async function createLaneNow(home, { slug, maxLanes } = {}) {
  gitops.assertSlug(slug);
  const pre = await lanePreconditions(home, { count: 1, maxLanes });
  if (!pre.ok) throw fail(409, pre.blockers[0].code, pre.blockers.map((entry) => entry.message).join(' '), { blockers: pre.blockers });
  const lanesRoot = await ensureLanesRoot(home);
  const created = await gitops.createLaneWorktree({ home, lanesRoot, slug, base: pre.base });
  const id = `l-${randomBytes(4).toString('hex')}`;
  const record = { id, slug, path: created.path, branch: created.branch, base: created.base, integrationBranch: pre.integrationBranch, createdAt: new Date().toISOString(), createdBy: 'yallaflow', state: 'ready', configFingerprint: await gitops.configFingerprint(home) };
  await ensureLocalIgnored(created.path);
  const markerDir = await safeLocalDir(created.path, '.yallaflow', 'local', 'execution');
  await safeWriteFile(markerDir, 'lane.json', `${JSON.stringify({ schema: MARKER_SCHEMA, id, home, slug, branch: created.branch, base: created.base, createdAt: record.createdAt, createdBy: 'yallaflow' }, null, 1)}\n`);
  await writeLanes(home, [...(await readLanes(home)), record]);
  return record;
}

// A6: ignored paths that are positively identified, reproducible dependencies of the
// lane's stack. Everything else ignored blocks Clean up.
const LOCKFILES = { node_modules: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'], vendor: ['composer.lock'] };
const MANIFEST = { node_modules: 'package.json', vendor: 'composer.json' };
async function isDependency(lane, relative) {
  const parts = relative.replace(/\/$/, '').split('/');
  for (let index = 0; index < parts.length; index++) {
    const name = parts[index];
    if (!LOCKFILES[name]) continue;
    const owner = path.join(lane, ...parts.slice(0, index));
    const has = async (file) => (await lstat(path.join(owner, file)).then((info) => info.isFile(), () => false));
    if (await has(MANIFEST[name]) && (await Promise.all(LOCKFILES[name].map(has))).some(Boolean)) return true;
  }
  return false;
}

// The first folder named .git below the lane root (not following links), or null.
async function nestedGitDir(lane) {
  const { readdir } = await import('node:fs/promises');
  const stack = [lane];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === '.git') return path.relative(lane, full);
      stack.push(full);
    }
  }
  return null;
}

// Read-only: can this lane be cleaned up now? → { ok, blockers[], deletions[], archive }
// `session` comes from the console (bridge glance for the lane project): any session, link or
// open request blocks.
export async function cleanupCheck(home, laneRecord, { session = null, pending = 0, integrated = null } = {}) {
  const blockers = [];
  const lane = laneRecord.path;
  const marker = await readMarker(lane);
  if (!marker || marker.id !== laneRecord.id || marker.home !== home || marker.createdBy !== 'yallaflow') blockers.push({ code: 'NOT_OURS', message: 'This folder has no matching YallaFlow lane marker; YallaFlow only removes lanes it created.' });
  if (session || pending) blockers.push({ code: 'SESSION_ACTIVE', message: 'An agent session is running or waiting in this lane. End it first.' });
  const holder = await readCheckoutLock(lane).catch(() => null);
  if (holder && !holder.stale && !holder.unreadable && holder.pid !== process.pid) blockers.push({ code: 'CHECKOUT_LOCKED', message: `Another YallaFlow console (pid ${holder.pid}) owns this lane.` });
  let deletions = [];
  try {
    await gitops.assertLaneOf(home, lane);
    const links = gitops.gitlinks(lane);
    if (links.length) {
      blockers.push({ code: 'GIT_SUBMODULES', message: `The lane has submodules (${links.slice(0, 3).join(', ')}); YallaFlow 1.5.0 does not clean up lanes with submodules. Remove it by hand.` });
      return { ok: false, blockers, deletions: [], archive: '.yallaflow/local/' };
    }
    // Git never lists files inside a folder named .git, and `worktree remove` deletes them silently
    // (final review M1): any nested .git folder blocks Clean up.
    const nested = await nestedGitDir(lane);
    if (nested) blockers.push({ code: 'NESTED_GIT', message: `The lane has a folder named .git inside it (${nested}); Git cannot see its files, so Clean up could delete them. Move it out of the lane yourself first.` });
    const hidden = gitops.hiddenEntries(lane);
    if (hidden.length) blockers.push({ code: 'HIDDEN_CHANGES', message: `Git hides changes to ${hidden.length} file(s) here (assume-unchanged or skip-worktree): ${hidden.slice(0, 5).join(', ')}${hidden.length > 5 ? ', …' : ''}. Clean up cannot see whether they changed; clear those flags yourself first.` });
    const changes = gitops.statusEntries(lane);
    if (changes.length) blockers.push({ code: 'UNCOMMITTED', message: `The lane has ${changes.length} staged, unstaged or untracked change(s): ${changes.slice(0, 5).map((entry) => entry.path).join(', ')}${changes.length > 5 ? ', …' : ''}.` });
    const ignored = gitops.statusEntries(lane, { ignored: true }).filter((entry) => entry.code === '!!').map((entry) => entry.path);
    for (const entry of ignored) {
      if (entry === '.yallaflow/local/' || entry.startsWith('.yallaflow/local/')) continue; // archived first
      if (await isDependency(lane, entry)) deletions.push(entry);
      else blockers.push({ code: 'IGNORED_FILES', message: `${entry} is ignored by Git but is not a reproducible dependency; Clean up would delete it. Move or delete it yourself first.` });
    }
    const merged = laneRecord.integrationBranch ? gitops.isAncestor(home, gitops.head(lane), `refs/heads/${laneRecord.integrationBranch}`) : false;
    if (!merged) blockers.push({ code: 'NOT_MERGED', message: `The lane's branch is not merged into ${laneRecord.integrationBranch ?? 'the integration branch'}; its work would only remain on ${laneRecord.branch}.` });
    if (integrated === false) blockers.push({ code: 'NOT_VERIFIED', message: 'The lane is merged but not verified yet.' });
  } catch (error) {
    blockers.push({ code: error.code ?? 'GIT_FAILED', message: error.message });
  }
  deletions = deletions.sort();
  return { ok: blockers.length === 0, blockers, deletions, archive: '.yallaflow/local/' };
}

// Clean up: re-checks everything, requires the developer's confirmation of the exact
// deletion list, copies the lane's YallaFlow runtime records into the home checkout, then
// removes the worktree (git-ops G2, never --force). The branch stays.
export async function cleanupLane(home, laneId, { confirmedDeletions, session = null, pending = 0, integrated = null } = {}) {
  const lanes = await readLanes(home);
  const record = lanes.find((lane) => lane.id === laneId && lane.state !== 'removed');
  if (!record) throw fail(404, 'NOT_FOUND', 'Unknown lane.');
  const check = await cleanupCheck(home, record, { session, pending, integrated });
  if (!check.ok) throw fail(409, check.blockers[0].code, check.blockers.map((entry) => entry.message).join(' '), { blockers: check.blockers });
  const confirmed = Array.isArray(confirmedDeletions) ? [...confirmedDeletions].map(String).sort() : null;
  if (!confirmed || JSON.stringify(confirmed) !== JSON.stringify(check.deletions)) throw fail(409, 'SCOPE_CHANGED', 'The files Clean up would delete changed since you confirmed them; review the list again.', { deletions: check.deletions });
  if ((await gitops.configFingerprint(home)) !== record.configFingerprint) throw fail(409, 'CONFIG_CHANGED', 'The repository Git configuration changed since this lane was created; review it, then clean up by hand.');
  const local = path.join(record.path, '.yallaflow', 'local');
  if (await stat(local).then(() => true, () => false)) {
    const archiveDir = await safeLocalDir(home, '.yallaflow', 'local', 'execution', 'lanes');
    await cp(local, path.join(archiveDir, record.id), { recursive: true, dereference: false, errorOnExist: true, force: false, verbatimSymlinks: true });
  }
  await gitops.removeLaneWorktree({ home, lane: record.path, ignoredAllowed: check.deletions });
  const removedAt = new Date().toISOString();
  await writeLanes(home, lanes.map((lane) => (lane.id === record.id ? { ...lane, state: 'removed', removedAt, deleted: check.deletions } : lane)));
  return { removed: record.path, branch: record.branch, deleted: check.deletions, archived: `.yallaflow/local/execution/lanes/${record.id}` };
}

export async function realHome(home) {
  return realpath(home);
}
