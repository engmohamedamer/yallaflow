// Workspace discovery (PF-0072): how an existing project actually runs. Read-only and
// bounded: the repository and up to three of its parent folders inside the home folder are
// searched for Compose files that mount or build the project; the web-server vhost folders
// those Compose files mount are read to learn the project's local domains. Nothing found is
// ever run, `.env` is never opened (its existence alone is noted), and environment values
// are never kept. Whatever lies outside that scope, or cannot be read with certainty, is
// reported as unresolved with the reason — never as absent.
//
// It also answers, at execution time, whether a service is shared infrastructure, from the
// evidence on disk now (owner requirement S3): a stored marker can only add protection.
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COMPOSE_NAMES, COMPOSE_OVERRIDES, composeArgs, composeProjectName, defaultComposeFiles, looksLikeInfrastructure, mergeCompose, readCompose } from './compose.js';
import { observeRuntime, portOwner, runningContainersOf } from './observe.js';
import { inventoryRepository } from '../inventory/inventory.js';
import { suggestServices } from './suggest.js';

export const MAX_UP_LEVELS = 3;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_FILES = 200;
const MAX_VHOST_FILES = 120;
const WEB_SERVER_PATH = /(^|\/)(apache2|httpd|nginx)(\/|$)/;

const inside = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);
const tilde = (file, home) => (inside(file, home) ? `~${file.slice(home.length)}` : file);

// A bounded, symlink-aware reader. → { text } | { skip: reason }
async function readBounded(file, scope, budget) {
  if (budget.files >= MAX_FILES) return { skip: 'the file limit for one analysis was reached' };
  let info;
  try { info = await lstat(file); } catch (error) { return { skip: error.code === 'ENOENT' ? 'missing' : 'not readable' }; }
  if (info.isSymbolicLink()) {
    let real;
    try { real = await realpath(file); } catch { return { skip: 'a symbolic link that leads nowhere' }; }
    if (!inside(real, scope)) return { skip: 'a symbolic link leading outside the scanned scope' };
    info = await lstat(real);
    file = real;
  }
  if (!info.isFile()) return { skip: 'not a regular file' };
  if (info.size > MAX_FILE_BYTES) return { skip: `larger than ${MAX_FILE_BYTES / 1024} KB` };
  budget.files += 1;
  try { return { text: await readFile(file, 'utf8') }; } catch { return { skip: 'not readable' }; }
}

// The repository, then its parents up to MAX_UP_LEVELS, never above the home folder.
export async function scanFolders(root, home) {
  const folders = [root];
  const limits = [];
  if (!inside(root, home)) { limits.push({ what: 'parent folders', why: 'the project is outside your home folder, so only the project itself was scanned' }); return { folders, limits }; }
  let dir = root;
  for (let level = 0; level < MAX_UP_LEVELS; level++) {
    const parent = path.dirname(dir);
    if (parent === dir || !inside(parent, home)) break;
    folders.push(parent);
    dir = parent;
  }
  const outer = path.dirname(dir);
  if (outer !== dir) limits.push({ what: `folders above ${tilde(dir, home)}`, why: inside(outer, home) ? `outside the scanned scope (${MAX_UP_LEVELS} levels up)` : 'outside your home folder' });
  return { folders, limits };
}

function expandHost(host, composeDir, home) {
  if (host === '~' || host.startsWith('~/')) return path.join(home, host.slice(1));
  return path.resolve(composeDir, host);
}

// Apache <VirtualHost> and nginx server blocks: names, document root, port.
export function parseVhosts(text) {
  const hosts = [];
  const apache = /<VirtualHost\s+([^>]*)>([\s\S]*?)<\/VirtualHost>/gi;
  for (const match of text.matchAll(apache)) {
    const body = match[2].replace(/^\s*#.*$/gm, '');
    const names = [...body.matchAll(/^\s*Server(?:Name|Alias)\s+(.+)$/gim)].flatMap((m) => m[1].trim().split(/\s+/)).map((name) => name.replace(/:\d+$/, ''));
    const root = /^\s*DocumentRoot\s+"?([^"\s]+)"?/im.exec(body)?.[1] ?? null;
    const port = Number(/:(\d+)/.exec(match[1])?.[1] ?? 80);
    if (names.length || root) hosts.push({ names, root, port });
  }
  const nginx = /server\s*\{([\s\S]*?)\n\s*\}/g;
  for (const match of text.matchAll(nginx)) {
    const body = match[1].replace(/^\s*#.*$/gm, '');
    const names = (/^\s*server_name\s+([^;]+);/m.exec(body)?.[1] ?? '').trim().split(/\s+/).filter((name) => name && name !== '_');
    const root = /^\s*root\s+([^;]+);/m.exec(body)?.[1]?.trim() ?? null;
    const port = Number(/^\s*listen\s+(?:[^;\s]*:)?(\d+)/m.exec(body)?.[1] ?? 80);
    if (names.length || root) hosts.push({ names, root, port });
  }
  return hosts;
}

// Maps a path inside a container to the host through that service's bind mounts.
function hostPathOf(containerPath, volumes) {
  let best = null;
  for (const volume of volumes) {
    if (!volume.hostAbs || !volume.container) continue;
    const target = volume.container.replace(/\/+$/, '');
    if (containerPath === target || containerPath.startsWith(`${target}/`)) {
      if (!best || target.length > best.target.length) best = { target, volume };
    }
  }
  if (!best) return null;
  return { host: path.join(best.volume.hostAbs, containerPath.slice(best.target.length)), inferred: Boolean(best.volume.defaulted?.length) };
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
function serviceIdFor(base, taken) {
  let id = slug(base).slice(0, 26) || 'stack';
  if (!/^[a-z]/.test(id)) id = `s-${id}`;
  let candidate = id;
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}-${n}`;
  taken.add(candidate);
  return candidate;
}

// Reads one Compose file and works out how it relates to the project.
async function studyCompose({ file, text, root, home, budget, scope }) {
  const composeDir = path.dirname(file);
  const compose = (Array.isArray(text) ? text : [text]).map(readCompose).reduce((base, extra) => mergeCompose(base, extra));
  const services = Object.values(compose.services);
  for (const svc of services) for (const volume of svc.volumes) volume.hostAbs = volume.host ? expandHost(volume.host, composeDir, home) : null;
  const inRepo = inside(composeDir, root);
  const relation = new Map(); // service id -> { how, inferred }
  for (const svc of services) {
    if (inRepo) { relation.set(svc.id, { how: 'defined in the repository', inferred: false }); continue; }
    for (const volume of svc.volumes) {
      if (!volume.hostAbs) continue;
      if (inside(root, volume.hostAbs)) { relation.set(svc.id, { how: `mounts ${tilde(volume.hostAbs, home)} (which holds the project) at ${volume.container}`, inferred: Boolean(volume.defaulted?.length), mount: volume }); break; }
      if (inside(volume.hostAbs, root)) { relation.set(svc.id, { how: `mounts ${tilde(volume.hostAbs, home)} from the project`, inferred: Boolean(volume.defaulted?.length), mount: volume }); break; }
    }
    if (!relation.has(svc.id) && svc.build?.context && inside(path.resolve(composeDir, svc.build.context), root)) relation.set(svc.id, { how: 'builds from the project', inferred: false });
  }
  return { file, composeDir, compose, services, inRepo, relation, scope };
}

// Vhost folders a related web server mounts, read within the Compose file's own folder.
async function studyVhosts({ study, root, home, budget, unresolved, coverage }) {
  const found = [];
  for (const svc of study.services) {
    for (const volume of svc.volumes) {
      if (!volume.hostAbs || !volume.container || !WEB_SERVER_PATH.test(volume.container)) continue;
      if (/\.(ini|log)$/.test(volume.hostAbs) || /\/log/.test(volume.container)) continue;
      if (!inside(volume.hostAbs, study.composeDir) || !inside(volume.hostAbs, home)) {
        unresolved.push({ item: `vhosts of ${svc.id}`, reason: `${tilde(volume.hostAbs, home)} is outside the scanned scope; its local domains were not read`, blocking: false });
        continue;
      }
      let entries = [];
      let info;
      try { info = await lstat(volume.hostAbs); } catch { unresolved.push({ item: `vhosts of ${svc.id}`, reason: `${tilde(volume.hostAbs, home)} is missing or not readable`, blocking: false }); continue; }
      if (info.isDirectory()) {
        try { entries = (await readdir(volume.hostAbs)).filter((name) => /\.conf$/.test(name)).sort().map((name) => path.join(volume.hostAbs, name)); } catch { unresolved.push({ item: `vhosts of ${svc.id}`, reason: `${tilde(volume.hostAbs, home)} is not readable`, blocking: false }); continue; }
      } else if (info.isFile()) {
        // A single mounted file is read only when it is a web-server .conf, never an env or secret file.
        if (!/\.conf$/i.test(volume.hostAbs) || /(^|[/\\])\.env|secret|passw|token|credential|\.pem$|\.key$/i.test(volume.hostAbs)) continue;
        entries = [volume.hostAbs];
      }
      if (entries.length > MAX_VHOST_FILES) { unresolved.push({ item: `vhosts of ${svc.id}`, reason: `${entries.length - MAX_VHOST_FILES} vhost file(s) in ${tilde(volume.hostAbs, home)} were not read (limit ${MAX_VHOST_FILES})`, blocking: false }); entries = entries.slice(0, MAX_VHOST_FILES); }
      for (const conf of entries) {
        const read = await readBounded(conf, study.composeDir, budget);
        if (read.skip) { coverage.skipped.push({ path: tilde(conf, home), why: read.skip }); if (read.skip !== 'missing') unresolved.push({ item: path.basename(conf), reason: `vhost file not read: ${read.skip}`, blocking: false }); continue; }
        coverage.read.push(tilde(conf, home));
        for (const vhost of parseVhosts(read.text)) {
          const mapped = vhost.root ? hostPathOf(vhost.root, svc.volumes) : null;
          found.push({ ...vhost, service: svc, file: conf, hostRoot: mapped?.host ?? null, inferred: Boolean(mapped?.inferred), mapped: Boolean(mapped) });
        }
      }
    }
  }
  return found;
}

function dependencyClosure(services, ids) {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  const out = new Set();
  const visit = (id) => { if (out.has(id) || !byId.has(id)) return; out.add(id); for (const dep of [...byId.get(id).dependsOn, ...byId.get(id).links]) visit(dep); };
  for (const id of ids) visit(id);
  return [...out];
}

// Shared-infrastructure reasons for a stack, from what is on disk now (S3).
async function sharedReasons({ study, root, home, vhosts, included }) {
  const reasons = [];
  const scope = new Set();
  if (!study.inRepo) { reasons.push(`defined outside the project, in ${tilde(study.file, home)}`); }
  for (const svc of study.services.filter((entry) => included.includes(entry.id))) {
    const infra = looksLikeInfrastructure(svc);
    if (infra) reasons.push(`${svc.id} is ${infra}`);
    for (const volume of svc.volumes) {
      if (!volume.hostAbs || volume.hostAbs === root || !inside(root, volume.hostAbs)) continue;
      let others = [];
      try { others = (await readdir(volume.hostAbs, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && path.join(volume.hostAbs, entry.name) !== root && !inside(root, path.join(volume.hostAbs, entry.name))).map((entry) => entry.name); } catch { others = []; }
      if (others.length) { reasons.push(`${svc.id} mounts ${tilde(volume.hostAbs, home)}, which also holds ${others.length} other folder(s)`); for (const name of others.slice(0, 12)) scope.add(`folder ${name}`); }
    }
  }
  const foreign = (vhosts ?? []).filter((vhost) => vhost.hostRoot && !inside(vhost.hostRoot, root));
  if (foreign.length) {
    reasons.push(`its web server also serves ${foreign.length} site(s) outside the project`);
    for (const vhost of foreign.slice(0, 12)) for (const name of vhost.names.slice(0, 1)) scope.add(`site ${name}`);
  }
  const outsideDependants = study.services.filter((svc) => !included.includes(svc.id) && [...svc.dependsOn, ...svc.links].some((dep) => included.includes(dep)));
  if (outsideDependants.length) { reasons.push(`other services depend on it: ${outsideDependants.map((svc) => svc.id).join(', ')}`); for (const svc of outsideDependants) scope.add(`service ${svc.id}`); }
  return { reasons, scope: [...scope] };
}

// Analyze Project, step 1: the scan plan. Read-only.
export async function analyzeWorkspace(root, { home = os.homedir(), observe = true } = {}) {
  const realRoot = await realpath(root);
  let realHome;
  try { realHome = await realpath(home); } catch { realHome = home; }
  const budget = { files: 0 };
  const unresolved = [];
  const { folders, limits } = await scanFolders(realRoot, realHome);
  const coverage = { scanned: folders.map((dir) => tilde(dir, realHome)), read: [], skipped: [], limits };
  // Compose files: in each scanned folder (top level), plus those the inventory finds in the repository.
  const candidates = [];
  for (const dir of folders) {
    let names = [];
    try { names = await readdir(dir); } catch { coverage.skipped.push({ path: tilde(dir, realHome), why: 'not readable' }); }
    const files = defaultComposeFiles(names);
    if (files.length) candidates.push({ file: path.join(dir, files[0]), scope: dir, overrides: files.slice(1).map((name) => path.join(dir, name)) });
    for (const name of [...COMPOSE_NAMES, ...COMPOSE_OVERRIDES].filter((entry) => names.includes(entry) && !files.includes(entry))) unresolved.push({ item: tilde(path.join(dir, name), realHome), reason: 'a Compose file Docker does not load by default next to another one; not analyzed', blocking: false });
  }
  try {
    const inventory = await inventoryRepository(realRoot);
    for (const entry of inventory.containerCi) if (entry.kind === 'Docker Compose') candidates.push({ file: path.join(realRoot, entry.path), scope: realRoot });
  } catch { coverage.limits.push({ what: 'the repository inventory', why: 'could not be read' }); }
  const seen = new Set();
  const studies = [];
  for (const { file, scope, overrides = [] } of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    const texts = [];
    for (const one of [file, ...overrides]) {
      const read = await readBounded(one, scope, budget);
      if (read.skip) {
        if (read.skip !== 'missing') { coverage.skipped.push({ path: tilde(one, realHome), why: read.skip }); unresolved.push({ item: tilde(one, realHome), reason: `Compose file not read: ${read.skip}`, blocking: true }); }
        texts.length = 0;
        break;
      }
      coverage.read.push(tilde(one, realHome));
      texts.push(read.text);
    }
    if (!texts.length) continue;
    studies.push(await studyCompose({ file, text: texts, root: realRoot, home: realHome, budget, scope }));
  }
  const observation = observe ? await observeRuntime() : { observedAt: null, docker: { available: false, reason: 'not observed', containers: [] }, ports: { available: false, reason: 'not observed', listeners: [] } };
  const taken = new Set();
  const services = [];
  for (const study of studies) {
    if (!study.relation.size) {
      // Review finding 3: a file YallaFlow cannot read with certainty may well run the project.
      const blocking = study.compose.problems.filter((entry) => entry.blocking);
      if (blocking.length) unresolved.push({ item: tilde(study.file, realHome), reason: `whether it runs this project is unresolved: it cannot be read with certainty (${blocking.slice(0, 3).map((entry) => entry.reason).join('; ')})`, blocking: true });
      continue;
    }
    const where = tilde(study.file, realHome);
    for (const entry of study.compose.problems) unresolved.push({ item: where, reason: `${where}${entry.line ? `:${entry.line}` : ''}: ${entry.reason}`, blocking: entry.blocking });
    const related = [...study.relation.keys()];
    const included = dependencyClosure(study.services, related);
    const vhosts = await studyVhosts({ study, root: realRoot, home: realHome, budget, unresolved, coverage });
    const project = composeProjectName({ name: study.compose.name, dir: study.composeDir });
    const components = study.services.filter((svc) => included.includes(svc.id));
    const ports = [...new Set(components.flatMap((svc) => svc.ports.filter((port) => port.host).map((port) => port.host)))];
    for (const svc of components) for (const port of svc.ports.filter((entry) => entry.problem)) unresolved.push({ item: `${svc.id} port ${port.raw}`, reason: `not a fixed host port (${port.problem})`, blocking: false });
    // App links: the project's vhosts on *.localhost names, else the published web ports.
    const links = [];
    const ownVhosts = vhosts.filter((vhost) => vhost.hostRoot && inside(vhost.hostRoot, realRoot));
    for (const vhost of vhosts.filter((entry) => entry.root && !entry.mapped)) unresolved.push({ item: vhost.names[0] ?? path.basename(vhost.file), reason: `document root ${vhost.root} is not mounted from a folder YallaFlow can see`, blocking: false });
    for (const vhost of ownVhosts) {
      const hostPort = vhost.service.ports.find((port) => port.container === vhost.port)?.host ?? null;
      // A vhost whose document root does not exist in the project is not offered as a link.
      let rootExists = false;
      try { rootExists = (await stat(vhost.hostRoot)).isDirectory(); } catch { rootExists = false; }
      if (!rootExists) { unresolved.push({ item: vhost.names[0] ?? path.basename(vhost.file), reason: `its document root ${path.relative(realRoot, vhost.hostRoot) || '.'} does not exist in the project; not offered as a link`, blocking: false }); continue; }
      for (const name of vhost.names.slice(0, 2)) {
        if (!/^(localhost|([a-z0-9-]+\.)+localhost)$/i.test(name)) { unresolved.push({ item: name, reason: 'not a *.localhost name; YallaFlow links only loopback and *.localhost addresses', blocking: false }); continue; }
        if (!hostPort) { unresolved.push({ item: name, reason: `served on container port ${vhost.port}, which is not published on a fixed host port`, blocking: false }); continue; }
        const url = `http://${name.toLowerCase()}${hostPort === 80 ? '' : `:${hostPort}`}/`;
        if (!links.some((link) => link.url === url)) links.push({ label: name.toLowerCase(), url, confidence: vhost.inferred ? 'inferred' : 'confirmed', evidence: [tilde(vhost.file, realHome)], module: path.relative(realRoot, vhost.hostRoot) || '.' });
      }
    }
    if (!links.length) for (const port of ports.slice(0, 3)) links.push({ label: `127.0.0.1:${port}`, url: `http://127.0.0.1:${port}/`, confidence: 'inferred', evidence: [where] });
    const shared = await sharedReasons({ study, root: realRoot, home: realHome, vhosts, included });
    const relationInferred = [...study.relation.values()].some((entry) => entry.inferred);
    const webPort = (components.find((svc) => vhosts.some((vhost) => vhost.service === svc)) ?? components.find((svc) => svc.ports.some((port) => port.host)))?.ports.find((port) => port.host)?.host ?? null;
    const containerNames = components.map((svc) => svc.containerName).filter(Boolean);
    const running = runningContainersOf(observation, { project, containerNames });
    const conflicts = [];
    for (const port of ports) {
      const owner = portOwner(observation, port, { exceptProject: project });
      if (owner && !running.some((entry) => entry.ports.includes(port))) conflicts.push({ port, owner });
    }
    const blocking = study.compose.problems.filter((entry) => entry.blocking).map((entry) => entry.reason);
    services.push({
      id: serviceIdFor(study.inRepo ? `compose-${path.relative(realRoot, study.composeDir) || 'project'}` : `${project}-stack`, taken),
      name: `Docker stack ${project} (${included.join(', ')})`,
      kind: 'docker-compose',
      command: ['docker', 'compose', '-f', path.basename(study.file), 'up', ...(included.length === study.services.length ? [] : included)],
      cwd: study.inRepo ? (path.relative(realRoot, study.composeDir) || '.') : study.composeDir,
      env: [],
      ports,
      ready: webPort ? { port: webPort } : null,
      stopSignal: 'SIGINT',
      stopTimeoutSeconds: 30,
      readyTimeoutSeconds: 300,
      dependsOn: [],
      links: links.slice(0, 24),
      confidence: blocking.length ? 'unresolved' : relationInferred ? 'inferred' : 'confirmed',
      evidence: [where, ...new Set(ownVhosts.map((vhost) => tilde(vhost.file, realHome)))].slice(0, 30),
      notes: [
        ...[...study.relation.entries()].map(([id, entry]) => `${id} ${entry.how}${entry.inferred ? ' (path from a variable default; an .env file can change it)' : ''}`),
        ...(relationInferred ? ['Paths come from variable defaults in the Compose file; an .env next to it can change them and is never read.'] : [])
      ],
      components: components.map((svc) => ({ id: svc.id, image: svc.image, build: svc.build?.context ?? null, containerName: svc.containerName, ports: svc.ports.filter((port) => port.host).map((port) => port.host), dependsOn: [...new Set([...svc.dependsOn, ...svc.links])], infrastructure: looksLikeInfrastructure(svc), envNames: svc.envNames })),
      shared: shared.reasons.length ? { reasons: shared.reasons, scope: shared.scope, partial: coverage.limits.length > 0 || unresolved.some((entry) => /vhost/.test(entry.item)) } : null,
      runningOutside: running.length ? running.map((entry) => entry.name) : null,
      conflicts,
      blocking
    });
  }
  let otherSuggestions = [];
  try { otherSuggestions = await suggestServices(realRoot); } catch { otherSuggestions = []; }
  return {
    schemaVersion: 1,
    source: 'scan',
    analyzedAt: new Date().toISOString(),
    project: tilde(realRoot, realHome),
    services,
    unresolved,
    coverage,
    observation: {
      observedAt: observation.observedAt,
      docker: observation.docker.available ? { available: true, running: observation.docker.containers.length } : { available: false, reason: observation.docker.reason },
      ports: observation.ports.available ? { available: true } : { available: false, reason: observation.ports.reason }
    },
    nothingFound: services.length ? null : unresolved.some((entry) => entry.blocking) ? `Nothing confirmed within: ${coverage.scanned.join(', ')} — see the unresolved items` : `Nothing found within: ${coverage.scanned.join(', ')}`,
    otherSuggestions: otherSuggestions.map(({ id, name, command, cwd, evidence, note }) => ({ id, name, command, cwd, evidence, note: note ?? null }))
  };
}

// The Compose files a compose service loads now: -f/--file in any spelling, else the default
// file plus its override, resolved in --project-directory or the service folder.
async function composeFilesOf(root, service) {
  const [executable, ...args] = service.command;
  const name = path.basename(executable);
  if (!(service.kind === 'docker-compose' || name === 'docker-compose' || (name === 'docker' && args.includes('compose')))) return null;
  const realRoot = await realpath(root);
  const cwd = await realpath(path.isAbsolute(service.cwd) ? service.cwd : path.join(realRoot, service.cwd));
  const parsed = composeArgs(args);
  const dir = parsed.projectDirectory ? path.resolve(cwd, parsed.projectDirectory) : cwd;
  let files = parsed.files.map((file) => path.resolve(cwd, file));
  if (!files.length) { let names = []; try { names = await readdir(dir); } catch { names = []; } files = defaultComposeFiles(names).map((file) => path.join(dir, file)); }
  return { realRoot, cwd, dir, files, args, parsed };
}

// Is this service shared infrastructure, judged from the evidence on disk now (S3)?
// → { shared, reasons, scope }. Unreadable evidence counts as shared (fail closed).
export async function sharedNow(root, service, { home = os.homedir() } = {}) {
  const reasons = [];
  let scope = [];
  if (service.shared) { reasons.push('marked shared when it was saved'); scope = [...service.shared.scope]; }
  let found;
  try { found = await composeFilesOf(root, service); } catch (error) { reasons.push(`its folder could not be resolved (${error.message}); treated as shared`); return { shared: true, reasons, scope }; }
  if (!found) return { shared: reasons.length > 0, reasons, scope };
  try {
    const realHome = await realpath(home).catch(() => home);
    if (!found.files.length) throw new Error('no Compose file');
    const texts = [];
    for (const file of found.files) {
      const read = await readBounded(file, path.dirname(file), { files: 0 });
      if (read.skip) throw new Error(`${path.basename(file)}: ${read.skip}`);
      texts.push(read.text);
    }
    const study = await studyCompose({ file: found.files[0], text: texts, root: found.realRoot, home: realHome, budget: { files: 0 }, scope: found.dir });
    if (study.compose.problems.some((entry) => entry.blocking)) reasons.push('its Compose configuration cannot be read with certainty; treated as shared');
    const included = dependencyClosure(study.services, found.parsed.services.length ? found.parsed.services : study.services.map((svc) => svc.id));
    const vhosts = await studyVhosts({ study, root: found.realRoot, home: realHome, budget: { files: 0 }, unresolved: [], coverage: { read: [], skipped: [] } });
    const evidence = await sharedReasons({ study, root: found.realRoot, home: realHome, vhosts, included });
    reasons.push(...evidence.reasons);
    scope = [...new Set([...scope, ...evidence.scope])];
  } catch (error) {
    reasons.push(`its Compose configuration could not be verified (${error.message}); treated as shared`);
  }
  return { shared: reasons.length > 0, reasons: [...new Set(reasons)], scope };
}

// The Compose project name, container names and folder a compose service would use, from
// its current files — so start can tell that the stack already runs outside YallaFlow. The
// name is uncertain when an .env, an env file or the environment may set it.
export async function composeIdentity(root, service) {
  const found = await composeFilesOf(root, service);
  if (!found) return null;
  let composeName = null;
  const containerNames = [];
  for (const file of found.files) {
    const read = await readBounded(file, path.dirname(file), { files: 0 });
    if (read.skip) continue;
    const compose = readCompose(read.text);
    composeName = composeName ?? compose.name;
    for (const svc of Object.values(compose.services)) if (svc.containerName) containerNames.push(svc.containerName);
  }
  let dotEnv = false;
  try { await lstat(path.join(found.dir, '.env')); dotEnv = true; } catch { dotEnv = false; }
  const uncertain = found.parsed.project === null && (dotEnv || found.parsed.envFiles.length > 0 || service.env.includes('COMPOSE_PROJECT_NAME'));
  return { project: composeProjectName({ name: composeName, dir: found.dir, args: found.args }), containerNames, workingDir: found.dir, uncertain };
}
