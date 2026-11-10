// Team view data (v1.2.0): the repository's Git worktrees, read without mutating Git.
//
// - Worktrees come from Git's own files (<common-dir>/worktrees/<name>/gitdir and HEAD);
//   no `git worktree` command runs.
// - Changed files come from `git --no-optional-locks status --porcelain`, which never
//   refreshes .git/index.
// - Each worktree's YallaFlow state comes from its own `snapshot --json` (the runner).
// A worktree is a checkout, not an agent session: nothing here claims anyone is working
// in it. "Last recorded activity" is the newest timestamp YallaFlow recorded there.
import { spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SAFE_GIT } from '../utils/git-safety.js';

async function readTrim(file) {
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function isDir(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

// The common .git directory of the repository that contains `root`, or null.
async function commonGitDir(root) {
  const dotGit = path.join(root, '.git');
  if (await isDir(dotGit)) return dotGit;
  const pointer = await readTrim(dotGit);
  if (!pointer?.startsWith('gitdir:')) return null;
  const gitDir = path.resolve(root, pointer.slice('gitdir:'.length).trim());
  const common = await readTrim(path.join(gitDir, 'commondir'));
  return common ? path.resolve(gitDir, common) : gitDir;
}

function branchOf(head) {
  if (!head) return null;
  return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : `detached ${head.slice(0, 8)}`;
}

export async function listWorktrees(root) {
  const common = await commonGitDir(root);
  if (!common) return { git: false, worktrees: [] };
  const main = path.dirname(common);
  const entries = [{ path: main, branch: branchOf(await readTrim(path.join(common, 'HEAD'))), main: true }];
  let names = [];
  try {
    names = await readdir(path.join(common, 'worktrees'));
  } catch {
    names = [];
  }
  for (const name of names.sort()) {
    const admin = path.join(common, 'worktrees', name);
    const gitdir = await readTrim(path.join(admin, 'gitdir'));
    if (!gitdir) continue;
    const dir = path.dirname(path.resolve(admin, gitdir));
    // Git's own consistency check: a real linked worktree's .git file points back to this
    // admin directory. Anything else (a planted or stale gitdir) is never read or run in.
    const back = await readTrim(path.join(dir, '.git'));
    const linked = back?.startsWith('gitdir:') && path.resolve(dir, back.slice('gitdir:'.length).trim()) === path.resolve(admin);
    if (!linked) {
      entries.push({ path: dir, branch: null, main: false, exists: false, unverified: true });
      continue;
    }
    entries.push({ path: dir, admin, branch: branchOf(await readTrim(path.join(admin, 'HEAD'))), main: false, exists: await isDir(dir) });
  }
  return { git: true, worktrees: entries.map((entry) => ({ exists: true, ...entry })) };
}

// Changed paths in one worktree (working tree + index vs HEAD, plus untracked), without
// YallaFlow's own state.
// `gitDir`: a linked worktree's admin directory, pinned so the worktree's own .git file is not read.
export function changedFiles(dir, { gitDir = null } = {}) {
  return new Promise((resolve) => {
    // No fsmonitor hook and no optional locks: reading changes never runs repository-configured programs or writes the index.
    const child = spawn('git', [...SAFE_GIT, '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all'], { cwd: dir, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...(gitDir ? { GIT_DIR: gitDir, GIT_WORK_TREE: dir } : {}) } });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const files = [];
      const records = out.split('\0');
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (record.length < 4) continue;
        const status = record.slice(0, 2);
        files.push({ path: record.slice(3), status: status.trim() || '?' });
        if (status[0] === 'R' || status[0] === 'C') index += 1; // skip the rename source
      }
      resolve(files.filter((entry) => !entry.path.startsWith('.yallaflow/')));
    });
  });
}
