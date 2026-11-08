// A bounded, conservative Docker Compose reader (PF-0072, plan decision D1): no new
// dependency. It reads only the block-style YAML subset Compose files normally use and the
// keys YallaFlow needs. It fails closed: anything it cannot read with certainty (anchors,
// aliases, merge keys, tags, flow mappings, multiple documents, `extends`, `include`) is
// reported as a problem — never guessed. Values are interpolated from defaults only; `.env`
// and environment values are never read, so an unset variable is reported, not filled in.

const MAX_LINES = 20_000;

function problem(line, reason) {
  return { line, reason };
}

// Removes a trailing comment that is outside quotes.
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote && (quote === "'" || text[i - 1] !== '\\')) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function scalar(raw, line, problems) {
  const text = raw.trim();
  if (text === '' || text === '~' || text === 'null') return null;
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) return text.slice(1, -1).replace(/\\(["\\nt])/g, (m, c) => ({ n: '\n', t: '\t' }[c] ?? c));
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'");
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1);
    const parts = [];
    let current = '';
    let quote = null;
    for (const c of inner) {
      if (quote) { current += c; if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; current += c; continue; }
      if (c === '[' || c === '{') { problems.push(problem(line, 'nested flow collection')); return null; }
      if (c === ',') { parts.push(current); current = ''; continue; }
      current += c;
    }
    if (current.trim()) parts.push(current);
    return parts.map((part) => scalar(part, line, problems));
  }
  if (text.startsWith('{')) { problems.push(problem(line, 'flow mapping')); return null; }
  if (/^[&*!]/.test(text)) { problems.push(problem(line, text[0] === '&' ? 'YAML anchor' : text[0] === '*' ? 'YAML alias' : 'YAML tag')); return null; }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

// "key: value" → [key, rest] (rest may be ''), else null.
function splitKey(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if ((c === '"' || c === "'") && i === 0) { quote = c; continue; }
    if (c === ':' && (i === text.length - 1 || text[i + 1] === ' ')) {
      let key = text.slice(0, i).trim();
      let escaped = false;
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) { escaped = key.slice(1, -1).includes('\\') || key.slice(1, -1).includes("''"); key = key.slice(1, -1); }
      return [key, text.slice(i + 1).trim(), escaped];
    }
  }
  return null;
}

// Parses the YAML subset. → { value, problems: [{ line, reason }] }
export function parseYamlSubset(text) {
  const problems = [];
  const raw = String(text).replace(/^\ufeff/, '').split(/\r?\n/);
  if (raw.length > MAX_LINES) return { value: null, problems: [problem(0, 'file too long')] };
  const lines = [];
  let started = false;
  for (const [index, full] of raw.entries()) {
    if (/\t/.test(full.match(/^\s*/)[0])) problems.push(problem(index + 1, 'tab indentation'));
    const body = stripComment(full).replace(/\s+$/, '');
    if (!body.trim()) continue;
    if (/^(---|\.\.\.)\s*$/.test(body)) { if (started) problems.push(problem(index + 1, 'more than one YAML document')); continue; }
    started = true;
    if (/(^|[\s:\-\[,])[&*][A-Za-z0-9_-]/.test(body) && !/["'][^"']*[&*][^"']*["']/.test(body)) problems.push(problem(index + 1, 'YAML anchor or alias'));
    if (/^\s*<<\s*:/.test(body)) problems.push(problem(index + 1, 'YAML merge key'));
    lines.push({ n: index + 1, indent: body.match(/^ */)[0].length, text: body.trim() });
  }
  let pos = 0;

  function blockScalar(parentIndent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent > parentIndent) out.push(lines[pos++].text);
    return out.join('\n');
  }

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    return lines[pos].text.startsWith('- ') || lines[pos].text === '-' ? parseSeq(lines[pos].indent) : parseMap(lines[pos].indent);
  }

  function valueAfter(rest, line, ownIndent) {
    if (rest === '|' || rest === '>' || /^[|>][-+]?$/.test(rest)) return blockScalar(ownIndent);
    if (rest !== '') return scalar(rest, line, problems);
    if (pos < lines.length && (lines[pos].indent > ownIndent || (lines[pos].indent === ownIndent && (lines[pos].text.startsWith('- ') || lines[pos].text === '-')))) return parseBlock(lines[pos].indent);
    return null;
  }

  function parseMap(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent && !(lines[pos].text.startsWith('- ') || lines[pos].text === '-')) {
      const { n, text: t } = lines[pos];
      const kv = splitKey(t);
      pos++;
      if (!kv) { problems.push(problem(n, 'not a key: value line')); continue; }
      const [key, rest, escaped] = kv;
      if (escaped) problems.push(problem(n, 'an escaped key (YallaFlow cannot tell which key it is)'));
      if (key === '<<') { problems.push(problem(n, 'YAML merge key')); continue; }
      if (Object.hasOwn(out, key)) problems.push(problem(n, `duplicate key ${key}`));
      out[key] = valueAfter(rest, n, indent);
    }
    if (pos < lines.length && lines[pos].indent > indent) { problems.push(problem(lines[pos].n, 'unexpected indentation')); while (pos < lines.length && lines[pos].indent > indent) pos++; }
    return out;
  }

  function parseSeq(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent && (lines[pos].text.startsWith('- ') || lines[pos].text === '-')) {
      const { n, text: t } = lines[pos];
      const rest = t === '-' ? '' : t.slice(2).trim();
      pos++;
      if (rest === '') { out.push(pos < lines.length && lines[pos].indent > indent ? parseBlock(lines[pos].indent) : null); continue; }
      const kv = splitKey(rest);
      if (kv && !/^["']/.test(rest)) {
        // "- key: value" starts a mapping whose further keys are indented past the dash.
        const item = {};
        const itemIndent = indent + 2;
        if (kv[2]) problems.push(problem(n, 'an escaped key (YallaFlow cannot tell which key it is)'));
        item[kv[0]] = valueAfter(kv[1], n, itemIndent);
        if (pos < lines.length && lines[pos].indent === itemIndent && !lines[pos].text.startsWith('- ')) Object.assign(item, parseMap(itemIndent));
        out.push(item);
      } else out.push(scalar(rest, n, problems));
    }
    return out;
  }

  let value = null;
  try {
    value = lines.length ? parseBlock(lines[0].indent) : {};
    if (pos < lines.length) problems.push(problem(lines[pos].n, 'content after the document could not be read'));
  } catch {
    problems.push(problem(0, 'could not be read'));
  }
  return { value, problems };
}

// ${VAR}, ${VAR:-default}, ${VAR-default}, $VAR, $$ — defaults only.
export function interpolate(text) {
  if (typeof text !== 'string') return { value: text, unset: [], defaulted: [] };
  const unset = [];
  const defaulted = [];
  const value = text.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name, op, def, bare) => {
    if (match === '$$') return '$';
    const variable = name ?? bare;
    if (op === '-' || op === ':-') { defaulted.push(variable); return def; }
    unset.push(variable);
    return '';
  });
  return { value: unset.length ? null : value, unset, defaulted };
}

const asList = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.keys(value) : []);

// Short-syntax ports: "80", "80:80", "4991:443", "127.0.0.1:3306:3306", with /tcp|/udp.
function readPort(entry) {
  if (entry && typeof entry === 'object') {
    const host = Number(entry.published);
    return Number.isInteger(host) && host > 0 ? { host, container: Number(entry.target) || null, raw: `${entry.published}:${entry.target}` } : { host: null, container: Number(entry.target) || null, raw: JSON.stringify(entry), problem: 'no fixed host port' };
  }
  const raw = String(entry);
  const { value, unset } = interpolate(raw);
  if (value === null) return { host: null, container: null, raw, problem: `depends on ${unset.join(', ')}` };
  const parts = value.replace(/\/(tcp|udp)$/, '').split(':');
  if (parts.some((part) => /-/.test(part))) return { host: null, container: null, raw, problem: 'port range' };
  if (parts.length === 1) return { host: null, container: Number(parts[0]) || null, raw, problem: 'no fixed host port' };
  const host = Number(parts.at(-2));
  return Number.isInteger(host) && host > 0 && host < 65536 ? { host, container: Number(parts.at(-1)) || null, raw } : { host: null, container: null, raw, problem: 'not a port' };
}

// Short-syntax volumes: "host:container[:mode]"; a named volume has no host path.
function readVolume(entry) {
  if (entry && typeof entry === 'object') {
    if (entry.type === 'bind' && typeof entry.source === 'string' && typeof entry.target === 'string') {
      const source = interpolate(entry.source);
      return { host: source.value, container: entry.target, raw: `${entry.source}:${entry.target}`, defaulted: source.defaulted, unset: source.unset };
    }
    return { host: null, container: typeof entry.target === 'string' ? entry.target : null, raw: JSON.stringify(entry), named: true };
  }
  const raw = String(entry);
  const { value, unset, defaulted } = interpolate(raw);
  if (value === null) {
    const container = raw.split(':')[1] ?? null;
    return { host: null, container, raw, unset, defaulted };
  }
  const parts = value.split(':');
  if (parts.length < 2) return { host: null, container: parts[0], raw, named: true };
  const host = parts[0];
  const named = !/^[.~/]/.test(host);
  return { host: named ? null : host, container: parts[1], raw, named, defaulted, unset };
}

// Keys the reader knows (Compose specification). Anything else — at the top level or in a
// service — may change what runs in a way YallaFlow cannot see, so it blocks (fail closed).
const TOP_KEYS = new Set(['version', 'name', 'services', 'volumes', 'networks', 'configs', 'secrets', 'include', 'models']);
const SERVICE_KEYS = new Set(['annotations', 'attach', 'blkio_config', 'build', 'cap_add', 'cap_drop', 'cgroup', 'cgroup_parent', 'command', 'configs', 'container_name', 'cpu_count', 'cpu_percent', 'cpu_period', 'cpu_quota', 'cpu_rt_period', 'cpu_rt_runtime', 'cpu_shares', 'cpus', 'cpuset', 'credential_spec', 'depends_on', 'deploy', 'develop', 'device_cgroup_rules', 'devices', 'dns', 'dns_opt', 'dns_search', 'domainname', 'entrypoint', 'env_file', 'environment', 'expose', 'extends', 'external_links', 'extra_hosts', 'gpus', 'group_add', 'healthcheck', 'hostname', 'image', 'init', 'ipc', 'isolation', 'labels', 'label_file', 'links', 'logging', 'mac_address', 'mem_limit', 'mem_reservation', 'mem_swappiness', 'memswap_limit', 'models', 'network_mode', 'networks', 'oom_kill_disable', 'oom_score_adj', 'pid', 'pids_limit', 'platform', 'ports', 'post_start', 'pre_stop', 'privileged', 'profiles', 'pull_policy', 'read_only', 'restart', 'runtime', 'scale', 'secrets', 'security_opt', 'shm_size', 'stdin_open', 'stop_grace_period', 'stop_signal', 'storage_opt', 'sysctls', 'tmpfs', 'tty', 'ulimits', 'use_api_socket', 'user', 'userns_mode', 'uts', 'volumes', 'volumes_from', 'working_dir']);

// → { name, services: { id: {...} }, problems, blocking }
//   blocking: problems that materially affect what runs (owner safety requirement S1).
export function readCompose(text) {
  const { value, problems: yamlProblems } = parseYamlSubset(text);
  const problems = yamlProblems.map((entry) => ({ ...entry, blocking: true }));
  const services = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { name: null, services, problems: [...problems, { line: 0, reason: 'not a Compose mapping', blocking: true }] };
  if ('include' in value) problems.push({ line: 0, reason: 'top-level include (another file decides what runs)', blocking: true });
  for (const key of Object.keys(value)) if (!TOP_KEYS.has(key) && !/^x-[A-Za-z0-9_.-]*$/.test(key)) problems.push({ line: 0, reason: `unknown top-level key ${JSON.stringify(key)}`, blocking: true });
  const top = interpolate(value.name ?? null);
  const name = typeof value.name === 'string' && top.value ? top.value : null;
  const raw = value.services && typeof value.services === 'object' && !Array.isArray(value.services) ? value.services : {};
  if (!value.services) problems.push({ line: 0, reason: 'no services section', blocking: false });
  for (const [id, svc] of Object.entries(raw)) {
    if (!svc || typeof svc !== 'object' || Array.isArray(svc)) { problems.push({ line: 0, reason: `service ${id} is not a mapping`, blocking: true }); continue; }
    if ('extends' in svc) problems.push({ line: 0, reason: `service ${id} uses extends (another file decides what runs)`, blocking: true });
    for (const key of Object.keys(svc)) if (!SERVICE_KEYS.has(key) && !/^x-[A-Za-z0-9_.-]*$/.test(key)) problems.push({ line: 0, reason: `service ${id}: unknown key ${JSON.stringify(key)}`, blocking: true });
    let build = null;
    if (svc.build !== undefined && svc.build !== null) {
      const spec = typeof svc.build === 'string' ? { context: svc.build } : svc.build;
      const context = interpolate(spec.context ?? '.');
      const dockerfile = interpolate(spec.dockerfile ?? 'Dockerfile');
      build = { context: context.value, dockerfile: dockerfile.value, inline: typeof spec.dockerfile_inline === 'string' };
      if (context.unset.length || dockerfile.unset.length) problems.push({ line: 0, reason: `service ${id}: the build depends on unset variable(s) ${[...context.unset, ...dockerfile.unset].join(', ')}`, blocking: true });
      else if (context.defaulted.length || dockerfile.defaulted.length) problems.push({ line: 0, reason: `service ${id}: the build folder comes from variable(s) ${[...context.defaulted, ...dockerfile.defaulted].join(', ')}, which an .env file can change (YallaFlow never reads it)`, blocking: true });
      if (typeof build.context === 'string' && (/:\/\//.test(build.context) || /^git@/.test(build.context) || /\.git(#.*)?$/.test(build.context))) problems.push({ line: 0, reason: `service ${id}: the build comes from a remote source (${build.context})`, blocking: true });
      if (spec.additional_contexts) problems.push({ line: 0, reason: `service ${id}: additional build contexts are not covered`, blocking: true });
    }
    const environment = svc.environment;
    const envNames = Array.isArray(environment) ? environment.map((entry) => String(entry).split('=')[0]) : environment && typeof environment === 'object' ? Object.keys(environment) : [];
    const envFiles = (Array.isArray(svc.env_file) ? svc.env_file : svc.env_file ? [svc.env_file] : []).map((entry) => (typeof entry === 'object' ? entry.path : entry)).filter((entry) => typeof entry === 'string');
    const ports = (Array.isArray(svc.ports) ? svc.ports : []).map(readPort);
    const image = typeof svc.image === 'string' ? (interpolate(svc.image).value ?? svc.image) : null;
    services[id] = {
      id,
      image,
      build,
      containerName: typeof svc.container_name === 'string' ? svc.container_name : null,
      ports,
      dependsOn: asList(svc.depends_on).map(String),
      links: (Array.isArray(svc.links) ? svc.links : []).map((entry) => String(entry).split(':')[0]),
      volumes: (Array.isArray(svc.volumes) ? svc.volumes : []).map(readVolume),
      envNames: envNames.filter((entry) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry)),
      envFiles
    };
  }
  return { name, services, problems };
}

// Compose command-line options that change what runs, in every spelling (review finding 5).
export function composeArgs(args) {
  const out = { files: [], project: null, projectDirectory: null, envFiles: [], profiles: [], services: [] };
  const take = (arg, short, long, next) => {
    if (short && arg === short) return { value: next(), hit: true };
    if (short && arg.startsWith(short) && !arg.startsWith('--') && arg.length > short.length) return { value: arg.slice(short.length).replace(/^=/, ''), hit: true };
    if (arg === long) return { value: next(), hit: true };
    if (arg.startsWith(`${long}=`)) return { value: arg.slice(long.length + 1), hit: true };
    return { hit: false };
  };
  let afterUp = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => args[++i];
    if (afterUp) { if (!arg.startsWith('-')) out.services.push(arg); continue; }
    if (arg === 'up') { afterUp = true; continue; }
    let r;
    if ((r = take(arg, '-f', '--file', next)).hit) { out.files.push(r.value ?? ''); continue; }
    if ((r = take(arg, '-p', '--project-name', next)).hit) { out.project = r.value ?? ''; continue; }
    if ((r = take(arg, null, '--project-directory', next)).hit) { out.projectDirectory = r.value ?? ''; continue; }
    if ((r = take(arg, null, '--env-file', next)).hit) { out.envFiles.push(r.value ?? ''); continue; }
    if ((r = take(arg, null, '--profile', next)).hit) { out.profiles.push(r.value ?? ''); continue; }
  }
  return out;
}

// What Compose loads when no file is named: the first default file plus its override.
export function defaultComposeFiles(names) {
  const base = COMPOSE_NAMES.find((name) => names.includes(name));
  if (!base) return [];
  const stem = base.replace(/\.ya?ml$/, '');
  const override = [`${stem}.override.yaml`, `${stem}.override.yml`].find((name) => names.includes(name));
  return [base, ...(override ? [override] : [])];
}

// Compose merges later files into earlier ones; the lists that matter here are combined.
export function mergeCompose(base, extra) {
  const services = { ...base.services };
  for (const [id, svc] of Object.entries(extra.services)) {
    const prior = services[id];
    services[id] = prior ? {
      ...prior,
      image: svc.image ?? prior.image,
      build: svc.build ?? prior.build,
      containerName: svc.containerName ?? prior.containerName,
      ports: [...prior.ports, ...svc.ports],
      dependsOn: [...new Set([...prior.dependsOn, ...svc.dependsOn])],
      links: [...new Set([...prior.links, ...svc.links])],
      volumes: [...prior.volumes, ...svc.volumes],
      envNames: [...new Set([...prior.envNames, ...svc.envNames])],
      envFiles: [...new Set([...prior.envFiles, ...svc.envFiles])]
    } : svc;
  }
  return { name: extra.name ?? base.name, services, problems: [...base.problems, ...extra.problems] };
}

// The project name Compose uses for its containers' labels.
export function composeProjectName({ name, dir, args = [] }) {
  const parsed = composeArgs(args);
  if (parsed.project !== null) return normalizeProject(parsed.project);
  return normalizeProject(name ?? dir.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
}

function normalizeProject(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

export const COMPOSE_NAMES = Object.freeze(['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']);
export const COMPOSE_OVERRIDES = Object.freeze(['compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yaml', 'docker-compose.override.yml']);

// Data and infrastructure services that other projects usually share (S3 evidence).
const INFRA = /(^|[/_.-])(mysql|mariadb|postgres|postgis|postgresql|mongo|mongodb|redis|memcached|rabbitmq|kafka|zookeeper|elasticsearch|opensearch|mailhog|mailpit|minio|keycloak|phpmyadmin|adminer|db|database)([:/_.-]|$)/i;
export function looksLikeInfrastructure(service) {
  const names = [service.image ?? '', service.build?.context ?? '', service.id ?? '', service.containerName ?? ''];
  const hit = names.find((entry) => INFRA.test(entry));
  return hit ? `a data or infrastructure service (${hit})` : null;
}
