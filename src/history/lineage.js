// Preserved lineages (1.4.0, PF-0052): byte-identical, read-only copies of records that
// cannot live at their IDs in this workspace, kept under their ORIGINAL IDs.
//
//   .yallaflow/lineages/<label>/manifest.yaml        immutable: provenance + per-file hashes
//   .yallaflow/lineages/<label>/mappings.yaml        append-only: decided identity mappings
//   .yallaflow/lineages/<label>/other/<.yallaflow path>      records from the other side
//   .yallaflow/lineages/<label>/workspace/<.yallaflow path>  this workspace's own pre-merge copies
//
// A lineage is history, never a second canonical ledger: nothing in it is listed as work,
// becomes active, or receives new records. Import is staged and renamed atomically, is a
// no-op when the same plan was already imported, and never overwrites a different lineage.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { workspacePath } from '../core/workspace.js';
import { loadContextLedger } from '../context/ledger.js';
import { buildPlan, gitResolution, hashOf, LABEL, PLAN_SCHEMA } from './plan.js';
import { dirSource, git, gitSource, overlay, resolveCommit, sha256 } from './source.js';

export const MANIFEST_SCHEMA = 'yallaflow.lineage/1';
const RELATIONS = Object.freeze(['reconfirms', 'supersedes', 'disputes', 'distinct', 'canonical-continuation']);

export const lineagesDir = (root) => path.join(workspacePath(root), 'lineages');
const lineageDir = (root, label) => path.join(lineagesDir(root), label);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

async function readJson(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw fail('HISTORY_LINEAGE_UNSAFE', `${file} is not a single regular file.`);
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

async function realDir(dir) {
  const info = await lstat(dir).catch(() => null);
  if (!info) return false;
  if (info.isSymbolicLink() || !info.isDirectory()) throw fail('HISTORY_LINEAGE_UNSAFE', `${dir} is not a real folder; refusing to use it.`);
  return true;
}

export function validatePlanFile(plan) {
  if (!plan || plan.body?.schema !== PLAN_SCHEMA || typeof plan.hash !== 'string') throw fail('HISTORY_PLAN', 'Not a history plan (yallaflow history plan --out FILE).');
  if (hashOf(plan.body) !== plan.hash) throw fail('HISTORY_PLAN_TAMPERED', 'The plan does not match its hash; create a new plan.');
  if (!LABEL.test(plan.body.label)) throw fail('HISTORY_PLAN', 'The plan has an invalid label.');
  const HEX = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
  if (!HEX.test(plan.body.other?.commit ?? '') || !HEX.test(plan.body.mergeBase ?? '') || !HEX.test(plan.body.workspace?.head ?? '')) throw fail('HISTORY_PLAN_TAMPERED', 'The plan must name full commit ids.');
  const ID = { work: /^PF-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, source: /^SRC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, fact: /^CTX-\d{4,}$/, adr: /^ADR-[A-Za-z0-9._-]+\.md$/ };
  for (const identity of plan.body.identities ?? []) {
    if (!ID[identity.kind] || !ID[identity.kind].test(String(identity.id))) throw fail('HISTORY_PLAN_TAMPERED', `The plan names an invalid identity: ${String(identity.kind).slice(0, 10)} ${String(identity.id).slice(0, 40)}`);
  }
  for (const entry of plan.body.preserve) {
    if (!['other', 'workspace'].includes(entry.side) || typeof entry.path !== 'string' || !entry.path.startsWith('.yallaflow/') || entry.path.split('/').includes('..') || entry.path.includes('\0')) throw fail('HISTORY_PLAN_TAMPERED', `The plan names an invalid path: ${String(entry.path).slice(0, 80)}`);
  }
}

// Re-reads every file the plan preserves and refuses unless its bytes still match.
async function collect(root, plan, { fromDir }) {
  const body = plan.body;
  const otherGit = gitSource(root, body.other.commit);
  const other = fromDir ? overlay(otherGit, await dirSource(fromDir)) : otherGit;
  if (fromDir && sha256(Buffer.from(other.dir)).slice(0, 39) !== body.other.checkout) throw fail('HISTORY_PLAN_MISMATCH', 'The checkout folder is not the one the plan was made from.');
  if (!fromDir && body.other.checkout) throw fail('HISTORY_PLAN_MISMATCH', 'This plan includes uncommitted records: pass the same --from-dir.');
  const workspace = await dirSource(root);
  const out = [];
  for (const entry of body.preserve) {
    const file = (entry.side === 'other' ? other : workspace).files.get(entry.path);
    if (!file) throw fail('HISTORY_PLAN_MISMATCH', `${entry.side}:${entry.path} no longer exists; create a new plan.`);
    const bytes = file.read();
    if (sha256(bytes) !== entry.sha256) throw fail('HISTORY_PLAN_MISMATCH', `${entry.side}:${entry.path} changed since the plan; create a new plan.`);
    out.push({ ...entry, bytes });
  }
  return out;
}

async function writeExclusive(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: 'wx', mode: 0o444 }); // read-only history
}

// hooks.afterFile(index) lets tests inject a failure mid-import.
export async function importLineage(root, plan, { confirm, fromDir = null, allowSecrets = false, now = new Date().toISOString(), hooks = {} } = {}) {
  validatePlanFile(plan);
  if (typeof confirm !== 'string' || confirm.length < 8 || !plan.hash.startsWith(confirm.toLowerCase())) throw fail('HISTORY_CONFIRM', `Confirm the reviewed plan with the first 8 or more characters of its hash (${plan.hash.slice(0, 8)}…).`);
  const label = plan.body.label;
  // A plan only proves its own hash; rebuild it from the same inputs and require the same
  // identities, files and commits (security review, PF-0052).
  const rebuilt = await buildPlan(root, { label, fromRef: plan.body.other.commit, fromDir });
  const essence = (b) => ({ label: b.label, inventory: b.inventory, workspace: b.workspace, gitResolution: b.gitResolution, mergeCommands: b.mergeCommands, identities: b.identities, preserve: b.preserve, mergeBase: b.mergeBase, otherCommit: b.other.commit, checkout: b.other.checkout });
  if (hashOf(essence(rebuilt.body)) !== hashOf(essence(plan.body))) throw fail('HISTORY_PLAN_MISMATCH', 'The plan does not match what the sources show now (rebuilt and compared); create a new plan and review it.');
  const secretLike = plan.body.preserve.filter((entry) => entry.secretLike);
  if (secretLike.length && !allowSecrets) throw fail('HISTORY_SECRETS', `These files look like they contain secret values and would be preserved byte-for-byte (no redaction is possible in a byte-identical copy): ${secretLike.map((e) => `${e.side}:${e.path}`).join(', ')}. Remove the secrets from the source records first, or decide explicitly (--allow-secrets).`);
  const base = lineagesDir(root);
  await mkdir(base, { recursive: true });
  await realDir(base);
  const target = lineageDir(root, label);
  if (await realDir(target)) {
    const existing = await readJson(path.join(target, 'manifest.yaml')).catch(() => null);
    if (existing?.planHash === plan.hash) {
      await verifyLineage(root, label, { references: false });
      return { label, created: false, files: existing.files.length };
    }
    throw fail('HISTORY_LINEAGE_EXISTS', `Lineage ${label} already exists with different content; it is never overwritten. Choose another label.`);
  }
  // Leftovers of an interrupted import are only ever our own staging folders.
  for (const name of await readdir(base)) {
    if (new RegExp(`^\\.staging-${label.replace(/[.]/g, '\\.')}-[0-9a-f]{8}$`).test(name)) await rm(path.join(base, name), { recursive: true, force: true });
  }
  const files = await collect(root, plan, { fromDir });
  const staging = path.join(base, `.staging-${label}-${randomBytes(4).toString('hex')}`);
  await mkdir(staging);
  try {
    for (const [index, entry] of files.entries()) {
      await writeExclusive(path.join(staging, entry.side, entry.path.replace(/^\.yallaflow\//, '')), entry.bytes);
      hooks.afterFile?.(index);
    }
    const manifest = {
      schema: MANIFEST_SCHEMA,
      label,
      importedAt: now,
      planHash: plan.hash,
      workspace: plan.body.workspace,
      other: plan.body.other,
      mergeBase: plan.body.mergeBase,
      identities: plan.body.identities,
      files: files.map(({ side, path: p, sha256: digest, size, origin }) => ({ side, path: p, sha256: digest, size, origin }))
    };
    await writeExclusive(path.join(staging, 'manifest.yaml'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeExclusive(path.join(staging, 'mappings.yaml'), `${JSON.stringify({ schema: 'yallaflow.lineage-mappings/1', mappings: [] }, null, 2)}\n`);
    const referenceIssues = await preservedReferences(root, label, manifest, staging);
    if (referenceIssues.length) throw fail('HISTORY_LINEAGE_INVALID', referenceIssues.join('; '));
    await rename(staging, target); // atomic: the lineage appears complete or not at all
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await verifyLineage(root, label, { references: false });
  return { label, created: true, files: files.length };
}

export async function listLineages(root) {
  let names = [];
  try { names = (await readdir(lineagesDir(root))).filter((name) => LABEL.test(name)).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    try { out.push(await readJson(path.join(lineageDir(root, name), 'manifest.yaml'))); } catch { out.push({ label: name, invalid: true }); }
  }
  return out;
}

export async function readLineage(root, label) {
  if (!LABEL.test(String(label))) throw fail('HISTORY_USAGE', 'Invalid lineage label.');
  if (!(await realDir(lineagesDir(root)))) throw fail('HISTORY_UNKNOWN_LINEAGE', `No lineage ${label}.`);
  const dir = lineageDir(root, label);
  if (!(await realDir(dir))) throw fail('HISTORY_UNKNOWN_LINEAGE', `No lineage ${label}.`);
  return { manifest: await readJson(path.join(dir, 'manifest.yaml')), mappings: await readJson(path.join(dir, 'mappings.yaml')) };
}

// Inspect preserved bytes without changing the lineage or activating historical work.
export async function readLineageIdentity(root, label, id) {
  const lineage = await readLineage(root, label);
  await verifyLineage(root, label);
  const identity = lineage.manifest.identities.find((entry) => entry.id === id);
  if (!identity) throw fail('HISTORY_UNKNOWN_IDENTITY', `No identity ${id} in lineage ${label}.`);
  const prefix = identity.kind === 'fact' ? '.yallaflow/context/index.yaml' : `.yallaflow/${{ work: 'work', source: 'sources', adr: 'decisions' }[identity.kind]}/${id}`;
  const records = [];
  for (const file of lineage.manifest.files.filter((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`))) {
    const handle = await open(path.join(lineageDir(root, label), file.side, file.path.replace(/^\.yallaflow\//, '')), constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw fail('HISTORY_LINEAGE_UNSAFE', 'Preserved record is not a single regular file.');
      const bytes = await handle.readFile();
      if (sha256(bytes) !== file.sha256) throw fail('HISTORY_LINEAGE_INVALID', 'Preserved record changed during inspection.');
      if (identity.kind === 'fact') {
        records.push({ side: file.side, path: file.path, fact: JSON.parse(bytes.toString('utf8')).facts.find((fact) => fact.id === id) ?? null });
      } else records.push({ ...file, encoding: 'base64', content: bytes.toString('base64') });
    } finally { await handle.close(); }
  }
  return { label, identity, records, mappings: lineage.mappings.mappings.filter((entry) => entry.from === id) };
}

// Integrity: every manifest file exists with its hash, no extra files, mappings point to
// existing canonical records.
export async function verifyLineage(root, label, { references = true } = {}) {
  const dir = lineageDir(root, label);
  const { manifest, mappings } = await readLineage(root, label);
  const issues = [];
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.label !== label) issues.push('manifest schema or label mismatch');
  const expected = new Set(['manifest.yaml', 'mappings.yaml']);
  for (const file of manifest.files ?? []) {
    const relative = path.join(file.side, file.path.replace(/^\.yallaflow\//, ''));
    expected.add(relative);
    try {
      const handle = await open(path.join(dir, relative), constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile()) issues.push(`${relative} is not a regular file`);
        else if (info.nlink !== 1) issues.push(`${relative} is hard-linked`);
        else if (sha256(await handle.readFile()) !== file.sha256) issues.push(`${relative} does not match its recorded hash`);
      } finally { await handle.close(); }
    } catch {
      issues.push(`${relative} is missing or unreadable`);
    }
  }
  async function walk(absolute, relative) {
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const childRel = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (![...expected].some((file) => file.startsWith(`${childRel}${path.sep}`))) issues.push(`${childRel}/ is not part of the manifest`);
        else await walk(path.join(absolute, entry.name), childRel);
      } else if (!expected.has(childRel)) issues.push(`${childRel} is not part of the manifest`);
    }
  }
  await walk(dir, '');
  const { ledger } = await loadContextLedger(root).catch(() => ({ ledger: { facts: [] } }));
  for (const mapping of mappings.mappings ?? []) {
    if (mapping.kind === 'fact' && !ledger.facts.some((fact) => fact.id === mapping.to)) issues.push(`mapping ${label}:${mapping.from} → ${mapping.to} names a fact that does not exist`);
    if (mapping.kind !== 'fact') {
      const folder = { work: 'work', source: 'sources', adr: 'decisions' }[mapping.kind];
      const safeId = typeof mapping.to === 'string' && !/[\\/]/.test(mapping.to) && !['.', '..'].includes(mapping.to);
      const info = folder && safeId ? await lstat(path.join(workspacePath(root), folder, mapping.to)).catch(() => null) : null;
      if (!info || info.isSymbolicLink() || (mapping.kind === 'adr' ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) issues.push(`mapping ${label}:${mapping.from} → ${mapping.to} names a ${mapping.kind} that does not exist or is unsafe`);
    }
  }
  issues.push(...await preservedReferences(root, label, manifest));
  if (references) issues.push(...await unresolvedReferences(root, label, manifest, mappings));
  if (issues.length) throw Object.assign(fail('HISTORY_LINEAGE_INVALID', `Lineage ${label} failed integrity checks: ${issues.join('; ')}`), { issues });
  return { label, files: manifest.files.length, mappings: (mappings.mappings ?? []).length };
}

// Records taken from the other side (diverged-other, e.g. PF-0039) keep the other side's
// fact IDs in their knowledge records. Those references are resolved through the
// lineage's mappings, never by rewriting the record. Returns a resolver
// (workId, factId) → { lineage, originalId, canonicalId|null } or null.
export async function lineageReferenceResolver(root) {
  const entries = [];
  for (const manifest of await listLineages(root)) {
    if (manifest.invalid) continue;
    const mappings = (await readLineage(root, manifest.label).catch(() => ({ mappings: { mappings: [] } }))).mappings.mappings ?? [];
    const takenWork = new Set(manifest.identities.filter((i) => i.kind === 'work' && i.classification === 'diverged-other').map((i) => i.id));
    const facts = new Set(manifest.identities.filter((i) => i.kind === 'fact').map((i) => i.id));
    entries.push({ label: manifest.label, takenWork, facts, mappings });
  }
  return (workId, factId) => {
    for (const entry of entries) {
      if (!entry.takenWork.has(workId) || !entry.facts.has(factId)) continue;
      const mapping = entry.mappings.find((m) => m.from === factId);
      return { lineage: entry.label, originalId: factId, canonicalId: mapping?.to ?? null, relation: mapping?.relation ?? null };
    }
    return null;
  };
}

// Preserved work refers to its own side's immutable ledger, never a colliding canonical ID.
async function preservedReferences(root, label, manifest, dir = lineageDir(root, label)) {
  const issues = [];
  for (const side of ['other', 'workspace']) {
    const records = manifest.files.filter((file) => file.side === side && /^\.yallaflow\/work\/[^/]+\/knowledge\.yaml$/.test(file.path));
    if (!records.length) continue;
    const ledger = await readJson(path.join(dir, side, 'context/index.yaml')).catch(() => null);
    const ids = new Set((ledger?.facts ?? []).map((fact) => fact.id));
    for (const file of records) {
      const knowledge = await readJson(path.join(dir, side, file.path.replace(/^\.yallaflow\//, ''))).catch(() => null);
      if (!knowledge) { issues.push(`${side}:${file.path} is not a readable knowledge ledger`); continue; }
      for (const candidate of knowledge.candidates ?? []) {
        for (const ref of [candidate.factId, candidate.relation?.factId].filter(Boolean)) {
          if (!ids.has(ref)) issues.push(`${side}:${file.path} cites missing lineage fact ${ref}`);
        }
      }
    }
  }
  return issues;
}

// Referential integrity for records taken from the other side: every preserved fact
// identity they cite must have a recorded mapping (doctor).
async function unresolvedReferences(root, label, manifest, mappings) {
  const issues = [];
  const facts = new Set(manifest.identities.filter((i) => i.kind === 'fact').map((i) => i.id));
  for (const identity of manifest.identities.filter((i) => i.kind === 'work' && i.classification === 'diverged-other')) {
    let ledger;
    try { ledger = await readJson(path.join(workspacePath(root), 'work', identity.id, 'knowledge.yaml')); } catch { continue; }
    for (const candidate of ledger.candidates ?? []) {
      const refs = [candidate.factId, candidate.relation?.factId].filter(Boolean);
      for (const ref of refs) {
        if (facts.has(ref) && !(mappings.mappings ?? []).some((m) => m.from === ref)) issues.push(`${identity.id} ${candidate.id} cites ${label}:${ref}, which has no mapping yet (record one with history map after the knowledge decision)`);
      }
    }
  }
  return issues;
}

async function citesLineage(target, label) {
  const needle = `.yallaflow/lineages/${label}/`;
  const info = await lstat(target);
  if (info.isFile()) return (await readFile(target, 'utf8')).includes(needle);
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (await citesLineage(path.join(target, entry.name), label)) return true;
  }
  return false;
}

// Every record under .yallaflow (outside lineages and personal state) that cites the lineage.
async function lineageCitations(root, label) {
  const needle = `.yallaflow/lineages/${label}/`;
  const found = [];
  async function walk(dir, relative) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (['lineages', 'local'].includes(rel)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && (await readFile(path.join(dir, entry.name), 'utf8').catch(() => '')).includes(needle)) found.push(rel);
    }
  }
  await walk(workspacePath(root), '');
  return found;
}

// Records a decided relation between a preserved identity and a canonical record. Checks
// facts only (the canonical record exists and cites the lineage); the meaning is the
// decision of whoever records it, with a reason (owner decision 1).
export async function mapIdentity(root, label, from, { to, relation, work, reason, now = new Date().toISOString() }) {
  const { manifest, mappings } = await readLineage(root, label);
  await verifyLineage(root, label, { references: false }); // files intact; references are what mapping resolves
  const identity = manifest.identities.find((entry) => entry.id === from);
  if (!identity) throw fail('HISTORY_UNKNOWN_IDENTITY', `${label}:${from} is not an identity of this lineage.`);
  if (!RELATIONS.includes(relation)) throw fail('HISTORY_USAGE', `--relation must be one of ${RELATIONS.join(', ')}.`);
  if (typeof reason !== 'string' || reason.trim().length < 10) throw fail('HISTORY_USAGE', 'A --reason explaining the verified relation is required.');
  if (typeof work !== 'string' || !/^PF-[A-Za-z0-9-]+$/.test(work) || !(await lstat(path.join(workspacePath(root), 'work', work)).catch(() => null))) throw fail('HISTORY_USAGE', '--work must name the existing work item that took the decision.');
  if ((mappings.mappings ?? []).some((entry) => entry.from === from)) throw fail('HISTORY_MAPPING_EXISTS', `${label}:${from} is already mapped; mappings are append-only.`);
  if (identity.kind === 'fact') {
    const { ledger } = await loadContextLedger(root);
    const fact = ledger.facts.find((entry) => entry.id === to);
    if (!fact) throw fail('HISTORY_UNKNOWN_TARGET', `${to} is not a fact in the canonical ledger.`);
    const cites = (fact.evidence ?? []).some((evidence) => String(evidence.path ?? evidence.description ?? '').includes(`.yallaflow/lineages/${label}/`));
    if (!cites) throw fail('HISTORY_UNCITED', `${to} does not cite lineage ${label} in its evidence; propose it with --evidence .yallaflow/lineages/${label}/other/context/index.yaml#${from}.`);
  } else {
    const where = { work: ['work', /^PF-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/], source: ['sources', /^SRC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/], adr: ['decisions', /^ADR-[A-Za-z0-9._-]+\.md$/] }[identity.kind];
    if (!where || !where[1].test(String(to))) throw fail('HISTORY_UNKNOWN_TARGET', `${to} is not a valid ${identity.kind} identity.`);
    const target = path.join(workspacePath(root), where[0], to);
    const info = await lstat(target).catch(() => null);
    if (!info || info.isSymbolicLink()) throw fail('HISTORY_UNKNOWN_TARGET', `${to} does not exist in this workspace.`);
    if (!(await citesLineage(target, label))) throw fail('HISTORY_UNCITED', `${to} does not cite lineage ${label}; record the relation in it first (for example a ruling or evidence naming .yallaflow/lineages/${label}/…).`);
  }
  const entry = { from, kind: identity.kind, to, relation, work, reason: reason.trim(), recordedAt: now };
  const doc = { ...mappings, mappings: [...(mappings.mappings ?? []), entry] };
  const file = path.join(lineageDir(root, label), 'mappings.yaml');
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  await rename(temp, file);
  return entry;
}

// Rollback of an import: only an intact, unreferenced lineage is removed.
export async function removeLineage(root, label, { confirm, force = false }) {
  const { manifest, mappings } = await readLineage(root, label);
  if (typeof confirm !== 'string' || confirm.length < 8 || !manifest.planHash.startsWith(confirm.toLowerCase())) throw fail('HISTORY_CONFIRM', `Confirm with the first 8 or more characters of the lineage's plan hash (${manifest.planHash.slice(0, 8)}…).`);
  await verifyLineage(root, label, { references: false });
  if ((mappings.mappings ?? []).length) throw fail('HISTORY_REFERENCED', `Lineage ${label} has recorded mappings; it is referenced history and is not removed.`);
  const citations = await lineageCitations(root, label);
  if (citations.length) throw fail('HISTORY_REFERENCED', `Lineage ${label} is cited by ${citations.slice(0, 5).join(', ')}${citations.length > 5 ? ', …' : ''}; it is referenced history and is not removed.`);
  // Files that exist nowhere else (uncommitted on the other side, or this workspace's own
  // pre-merge copies no longer in HEAD) would be lost: refuse.
  const head = gitSource(root, resolveCommit(root, 'HEAD'));
  const unrecoverable = manifest.files.filter((file) => !String(file.origin).startsWith('git:') && head.files.get(file.path)?.sha256 !== file.sha256);
  if (unrecoverable.length && !force) throw fail('HISTORY_UNRECOVERABLE', `Removing lineage ${label} would destroy ${unrecoverable.length} file(s) that exist nowhere else (for example ${unrecoverable[0].side}:${unrecoverable[0].path}). Keep it, or pass --force after recording a ruling.`);
  const trash = path.join(lineagesDir(root), `.staging-${label}-removed-${randomBytes(4).toString('hex')}`);
  await rename(lineageDir(root, label), trash);
  await rm(trash, { recursive: true, force: true });
  return { label, removed: true };
}

// After `git merge --no-commit` and the plan's restore commands: every identity kept as
// "ours" must equal the pre-merge commit exactly, every "theirs" the other commit (no files
// added or missing), and the lineage must be intact.
export async function verifyMerge(root, plan) {
  validatePlanFile(plan);
  const { manifest } = await readLineage(root, plan.body.label);
  if (manifest.planHash !== plan.hash) throw fail('HISTORY_PLAN_MISMATCH', 'The plan hash differs from the imported lineage planHash.');
  await verifyLineage(root, plan.body.label, { references: false });
  const resolution = gitResolution(manifest.identities);
  if (hashOf(resolution) !== hashOf(plan.body.gitResolution)) throw fail('HISTORY_PLAN_MISMATCH', 'The resolution differs from the imported identities.');
  const working = await dirSource(root);
  const ours = gitSource(root, plan.body.workspace.head);
  const theirs = gitSource(root, plan.body.other.commit);
  const problems = [];
  // Read raw entries: include modes, unmerged stages, links and gitlinks. A content-only
  // comparison can certify a clean worktree while committing a different index.
  const entries = (args, index = false) => new Map(git(root, args).split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    const fields = entry.slice(0, tab).split(/\s+/);
    return [entry.slice(tab + 1) + (index && fields[2] !== '0' ? ` [stage ${fields[2]}]` : ''), index ? `${fields[0]} ${fields[1]}` : `${fields[0]} ${fields[2]}`];
  }));
  const index = entries(['ls-files', '-s', '-z', '--', '.yallaflow'], true);
  const trees = Object.fromEntries([['ours', plan.body.workspace.head], ['theirs', plan.body.other.commit]].map(([side, commit]) => [side, entries(['ls-tree', '-r', '-z', '--full-tree', commit, '--', '.yallaflow'])]));
  const targets = [...resolution, { path: '.yallaflow/state/current.yaml', take: 'ours' }];
  for (const r of targets) {
    const matches = (p) => p === r.path || p.startsWith(`${r.path}/`) || p.startsWith(`${r.path} [stage `);
    const select = (files, value = (f) => f) => new Map([...files].filter(([p]) => matches(p)).map(([p, f]) => [p, value(f)]));
    const expected = select((r.take === 'ours' ? ours : theirs).files, (f) => f.sha256);
    const actual = select(working.files, (f) => f.sha256);
    for (const [p, h] of expected) if (actual.get(p) !== h) problems.push(`${p} differs from ${r.take === 'ours' ? 'the pre-merge commit' : 'the other commit'}`);
    for (const p of actual.keys()) if (!expected.has(p)) problems.push(`${p} is extra (not in the selected commit)`);
    for (const skipped of working.skipped) if (matches(skipped.path) || r.path.startsWith(`${skipped.path}/`)) problems.push(`${skipped.path} is extra or unsafe (${skipped.reason})`);
    const expectedIndex = select(trees[r.take]);
    const actualIndex = select(index);
    for (const [p, entry] of expectedIndex) if (actualIndex.get(p) !== entry) problems.push(`${p} index mode/object differs from the selected commit`);
    for (const p of actualIndex.keys()) if (!expectedIndex.has(p)) problems.push(`${p} is extra in the index`);
    try { git(root, ['diff', '--quiet', '--no-ext-diff', '--', r.path]); }
    catch { problems.push(`${r.path} has unstaged changes or could not be checked`); }
  }
  if (problems.length) throw Object.assign(fail('HISTORY_MERGE_MIXED', `The merge mixes records: ${problems.join('; ')}. Run the plan's restore commands.`), { problems });
  return { ok: true, checked: targets.length };
}

export { buildPlan };
