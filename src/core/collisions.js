// Probable work-ID collision diagnosis (v1.2.0, read-only).
//
// Outside a Shared Project, work and source IDs are plain sequence numbers (PF-####,
// SRC-####). Two branches can each create the same ID; a later Git merge then combines
// two different items' files in one directory. Core validation rejects the result
// (for example "Progress ledger for PF-0091 uses registry v8, but its Behavior Contract
// uses registry v9"), but the message does not say why. This module names the signals
// that point to a merge and the commits that added each side. It never changes a file:
// the repair is a separate, explicitly approved step.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml } from './yaml.js';
import { workspacePath } from './workspace.js';
import { loadSource } from './sources.js';

const MAX_GIT_LOOKUPS = 40;

async function readOptional(file) {
  try {
    return await readYaml(file);
  } catch {
    return null;
  }
}

function earliest(times) {
  return times.filter((value) => typeof value === 'string' && value).sort()[0] ?? null;
}

// Signals for one work item, from its raw files (no Core validation, so a broken item can
// still be described). Empty when nothing points to a collision.
export async function collisionSignals(root, meta) {
  if (!meta?.id || meta.routingStatus === 'pending') return [];
  const dir = path.join(workspacePath(root), 'work', meta.id);
  const signals = [];
  const contract = meta.behaviorContract ?? {};
  const contractSkills = Array.isArray(contract.skills) ? contract.skills : [];
  const ledger = await readOptional(path.join(dir, 'progress.yaml'));
  if (ledger && typeof ledger === 'object') {
    const ledgerVersion = ledger.behavior?.registryVersion;
    if (Number.isInteger(ledgerVersion) && Number.isInteger(contract.registryVersion) && ledgerVersion !== contract.registryVersion) {
      signals.push(`progress ledger uses registry v${ledgerVersion}, but the pinned Behavior Contract uses v${contract.registryVersion}`);
    }
    const foreign = Object.keys(ledger.skills ?? {}).filter((skill) => contractSkills.length && !contractSkills.includes(skill));
    if (foreign.length) signals.push(`progress ledger records steps outside this item's contract (${foreign.join(', ')})`);
    const first = earliest(Object.values(ledger.skills ?? {}).flatMap((entry) => [entry?.startedAt, entry?.completedAt]));
    if (first && meta.createdAt && first < meta.createdAt) signals.push(`progress ledger entries (${first}) predate the item's creation (${meta.createdAt})`);
  }
  if (!contractSkills.includes('delivery-convergence')) {
    const delivery = [];
    for (const name of ['requirements.yaml', 'convergence.yaml']) if (await exists(path.join(dir, name))) delivery.push(name);
    if (delivery.length) signals.push(`${delivery.join(' and ')} present, but this item's contract has no delivery-convergence`);
  }
  for (const ref of meta.sources ?? []) {
    const id = typeof ref === 'string' ? ref : ref?.id;
    if (!id) continue;
    let record = null;
    try {
      record = await loadSource(root, id);
    } catch {
      continue;
    }
    if (Array.isArray(record?.linkedWork) && !record.linkedWork.includes(meta.id)) signals.push(`${id} is linked to ${record.linkedWork.join(', ') || 'no work item'}, not to ${meta.id} (a source-ID collision)`);
  }
  return signals;
}

// The commits that added a work item's identity files, newest first. Read-only git
// (no optional locks); null when Git is unavailable.
function addedIn(root, relative) {
  try {
    const out = execFileSync('git', ['--no-optional-locks', 'log', '--diff-filter=A', '--format=%h %ad %s', '--date=short', '--', relative], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    });
    return out.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 4);
  } catch {
    return null;
  }
}

export async function diagnoseCollisions(root, metas) {
  const found = [];
  for (const meta of metas) {
    const signals = await collisionSignals(root, meta);
    if (!signals.length) continue;
    const entry = { id: meta.id, title: meta.title ?? meta.rawRequest ?? null, signals, added: null };
    if (found.length < MAX_GIT_LOOKUPS) {
      const base = path.relative(root, path.join(workspacePath(root), 'work', meta.id)).split(path.sep).join('/');
      const meta1 = addedIn(root, `${base}/meta.yaml`);
      const ledger = addedIn(root, `${base}/progress.yaml`);
      const requirements = signals.some((signal) => signal.startsWith('requirements.yaml')) ? addedIn(root, `${base}/requirements.yaml`) : null;
      if (meta1 || ledger || requirements) entry.added = { meta: meta1 ?? [], progress: ledger ?? [], requirements: requirements ?? [] };
    }
    found.push(entry);
  }
  return found;
}
