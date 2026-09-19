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
