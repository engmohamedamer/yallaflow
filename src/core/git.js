import { spawnSync } from 'node:child_process';

export function discoverGitState(root) {
  const result = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return { available: false, summary: 'unavailable (not a Git work tree)' };
  const changes = result.stdout.split('\n').filter(Boolean);
  if (!changes.length) return { available: true, clean: true, changes: [], summary: 'clean' };
  return {
    available: true,
    clean: false,
    changes,
    summary: `${changes.length} changed path${changes.length === 1 ? '' : 's'}`
  };
}

// Read-only Git probes used by project-memory freshness. Every helper degrades to
// null/[] outside a Git work tree — freshness then reports UNKNOWN, never an error.
export function gitHead(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// 'unchanged' | 'changed' | 'unknown' for a path relative to root, comparing the
// recorded commit against the current working tree (tracked changes plus untracked
// files beneath the path).
export function gitPathChangedSince(root, commit, relativePath) {
  const diff = spawnSync('git', ['diff', '--quiet', commit, '--', relativePath], { cwd: root, encoding: 'utf8' });
  if (diff.status !== 0 && diff.status !== 1) return 'unknown';
  if (diff.status === 1) return 'changed';
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', relativePath], { cwd: root, encoding: 'utf8' });
  if (untracked.status !== 0) return 'unknown';
  return untracked.stdout.trim() ? 'changed' : 'unchanged';
}

// Paths (relative to root) changed in the working tree, or since `ref` when given:
// tracked modifications plus untracked files. Returns null outside a Git work tree.
export function gitChangedPaths(root, ref = 'HEAD') {
  const tracked = spawnSync('git', ['diff', '--name-only', '--relative', ref], { cwd: root, encoding: 'utf8' });
  if (tracked.status !== 0) return null;
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const paths = new Set(tracked.stdout.split('\n').map((line) => line.trim()).filter(Boolean));
  if (untracked.status === 0) for (const line of untracked.stdout.split('\n')) if (line.trim()) paths.add(line.trim());
  return [...paths].sort();
}

// Working-tree provenance (v0.3.10-internal.4), additional to content hashes — never a
// replacement for them, and never required. For repository file paths (relative to
// root) returns a Map path → 'head' (identical to the committed HEAD content),
// 'modified' (uncommitted changes relative to HEAD, including newly staged files), or
// 'untracked' (not tracked by Git, including ignored files). Returns null outside a Git
// work tree, without a HEAD commit, or if Git fails — callers then record nothing.
export const WORKING_TREE_STATES = Object.freeze(['head', 'modified', 'untracked']);

export function gitWorkingTreeStates(root, relativePaths) {
  const paths = [...new Set(relativePaths)];
  if (!paths.length || !gitHead(root)) return null;
  const changed = spawnSync('git', ['diff', '--name-only', '-z', '--relative', 'HEAD', '--', ...paths], { cwd: root, encoding: 'utf8' });
  const untracked = spawnSync('git', ['ls-files', '-z', '--others', '--', ...paths], { cwd: root, encoding: 'utf8' });
  if (changed.status !== 0 || untracked.status !== 0) return null;
  const split = (output) => new Set(output.split('\0').filter(Boolean));
  const modified = split(changed.stdout);
  const others = split(untracked.stdout);
  return new Map(paths.map((entry) => [entry, others.has(entry) ? 'untracked' : modified.has(entry) ? 'modified' : 'head']));
}
