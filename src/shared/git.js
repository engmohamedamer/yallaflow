import { spawnSync } from 'node:child_process';

// Read-only, local Git probes for Shared Project Mode. None of these touches the
// network, the index, refs, or history: YallaFlow never commits, pushes, pulls,
// rebases, merges, or fetches. Every helper degrades to null/false outside Git.

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function insideGitWorkTree(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

// The checked-out branch, or null for a detached HEAD (typical in CI) or no Git.
export function currentBranch(root) {
  return git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
}

// The default branch as far as local Git configuration knows it, without asking any
// remote: origin's recorded HEAD first, then init.defaultBranch. null when neither is
// mechanically available — the maintainer then names it explicitly.
export function defaultIntegrationBranch(root) {
  const remoteHead = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead && remoteHead.startsWith('origin/')) return { branch: remoteHead.slice('origin/'.length), source: 'origin/HEAD (local remote-tracking ref)' };
  const configured = git(root, ['config', '--get', 'init.defaultBranch']);
  if (configured) return { branch: configured, source: 'git config init.defaultBranch' };
  return null;
}

export function trackedPaths(root, pathspec) {
  const out = git(root, ['ls-files', '--', pathspec]);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function isGitIgnored(root, relativePath) {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', relativePath], { cwd: root }).status === 0;
}

export function uncommittedPaths(root) {
  const out = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (out.status !== 0) return null;
  return out.stdout.split('\n').filter(Boolean);
}
