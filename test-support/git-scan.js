// PF-0112 C10 (owner Checkpoint C, SRC-0058): the static scan behind test 51. It finds every
// way YallaFlow's source starts Git or another program, and checks the Git subcommand (the first
// argument that is not an option; `-c <anything>` is skipped whole).
//
// Hardened after the independent review (M9, 2026-11-10). It now also sees:
// - single, double and template quotes;
// - any function whose first argument is the literal 'git' (runQuiet('git', …), spawn("git", …));
// - Git wrappers git(<any expression>, […]) and git(x, argsVariable);
// - `-c` followed by a non-literal;
// - shell execution (exec/execSync, shell: true, sh/bash -c);
// - programs chosen at run time (spawn(variable, …)): every file that does this is a reviewed
//   exception listed below, so a new one fails the test until it is reviewed;
// - write forms of config, symbolic-ref and --output, everywhere.
// It remains a static scan: it cannot follow values across files. The runtime boundary is
// git-ops.js itself (argument validation, fixed prefix, neutralised drivers).
// Lives outside test/ because node --test loads every file under test/.
import path from 'node:path';

// Read-only everywhere. `log` (src/core/collisions.js), `var` (attribute file names) and `rev-list`
// (the objects a lane adds) are read-only.
export const READ_ONLY = Object.freeze(['status', 'rev-parse', 'diff', 'ls-files', 'ls-tree', 'check-ignore', 'symbolic-ref', 'config', 'cat-file', 'merge-base', 'log', 'var', 'rev-list']);
export const GIT_OPS = path.join('execution', 'git-ops.js');
// Approved mutating shapes G1–G10, only in src/execution/git-ops.js.
export const GIT_OPS_ALLOWED = Object.freeze([...READ_ONLY, 'worktree', 'merge-tree', 'read-tree', 'add', 'write-tree', 'commit-tree', 'commit', 'merge']);
// Wrappers that pass an argument list through. Their callers are scanned as wrapper calls.
// history/lineage.js: entries(args) is called only with ls-files / ls-tree lists.
const DYNAMIC_WRAPPERS = new Set([path.join('shared', 'git.js'), path.join('history', 'source.js'), path.join('history', 'lineage.js'), path.join('core', 'workspace.js'), GIT_OPS]);
const INIT_FILES = new Set([path.join('newproject', 'project.js'), path.join('console', 'greenfield.js')]);
// Reviewed files that start a program chosen at run time (never Git): verification commands,
// agents, runtime services, the browser opener, tool probes, merge checks, the CLI itself.
export const DYNAMIC_PROGRAMS = new Set(['commands/console.js', 'commands/verify.js', 'agents/detect.js', 'agents/acp.js', 'runtime/supervisor.js', 'runtime/observe.js', 'console/runner.js', 'console/greenfield.js', 'execution/merge.js', 'newproject/project.js'].map((entry) => entry.split('/').join(path.sep)));
// The only shell: `yallaflow verify --shell`, the developer's own explicit choice.
const SHELL_FILES = new Set([path.join('commands', 'verify.js')]);
const GIT_SUBCOMMANDS = new Set(['init', 'clone', 'push', 'pull', 'fetch', 'rebase', 'reset', 'revert', 'cherry-pick', 'stash', 'clean', 'checkout', 'switch', 'restore', 'branch', 'tag', 'update-ref', 'gc', 'prune', 'remote', 'am', 'apply', 'rm', 'mv', 'notes', 'replace', 'filter-branch', 'maintenance', 'worktree', 'merge', 'commit', 'add', 'read-tree', 'write-tree', 'commit-tree', 'merge-tree']);
const Q = `(?:'|"|\`)`;
const LIT = /^(['"`])((?:(?!\1)[^\\]|\\.)*)\1$/;

// The top-level elements of an array literal's inner text, as { literal, text }.
export function elementsOf(arrayText) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let index = 0; index < arrayText.length; index++) {
    const char = arrayText[index];
    if (quote) {
      current += char;
      if (char === '\\') { current += arrayText[++index] ?? ''; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) depth--;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map((text) => {
    const match = LIT.exec(text);
    return match && !(match[1] === '`' && match[2].includes('${')) ? { literal: match[2], text } : { literal: null, text };
  });
}

// → { sub, rest } or { sub: null } when the subcommand is not a literal.
// `-c key=value` settings that make Git run a program (or redirect what it reads). Only the
// safe values YallaFlow sets itself are accepted (review re-verification).
const SAFE_C = /^(?:core\.fsmonitor=false|core\.hooksPath=\/dev\/null|core\.untrackedCache=false|gc\.auto=0|maintenance\.auto=false|diff\.ignoreSubmodules=all|submodule\.recurse=false|core\.quotepath=(?:false|off)|color\.ui=(?:false|never)|advice\.[\w.]+=false|log\.showSignature=false)$/i;
let unsafeC = [];
function parseArgv(arrayText) {
  const elements = elementsOf(arrayText);
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (element.text.startsWith('...')) continue; // a spread prefix (GIT_PREFIX, SAFE_GIT): options only
    if (element.literal === '-c') { const value = elements[index + 1]; if (!value || value.literal === null || !SAFE_C.test(value.literal)) unsafeC.push(value?.literal ?? value?.text ?? '?'); index++; continue; }
    if (element.literal !== null && element.literal.startsWith('-')) continue;
    return { sub: element.literal, rest: elements.slice(index + 1), computed: element.literal === null };
  }
  return { sub: null, rest: [], computed: false };
}
export function subcommandOf(arrayText) {
  return parseArgv(arrayText).sub;
}

// Write forms of otherwise read-only subcommands.
function writeForm(sub, rest) {
  const literals = rest.map((element) => element.literal);
  if (literals.some((value) => value !== null && /^--output(=|$)/.test(value))) return `${sub} --output`;
  const positional = rest.filter((element) => element.literal === null || !element.literal.startsWith('-'));
  if (sub === 'config') {
    if (literals.some((value) => ['--global', '--system', '--local', '--worktree', '--file', '-f', '--unset', '--unset-all', '--add', '--replace-all', '--rename-section', '--remove-section', '--edit', '-e'].includes(value))) return 'config (write option)';
    if (!literals.some((value) => value !== null && /^(--get|--get-all|--get-regexp|--list|-l|--name-only)/.test(value)) && positional.length >= 2) return 'config <key> <value>';
  }
  if (sub === 'symbolic-ref' && positional.length >= 2) return 'symbolic-ref <ref> <target>';
  return null;
}

// → offenders for one source file (`relative` to src/).
export function scanGitCalls(relative, text) {
  const name = path.basename(relative);
  const offenders = [];
  const permitted = new Set(relative === GIT_OPS ? GIT_OPS_ALLOWED : READ_ONLY);
  const check = (arrayText, how) => {
    unsafeC = [];
    const { sub, rest, computed } = parseArgv(arrayText);
    for (const value of unsafeC) offenders.push(`${name}: git -c ${value} (${how}): only the known safe settings may be passed`);
    if (computed && !DYNAMIC_WRAPPERS.has(relative)) { offenders.push(`${name}: git with a computed subcommand (${how})`); return; }
    if (sub === null) return;
    if (!permitted.has(sub)) { offenders.push(`${name}: git ${sub}${how ? ` (${how})` : ''}`); return; }
    const write = writeForm(sub, rest);
    if (write) offenders.push(`${name}: git ${write} (${how})`);
    // status and diff recurse into submodules unless told not to on the command line.
    if (['status', 'diff'].includes(sub) && !rest.some((element) => element.literal === '--ignore-submodules=all')) offenders.push(`${name}: git ${sub} without --ignore-submodules=all (${how})`);
  };
  // Any call whose first argument is the literal 'git', with a literal argv or a computed one.
  for (const match of text.matchAll(new RegExp(`\\b[\\w$.]+\\(\\s*${Q}git${Q}\\s*,\\s*\\[([^\\]]*)\\]`, 'g'))) check(match[1], 'spawn');
  // A literal list may start with the fixed safety prefix: [...SAFE_GIT, 'status', …] is literal.
  for (const match of text.matchAll(new RegExp(`\\b[\\w$.]+\\(\\s*${Q}git${Q}\\s*,\\s*(?!\\[\\s*(?:\\.\\.\\.(?:SAFE_GIT|GIT_PREFIX)\\s*,\\s*)?${Q})([A-Za-z_$][\\w$]*|\\[\\s*\\.\\.\\.)`, 'g'))) {
    if (!DYNAMIC_WRAPPERS.has(relative)) offenders.push(`${name}: git with a computed argument list outside the known wrappers`);
  }
  // Git wrappers: git(<any first argument>, [...]) and git(x, argsVariable).
  for (const match of text.matchAll(/(?<![\w$.])git\(\s*[^,()[\]]+?,\s*\[([^\]]*)\]/g)) check(match[1], 'wrapper');
  for (const match of text.matchAll(/(?<![\w$.])git\(\s*[^,()[\]]+?,\s*(?!\[)([A-Za-z_$][\w$]*)/g)) {
    if (!DYNAMIC_WRAPPERS.has(relative)) offenders.push(`${name}: git wrapper with a computed argument list (${match[1]})`);
  }
  // argv arrays that start with 'git' for a generic runner.
  for (const match of text.matchAll(new RegExp(`\\[\\s*${Q}git${Q}\\s*,([^\\]]*)\\]`, 'g'))) {
    const sub = subcommandOf(match[1]);
    if (sub === null || (!GIT_SUBCOMMANDS.has(sub) && !READ_ONLY.includes(sub))) continue; // a list of words, not an argv
    if (sub === 'init') { if (relative !== path.join('newproject', 'project.js')) offenders.push(`${name}: git init outside the approved GIT_INIT_ARGV`); continue; }
    check(match[1], 'argv');
  }
  if (/GIT_INIT_ARGV/.test(text) && !INIT_FILES.has(relative)) offenders.push(`${name}: uses GIT_INIT_ARGV`);
  if (relative === path.join('core', 'workspace.js')) for (const match of text.matchAll(/\[\['([a-z-]+)'|\], \['([a-z-]+)'/g)) { const sub = match[1] ?? match[2]; if (!READ_ONLY.includes(sub)) offenders.push(`${name}: git ${sub} (workspace)`); }
  // Shells: child_process exec/execSync (not RegExp#exec), shell: true, sh/bash -c.
  const importsShell = /import\s*\{[^}]*\b(?:exec|execSync)\b[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/.test(text) || /child_process['"]\)?\.(?:exec|execSync)\b/.test(text) || /\b(?:cp|childProcess|child_process)\.(?:exec|execSync)\(/.test(text);
  if (importsShell) offenders.push(`${name}: runs a shell command (child_process exec/execSync)`);
  if (/\bshell:\s*true\b/.test(text) && !SHELL_FILES.has(relative)) offenders.push(`${name}: starts a program through a shell (shell: true)`);
  if (new RegExp(`\\b(?:spawnSync|spawn|execFileSync|execFile)\\(\\s*${Q}(?:sh|bash|zsh|dash|cmd|cmd\\.exe|powershell|pwsh)${Q}`).test(text)) offenders.push(`${name}: starts a shell`);
  // Git or a shell named by path, and child_process functions reached by name (review re-verification).
  if (new RegExp(`${Q}(?:/usr)?(?:/local)?/s?bin/git${Q}`).test(text) && relative !== GIT_OPS) offenders.push(`${name}: starts Git by path`);
  if (new RegExp(`${Q}(?:/usr)?(?:/local)?/s?bin/(?:sh|bash|zsh|dash)${Q}`).test(text)) offenders.push(`${name}: starts a shell by path`);
  if (/\[\s*['"`](?:exec|execSync)['"`]\s*\]/.test(text)) offenders.push(`${name}: reaches child_process exec by name`);
  // Programs chosen at run time: only in reviewed files.
  if (/\b(?:spawnSync|spawn|execFileSync|execFile)\(\s*(?!['"`])[A-Za-z_$]/.test(text) && !DYNAMIC_PROGRAMS.has(relative) && relative !== GIT_OPS) offenders.push(`${name}: starts a program chosen at run time; review it and add it to DYNAMIC_PROGRAMS`);
  if (relative === GIT_OPS) offenders.push(...scanGitOps(text));
  return offenders;
}

// The approved shapes inside git-ops itself: no forbidden word as a string literal, worktree
// only add/remove, merge only --ff-only, config only read forms.
export function scanGitOps(text) {
  const offenders = [];
  for (const word of ['push', 'pull', 'fetch', 'rebase', 'reset', 'revert', 'cherry-pick', 'stash', 'clean', 'checkout', 'switch', 'restore', 'branch', 'tag', 'update-ref', 'gc', 'prune', 'remote', '--force', '-f', '--no-verify', '--hard', '-D']) {
    // The filter key names (filter.<n>.clean|smudge|process) are the one place 'clean' appears.
    const scanned = word === 'clean' ? text.replaceAll("['clean', 'smudge', 'process']", '') : text;
    for (const quote of ["'", '"', '`']) if (scanned.includes(`${quote}${word}${quote}`)) offenders.push(`git-ops.js: forbidden literal '${word}'`);
  }
  for (const match of text.matchAll(/\['worktree', '([a-z-]+)'/g)) if (!['add', 'remove'].includes(match[1])) offenders.push(`git-ops.js: git worktree ${match[1]}`);
  for (const match of text.matchAll(/\['merge', '([^']+)'/g)) if (match[1] !== '--ff-only') offenders.push(`git-ops.js: git merge ${match[1]}`);
  for (const match of text.matchAll(/\['config', '([^']+)'/g)) if (!['--get', '--get-regexp', '--list', '-z'].includes(match[1])) offenders.push(`git-ops.js: git config ${match[1]}`);
  if (!/GIT_PREFIX = Object\.freeze\(\['-c', 'core\.hooksPath=\/dev\/null', '-c', 'core\.fsmonitor=false', '-c', 'core\.untrackedCache=false', '-c', 'gc\.auto=0', '-c', 'maintenance\.auto=false', '-c', 'diff\.ignoreSubmodules=all', '--literal-pathspecs', '--no-pager'\]\)/.test(text)) offenders.push('git-ops.js: GIT_PREFIX is not the approved prefix');
  // git(), the driver-name read before each call (review H2–H4) and the version probe.
  if ((text.match(/spawnSync\(\s*'git'/g) ?? []).length !== 3) offenders.push('git-ops.js: Git must be started only by git(), the driver-name read and the version probe');
  return offenders;
}
