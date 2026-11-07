// `yallaflow new …` (1.4.0): the New Project Wizard on the command line.
import { parseArgs } from 'node:util';
import path from 'node:path';
import { CATALOG, describeCatalog } from '../newproject/catalog.js';
import { createFromPlan, createPlan, discardPlan, listPlans, loadPlan } from '../newproject/project.js';
import { initProject } from './init.js';
import { createPendingIntake } from '../behavior/routing.js';
import { shellQuote } from '../security/redact.js';

export const NEW_USAGE = [
  'yallaflow new catalog [--json]',
  'yallaflow new recommend',
  'yallaflow new plan --name NAME --parent DIR --stack ID [--install] [--allow-nested] [--rationale TEXT] [--description TEXT] [--requirements TEXT] [--environment docker|local|later] [--git] [--attachment SHA256:SIZE:NAME]... [--json]',
  'yallaflow new show <plan-id> [--json] | yallaflow new list [--json]',
  'yallaflow new create <plan-id> --confirm <hash-prefix> [--json]',
  'yallaflow new discard <plan-id> [--json]'
].join('\n  ');

// Core entry points used by creation: canonical init and a first, unrouted work item kept
// for the developer (never routed on their behalf, never made active).
export const CORE_HOOKS = Object.freeze({
  initProject: (root, { name, origin }) => initProject(root, { name, kind: 'greenfield', mode: 'adaptive', origin }),
  firstWork: async (root, request, titleHint) => (await createPendingIntake(root, request, { keepActive: true, ...(titleHint ? { titleHint } : {}) })).id
});

// --attachment SHA256:SIZE:NAME (the console computes the digest of each file it will upload).
function parseAttachment(text) {
  const match = /^([0-9a-f]{64}):(\d{1,12}):(.+)$/.exec(String(text));
  if (!match) throw Object.assign(new Error('--attachment must be SHA256:SIZE:NAME.'), { code: 'NEW_PROJECT_ATTACHMENTS' });
  return { sha256: match[1], size: Number(match[2]), name: match[3] };
}

function usage() {
  return Object.assign(new Error(`Usage: ${NEW_USAGE}`), { code: 'USAGE' });
}

export const RECOMMEND_REQUEST = 'Recommend a stack for a new project. Ask me what I am building if you do not know yet, then choose one stack from `yallaflow new catalog` and run `yallaflow new plan --name <name> --parent <folder> --stack <id> --rationale "<why this stack fits>"`. Do not create the project: I review the plan and confirm it myself.';

export function describePlan(plan) {
  const b = plan.body;
  const lines = [
    `Plan ${plan.id} — ${b.stackLabel}`,
    `  Destination: ${b.destination} (must not exist; nothing existing is overwritten)`,
    `  Stack: ${b.technologies.join(', ') || '(none)'}`,
    b.generator ? `  Generator: ${b.generator.package}@${b.generator.version} (${b.generator.tool}) — ${b.docs}` : '  Generator: none (an empty folder)',
    ...b.steps.filter((step) => step.argv).map((step) => `  Runs: ${step.argv.join(' ')}${step.network ? '  [network]' : ''}${step.installsDependencies ? '  [installs dependencies]' : ''}${step.runsPackageScripts ? '  [runs package scripts]' : ''}`),
    `  Then: ${b.steps.filter((step) => !step.argv).map((step) => step.note).join('; ')}`,
    `  Expected structure: ${b.expectedStructure.join(', ')}`,
    ...b.prerequisites.map((p) => `  Prerequisite ${p.name}: ${p.found ? p.version || 'found' : 'NOT FOUND — install it first'}${p.note ? ` (${p.note})` : ''}`),
    ...(b.nestedIn ? [`  Note: inside ${b.nestedIn} (allowed with --allow-nested)`] : []),
    ...(b.rationale ? [`  Recommendation rationale: ${b.rationale}`] : []),
    ...(b.intent?.description ? [`  Goal: ${b.intent.description.split(/\r?\n/)[0]}`] : []),
    ...(b.environment ? [`  Development environment: ${b.environment}`] : []),
    ...(b.git ? ['  Git: a new local repository (no remote, no commit)'] : []),
    ...(b.attachments?.length ? [`  Attachments: ${b.attachments.map((a) => a.name).join(', ')}`] : []),
    `  Hash: ${plan.hash}`
  ];
  const status = Object.entries(plan.progress.steps).map(([step, state]) => `${step}:${state.status}`).join(', ');
  if (status) lines.push(`  Progress: ${status}${plan.progress.staging && !plan.progress.stagingRemoved ? ` · staging ${plan.progress.staging}` : ''}`);
  return lines;
}

export async function newCommand(rest) {
  const json = rest.includes('--json');
  try {
    return await run(rest.filter((token) => token !== '--json'), json);
  } catch (error) {
    if (!json) throw error;
    process.stdout.write(`${JSON.stringify({ error: { code: error.code ?? 'ERROR', message: error.message, ...(error.staging ? { staging: error.staging } : {}) } })}\n`);
    process.exitCode = 1;
    return null;
  }
}

const out = (json, value, lines) => (json ? process.stdout.write(`${JSON.stringify(value)}\n`) : lines.forEach((line) => console.log(line)));

async function run(rest, json) {
  const [action, ...args] = rest;
  if (action === 'catalog') {
    if (args.length) throw usage();
    const catalog = describeCatalog(CATALOG);
    return out(json, { schema: 'yallaflow.new-project-catalog/1', catalog, recommendRequest: RECOMMEND_REQUEST }, catalog.map((entry) => `${entry.id.padEnd(11)} ${entry.label}${entry.command ? ` — ${entry.command.join(' ')}` : ''}${entry.network ? ' [network]' : ''}`));
  }
  if (action === 'recommend') {
    if (args.length) throw usage();
    return out(json, { request: RECOMMEND_REQUEST }, ['Give your coding agent this request:', '', RECOMMEND_REQUEST]);
  }
  if (action === 'plan') {
    const { values, positionals } = parseArgs({ args, options: { name: { type: 'string' }, parent: { type: 'string' }, stack: { type: 'string' }, install: { type: 'boolean' }, 'allow-nested': { type: 'boolean' }, rationale: { type: 'string' }, description: { type: 'string' }, requirements: { type: 'string' }, environment: { type: 'string' }, git: { type: 'boolean' }, attachment: { type: 'string', multiple: true } }, allowPositionals: true, strict: true });
    if (positionals.length || !values.name || !values.parent || !values.stack) throw usage();
    const plan = await createPlan({ name: values.name, parent: path.resolve(values.parent), stack: values.stack, install: Boolean(values.install), allowNested: Boolean(values['allow-nested']), rationale: values.rationale ?? null, description: values.description ?? null, requirements: values.requirements ?? null, environment: values.environment ?? null, git: Boolean(values.git), attachments: (values.attachment ?? []).map(parseAttachment) });
    return out(json, plan, [...describePlan(plan), '', `Nothing was created. After reviewing: yallaflow new create ${plan.id} --confirm ${plan.hash.slice(0, 8)}`]);
  }
  if (action === 'show') {
    if (args.length !== 1) throw usage();
    const plan = await loadPlan(args[0]);
    return out(json, plan, describePlan(plan));
  }
  if (action === 'list') {
    if (args.length) throw usage();
    const plans = await listPlans();
    return out(json, { plans: plans.map((plan) => ({ id: plan.id, name: plan.body.name, stack: plan.body.stack, destination: plan.body.destination, progress: plan.progress })) }, plans.length ? plans.map((plan) => `${plan.id}  ${plan.body.stack.padEnd(11)} ${plan.body.destination}`) : ['No plans.']);
  }
  if (action === 'create') {
    const { values, positionals } = parseArgs({ args, options: { confirm: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length !== 1 || !values.confirm) throw usage();
    // Creating a project after reviewing its plan is a human decision: from a terminal, or
    // from the console's confirmed page. A script or an agent's tool call is refused (this
    // prevents automation from confirming its own plan; it is not a boundary against a
    // process that controls the whole user account).
    if (!process.stdin.isTTY && process.env.YALLAFLOW_NEW_VIA !== 'console') throw Object.assign(new Error('Creating a project is a human decision: run `yallaflow new create` in a terminal after reviewing the plan, or confirm it on the console\'s New project page. It cannot be scripted.'), { code: 'NEW_PROJECT_INTERACTIVE' });
    const result = await createFromPlan(positionals[0], values.confirm, { hooks: CORE_HOOKS, onStep: (step, status) => { if (!json) console.log(`${step}: ${status}`); } });
    return out(json, { ok: true, ...result }, [
      `Created ${result.destination} with YallaFlow initialized (${result.stack === 'empty' ? 'new empty project' : 'new project; the generated code has not been reviewed'}).`,
      `First work item: ${result.workId} (not routed, not active).`,
      `Next: open your coding agent in ${result.destination} and describe what you are building. Add it to the console with \`yallaflow console add ${shellQuote(result.destination)}\`.`
    ]);
  }
  if (action === 'discard') {
    if (args.length !== 1) throw usage();
    const result = await discardPlan(args[0]);
    return out(json, { ok: true, ...result }, [result.note ?? (result.removed ? `Removed the staging folder of ${args[0]}.` : `${args[0]} had no staging folder to remove.`)]);
  }
  throw usage();
}
