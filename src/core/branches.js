// Git Branch Health (PF-0184, 1.5.5). Read-only: for a promotion flow such as
// feature/* → dev → qc → prod, with hotfixes prod → hotfix/* → prod, it answers
//   - is dev ready for QC? is QC ready for production?
//   - is a production hotfix missing from QC or dev?
//   - would a promotion conflict?
//   - how old is the branch information?
//
// Safety boundaries (by construction, and tested):
// - Only reading Git commands run: rev-parse, config --get, rev-list, log, merge-base, cat-file,
//   status (with optional locks off, so the index is not refreshed), and — through
//   execution/git-ops.js, with merge and filter drivers neutralised — merge-tree for the conflict
//   preview. Nothing merges, cherry-picks, rebases, resets, checks out, fetches or pushes.
// - merge-tree writes the trees it computes into an object store. Here that store is a
//   temporary directory (the repository's objects are an alternate), deleted afterwards: no
//   object, ref or index entry is added to the repository. Git may refresh the modification time
//   of an existing object it meets again (its protection against cleanup); content never changes.
// - No network: branch information is what the last `git fetch` (run by the developer) left.
// - A clean merge preview means only that Git expects no textual conflict. It says nothing
//   about behaviour, migrations, configuration or deployment; every report says so.
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { SAFE_GIT } from '../utils/git-safety.js';
import { previewMergeIsolated } from '../execution/git-ops.js';
import { isBranchName, validateBranchesConfig } from '../shared/config.js';

export { validateBranchesConfig };

export const BRANCHES_SCHEMA = 'yallaflow.branches/1';
export const DEFAULT_GROUPS = Object.freeze([
  Object.freeze({ role: 'dev', names: ['dev', 'develop', 'development'] }),
  Object.freeze({ role: 'qc', names: ['qc', 'qa', 'staging', 'test', 'uat'] }),
  Object.freeze({ role: 'prod', names: ['prod', 'production', 'main', 'master'] })
]);
export const DEFAULT_HOTFIX = 'hotfix/*';
const STALE_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 20;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

// Every call site passes a literal argument list (checked by test-support/git-scan.js); only
// reading subcommands are used. Merges are previewed by execution/git-ops.js.
function git(root, [...args], { env = {} } = {}) {
  const result = spawnSync('git', [...SAFE_GIT, '--no-optional-locks', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
    shell: false,
    // GIT_NO_LAZY_FETCH (Git 2.44+): a partial clone never fetches a missing object here.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C', ...env }
  });
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), error: result.error };
}

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

function gitVersion() {
  const out = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true, shell: false });
  const match = /(\d+)\.(\d+)/.exec(String(out.stdout ?? ''));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function resolveBranch(root, name, remote) {
  if (!isBranchName(name)) return null;
  const local = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`]);
  if (local.status === 0 && OID.test(local.stdout.trim())) {
    return { name, ref: `refs/heads/${name}`, oid: local.stdout.trim(), source: 'local', ...upstreamOf(root, name) };
  }
  if (remote) {
    const tracking = git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${name}^{commit}`]);
    if (tracking.status === 0 && OID.test(tracking.stdout.trim())) return { name, ref: `refs/remotes/${remote}/${name}`, oid: tracking.stdout.trim(), source: 'remote-tracking', upstream: null, track: '' };
  }
  return null;
}

// A local branch's upstream and how far apart they are: { upstream, track: {ahead, behind, gone} }.
function upstreamOf(root, name) {
  const merge = git(root, ['config', '--get', `branch.${name}.merge`]);
  if (merge.status !== 0 || !merge.stdout.trim()) return { upstream: null, track: null };
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${name}@{upstream}`]);
  if (upstream.status !== 0 || !upstream.stdout.trim()) return { upstream: `${merge.stdout.trim().replace(/^refs\/heads\//, '')} (gone)`, track: { ahead: 0, behind: 0, gone: true } };
  const counts = git(root, ['rev-list', '--left-right', '--count', `refs/heads/${name}...${name}@{upstream}`]).stdout.trim().split(/\s+/).map(Number);
  return { upstream: upstream.stdout.trim(), track: { ahead: counts[0] || 0, behind: counts[1] || 0, gone: false } };
}

const count = (root, range) => Number(git(root, ['rev-list', '--count', range]).stdout.trim() || 0);

// Commits on `from` whose change is not on `to` (patch-equivalent cherry-picks are recognised),
// newest first, bounded.
function missingChanges(root, from, to) {
  const out = git(root, ['log', '--cherry-pick', '--right-only', '--no-merges', `--max-count=${LIST_LIMIT + 1}`, '--format=%H%x1f%s%x1f%cI', `${to}...${from}`]);
  if (out.status !== 0) return { commits: [], more: false, ok: false };
  const commits = lines(out.stdout).map((line) => {
    const [oid, subject, date] = line.split('\x1f');
    return { oid: oid.slice(0, 12), subject: (subject ?? '').slice(0, 160), date: date ?? null };
  });
  return { commits: commits.slice(0, LIST_LIMIT), more: commits.length > LIST_LIMIT, ok: true };
}

// A partial clone (blobs fetched on demand). Before Git 2.44 a missing object would be fetched
// from the remote, so the comparisons that read file contents are skipped there.
function partialCloneWithoutGuard(root) {
  const version = gitVersion();
  if (version && (version[0] > 2 || (version[0] === 2 && version[1] >= 44))) return false;
  if (git(root, ['config', '--get', 'extensions.partialClone']).stdout.trim()) return true;
  return Boolean(git(root, ['config', '--get-regexp', '^remote\\..*\\.promisor$']).stdout.split('\n').some((line) => /\strue\s*$/i.test(line)));
}

// Merge `source` into `target` in a throwaway object store (execution/git-ops.js); the
// repository gets no new object, ref or index entry.
export async function previewMerge(root, target, source, { offline = true } = {}) {
  if (!offline) return { result: 'unavailable', reason: 'this is a partial clone and Git older than 2.44 could fetch missing files from the remote.' };
  const version = gitVersion();
  if (!version || version[0] < 2 || (version[0] === 2 && version[1] < 38)) return { result: 'unavailable', reason: 'Git 2.38 or later is needed for the conflict preview.' };
  const ours = git(root, ['rev-parse', '--verify', '--quiet', `${target}^{commit}`]).stdout.trim();
  const theirs = git(root, ['rev-parse', '--verify', '--quiet', `${source}^{commit}`]).stdout.trim();
  if (!OID.test(ours) || !OID.test(theirs)) return { result: 'unavailable', reason: 'a branch could not be read.' };
  try {
    const out = previewMergeIsolated(root, ours, theirs);
    if (out.result === 'no-conflict') return { result: 'clean', conflicts: [] };
    if (out.result === 'conflict') return { result: 'conflict', conflicts: out.conflicts.slice(0, LIST_LIMIT), more: out.conflicts.length > LIST_LIMIT };
    return { result: 'unavailable', reason: out.message };
  } catch (error) {
    return { result: 'unavailable', reason: error.message };
  }
}

// The shared .git folder (a linked worktree's too), absolute.
function commonDir(root) {
  const out = git(root, ['rev-parse', '--git-common-dir']);
  return out.status === 0 && out.stdout.trim() ? path.resolve(root, out.stdout.trim()) : null;
}

async function lastFetch(root) {
  const common = commonDir(root);
  if (!common) return null;
  const info = await stat(path.join(common, 'FETCH_HEAD')).catch(() => null);
  return info ? info.mtime.toISOString() : null;
}

function localBranches(root) {
  return lines(git(root, ['rev-parse', '--symbolic-full-name', '--branches']).stdout).map((ref) => ref.replace(/^refs\/heads\//, ''));
}

function matchesPattern(name, pattern) {
  const expression = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^\\s]*')}$`);
  return expression.test(name);
}

function remotes(root) {
  return lines(git(root, ['config', '--get-regexp', '^remote\\..*\\.url$']).stdout).map((line) => /^remote\.(.+)\.url\s/.exec(line)?.[1]).filter(Boolean);
}

// The flow: configured, or detected from branch names (each role's first existing name).
function chooseFlow(root, config, remote) {
  if (config?.flow) return { flow: config.flow, configured: true };
  const flow = [];
  for (const group of DEFAULT_GROUPS) {
    const found = group.names.find((name) => resolveBranch(root, name, remote));
    if (found) flow.push(found);
  }
  return { flow, configured: false };
}

export async function analyzeBranches(root, { config = null, now = Date.now() } = {}) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    return { schema: BRANCHES_SCHEMA, available: false, reason: 'This folder is not a Git repository.' };
  }
  const configured = config && !validateBranchesConfig(config).length ? config : null;
  const knownRemotes = remotes(root);
  const remote = configured?.remote ?? (knownRemotes.includes('origin') ? 'origin' : knownRemotes[0] ?? null);
  const { flow, configured: isConfigured } = chooseFlow(root, configured, remote);
  const hotfixPattern = configured?.hotfix ?? DEFAULT_HOTFIX;
  const fetchedAt = remote ? await lastFetch(root) : null;
  const notes = [];
  const report = {
    schema: BRANCHES_SCHEMA,
    available: true,
    flow,
    flowSource: isConfigured ? 'configured' : 'detected',
    hotfixPattern,
    remote,
    fetchedAt,
    stale: Boolean(remote) && (!fetchedAt || now - Date.parse(fetchedAt) > STALE_MS),
    branches: [],
    promotions: [],
    hotfixes: [],
    productionOnly: [],
    unchecked: [],
    notes,
    caveat: 'Git can only predict textual merge conflicts. A clean preview does not show that the promoted code works: behaviour, database migrations, configuration and runtime compatibility still need review and testing.'
  };
  if (configured === null && config) notes.push('The branches block in config.yaml is not valid and was ignored; the flow was detected from branch names.');
  if (flow.length < 2) {
    report.available = false;
    report.reason = isConfigured ? 'The configured flow names fewer than two branches.' : 'No promotion flow was found: name your branches dev, qc and prod (or similar), or set the flow with `yallaflow branches configure --flow dev,qc,prod`.';
    return report;
  }

  const contentSafe = !partialCloneWithoutGuard(root);
  const resolved = new Map();
  for (const name of flow) {
    const branch = resolveBranch(root, name, remote);
    if (!branch) {
      report.branches.push({ name, exists: false });
      notes.push(`${name} does not exist here${remote ? ` (not as a local branch nor as ${remote}/${name})` : ''}.`);
      continue;
    }
    resolved.set(name, branch);
    const entry = { name, exists: true, ref: branch.ref, source: branch.source, oid: branch.oid.slice(0, 12), upstream: branch.upstream };
    if (branch.source === 'local' && branch.track) {
      const { track } = branch;
      Object.assign(entry, track);
      if (track.gone) notes.push(`${name}'s upstream ${branch.upstream} no longer exists on the remote (as of the last fetch).`);
      else if (track.ahead && track.behind) notes.push(`${name} has diverged from ${branch.upstream}: ${track.ahead} local commit(s) not pushed and ${track.behind} remote commit(s) not pulled.`);
      else if (track.ahead) notes.push(`${name} has ${track.ahead} local commit(s) not pushed to ${branch.upstream}.`);
      else if (track.behind) notes.push(`${name} is ${track.behind} commit(s) behind ${branch.upstream}; this report uses your local ${name}.`);
    } else if (branch.source === 'remote-tracking') {
      notes.push(`${name} has no local branch; ${branch.ref.replace('refs/remotes/', '')} from the last fetch is used.`);
    }
    report.branches.push(entry);
  }

  // Each step of the flow: lower → upper.
  for (let index = 0; index < flow.length - 1; index++) {
    const from = resolved.get(flow[index]);
    const to = resolved.get(flow[index + 1]);
    if (!from || !to) {
      report.promotions.push({ from: flow[index], to: flow[index + 1], status: 'unknown', summary: 'a branch is missing' });
      continue;
    }
    const waiting = count(root, `${to.ref}..${from.ref}`);
    const upperOnly = contentSafe ? missingChanges(root, to.ref, from.ref) : { commits: [], more: false, ok: false };
    const behind = [from, to].filter((branch) => branch.track?.behind || branch.track?.gone);
    const base = git(root, ['merge-base', to.ref, from.ref]).stdout.trim().slice(0, 12) || null;
    const promotion = { from: from.name, to: to.name, waiting, mergeBase: base, missingInFrom: upperOnly.commits, missingInFromMore: upperOnly.more, preview: null, status: null, summary: null, next: [] };
    if (behind.length) {
      // The local branch is not what the remote has: an answer from it could mislead.
      promotion.status = 'check-first';
      promotion.summary = behind.map((branch) => (branch.track.gone ? `${branch.name}'s upstream is gone` : `your local ${branch.name} is ${branch.track.behind} commit(s) behind ${branch.upstream}`)).join('; ') + '. Update it (for example git pull on that branch) and run this again.';
    } else if (!waiting) {
      promotion.status = 'up-to-date';
      promotion.summary = `Nothing in ${from.name} is waiting for ${to.name}.`;
    } else {
      promotion.preview = await previewMerge(root, to.ref, from.ref, { offline: contentSafe });
      const fastForward = count(root, `${from.ref}..${to.ref}`) === 0;
      if (promotion.preview.result === 'conflict') {
        promotion.status = 'conflict';
        promotion.summary = `${waiting} commit(s) wait in ${from.name}, and merging them into ${to.name} would conflict in ${promotion.preview.conflicts.length}${promotion.preview.more ? '+' : ''} file(s).`;
        promotion.next.push(`Resolve the conflict on a branch made from ${from.name} (for example merge ${to.name} into it), review, then promote.`);
      } else if (!upperOnly.ok || promotion.preview.result !== 'clean') {
        promotion.status = 'unknown';
        promotion.summary = `${waiting} commit(s) wait in ${from.name}, but ${!upperOnly.ok ? `whether ${to.name} has changes ${from.name} lacks could not be checked` : `the conflict preview was unavailable (${promotion.preview.reason})`}.`;
        promotion.next.push(`Compare ${from.name} and ${to.name} yourself before promoting.`);
      } else if (upperOnly.commits.length) {
        promotion.status = 'needs-sync';
        promotion.summary = `${waiting} commit(s) wait in ${from.name}, but ${to.name} has ${upperOnly.commits.length}${upperOnly.more ? '+' : ''} change(s) that ${from.name} does not.`;
        promotion.next.push(`Bring ${to.name}'s changes into ${from.name} first (merge ${to.name} into ${from.name}), test, then promote.`);
      } else {
        promotion.status = 'ready';
        promotion.summary = `${waiting} commit(s) in ${from.name} are ready for ${to.name}; Git expects no conflict${fastForward ? ' (a fast-forward is possible)' : ''}.`;
        promotion.next.push(`Review what changes (git log ${to.name}..${from.name}) and test, then promote ${from.name} into ${to.name} through your normal process.`);
      }
    }
    report.promotions.push(promotion);
  }

  // Production: changes there that earlier stages lack (hotfixes, direct fixes).
  const prod = resolved.get(flow[flow.length - 1]);
  if (prod) {
    for (const name of flow.slice(0, -1)) {
      const branch = resolved.get(name);
      if (!branch) continue;
      const missing = contentSafe ? missingChanges(root, prod.ref, branch.ref) : { commits: [], more: false, ok: false };
      if (!missing.ok) report.unchecked.push(name);
      else if (missing.commits.length) report.productionOnly.push({ branch: name, commits: missing.commits, more: missing.more, preview: await previewMerge(root, branch.ref, prod.ref) });
    }
    if (prod.track?.behind || prod.track?.gone) report.unchecked.push(`${prod.name} (behind its upstream)`);
    // hotfix/* branches: local ones, and remote-tracking ones without a local branch.
    const local = localBranches(root);
    const candidates = local.filter((branch) => matchesPattern(branch, hotfixPattern) && !flow.includes(branch)).map((name) => ({ name, ref: `refs/heads/${name}` }));
    if (remote) {
      for (const ref of lines(git(root, ['rev-parse', '--symbolic-full-name', '--remotes']).stdout)) {
        const name = ref.startsWith(`refs/remotes/${remote}/`) ? ref.slice(`refs/remotes/${remote}/`.length) : null;
        if (name && isBranchName(name) && matchesPattern(name, hotfixPattern) && !flow.includes(name) && !local.includes(name)) candidates.push({ name: `${remote}/${name}`, ref });
      }
    }
    for (const hotfix of candidates.slice(0, LIST_LIMIT)) {
      if (!contentSafe) break;
      const inProd = missingChanges(root, hotfix.ref, prod.ref);
      const entry = { name: hotfix.name, inProduction: inProd.ok && !inProd.commits.length, missingFrom: [], unchecked: !inProd.ok };
      for (const stage of flow.slice(0, -1)) {
        const branch = resolved.get(stage);
        if (!branch) continue;
        const missing = missingChanges(root, hotfix.ref, branch.ref);
        if (!missing.ok) entry.unchecked = true;
        else if (missing.commits.length) entry.missingFrom.push(stage);
      }
      report.hotfixes.push(entry);
    }
  }
  if (!contentSafe) notes.push('This is a partial clone and this Git (older than 2.44) would download missing files from the remote to compare changes, so those comparisons were skipped. Upgrade Git to 2.44 or later for a complete report.');
  // Uncommitted work is never read: reading the work tree could run a repository's own filters.
  notes.push('Only committed branches are compared; uncommitted changes in this checkout are not included.');
  if (!remote) notes.push('This repository has no remote; only local branches were compared.');
  else if (!fetchedAt) notes.push(`There is no record of a fetch from ${remote}; remote branch information may be missing. YallaFlow never fetches: run \`git fetch\` yourself to update it.`);
  else if (report.stale) notes.push(`Branch information is from the last fetch (${fetchedAt}); it may be out of date. YallaFlow never fetches: run \`git fetch\` yourself to update it.`);
  return report;
}

// Plain answers for the CLI.
export function describeBranches(report) {
  const out = [];
  if (!report.available) return [report.reason];
  out.push(`Flow (${report.flowSource}): ${report.flow.join(' → ')}${report.hotfixPattern ? `; hotfixes: ${report.hotfixPattern} → ${report.flow.at(-1)}` : ''}`);
  for (const promotion of report.promotions) {
    const label = { 'up-to-date': 'Up to date', ready: 'Ready', 'needs-sync': 'Sync first', conflict: 'Potential conflict', 'check-first': 'Check first', unknown: 'Unknown' }[promotion.status];
    out.push(`\nIs ${promotion.from} ready for ${promotion.to}? ${label}. ${promotion.summary}`);
    if (promotion.preview?.result === 'conflict') for (const file of promotion.preview.conflicts) out.push(`  conflict: ${file}`);
    for (const commit of promotion.missingInFrom.slice(0, 5)) out.push(`  only in ${promotion.to}: ${commit.oid} ${commit.subject}`);
    for (const step of promotion.next) out.push(`  Suggested (not run): ${step}`);
  }
  if (report.productionOnly.length || report.hotfixes.some((entry) => entry.missingFrom.length)) {
    out.push(`\nProduction changes missing from earlier branches:`);
    for (const item of report.productionOnly) {
      out.push(`  ${report.flow.at(-1)} has ${item.commits.length}${item.more ? '+' : ''} change(s) that ${item.branch} does not:`);
      for (const commit of item.commits.slice(0, 5)) out.push(`    ${commit.oid} ${commit.subject}`);
      if (item.preview?.result === 'conflict') out.push(`    Potential conflict: merging ${report.flow.at(-1)} into ${item.branch} would conflict in ${item.preview.conflicts.join(', ')}${item.preview.more ? ', …' : ''}.`);
      else if (item.preview?.result === 'clean') out.push(`    Git expects no conflict merging ${report.flow.at(-1)} into ${item.branch}.`);
      out.push(`    Suggested (not run): merge ${report.flow.at(-1)} into ${item.branch} (or cherry-pick the fix), review and test.`);
    }
    for (const hotfix of report.hotfixes.filter((entry) => entry.missingFrom.length)) out.push(`  ${hotfix.name}${hotfix.inProduction ? ' (in production)' : ' (not yet in production)'} is missing from ${hotfix.missingFrom.join(', ')}.`);
  } else if (!report.unchecked.length && !report.hotfixes.some((entry) => entry.unchecked)) {
    out.push(`\nNo production change is missing from ${report.flow.slice(0, -1).join(' or ')}.`);
  }
  if (report.unchecked.length) out.push(`\nCould not check production changes against: ${report.unchecked.join(', ')}.`);
  if (report.notes.length) {
    out.push('\nNotes:');
    for (const note of report.notes) out.push(`  - ${note}`);
  }
  out.push(`\n${report.caveat}`);
  out.push('Read-only: nothing was merged, fetched, checked out or changed.');
  return out;
}
