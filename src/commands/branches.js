// yallaflow branches [--json] | branches configure ... (PF-0184). Branch Health is read-only;
// only `configure` writes, and only the branches block of .yallaflow/config.yaml.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findProjectRoot, workspacePath } from '../core/workspace.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { analyzeBranches, describeBranches } from '../core/branches.js';
import { isBranchName, validateBranchesConfig, validateProjectConfig } from '../shared/config.js';
import { SAFE_GIT } from '../utils/git-safety.js';

async function where() {
  const root = await findProjectRoot();
  if (root) return { root, workspace: true };
  const top = spawnSync('git', [...SAFE_GIT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, shell: false });
  if (top.status === 0 && top.stdout.trim()) return { root: top.stdout.trim(), workspace: false };
  throw new Error('This folder is not a Git repository.');
}

export async function branchesCommand({ json = false } = {}) {
  const { root, workspace } = await where();
  const config = workspace ? (await readYaml(path.join(workspacePath(root), 'config.yaml')).catch(() => null))?.branches ?? null : null;
  const report = await analyzeBranches(root, { config });
  if (json) return console.log(JSON.stringify(report, null, 2));
  console.log('Branch health');
  for (const line of describeBranches(report)) console.log(line);
}

export async function branchesConfigureCommand({ flow, hotfix, remote, clear = false } = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Branch settings are kept in .yallaflow/config.yaml; run `yallaflow init` first.');
  const file = path.join(workspacePath(root), 'config.yaml');
  const config = await readYaml(file);
  if (clear) {
    if (!config.branches) return console.log('No branch settings to remove; the flow is detected from branch names.');
    delete config.branches;
  } else {
    if (!flow) throw new Error('Usage: yallaflow branches configure --flow dev,qc,prod [--hotfix "hotfix/*"] [--remote origin]');
    const names = String(flow).split(',').map((name) => name.trim()).filter(Boolean);
    const bad = names.filter((name) => !isBranchName(name));
    if (bad.length) throw new Error(`Not a branch name: ${bad.join(', ')}.`);
    const block = { flow: names, ...(hotfix ? { hotfix } : {}), ...(remote ? { remote } : {}) };
    const errors = validateBranchesConfig(block);
    if (errors.length) throw new Error(errors.join('\n'));
    config.branches = block;
  }
  const problems = validateProjectConfig(config);
  if (problems.length) throw new Error(`config.yaml would not be valid; nothing was changed:\n${problems.join('\n')}`);
  await writeYaml(file, config);
  console.log(clear ? 'Branch settings removed; the flow is detected from branch names again.' : `Branch flow set: ${config.branches.flow.join(' → ')}${config.branches.hotfix ? `; hotfixes ${config.branches.hotfix}` : ''}${config.branches.remote ? `; remote ${config.branches.remote}` : ''}. Saved in .yallaflow/config.yaml (shared with the team when committed).`);
}
