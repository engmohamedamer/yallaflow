// `yallaflow runtime …` (1.4.0): reviewed, trusted local development services.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { findProjectRoot } from '../core/workspace.js';
import { PACKAGE_VERSION } from '../version.js';
import { addService, definitionHash, loadRuntimeProfiles, removeService } from '../runtime/profile.js';
import { suggestServices } from '../runtime/suggest.js';
import { trustService, trustState } from '../runtime/trust.js';
import { RuntimeError, restartService, runtimeStatus, serviceLogs, startAllServices, startService, stopAllServices, stopService } from '../runtime/supervisor.js';
import { readFile } from 'node:fs/promises';

export const RUNTIME_SCHEMA = 'yallaflow.runtime/1';
export { RUNTIME_USAGE } from './runtime-usage.js';
import { RUNTIME_USAGE } from './runtime-usage.js';

function usage() {
  return Object.assign(new Error(`Usage: ${RUNTIME_USAGE}`), { code: 'USAGE' });
}

function out(json, value, lines) {
  if (json) process.stdout.write(`${JSON.stringify(value)}\n`);
  else for (const line of lines) console.log(line);
}

export async function runtimeCommand(rest) {
  const json = rest.includes('--json');
  try {
    return await run(rest, json);
  } catch (error) {
    if (!json) throw error;
    process.stdout.write(`${JSON.stringify({ error: { code: error.code ?? 'ERROR', message: error.message, ...(error.review ? { review: error.review } : {}), ...(error.shared ? { shared: error.shared } : {}), ...(error.problems ? { problems: error.problems } : {}), ...(error.blocking ? { blocking: error.blocking } : {}) } })}\n`);
    process.exitCode = 1;
    return null;
  }
}

async function run(rest, json) {
  const root = await findProjectRoot();
  if (!root) throw Object.assign(new Error('No .yallaflow workspace found. Run `yallaflow init` first.'), { code: 'NO_WORKSPACE' });
  const [action, ...args] = rest;
  const plain = args.filter((token) => token !== '--json');

  if (action === 'list' || action === 'status') {
    if (plain.length) throw usage();
    const status = await collectRuntime(root);
    return out(json, status, statusLines(status));
  }
  if (action === 'suggest') {
    if (plain.length) throw usage();
    const profiles = await loadRuntimeProfiles(root);
    const suggestions = await suggestServices(root, { existing: profiles.services });
    return out(json, { schema: RUNTIME_SCHEMA, suggestions }, suggestions.length
      ? [...suggestions.map((s, index) => `${index + 1}. ${s.id} — ${s.name}: ${JSON.stringify(s.command)} in ${s.cwd} (from ${s.evidence.join(', ')})${s.note ? `\n   ${s.note}` : ''}`), '', 'Suggestions never run. Add one with `yallaflow runtime add --from-suggestion <n>`, review it, then `yallaflow runtime trust <id>`.']
      : ['No suggestions from this repository. Add a service with `yallaflow runtime add`.']);
  }
  if (action === 'add') return add(root, args, json);
  // PF-0072: Analyze Project, the runtime plan, and the review before trust.
  if (action === 'analyze') {
    if (plain.length) throw usage();
    const { analyzeWorkspace } = await import('../runtime/discover.js');
    const { storeScanPlan } = await import('../runtime/plan.js');
    const scan = await analyzeWorkspace(root);
    const { plan, changes } = await storeScanPlan(root, scan);
    return out(json, { schema: RUNTIME_SCHEMA, scan: plan.scan, changes }, planLines(plan.scan, 'Analysis (read-only; nothing was run)'));
  }
  if (action === 'plan') return planCommand(root, plain, json);
  if (action === 'review') {
    if (plain.length !== 1) throw usage();
    const { reviewService } = await import('../runtime/review.js');
    const review = await reviewService(root, plain[0]);
    return out(json, { schema: RUNTIME_SCHEMA, review }, reviewLines(review));
  }
  if (action === 'remove') {
    const { values, positionals } = parseArgs({ args: plain, options: { local: { type: 'boolean' } }, allowPositionals: true, strict: true });
    if (positionals.length !== 1) throw usage();
    await removeService(root, positionals[0], { local: Boolean(values.local) });
    return out(json, { ok: true, id: positionals[0] }, [`Removed ${positionals[0]} from ${values.local ? '.yallaflow/local/runtime.yaml' : '.yallaflow/runtime.yaml'}. Nothing was stopped; a running service keeps running until you stop it.`]);
  }
  if (action === 'trust') {
    const { values, positionals } = parseArgs({ args: plain, options: { expect: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length !== 1) throw usage();
    const profiles = await loadRuntimeProfiles(root);
    const service = profiles.services.find((entry) => entry.id === positionals[0]);
    if (!service) throw new RuntimeError('RUNTIME_UNKNOWN_SERVICE', `No service ${positionals[0]} in the runtime profile.`);
    // Trust is a human decision. On the command line a person types the id in a terminal; the
    // console trusts in its own process after the typed confirmation (PF-0072 review finding
    // 2: no environment flag can stand in for a person). A non-interactive caller (a script,
    // or an agent's tool call) is refused. This prevents trust by automation; it is not a
    // boundary against a process that controls the whole user account.
    const reviewedHash = values.expect ?? await definitionHash(root, service);
    {
      if (!process.stdin.isTTY) throw new RuntimeError('RUNTIME_TRUST_INTERACTIVE', `Trusting a command is a human decision: run \`yallaflow runtime trust ${service.id}\` in a terminal and type the service id, or use Trust in the console. It cannot be scripted.`);
      for (const line of [`Review ${service.id} before trusting it:`, `  command: ${JSON.stringify(service.command)}`, `  cwd: ${service.cwd}`, `  env names: ${service.env.join(', ') || '(none)'}`, `  ports: ${service.ports.join(', ') || '(none)'}`]) console.log(line);
      const typed = await ask(`Type ${service.id} to trust it (anything else cancels): `);
      if (typed.trim() !== service.id) throw new RuntimeError('RUNTIME_TRUST_CANCELLED', 'Not trusted.');
    }
    const record = await trustService(root, service, { expect: reviewedHash });
    return out(json, { ok: true, id: service.id, trustedAt: record.trustedAt }, [
      `Trusted ${service.id} for this checkout (personal, not shared):`,
      `  command: ${JSON.stringify(service.command)}`, `  cwd: ${service.cwd}`, `  env names: ${service.env.join(', ') || '(none)'}`, `  ports: ${service.ports.join(', ') || '(none)'}`,
      `  definition: ${record.hash}`,
      'Trust is personal (kept in your user config folder, not in the repository). Changes to the definition, package/composer script definitions, directly executed shell scripts or selected Compose files require trusting it again. Application code and indirect dependencies remain outside this fingerprint. Nothing was started.'
    ]);
  }
  if (action === 'start' && plain.length === 1 && plain[0] === '--all') {
    // Start project (PF-0069): trusted services only, in dependency order.
    const startedBy = process.env.YALLAFLOW_RUNTIME_VIA === 'console' ? 'console' : 'cli';
    const result = await startAllServices(root, { startedBy });
    if (!result.ok) process.exitCode = 1;
    return out(json, result, [
      ...result.started.map((entry) => entry.already ? `${entry.id} is already ${entry.state}.` : `${entry.id} started: ${entry.state} (pid ${entry.pid}).`),
      ...result.skipped.map((entry) => `${entry.id} not started: ${entry.reason}. Review it, then \`yallaflow runtime trust ${entry.blockedBy}\`.`),
      ...(result.failed ? [`${result.failed.id} failed; the remaining services were not started. ${result.failed.message}`] : []),
      ...(!result.started.length && !result.skipped.length && !result.failed ? ['No runtime services defined. See `yallaflow runtime suggest`.'] : [])
    ]);
  }
  if (action === 'start' || action === 'restart') {
    const confirmShared = action === 'restart' && plain.includes('--confirm-shared');
    const ids = plain.filter((token) => token !== '--confirm-shared');
    if (ids.length !== 1 || (action === 'start' && confirmShared)) throw usage();
    const startedBy = process.env.YALLAFLOW_RUNTIME_VIA === 'console' ? 'console' : 'cli';
    const result = action === 'start' ? await startService(root, ids[0], { startedBy }) : await restartService(root, ids[0], { startedBy, confirmShared });
    return out(json, { ok: true, ...result }, [result.state === 'running-outside' ? `${result.id} already runs outside YallaFlow (${(result.outside ?? []).join(', ')}); it was not started and YallaFlow will never stop it.` : result.already ? `${result.id} is already ${result.state} (pid ${result.pid}).` : `${result.id} ${action === 'restart' ? 'restarted' : 'started'}: ${result.state} (pid ${result.pid}). Logs: yallaflow runtime logs ${result.id}`]);
  }
  if (action === 'stop') {
    if (plain.length === 1 && plain[0] === '--all') {
      const results = await stopAllServices(root);
      return out(json, { ok: results.every((entry) => !entry.error && !entry.survivors?.length), results }, results.length ? results.map(describeStop) : ['No YallaFlow-started service is running.']);
    }
    const confirmShared = plain.includes('--confirm-shared');
    const ids = plain.filter((token) => token !== '--confirm-shared');
    if (ids.length !== 1) throw usage();
    const result = await stopService(root, ids[0], { confirmShared });
    if (result.survivors?.length) process.exitCode = 1;
    return out(json, { ok: !result.survivors?.length, ...result }, [describeStop(result)]);
  }
  if (action === 'logs') {
    const { values, positionals } = parseArgs({ args: plain, options: { lines: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length !== 1) throw usage();
    const lines = values.lines === undefined ? 200 : Number(values.lines);
    if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw Object.assign(new Error('--lines must be 1-1000'), { code: 'USAGE' });
    const profiles = await loadRuntimeProfiles(root);
    if (!profiles.services.some((entry) => entry.id === positionals[0])) throw new RuntimeError('RUNTIME_UNKNOWN_SERVICE', `No service ${positionals[0]} in the runtime profile.`);
    const text = await serviceLogs(root, positionals[0], { lines });
    return out(json, { schema: RUNTIME_SCHEMA, id: positionals[0], lines: text, redaction: 'best-effort' }, text.length ? text : ['(no log output yet)']);
  }
  throw usage();
}

function humanOnly(what) {
  // Like trust: a person in a terminal. The console saves in its own process (finding 2).
  if (!process.stdin.isTTY) throw new RuntimeError('RUNTIME_HUMAN_ONLY', `${what} is the developer's decision: run it in a terminal yourself, or use Setup in the console. An agent can only propose a plan (\`yallaflow runtime plan propose --file\`).`);
}

async function planCommand(root, plain, json) {
  const plan = await import('../runtime/plan.js');
  const [sub, ...rest] = plain;
  if (sub === 'show' && !rest.length) {
    const doc = await plan.readPlan(root);
    return out(json, { schema: RUNTIME_SCHEMA, ...doc }, [
      ...(doc.agent ? planLines(doc.agent, `Agent proposal (${doc.agent.proposedAt})`) : ['No agent proposal.']),
      '',
      ...(doc.scan ? planLines(doc.scan, `Scan (${doc.scan.analyzedAt})`) : ['No scan yet. Run `yallaflow runtime analyze`.'])
    ]);
  }
  if (sub === 'propose') {
    const { values, positionals } = parseArgs({ args: rest, options: { file: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length || !values.file) throw usage();
    let input;
    try { input = JSON.parse(await readFile(values.file, 'utf8')); } catch { throw Object.assign(new Error(`${values.file} is not a readable JSON file.`), { code: 'RUNTIME_PLAN_INVALID' }); }
    const doc = await plan.storeAgentPlan(root, input);
    return out(json, { ok: true, schema: RUNTIME_SCHEMA, agent: doc.agent }, [
      `Proposal stored: ${doc.agent.services.length} service(s), ${doc.agent.unresolved.length} unresolved item(s).`,
      'Nothing was saved to the runtime profile, trusted or started. The developer reviews it in Setup (or `yallaflow runtime plan show`).'
    ]);
  }
  if (sub === 'discard') {
    const which = rest.includes('--agent') ? 'agent' : rest.includes('--scan') ? 'scan' : rest.length ? null : 'all';
    if (!which) throw usage();
    await plan.discardPlan(root, which);
    return out(json, { ok: true, discarded: which }, [`Discarded the ${which === 'all' ? 'whole plan' : `${which} plan`}. The runtime profile is unchanged.`]);
  }
  if (sub === 'save') {
    const { values, positionals } = parseArgs({ args: rest, options: { 'shared-profile': { type: 'boolean' }, replace: { type: 'boolean' }, from: { type: 'string' } }, allowPositionals: true, strict: true });
    if (!positionals.length || (values.from && !['agent', 'scan'].includes(values.from))) throw usage();
    humanOnly('Saving services to the runtime profile');
    const result = await plan.savePlanServices(root, positionals, { from: values.from ?? 'agent', sharedProfile: Boolean(values['shared-profile']), replace: Boolean(values.replace) });
    return out(json, { ok: true, ...result }, [
      ...result.saved.map((entry) => `Saved ${entry.id} to ${entry.profile} — NOT trusted.`),
      'Saving never allows anything to run. Review and trust each service (`yallaflow runtime review <id>`, then `yallaflow runtime trust <id>`), then start it.'
    ]);
  }
  throw usage();
}

function planLines(plan, title) {
  const lines = [title];
  for (const service of plan.services ?? []) {
    lines.push(`- ${service.id} — ${service.name} [${service.confidence}]`, `    command: ${JSON.stringify(service.command)} in ${service.cwd}`);
    if (service.ports?.length) lines.push(`    ports: ${service.ports.join(', ')}`);
    if (service.links?.length) lines.push(`    links: ${service.links.map((link) => link.url).join(' ')}`);
    if (service.shared) lines.push(`    SHARED: ${(service.shared.reasons ?? service.shared.scope ?? []).join('; ')}`);
    if (service.runningOutside?.length) lines.push(`    already running outside YallaFlow: ${service.runningOutside.join(', ')}`);
    for (const conflict of service.conflicts ?? []) lines.push(`    port ${conflict.port} is held by ${conflict.owner}`);
    for (const item of service.blocking ?? []) lines.push(`    BLOCKING: ${item}`);
  }
  for (const item of plan.unresolved ?? []) lines.push(`? unresolved: ${item.item} — ${item.reason}${item.blocking ? ' (blocks trust until resolved)' : ''}`);
  if (plan.nothingFound) lines.push(plan.nothingFound);
  if (plan.coverage) {
    lines.push(`Scanned: ${plan.coverage.scanned.join(', ')}`);
    for (const limit of plan.coverage.limits ?? []) lines.push(`Not scanned: ${limit.what} — ${limit.why}`);
    for (const skipped of plan.coverage.skipped ?? []) lines.push(`Not read: ${skipped.path} — ${skipped.why}`);
  }
  return lines;
}

function reviewLines(review) {
  const e = review.effective;
  return [
    `Review ${review.id} before trusting it:`,
    `  command: ${JSON.stringify(e.command)}`,
    `  folder: ${e.folder ?? e.cwd} (${e.profile})`,
    `  env names: ${e.env.join(', ') || '(none)'} · ports: ${e.ports.join(', ') || '(none)'} · depends on: ${e.dependsOn.join(', ') || '(none)'}`,
    `  trust covers: ${review.covered.join(', ') || '(the definition only)'}`,
    ...review.notCovered.map((entry) => `  not covered: ${entry.what} — ${entry.why}`),
    ...review.blocking.map((entry) => `  BLOCKING: ${entry.reason}`),
    ...(review.shared.shared ? [`  SHARED: ${review.shared.reasons.join('; ')}`] : []),
    review.definitionHash ? `  definition: ${review.definitionHash}` : '  It cannot be trusted until the blocking items are resolved.'
  ];
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function describeStop(result) {
  if (result.left === 'shared') return `${result.id} left running: shared infrastructure (${result.reasons.join('; ')}). Stop it on its own with \`yallaflow runtime stop ${result.id} --confirm-shared\` if no one else needs it.`;
  if (result.error) return `${result.id}: ${result.error}`;
  if (result.already) return `${result.id} was not running.`;
  if (result.acknowledged) return `${result.id} had already ended; marked stopped.`;
  if (result.survivors?.length) return `${result.id}: stop incomplete — still running: ${result.survivors.join(', ')}. YallaFlow does not claim a clean stop.`;
  return `${result.id} stopped${result.forced ? ' (forced after the timeout)' : ''}.`;
}

export async function collectRuntime(root, { now = new Date().toISOString() } = {}) {
  let status;
  let profileError = null;
  try {
    status = await runtimeStatus(root);
  } catch (error) {
    if (error.code !== 'RUNTIME_PROFILE_INVALID') throw error;
    profileError = error.message;
    status = { supported: true, profile: { exists: true }, services: [] };
  }
  let suggestions = [];
  try {
    suggestions = await suggestServices(root, { existing: status.services });
  } catch {
    suggestions = [];
  }
  return { schema: RUNTIME_SCHEMA, generatedAt: now, yallaflowVersion: PACKAGE_VERSION, supported: status.supported, profile: { ...status.profile, error: profileError }, services: status.services, suggestions };
}

function statusLines(status) {
  if (status.profile.error) return [`Runtime profile is invalid: ${status.profile.error}`];
  if (!status.services.length) return ['No runtime services defined. See `yallaflow runtime suggest`, then `yallaflow runtime add`.'];
  return status.services.map((service) => {
    const trust = service.trust.trusted ? 'trusted' : service.trust.reason === 'changed' ? 'NOT trusted (changed since trust)' : 'NOT trusted';
    const ports = service.ports.map((entry) => `${entry.port}${entry.listening ? '*' : ''}`).join(',');
    return `${service.id.padEnd(16)} ${service.state.padEnd(8)} ${trust}${ports ? ` · ports ${ports}` : ''}${service.reason ? ` · ${service.reason}` : ''}${service.unmanagedPorts.length ? ` · port(s) ${service.unmanagedPorts.join(',')} held by a process YallaFlow did not start` : ''}`;
  });
}

async function add(root, args, json) {
  const dash = args.indexOf('--');
  const head = (dash >= 0 ? args.slice(0, dash) : args).filter((token) => token !== '--json');
  const argv = dash >= 0 ? args.slice(dash + 1) : [];
  const { values, positionals } = parseArgs({
    args: head,
    options: {
      name: { type: 'string' }, kind: { type: 'string' }, cwd: { type: 'string' }, port: { type: 'string', multiple: true }, env: { type: 'string', multiple: true },
      'ready-port': { type: 'string' }, 'ready-log': { type: 'string' }, 'stop-signal': { type: 'string' }, 'depends-on': { type: 'string', multiple: true },
      local: { type: 'boolean' }, 'from-suggestion': { type: 'string' }
    },
    allowPositionals: true, strict: true
  });
  let service;
  if (values['from-suggestion'] !== undefined) {
    if (positionals.length || argv.length) throw usage();
    const profiles = await loadRuntimeProfiles(root);
    const suggestions = await suggestServices(root, { existing: profiles.services });
    const key = values['from-suggestion'];
    const picked = /^\d+$/.test(key) ? suggestions[Number(key) - 1] : suggestions.find((entry) => entry.id === key);
    if (!picked) throw Object.assign(new Error(`No suggestion ${key}. See \`yallaflow runtime suggest\`.`), { code: 'RUNTIME_UNKNOWN_SUGGESTION' });
    const { evidence, note, ...definition } = picked;
    service = Object.fromEntries(Object.entries(definition).filter(([key, value]) => value !== null && !(['env', 'ports'].includes(key) && Array.isArray(value) && !value.length)));
  } else {
    if (positionals.length !== 1 || !argv.length) throw usage();
    const number = (text, flag) => { const value = Number(text); if (!Number.isInteger(value)) throw Object.assign(new Error(`${flag} must be an integer`), { code: 'USAGE' }); return value; };
    // A personal override of a shared service holds only the fields given here.
    const existing = (await loadRuntimeProfiles(root)).shared?.services.some((entry) => entry.id === positionals[0]);
    const override = Boolean(values.local) && existing;
    if (override && values.kind) throw Object.assign(new Error('kind cannot be overridden; remove and add the service instead.'), { code: 'USAGE' });
    service = override
      ? { id: positionals[0], command: argv, ...(values.name ? { name: values.name } : {}), ...(values.cwd ? { cwd: values.cwd } : {}) }
      : { id: positionals[0], name: values.name ?? positionals[0], kind: values.kind ?? 'process', command: argv, cwd: values.cwd ?? '.' };
    if (values.env?.length) service.env = values.env;
    if (values.port?.length) service.ports = values.port.map((port) => number(port, '--port'));
    if (values['ready-port'] !== undefined && values['ready-log'] !== undefined) throw Object.assign(new Error('Use --ready-port or --ready-log, not both.'), { code: 'USAGE' });
    if (values['ready-port'] !== undefined) service.ready = { port: number(values['ready-port'], '--ready-port') };
    if (values['ready-log'] !== undefined) service.ready = { log: values['ready-log'] };
    if (values['stop-signal']) service.stopSignal = values['stop-signal'];
    if (values['depends-on']?.length) service.dependsOn = values['depends-on'];
  }
  const profiles = await addService(root, service, { local: Boolean(values.local) });
  const effective = profiles.services.find((entry) => entry.id === service.id);
  const trust = await trustState(root, effective);
  return out(json, { ok: true, id: service.id, trusted: trust.trusted }, [
    `Added ${service.id} to ${values.local ? '.yallaflow/local/runtime.yaml (personal)' : '.yallaflow/runtime.yaml (shared)'}:`,
    `  command: ${JSON.stringify(effective.command)} in ${effective.cwd}`,
    'Nothing was started. Review it, then `yallaflow runtime trust ' + service.id + '` and `yallaflow runtime start ' + service.id + '`.'
  ]);
}
