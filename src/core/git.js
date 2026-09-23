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
