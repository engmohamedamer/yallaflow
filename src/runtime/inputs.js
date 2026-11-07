// Bounded execution-input fingerprints, not a transitive application-code sandbox.
// Only hashes leave this module; script text and environment values are never stored.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'fish']);
const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml', 'compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yaml', 'docker-compose.override.yml'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const unsafe = () => Object.assign(new Error('A runtime trust input is unsafe, unreadable, outside the checkout, or too large; review the service inputs.'), { code: 'RUNTIME_TRUST_INPUT' });

export async function executionInputs(root, service) {
  const base = await realpath(root);
  const cwd = path.resolve(base, service.cwd);
  const inside = (file) => file === base || file.startsWith(`${base}${path.sep}`);
  if (!inside(cwd)) throw unsafe();
  const inputs = new Map();
  async function bytes(file, probe = false) {
    if (!inside(file)) throw unsafe();
    const relative = path.relative(base, file);
    let current = base;
    try {
      for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink() || (current !== file && !info.isDirectory())) throw unsafe();
      }
      const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || (!probe && info.size > 2 * 1024 * 1024)) throw unsafe();
        if (probe) {
          const buffer = Buffer.alloc(256);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          return buffer.subarray(0, bytesRead);
        }
        return await handle.readFile();
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw unsafe();
    }
  }
  async function add(file, scripts = false) {
    file = path.resolve(file);
    const content = await bytes(file);
    let value = content;
    if (scripts && content) {
      try { value = Buffer.from(JSON.stringify(canonical(JSON.parse(content.toString('utf8')).scripts ?? {}))); }
      catch { throw unsafe(); }
    }
    inputs.set(path.relative(base, file), value === null ? null : digest(value));
  }
  const [executable, ...args] = service.command;
  const name = path.basename(executable);
  const folders = new Set([cwd]);
  const manager = ['npm', 'pnpm', 'yarn', 'bun', 'composer'].includes(name);
  const compose = service.kind === 'docker-compose' || name === 'docker-compose' || (name === 'docker' && args.includes('compose'));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const flags = [...(manager ? ['--prefix', '--cwd', '--dir', '-C', '--working-dir', ...(name === 'composer' ? ['-d'] : [])] : []), ...(compose ? ['--project-directory'] : [])];
    const flag = flags.find((value) => arg === value || arg.startsWith(`${value}=`));
    if (flag) {
      const value = arg === flag ? args[++i] : arg.slice(flag.length + 1);
      if (!value) throw unsafe();
      const selected = path.resolve(cwd, value);
      if (!inside(selected)) throw unsafe();
      folders.add(selected);
    }
  }
  // Cover scripts and default Compose files in each selected repository ancestry.
  for (const folder of folders) for (let dir = folder; ; dir = path.dirname(dir)) {
    for (const input of ['package.json', 'composer.json']) await add(path.join(dir, input), true);
    for (const input of COMPOSE) await add(path.join(dir, input));
    if (dir === base) break;
  }
  if (SHELLS.has(name)) {
    // Shell options end at the script operand. A script's own '-c' argument is data.
    let script;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') { script = args[i + 1]; break; }
      if (!arg.startsWith('-')) { script = arg; break; }
      if (/^-[^-]*c/.test(arg) || arg === '-s') break;
      if (['-o', '-O'].includes(arg)) { i++; continue; }
      if (['--rcfile', '--init-file'].includes(arg)) { if (!args[i + 1]) throw unsafe(); await add(path.resolve(cwd, args[++i])); }
    }
    if (script) await add(path.resolve(cwd, script));
  } else if (executable.includes('/') && inside(path.resolve(cwd, executable))) {
    const file = path.resolve(cwd, executable);
    const head = await bytes(file, true);
    if (/\.sh$/.test(file) || (head && /^#![^\n]*\b(?:sh|bash|dash|zsh|ksh|fish)\b/.test(head.toString('utf8')))) await add(file);
  }
  if (compose) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const selected = arg === '-f' || arg === '--file' ? args[++i] : arg.startsWith('--file=') ? arg.slice(7) : arg.startsWith('-f') && arg.length > 2 ? arg.slice(2) : null;
      if (selected) { if (selected === '-') throw unsafe(); await add(path.resolve(cwd, selected)); }
    }
    if (service.env.includes('COMPOSE_FILE') && process.env.COMPOSE_FILE) {
      const separator = service.env.includes('COMPOSE_PATH_SEPARATOR') ? process.env.COMPOSE_PATH_SEPARATOR || path.delimiter : path.delimiter;
      for (const selected of process.env.COMPOSE_FILE.split(separator).filter(Boolean)) await add(path.resolve(cwd, selected));
    }
  }
  return [...inputs].sort(([a], [b]) => a.localeCompare(b));
}
