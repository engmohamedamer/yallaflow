// What a service needs before it can start (PF-0166): checked from the files on disk, nothing
// is run. Only cases YallaFlow can tell with certainty are reported:
//
// - DEPENDENCIES_MISSING: the service is started by a Node package manager (npm, pnpm, yarn,
//   bun) or by npx, its package.json declares dependencies, and no installed dependencies
//   are found in the package folder or the folders above it (up to the repository).
// - LOCAL_TOOL_MISSING: the package script it runs starts with a tool that the package
//   declares (for example `ng` from @angular/cli) and that tool is not installed locally.
//
// Each problem carries the fix: the install command for the package manager the project
// uses, chosen from its lockfile. The command is only shown here; running it is a separate,
// explicit, confirmed action (see runtimeInstall in supervisor.js). A frozen install
// (`npm ci`, `--frozen-lockfile`) is preferred when a lockfile exists, so installing never
// rewrites package.json or the lockfile.
//
// The answer has one of three states (owner review, 2026-11-17):
// - READY: checked, and nothing is missing (or the package declares no dependencies).
// - NEEDS_SETUP: one of the problems above, with its fix. Start refuses it unless the
//   developer chooses to try anyway (that skips this check only, see startService).
// - UNKNOWN: the check cannot tell (a command YallaFlow does not recognize, no or an
//   unreadable package.json, Yarn Plug'n'Play, a custom module path, a folder outside the
//   project). It is said, with its reason, and never blocks a start.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun']);
const DIR_FLAGS = Object.freeze({ npm: ['--prefix', '-C'], pnpm: ['--dir', '-C', '--prefix'], yarn: ['--cwd'], bun: ['--cwd'] });
// Words that are not a locally installed tool when they start a script.
const NOT_LOCAL = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'sh', 'bash', 'cd', 'echo', 'env', 'cross-env', 'export', 'set', 'docker', 'php', 'python', 'python3', 'make', 'rm', 'cp', 'mkdir', 'true', 'exec', 'time', 'sudo']);
// Tools whose package has another name.
const TOOL_PACKAGES = Object.freeze({ ng: '@angular/cli', nest: '@nestjs/cli', 'vue-cli-service': '@vue/cli-service', tsc: 'typescript', 'react-scripts': 'react-scripts' });
const exists = async (file) => { try { await lstat(file); return true; } catch { return false; } };
const baseName = (program) => path.basename(String(program)).replace(/\.(cmd|exe|bat)$/i, '').toLowerCase();

// → { manager, dir (relative to cwd), script } for a package-manager command, else null.
export function parsePackageCommand(command) {
  const manager = baseName(command[0]);
  if (manager === 'npx') return { manager: 'npm', dir: '.', script: null, npx: true };
  if (!MANAGERS.includes(manager)) return null;
  let dir = '.';
  const words = [];
  for (let index = 1; index < command.length; index++) {
    const arg = command[index];
    if (arg === '--') break;
    const flag = DIR_FLAGS[manager].find((name) => arg === name || arg.startsWith(`${name}=`));
    if (flag) {
      if (arg === flag) { dir = command[index + 1] ?? '.'; index += 1; } else dir = arg.slice(flag.length + 1);
      continue;
    }
    if (arg.startsWith('-')) continue;
    words.push(arg);
  }
  // `npm run x`, `npm start`, `yarn x`, `pnpm x`, `bun run x`
  let script = null;
  if (['run', 'run-script'].includes(words[0])) script = words[1] ?? null;
  else if (['start', 'test', 'dev', 'serve', 'build'].includes(words[0])) script = words[0];
  else if (manager !== 'npm' && words[0] && !['install', 'add', 'remove', 'exec', 'dlx', 'x', 'create', 'init', 'ci'].includes(words[0])) script = words[0];
  return { manager, dir, script, npx: false };
}

async function readPackage(dir) {
  try {
    const info = await lstat(path.join(dir, 'package.json'));
    if (!info.isFile() || info.size > 2 * 1024 * 1024) return null;
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null;
  } catch {
    return null;
  }
}

// The package manager the project uses and its install command, from the lockfile beside
// package.json (then the `packageManager` field, then the manager that starts the service).
export async function installCommand(dir, pkg, startedWith = 'npm') {
  const has = (name) => exists(path.join(dir, name));
  const declared = /^(npm|pnpm|yarn|bun)@(\d+)/.exec(String(pkg?.packageManager ?? ''));
  if (await has('pnpm-lock.yaml')) return { manager: 'pnpm', lockfile: 'pnpm-lock.yaml', argv: ['pnpm', 'install', '--frozen-lockfile'] };
  if (await has('yarn.lock')) {
    // Yarn 2+ renamed the flag; the version is known only from packageManager.
    const modern = declared?.[1] === 'yarn' && Number(declared[2]) >= 2;
    return { manager: 'yarn', lockfile: 'yarn.lock', argv: ['yarn', 'install', modern ? '--immutable' : '--frozen-lockfile'] };
  }
  if ((await has('bun.lock')) || (await has('bun.lockb'))) return { manager: 'bun', lockfile: (await has('bun.lock')) ? 'bun.lock' : 'bun.lockb', argv: ['bun', 'install', '--frozen-lockfile'] };
  if ((await has('package-lock.json')) || (await has('npm-shrinkwrap.json'))) return { manager: 'npm', lockfile: (await has('package-lock.json')) ? 'package-lock.json' : 'npm-shrinkwrap.json', argv: ['npm', 'ci', '--include=dev'] };
  // No lockfile: a plain install (it creates one; said to the developer).
  const manager = declared?.[1] ?? (MANAGERS.includes(startedWith) ? startedWith : 'npm');
  return { manager, lockfile: null, argv: [manager, 'install'] };
}

// Installed dependencies in dir or a folder above it, never above `top` (hoisted workspaces).
async function findUp(dir, top, relative) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (await exists(path.join(current, relative))) return current;
    if (current === top || current === path.dirname(current) || !current.startsWith(top)) return null;
  }
}

// cwd: the service's resolved working folder. top: the folder nothing above which is looked at
// (the repository, or the personal service's own folder).
export const READY = 'READY';
export const NEEDS_SETUP = 'NEEDS_SETUP';
export const UNKNOWN = 'UNKNOWN';
// Why a check could not tell; the console words each one for the reader.
export const UNKNOWN_REASONS = Object.freeze(['not-checked', 'unsupported-command', 'folder-missing', 'outside-project', 'no-package-json', 'yarn-pnp', 'custom-module-path']);
const unknown = (reason, detail) => ({ state: UNKNOWN, ok: true, problems: [], reason, ...(detail ? { detail } : {}) });

export async function checkPrerequisites(service, { cwd, top }) {
  const problems = [];
  if (service.kind !== 'process') return unknown('not-checked');
  const parsed = parsePackageCommand(service.command);
  if (!parsed) return unknown('unsupported-command');
  let dir;
  try { dir = await realpath(path.resolve(cwd, parsed.dir)); } catch { return unknown('folder-missing'); }
  const realTop = await realpath(top).catch(() => top);
  if (dir !== realTop && !dir.startsWith(`${realTop}${path.sep}`)) return unknown('outside-project');
  const pkg = await readPackage(dir);
  if (!pkg) return unknown('no-package-json');
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (!Object.keys(declared).length) return { state: READY, ok: true, problems };
  // Yarn Plug'n'Play keeps no node_modules by design.
  if ((await findUp(dir, realTop, '.pnp.cjs')) || (await findUp(dir, realTop, '.pnp.loader.mjs'))) return unknown('yarn-pnp');
  // A service that points Node at its own module folder (NODE_PATH) resolves packages where
  // this check does not look: a custom setup is never called missing.
  if ((service.env ?? []).includes('NODE_PATH')) return unknown('custom-module-path', 'NODE_PATH');
  const where = path.relative(realTop, dir) || '.';
  const install = await installCommand(dir, pkg, parsed.manager);
  const fix = {
    argv: install.argv,
    cwd: where,
    display: `${where === '.' ? '' : `cd ${where} && `}${install.argv.join(' ')}`,
    manager: install.manager,
    lockfile: install.lockfile,
    // A frozen install changes neither package.json nor the lockfile.
    changesLockfile: install.lockfile === null,
    hash: createHash('sha256').update(JSON.stringify({ argv: install.argv, cwd: where })).digest('hex')
  };
  if (!(await findUp(dir, realTop, 'node_modules'))) {
    problems.push({ code: 'DEPENDENCIES_MISSING', dir: where, message: `The dependencies of ${where === '.' ? 'this project' : where} are not installed (no node_modules folder), so ${service.id} cannot start.`, fix });
    return { state: NEEDS_SETUP, ok: false, problems };
  }
  const text = parsed.script && typeof pkg.scripts?.[parsed.script] === 'string' ? pkg.scripts[parsed.script] : null;
  const tool = text ? /^\s*([A-Za-z0-9@][A-Za-z0-9._/@-]*)/.exec(text.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''))?.[1] : null;
  if (tool && !NOT_LOCAL.has(tool) && !tool.includes('/') && !(await findUp(dir, realTop, path.join('node_modules', '.bin', tool)))) {
    // Only a tool the package itself declares is called missing (anything else may be global).
    const owner = Object.keys(declared).find((name) => name === tool || name.endsWith(`/${tool}`) || TOOL_PACKAGES[tool] === name);
    if (owner) problems.push({ code: 'LOCAL_TOOL_MISSING', dir: where, tool, package: owner, message: `The script "${parsed.script}" starts ${tool}, which ${owner} provides, and it is not installed in ${where === '.' ? 'this project' : where}.`, fix });
  }
  return { state: problems.length ? NEEDS_SETUP : READY, ok: problems.length === 0, problems };
}
