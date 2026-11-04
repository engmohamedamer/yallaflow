import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { parseScopedId } from './ids.js';
import { WORKSPACE_DIR, workspacePath } from './workspace.js';

// ID collisions (legacy PF-#### and SRC-#### only). In a single-user workspace two
// developers on two branches both allocate the next sequential ID, so once the branches
// merge one directory holds two records: Git keeps one side's identity file and merges
// both sides' other files in beside it. A record's identity is a timestamp written at
// creation and never changed (meta.createdAt, source.capturedAt), so the identity-file
// versions reachable from HEAD tell, without any judgment, how many records a directory
// has held. Branch-safe <prefix>-<tag>-#### IDs cannot collide and are not inspected.
//
// Read-only and local: everything degrades to "unknown" outside Git; nothing here
// touches the index, refs, history or the network.

export const COLLISION_KINDS = Object.freeze({
  work: { prefix: 'PF', dir: 'work', file: 'meta.yaml', identity: 'createdAt', label: 'work item', command: 'work split', title: (record) => record.title ?? record.rawRequest ?? '' },
  source: { prefix: 'SRC', dir: 'sources', file: 'source.json', identity: 'capturedAt', label: 'source', command: 'source split', title: (record) => record.sourceName ?? '' }
});

const ZERO_BLOB = /^0+$/;

function git(root, args, options = {}) {
  return spawnSync('git', args, { cwd: root, maxBuffer: 1024 * 1024 * 512, ...options });
}

function gitText(root, args) {
  const result = git(root, args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

// Reads many blobs with one `git cat-file --batch`. Returns Map sha -> Buffer.
export function readBlobs(root, shas) {
  const unique = [...new Set(shas)];
  const blobs = new Map();
  if (!unique.length) return blobs;
  const result = git(root, ['cat-file', '--batch'], { input: `${unique.join('\n')}\n` });
  if (result.status !== 0) return blobs;
  const out = result.stdout;
  let offset = 0;
  while (offset < out.length) {
    const headerEnd = out.indexOf(0x0a, offset);
    if (headerEnd === -1) break;
    const [sha, type, size] = out.subarray(offset, headerEnd).toString('utf8').split(' ');
    offset = headerEnd + 1;
    if (type === 'missing') continue;
    const length = Number(size);
    blobs.set(sha, out.subarray(offset, offset + length));
    offset += length + 1; // content plus the trailing newline
  }
  return blobs;
}

export function parseRecord(buffer) {
  try {
    const record = JSON.parse(buffer.toString('utf8'));
    return record && typeof record === 'object' ? record : null;
  } catch {
    return null;
  }
}

export function identityOf(kind, record) {
  const spec = COLLISION_KINDS[kind];
  const value = record?.[spec.identity];
  return typeof value === 'string' && value ? { identity: value, title: spec.title(record) } : null;
}

// Every identity-file blob of each legacy ID reachable from HEAD, including the side of
// a merge that Git discarded (--full-history, -m), as Map id -> Set(blob sha).
function identityBlobsFromHistory(root, spec) {
  const log = gitText(root, ['log', 'HEAD', '--full-history', '-m', '--no-renames', '--format=', '--raw', '--no-abbrev', '--', `${WORKSPACE_DIR}/${spec.dir}`]);
  if (log === null) return null;
  const pattern = new RegExp(`^${WORKSPACE_DIR.replace('.', '\\.')}/${spec.dir}/(${spec.prefix}-\\d+)/${spec.file.replace('.', '\\.')}$`);
  const byId = new Map();
  for (const line of log.split('\n')) {
    if (!line.startsWith(':')) continue;
    const tab = line.indexOf('\t');
    const match = pattern.exec(line.slice(tab + 1));
    if (!match) continue;
    const sha = line.slice(0, tab).split(' ')[3];
    if (!sha || ZERO_BLOB.test(sha)) continue;
    if (!byId.has(match[1])) byId.set(match[1], new Set());
    byId.get(match[1]).add(sha);
  }
  return byId;
}

export async function currentRecords(root, kind) {
  const spec = COLLISION_KINDS[kind];
  const dir = path.join(workspacePath(root), spec.dir);
  const records = new Map();
  if (!await exists(dir)) return records;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !parseScopedId(spec.prefix, entry.name)) continue;
    const file = path.join(dir, entry.name, spec.file);
    if (await exists(file)) records.set(entry.name, parseRecord(await readFile(file)));
  }
  return records;
}

// Records already moved out of a collided ID by a split say where they came from; those
// historical identities are resolved, not collisions.
function resolvedIdentities(records) {
  const resolved = new Set();
  for (const record of records.values()) {
    const from = record?.renumberedFrom;
    if (from?.id && from?.identity) resolved.add(`${from.id}\u0000${from.identity}`);
  }
  return resolved;
}

// { available: false } outside Git (or without a commit), otherwise
// { available: true, collisions: [{ kind, id, current, others: [{ identity, title }...] }] }
// where `current` is the record the directory holds now and `others` are the records that
// also lived under this ID in history and have not been split off.
export async function detectCollisions(root, kind) {
  const spec = COLLISION_KINDS[kind];
  if (!gitText(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) return { available: false, collisions: [] };
  const history = identityBlobsFromHistory(root, spec);
  if (!history) return { available: false, collisions: [] };
  const records = await currentRecords(root, kind);
  const blobs = readBlobs(root, [...history.values()].flatMap((set) => [...set]));
  const resolved = resolvedIdentities(records);
  const collisions = [];
  for (const [id, shas] of [...history.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const current = identityOf(kind, records.get(id));
    if (!current) continue;
    const others = new Map();
    for (const sha of shas) {
      const other = identityOf(kind, parseRecord(blobs.get(sha) ?? Buffer.alloc(0)));
      if (!other || other.identity === current.identity || resolved.has(`${id}\u0000${other.identity}`)) continue;
      if (!others.has(other.identity)) others.set(other.identity, other);
    }
    if (others.size) collisions.push({ kind, id, current, others: [...others.values()].sort((a, b) => a.identity.localeCompare(b.identity)) });
  }
  return { available: true, collisions };
}

export async function detectAllCollisions(root) {
  const work = await detectCollisions(root, 'work');
  const sources = await detectCollisions(root, 'source');
  return { available: work.available, collisions: [...sources.collisions, ...work.collisions] };
}

export function describeCollision({ kind, id, current, others }) {
  const spec = COLLISION_KINDS[kind];
  const quote = (record) => `"${record.title}" (${kind === 'work' ? 'created' : 'captured'} ${record.identity.slice(0, 10)})`;
  return `${kind === 'work' ? 'work' : 'source'} ID collision: ${id} holds ${others.length + 1} ${spec.label}s merged from different branches — ${quote(current)} is in the directory now; ${others.map(quote).join(', ')} also lived here. Run \`yallaflow ${spec.command} ${id}\` to restore ${others.length === 1 ? 'it' : 'them'} under a new ID.`;
}
