// Bounded execution-input fingerprints, not a transitive application-code sandbox.
// Only hashes leave this module; script text and environment values are never stored.
// PF-0072: the same inputs are covered for a personal service whose folder is outside the
// repository (inside the home folder), Compose files are read to also cover the Dockerfiles
// of their build contexts, and anything that materially affects execution but cannot be
// read with certainty is *blocking*: trust and start refuse it (owner requirement S1).
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { composeArgs, readCompose } from './compose.js';

const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'fish']);
const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml', 'compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yaml', 'docker-compose.override.yml'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const unsafe = () => Object.assign(new Error('A runtime trust input is unsafe, unreadable, outside the checkout, or too large; review the service inputs.'), { code: 'RUNTIME_TRUST_INPUT' });

// The folder a service's inputs are read from: the repository, or (personal services only,
// validated by the profile) an absolute folder inside the home folder.
export async function inputBase(root, service) {
  if (!path.isAbsolute(service.cwd)) return realpath(root);
  let home;
  let folder;
  try { home = await realpath(os.homedir()); folder = await realpath(service.cwd); } catch { throw unsafe(); }
  if (!folder.startsWith(`${home}${path.sep}`)) throw unsafe();
  return folder;
}

export async function executionInputs(root, service) {
  const review = await executionReview(root, service);
  if (review.blocking.length) throw Object.assign(new Error(`Not trusted until resolved: ${review.blocking.map((entry) => entry.reason).join('; ')}.`), { code: 'RUNTIME_TRUST_BLOCKED', blocking: review.blocking });
  return review.entries;
}

// → { entries: [[relative path, hash|null]], covered: [path], notCovered: [{ what, why }], blocking: [{ item, reason }] }
export async function executionReview(root, service) {
  const base = await inputBase(root, service);
  const cwd = path.resolve(base, path.isAbsolute(service.cwd) ? '.' : service.cwd);
  const inside = (file) => file === base || file.startsWith(`${base}${path.sep}`);
  if (!inside(cwd)) throw unsafe();
  const inputs = new Map();
  const contents = new Map();
  const notCovered = [];
  const blocking = [];
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
    if (content) contents.set(file, content);
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
  // PF-0072 review finding 6: Compose reads `.env` (and --env-file files) for variable values,
  // the project name and COMPOSE_FILE. Their content holds secrets and is never read: the
  // trust is bound to their file metadata (size, modification time, inode), so any edit ends
  // it. Compose/Docker settings passed by name are bound to a digest of their value.
  if (compose) {
    const parsed = composeArgs(args);
    const project = parsed.projectDirectory ? path.resolve(cwd, parsed.projectDirectory) : cwd;
    const envFiles = [path.join(project, '.env'), ...parsed.envFiles.map((file) => path.resolve(cwd, file))];
    for (const file of envFiles) {
      let info = null;
      try { info = await lstat(file); } catch { info = null; }
      const key = `${path.relative(base, file) || '.env'} (metadata)`;
      if (!inside(file)) { if (info) blocking.push({ item: key, reason: `${file} is outside the folder this trust covers` }); continue; }
      inputs.set(key, info ? digest(`${info.isSymbolicLink() ? 'link' : 'file'}:${info.size}:${info.mtimeMs}:${info.ino}`) : null);
    }
    for (const name of ['COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES', 'COMPOSE_PATH_SEPARATOR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) {
      if (service.env.includes(name)) inputs.set(`env:${name}`, digest(`${process.env[name] ?? ''}`));
    }
  }
  // The Dockerfiles of the build contexts the used Compose files declare (PF-0072).
  if (compose) {
    for (const [file, content] of [...contents]) {
      if (!/(^|[/\\])(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(file) && !args.some((arg) => path.resolve(cwd, arg) === file)) continue;
      const parsed = readCompose(content.toString('utf8'));
      const where = path.relative(base, file) || path.basename(file);
      for (const entry of parsed.problems.filter((item) => item.blocking)) blocking.push({ item: where, reason: `${where}${entry.line ? `:${entry.line}` : ''}: ${entry.reason}` });
      for (const svc of Object.values(parsed.services)) {
        if (svc.image && !svc.build) notCovered.push({ what: `image ${svc.image} (${svc.id})`, why: 'pulled from a registry; its content is not part of this fingerprint' });
        for (const envFile of svc.envFiles) notCovered.push({ what: `${envFile} (${svc.id})`, why: 'an env file holds secrets and is never read' });
        if (!svc.build || svc.build.context === null || svc.build.inline) continue;
        const context = path.resolve(path.dirname(file), svc.build.context);
        if (!inside(context)) { blocking.push({ item: svc.id, reason: `${where}: service ${svc.id} builds from ${svc.build.context}, outside the folder this trust covers` }); continue; }
        const dockerfile = path.resolve(context, svc.build.dockerfile ?? 'Dockerfile');
        if (!inside(dockerfile)) { blocking.push({ item: svc.id, reason: `${where}: service ${svc.id} uses a Dockerfile outside the folder this trust covers` }); continue; }
        await add(dockerfile);
        if (inputs.get(path.relative(base, dockerfile)) === null) blocking.push({ item: svc.id, reason: `${where}: the Dockerfile of service ${svc.id} (${path.relative(base, dockerfile)}) is missing` });
        notCovered.push({ what: `files the ${svc.id} Dockerfile copies (${path.relative(base, context) || '.'})`, why: 'application files are outside this fingerprint' });
      }
      try { await lstat(path.join(path.dirname(file), '.env')); notCovered.push({ what: path.relative(base, path.join(path.dirname(file), '.env')) || '.env', why: 'Compose reads it for variable values; it holds secrets and is never read — its content is not covered, but any edit to it (size, time) ends the trust' }); } catch { /* none */ }
    }
  }
  const entries = [...inputs].sort(([a], [b]) => a.localeCompare(b));
  return { base, entries, covered: entries.filter(([, hash]) => hash !== null).map(([file]) => file), notCovered, blocking };
}
