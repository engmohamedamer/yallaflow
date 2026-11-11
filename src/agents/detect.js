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

async function isExecutable(file) {
  try {
    const info = await stat(file);
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// PATH lookup without a shell.
export async function which(name, env = process.env) {
  if (name.includes('/')) return (await isExecutable(name)) ? name : null;
  // PF-0123: only absolute PATH entries (a relative one like `.` would pick up a repository's own program).
  for (const dir of String(env.PATH ?? '').split(path.delimiter).filter((entry) => entry && path.isAbsolute(entry))) {
    const candidate = path.join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export function run(file, args, { timeoutMs = 8000, env = process.env } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, env, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
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
  const result = { provider: 'codex', codex: null, adapter: null, ready: false, problems: [] };
  if (!codex) result.problems.push('Codex CLI (`codex`) is not installed or not on PATH.');
  // PF-0123: an override that names a missing file is not an installed Codex.
  else if (!(await isExecutable(codex))) result.problems.push(`Codex CLI was not found at ${codex}.`);
  else {
    const version = await run(codex, ['--version'], { env });
    result.codex = { path: codex, version: (parseVersion(version.stdout) ?? []).join('.') || null };
  }
  if (!adapter) result.problems.push('The Codex ACP adapter (`codex-acp`, npm @agentclientprotocol/codex-acp) is not installed.');
  else if (!(await isExecutable(adapter))) result.problems.push(`The Codex ACP adapter was not found at ${adapter}.`);
  else {
    const version = await adapterPackageVersion(adapter);
    const parsed = parseVersion(version);
    result.adapter = { path: adapter, version };
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
