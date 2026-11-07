// `yallaflow history …` (1.4.0, PF-0052): reconcile diverged work histories by preserving
// the other side's records in a read-only lineage. `plan` is a dry-run and writes nothing
// to the workspace (only to the --out file you name).
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from '../core/workspace.js';
import { buildPlan, importLineage, listLineages, mapIdentity, readLineage, readLineageIdentity, removeLineage, verifyLineage, verifyMerge } from '../history/lineage.js';
import { realpath } from 'node:fs/promises';

export const HISTORY_USAGE = [
  'yallaflow history plan --label LABEL --from-ref REF [--from-dir CHECKOUT] [--out FILE] [--json]   (dry-run)',
  'yallaflow history import --plan FILE --confirm HASH-PREFIX [--from-dir CHECKOUT] [--allow-secrets]',
  'yallaflow history verify-merge --plan FILE   (after git merge --no-commit and the plan\'s restore commands)',
  'yallaflow history list [--json] | yallaflow history show LABEL[:ID] [--json]',
  'yallaflow history map LABEL:ID --to ID --relation reconfirms|supersedes|disputes|distinct|canonical-continuation --work WORK-ID --reason TEXT',
  'yallaflow history remove LABEL --confirm HASH-PREFIX [--force]   (rollback; only an intact, unreferenced lineage)'
].join('\n  ');

const usage = () => Object.assign(new Error(`Usage: ${HISTORY_USAGE}`), { code: 'USAGE' });
const out = (json, value, lines) => (json ? process.stdout.write(`${JSON.stringify(value)}\n`) : lines.forEach((line) => console.log(line)));

export async function historyCommand(rest) {
  const json = rest.includes('--json');
  try {
    return await run(rest.filter((token) => token !== '--json'), json);
  } catch (error) {
    if (!json) throw error;
    process.stdout.write(`${JSON.stringify({ error: { code: error.code ?? 'ERROR', message: error.message } })}\n`);
    process.exitCode = 1;
    return null;
  }
}

function describePlan(plan) {
  const b = plan.body;
  const lines = [`History plan ${b.label} (dry-run; nothing was written to the workspace)`, `  this workspace: ${b.workspace.head.slice(0, 12)} · other: ${b.other.ref} ${b.other.commit.slice(0, 12)}${b.other.checkout ? ' + its checkout (uncommitted records included)' : ''} · merge base ${b.mergeBase.slice(0, 12)}`];
  const unchanged = (b.inventory ?? []).filter((entry) => ['identical', 'workspace-only', 'diverged-workspace'].includes(entry.classification));
  if (unchanged.length) lines.push(`  unchanged here: ${unchanged.length} identities (complete per-ID classification and hashes in --json inventory)`);
  for (const entry of b.identities) {
    lines.push(`  ${entry.kind.padEnd(5)} ${entry.id.padEnd(10)} ${entry.classification.padEnd(19)} → ${entry.action}`);
    if (entry.kind === 'fact') {
      if (entry.other) lines.push(`        other: [${entry.other.state}] ${entry.other.summary.slice(0, 110)}`);
      if (entry.workspace) lines.push(`        here:  [${entry.workspace.state}] ${entry.workspace.summary.slice(0, 110)}`);
    }
  }
  lines.push(`  files to preserve: ${b.preserve.length} (${b.preserve.filter((f) => f.side === 'other').length} other, ${b.preserve.filter((f) => f.side === 'workspace').length} workspace; ${b.preserve.filter((f) => f.origin === 'checkout:uncommitted').length} uncommitted)`);
  if (b.skipped.length) lines.push(`  not read: ${b.skipped.map((s) => `${s.path} (${s.reason})`).join(', ')}`);
  for (const r of b.gitResolution) lines.push(`  merge resolution: ${r.path} → ${r.take}`);
  if (b.preserve.some((f) => f.secretLike)) lines.push(`  WARNING secret-looking content in: ${b.preserve.filter((f) => f.secretLike).map((f) => `${f.side}:${f.path}`).join(', ')}`);
  lines.push('  merge commands (after import):', ...b.mergeCommands.map((c) => `    ${c}`));
  lines.push(`  plan hash: ${plan.hash}`);
  return lines;
}

async function run(rest, json) {
  const root = await findProjectRoot();
  if (!root) throw Object.assign(new Error('No .yallaflow workspace found.'), { code: 'NO_WORKSPACE' });
  const [action, ...args] = rest;
  if (action === 'plan') {
    const { values, positionals } = parseArgs({ args, options: { label: { type: 'string' }, 'from-ref': { type: 'string' }, 'from-dir': { type: 'string' }, out: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length || !values.label || !values['from-ref']) throw usage();
    const plan = await buildPlan(root, { label: values.label, fromRef: values['from-ref'], fromDir: values['from-dir'] ? path.resolve(values['from-dir']) : null });
    if (values.out) {
      const target = path.join(await realpath(path.dirname(path.resolve(values.out))), path.basename(values.out));
      if (target.startsWith(`${await realpath(path.join(root, '.yallaflow'))}${path.sep}`)) throw Object.assign(new Error('--out must be outside .yallaflow (the dry-run writes nothing there).'), { code: 'HISTORY_USAGE' });
      await writeFile(target, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
    }
    return out(json, plan, [...describePlan(plan), values.out ? `  saved to ${values.out}` : '  (pass --out FILE to keep it for import)']);
  }
  if (action === 'import') {
    const { values, positionals } = parseArgs({ args, options: { plan: { type: 'string' }, confirm: { type: 'string' }, 'from-dir': { type: 'string' }, 'allow-secrets': { type: 'boolean' } }, allowPositionals: true, strict: true });
    if (positionals.length || !values.plan || !values.confirm) throw usage();
    const plan = JSON.parse(await readFile(path.resolve(values.plan), 'utf8'));
    const result = await importLineage(root, plan, { confirm: values.confirm, fromDir: values['from-dir'] ? path.resolve(values['from-dir']) : null, allowSecrets: Boolean(values['allow-secrets']) });
    return out(json, { ok: true, ...result }, [result.created ? `Preserved ${result.files} file(s) in .yallaflow/lineages/${result.label}/ (read-only history; hashes verified).` : `Lineage ${result.label} was already imported from this plan; nothing changed.`]);
  }
  if (action === 'verify-merge') {
    const { values, positionals } = parseArgs({ args, options: { plan: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length || !values.plan) throw usage();
    const result = await verifyMerge(root, JSON.parse(await readFile(path.resolve(values.plan), 'utf8')));
    return out(json, result, [`Merge verified: ${result.checked} kept/taken record set(s) match their source commits exactly; the lineage is intact.`]);
  }
  if (action === 'list') {
    if (args.length) throw usage();
    const lineages = await listLineages(root);
    return out(json, { lineages }, lineages.length ? lineages.map((l) => `${l.label}  ${l.invalid ? 'INVALID' : `${l.files.length} file(s) from ${l.other.ref} ${l.other.commit.slice(0, 12)}, imported ${l.importedAt}`}`) : ['No lineages.']);
  }
  if (action === 'show') {
    if (args.length !== 1) throw usage();
    if (args[0].includes(':')) {
      const parts = args[0].split(':');
      if (parts.length !== 2 || !parts[1]) throw usage();
      const record = await readLineageIdentity(root, parts[0], parts[1]);
      return out(json, record, [JSON.stringify(record, null, 2)]);
    }
    const lineage = await readLineage(root, args[0]);
    const integrity = await verifyLineage(root, args[0]);
    return out(json, { ...lineage, integrity }, [
      `Lineage ${lineage.manifest.label} — from ${lineage.manifest.other.ref} ${lineage.manifest.other.commit} (merge base ${lineage.manifest.mergeBase.slice(0, 12)}), imported ${lineage.manifest.importedAt}; integrity OK (${integrity.files} files)`,
      ...lineage.manifest.identities.map((i) => `  ${i.kind} ${i.id}: ${i.classification}`),
      ...(lineage.mappings.mappings.length ? lineage.mappings.mappings.map((m) => `  mapping ${m.from} → ${m.to} (${m.relation}, ${m.work}): ${m.reason}`) : ['  no mappings yet'])
    ]);
  }
  if (action === 'map') {
    const { values, positionals } = parseArgs({ args, options: { to: { type: 'string' }, relation: { type: 'string' }, work: { type: 'string' }, reason: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length !== 1 || !positionals[0].includes(':') || !values.to || !values.relation || !values.work) throw usage();
    const [label, from] = positionals[0].split(':');
    const entry = await mapIdentity(root, label, from, { to: values.to, relation: values.relation, work: values.work, reason: values.reason });
    return out(json, { ok: true, ...entry }, [`Recorded ${label}:${entry.from} → ${entry.to} (${entry.relation}).`]);
  }
  if (action === 'remove') {
    const { values, positionals } = parseArgs({ args, options: { confirm: { type: 'string' }, force: { type: 'boolean' } }, allowPositionals: true, strict: true });
    if (positionals.length !== 1 || !values.confirm) throw usage();
    const result = await removeLineage(root, positionals[0], { confirm: values.confirm, force: Boolean(values.force) });
    return out(json, { ok: true, ...result }, [`Removed lineage ${result.label}.`]);
  }
  throw usage();
}
