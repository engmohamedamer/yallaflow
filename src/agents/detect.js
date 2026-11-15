// Provider detection (v1.3.0). Finds the user's own installed tools and reports versions
// and subscription status from each provider's official CLI. It never reads credential
// files, tokens, or keychains, and never logs in or out.
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

// Minimum versions with the features the bridge relies on (see CAPABILITY_MATRIX.md).
export const REQUIREMENTS = Object.freeze({
  codexAcp: { min: [2, 5, 0], maxMajor: 2 }
});

// PF-0124: the exact versions the console offers to install, because they were tested together
// with this YallaFlow release (a real handshake-only connection test plus the agent test suite).
// Updating them: docs/agents.md "Tested Codex versions". A test keeps them inside REQUIREMENTS.
export const TESTED_CODEX = Object.freeze({
  cli: Object.freeze({ package: '@openai/codex', version: '0.167.0' }),
  adapter: Object.freeze({ package: '@agentclientprotocol/codex-acp', version: '2.5.0' }),
  testedAt: '2026-11-11'
});

export function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''));
  return match ? match.slice(1, 4).map(Number) : null;
}

export function versionAtLeast(version, min) {
  if (!version) return false;
  for (let index = 0; index < 3; index++) {
    if (version[index] !== min[index]) return version[index] > min[index];
  }
  return true;
}

// ---------------------------------------------------------------- finding and starting programs
// POSIX: a regular file with an execute bit, found by its bare name on PATH.
// Windows (PF-0148): files carry no execute bits and programs have an extension, so a program
// is a regular file whose extension YallaFlow can start (.exe, .com, and the .cmd/.bat shims
// npm installs), found by trying the PATHEXT extensions in each PATH folder. The PATH variable
// is read whatever its case (Windows usually names it "Path"). No shell is ever used.
// Windows behavior here is exercised with simulated paths only; it is not verified on Windows.
const WINDOWS_LAUNCHABLE = Object.freeze(['.exe', '.com', '.cmd', '.bat']);
const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);

async function regularFile(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}
async function posixExecutable(file) {
  try {
    const info = await stat(file);
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// An environment variable by name; on Windows whatever its case (PATH, Path, path).
export function envValue(env, name, platform = process.platform) {
  if (platform !== 'win32') return env?.[name];
  if (typeof env?.[name] === 'string') return env[name];
  const key = Object.keys(env ?? {}).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

// The extensions tried for a bare name on Windows: PATHEXT's order, limited to what can be started.
export function programExtensions(env, platform = process.platform) {
  if (platform !== 'win32') return [''];
  const listed = String(envValue(env, 'PATHEXT', platform) ?? '').split(';').map((entry) => entry.trim().toLowerCase()).filter((entry) => WINDOWS_LAUNCHABLE.includes(entry));
  return listed.length ? [...new Set(listed)] : [...WINDOWS_LAUNCHABLE];
}

export async function isExecutable(file, { platform = process.platform, isFile = regularFile } = {}) {
  if (platform !== 'win32') return posixExecutable(file);
  return WINDOWS_LAUNCHABLE.includes(pathFor(platform).extname(String(file)).toLowerCase()) && (await isFile(file));
}

// PATH lookup without a shell.
export async function which(name, env = process.env, { platform = process.platform, isFile = regularFile } = {}) {
  const p = pathFor(platform);
  const check = (file) => isExecutable(file, { platform, isFile });
  if (name.includes('/') || (platform === 'win32' && name.includes('\\'))) return (await check(name)) ? name : null;
  const names = platform !== 'win32' ? [name]
    : WINDOWS_LAUNCHABLE.includes(p.extname(name).toLowerCase()) ? [name] : programExtensions(env, platform).map((extension) => `${name}${extension}`);
  // PF-0123: only absolute PATH entries (a relative one like `.` would pick up a repository's own program).
  const folders = String(envValue(env, 'PATH', platform) ?? '').split(p.delimiter).map((entry) => entry.trim().replace(/^"(.*)"$/, '$1')).filter((entry) => entry && p.isAbsolute(entry));
  for (const dir of folders) {
    for (const candidate of names) {
      const file = p.join(dir, candidate);
      if (await check(file)) return file;
    }
  }
  return null;
}

// What to start for a program, as { file, args }, never through a shell.
// A Windows .cmd/.bat file cannot be started without one, so the shim npm writes is read and
// the program it points to is started directly: its script with node, or its own .exe. The
// target must be a real file inside the shim's own folder. Any other command script is
// refused with a plain reason (error.code SHIM_UNSUPPORTED) instead of being run by a shell.
export async function launchSpec(file, args = [], { platform = process.platform, isFile = regularFile, readText = (target) => readFile(target, 'utf8'), node = process.execPath } = {}) {
  const p = pathFor(platform);
  if (platform !== 'win32' || !['.cmd', '.bat'].includes(p.extname(String(file)).toLowerCase())) return { file, args: [...args] };
  const refuse = () => Object.assign(new Error(`${p.basename(file)} is a Windows command script that YallaFlow cannot start safely (it never uses a shell). Reinstall the program with npm, or install its native version.`), { code: 'SHIM_UNSUPPORTED' });
  let text;
  try { text = String(await readText(file)).slice(0, 65_536); } catch { throw refuse(); }
  const base = p.dirname(file);
  const targets = [...text.matchAll(/%~?dp0%?[\\/]([^"\r\n%*]+?\.(?:exe|[cm]?js))(?=["\s]|$)/gim)].map((found) => found[1]).filter((relative) => p.basename(relative).toLowerCase() !== 'node.exe');
  const relative = targets.at(-1);
  if (!relative) throw refuse();
  const target = p.resolve(base, relative);
  const inside = target.toLowerCase().startsWith(`${base.toLowerCase().replace(/[\\/]+$/, '')}${p.sep}`);
  if (!inside || !(await isFile(target))) throw refuse();
  if (p.extname(target).toLowerCase() === '.exe') return { file: target, args: [...args] };
  const beside = p.join(base, 'node.exe');
  return { file: (await isFile(beside)) ? beside : node, args: [target, ...args] };
}

export async function run(file, args, { timeoutMs = 8000, env = process.env, platform = process.platform } = {}) {
  let spec;
  try { spec = await launchSpec(file, args, { platform }); } catch (error) { return { ok: false, stdout: '', stderr: error.message, launchError: error.code ?? 'LAUNCH_FAILED' }; }
  return new Promise((resolve) => {
    try {
      execFile(spec.file, spec.args, { timeout: timeoutMs, env, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), ...(error && typeof error.code === 'string' ? { launchError: error.code } : {}) });
      });
    } catch (error) {
      // A program that cannot be started at all is an answer, never a crash.
      resolve({ ok: false, stdout: '', stderr: String(error.message ?? error), launchError: error.code ?? 'LAUNCH_FAILED' });
    }
  });
}

// The adapter's own package.json (it is a user-installed npm package).
async function adapterPackageVersion(binary) {
  try {
    let dir = path.dirname(await realpath(binary));
    for (let depth = 0; depth < 5; depth++) {
      try {
        const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name === '@agentclientprotocol/codex-acp') return pkg.version ?? null;
      } catch {
        // keep walking up
      }
      dir = path.dirname(dir);
    }
  } catch {
    return null;
  }
  return null;
}

export async function detectCodex(env = process.env) {
  const codex = env.YALLAFLOW_CODEX_BIN || (await which('codex', env));
  const adapter = env.YALLAFLOW_CODEX_ACP || (await which('codex-acp', env));
  const cannotStart = (name, error) => `${name} was found but cannot be started: ${error.message}`;
  const result = { provider: 'codex', codex: null, adapter: null, ready: false, problems: [] };
  if (!codex) result.problems.push('Codex CLI (`codex`) is not installed or not on PATH.');
  // PF-0123: an override that names a missing file is not an installed Codex.
  else if (!(await isExecutable(codex))) result.problems.push(`Codex CLI was not found at ${codex}.`);
  else {
    const version = await run(codex, ['--version'], { env });
    result.codex = { path: codex, version: (parseVersion(version.stdout) ?? []).join('.') || null };
    // What a job that runs Codex itself starts (its sign-in): the program, or a shim's target.
    try { result.codex.launch = await launchSpec(codex, []); } catch (error) { result.problems.push(cannotStart('Codex CLI', error)); }
  }
  if (!adapter) result.problems.push('The Codex ACP adapter (`codex-acp`, npm @agentclientprotocol/codex-acp) is not installed.');
  else if (!(await isExecutable(adapter))) result.problems.push(`The Codex ACP adapter was not found at ${adapter}.`);
  else {
    // The adapter is started as { file, args } (a Windows shim's target with node), never by a shell.
    let launch = null;
    try { launch = await launchSpec(adapter, []); } catch (error) { result.problems.push(cannotStart('The Codex ACP adapter', error)); }
    const version = await adapterPackageVersion(launch?.args[0] ?? adapter);
    const parsed = parseVersion(version);
    result.adapter = { path: adapter, version, ...(launch ? { launch } : {}) };
    if (parsed && (!versionAtLeast(parsed, REQUIREMENTS.codexAcp.min) || parsed[0] > REQUIREMENTS.codexAcp.maxMajor)) {
      result.problems.push(`codex-acp ${version} is not supported; install a 2.x version from 2.5.0.`);
    }
  }
  // Subscription status is checked when a session starts, from the adapter's own report.
  result.ready = result.problems.length === 0;
  return result;
}

const cache = new Map();
export async function detectProviders({ env = process.env, maxAgeMs = 30_000, claude = false } = {}) {
  const key = claude ? 'both' : 'codex';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  // Claude detection exists only in development builds (see experimental.js).
  const value = { codex: await detectCodex(env), ...(claude ? { claude: await (await import('./claude-detect.js')).detectClaude(env) } : {}) };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearDetectionCache() {
  cache.clear();
}
