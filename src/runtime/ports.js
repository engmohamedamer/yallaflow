// Moving a service to another port (PF-0166), consistently: the port list, the readiness
// check, the links that open it, and the port argument of its command change together, or
// nothing changes. A command whose port YallaFlow cannot change with certainty is never
// edited by guesswork: the change is refused with the reason, and the developer edits the
// command. Nothing is run and no other service is touched.
//
// Owner review (2026-11-17): a rewrite is refused when any mention of the old port would be
// left behind in the command, when the script already chooses a port or chains commands, and
// when the package manager is not npm (pnpm, Yarn and Bun pass `--` to the script in ways
// that differ by version). Other services that still mention the old port (their command or
// links) are reported, never changed. Project files (a proxy config, .env) are not read.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parsePackageCommand } from './prerequisites.js';

const PORT_FLAG = /^(?:--port|-p|--listen-port|--server\.port|--server-port)$/;
const PORT_ASSIGN = /^(--(?:port|listen-port|server\.port|server-port)|-p)=(\d+)$/;
const HOST_PORT = /^((?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1?\]):)(\d+)$/;
// Dev servers that take `--port N` after the script's own arguments.
const TAKES_PORT = /^\s*(?:npx\s+)?(?:ng\s+serve|vite(?:\s+(?:dev|serve|preview))?|next\s+(?:dev|start)|nuxt(?:i)?\s+dev|astro\s+dev|webpack(?:-dev-server|\s+serve)|vue-cli-service\s+serve)\b/;

export class PortChangeError extends Error {
  constructor(message) {
    super(message);
    this.code = 'RUNTIME_PORT_COMMAND';
  }
}

// → the command with its port argument changed, or null when the port is not in the argv.
const mentions = (arg, port) => new RegExp(`(?:^|[^0-9])${port}(?:[^0-9]|$)`).test(String(arg));
function replaceInArgv(command, from, to) {
  let changed = false;
  const next = command.map((arg, index) => {
    if (index > 0 && PORT_FLAG.test(command[index - 1]) && arg === String(from)) { changed = true; return String(to); }
    const assign = PORT_ASSIGN.exec(arg);
    if (assign && Number(assign[2]) === from) { changed = true; return `${assign[1]}=${to}`; }
    const host = HOST_PORT.exec(arg);
    if (host && Number(host[2]) === from) { changed = true; return `${host[1]}${to}`; }
    return arg;
  });
  return changed ? next : null;
}

async function scriptText(service, cwd) {
  const parsed = parsePackageCommand(service.command);
  if (!parsed?.script) return null;
  try {
    const dir = await realpath(path.resolve(cwd, parsed.dir));
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    return typeof pkg?.scripts?.[parsed.script] === 'string' ? pkg.scripts[parsed.script] : null;
  } catch {
    return null;
  }
}

// → { patch, changed: [what changed, in plain words] }. `cwd`: the service's resolved folder.
// others: the other services of the project, to report the ones that still mention `from`.
export async function planPortChange(service, from, to, { cwd, others = [] }) {
  for (const [name, value] of [['from', from], ['to', to]]) if (!Number.isInteger(value) || value < 1 || value > 65535) throw Object.assign(new Error(`${name} must be a port from 1 to 65535.`), { code: 'RUNTIME_PROFILE_INVALID' });
  if (!service.ports.includes(from)) throw Object.assign(new Error(`Service ${service.id} is not defined on port ${from}.`), { code: 'RUNTIME_PROFILE_INVALID' });
  if (from === to) throw Object.assign(new Error('The new port is the same as the current one.'), { code: 'RUNTIME_PROFILE_INVALID' });
  if (service.ports.includes(to)) throw Object.assign(new Error(`Service ${service.id} already uses port ${to}.`), { code: 'RUNTIME_PROFILE_INVALID' });
  if (service.kind !== 'process') throw new PortChangeError(`${service.id} is a Compose service: its ports are published by its Compose file, which YallaFlow does not edit. Change the port there, then update the service here.`);

  let command = replaceInArgv(service.command, from, to);
  let how = command ? 'the port argument of the command' : null;
  // Changed in one place but still mentioned in another (a URL, a second flag): not certain.
  if (command && command.some((arg, index) => arg === service.command[index] && mentions(arg, from))) throw new PortChangeError(`The command of ${service.id} mentions ${from} in more than one place, and YallaFlow recognizes only some of them as the port, so it was not changed. Edit the command yourself.`);
  if (!command) {
    if (service.command.some((arg) => mentions(arg, from))) throw new PortChangeError(`The command of ${service.id} mentions ${from} in a form YallaFlow does not recognize as a port argument, so it was not changed. Edit the command yourself.`);
    const parsed = parsePackageCommand(service.command);
    const text = await scriptText(service, cwd);
    if (text && TAKES_PORT.test(text)) {
      if (parsed?.manager !== 'npm' || parsed.npx) throw new PortChangeError(`${service.id} runs its script with ${parsed?.manager ?? service.command[0]}, which passes extra arguments to the script differently by version, so YallaFlow did not add a port to it. Edit the command yourself (for example add the port to the script).`);
      if (/&&|\|\||[;|]/.test(text)) throw new PortChangeError(`The script of ${service.id} runs more than one command (${text.trim().slice(0, 80)}), so YallaFlow cannot tell which one would get the port. Edit the command yourself.`);
      if (/(?:^|\s)(?:--port|-p)(?:[=\s]|$)|\bPORT=/.test(text) || mentions(text, from)) throw new PortChangeError(`The script of ${service.id} already sets its port (${text.trim().slice(0, 80)}), so adding another one would be a guess. Change the port in the script, then set it here.`);
      const at = service.command.indexOf('--');
      const rest = at === -1 ? [] : service.command.slice(at + 1).filter((arg, index, all) => !(arg === '--port' || (index > 0 && all[index - 1] === '--port') || /^--port=/.test(arg)));
      command = [...(at === -1 ? service.command : service.command.slice(0, at)), '--', ...rest, '--port', String(to)];
      how = `"--port ${to}" passed to the script (${text.trim().split(/\s+/).slice(0, 2).join(' ')})`;
    } else {
      throw new PortChangeError(`YallaFlow cannot tell how the command of ${service.id} chooses its port (${service.command.join(' ')}), so it did not change it. Edit the command yourself, then set the port.`);
    }
  }
  const patch = { command, ports: service.ports.map((port) => (port === from ? to : port)) };
  const changed = [how, 'the port'];
  if (service.ready?.port === from) { patch.ready = { port: to }; changed.push('the readiness check'); }
  const links = (service.links ?? []).map((link) => ({ ...link, url: link.url.replace(new RegExp(`^(https?://[^/:]+):${from}(?=/|$)`), `$1:${to}`) }));
  if (links.some((link, index) => link.url !== service.links[index].url)) { patch.links = links; changed.push('the links that open it'); }
  // Other services that still point at the old port: reported, never changed (a frontend's
  // proxy or API link may need the new port, which is the developer's decision).
  const references = others.filter((other) => other.id !== service.id).map((other) => ({
    id: other.id,
    where: [
      ...(other.command ?? []).some((arg) => mentions(arg, from)) ? ['command'] : [],
      ...(other.links ?? []).some((link) => new RegExp(`:${from}(?=/|$)`).test(link.url)) ? ['links'] : [],
      ...(other.ready?.port === from ? ['readiness check'] : [])
    ]
  })).filter((entry) => entry.where.length);
  return { patch, changed, from, to, references };
}
