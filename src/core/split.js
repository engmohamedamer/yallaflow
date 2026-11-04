import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { COLLISION_KINDS, currentRecords, detectCollisions, readBlobs } from './collisions.js';
import { WORKSPACE_DIR, nextWorkId, workspacePath } from './workspace.js';
import { linkSourceToWork, nextSourceId, sourceRecordPath, unlinkSourceFromWork } from './sources.js';
import { writeYaml } from './yaml.js';

// `yallaflow work split <PF-####>` and `yallaflow source split <SRC-####>` (see
// core/collisions.js): restore every other record that lived under a collided legacy ID
// from its own Git history into a new ID, and take its files out of the shared
// directory. Attribution is by content only — a file belongs to a record when it is
// byte-identical to that record's own committed version — so nothing is guessed: a file
// that matches no single side stops the split.

const TEXT_FILE = /\.(md|ya?ml|json|txt|csv)$/i;

function gitText(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });
  return result.status === 0 ? result.stdout : null;
}

function isAncestor(root, ancestor, commit) {
  return spawnSync('git', ['merge-base', '--is-ancestor', ancestor, commit], { cwd: root }).status === 0;
}

// Map relative path -> blob sha of a record directory at a commit.
function treeAt(root, commit, dir) {
  const out = gitText(root, ['ls-tree', '-r', '--full-tree', commit, '--', `${dir}/`]) ?? '';
  const files = new Map();
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const [, type, sha] = line.slice(0, tab).split(' ');
    if (type === 'blob') files.set(line.slice(tab + 1).slice(dir.length + 1), sha);
  }
  return files;
}

async function workingFiles(dir, prefix = '') {
  const files = [];
  if (!await exists(dir)) return files;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await workingFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function hashFiles(root, absolutePaths) {
  if (!absolutePaths.length) return [];
  const out = spawnSync('git', ['hash-object', '--stdin-paths'], { cwd: root, encoding: 'utf8', input: `${absolutePaths.join('\n')}\n` });
  if (out.status !== 0) throw new Error(`git hash-object failed: ${out.stderr}`);
  return out.stdout.trim().split('\n');
}

// The ID as a whole token: PF-0007 but not PF-00071 or PF-0007-x.
function idToken(id) {
  return new RegExp(`(?<![\\w-])${id}(?![\\w-])`, 'g');
}

function recordDir(kind, id) {
  return `${WORKSPACE_DIR}/${COLLISION_KINDS[kind].dir}/${id}`;
}

// Each record that ever lived under the ID, with the commit holding its own files before
// any other record's files were merged in.
function ownSnapshots(root, kind, id, identities) {
  const spec = COLLISION_KINDS[kind];
  const dir = recordDir(kind, id);
  const commits = (gitText(root, ['log', 'HEAD', '--full-history', '--format=%H', '--', dir]) ?? '').split('\n').filter(Boolean);
  const trees = commits.map((commit) => ({ commit, files: treeAt(root, commit, dir) }));
  const blobs = readBlobs(root, trees.map((tree) => tree.files.get(spec.file)).filter(Boolean));
  for (const tree of trees) {
    try {
      tree.identity = JSON.parse(blobs.get(tree.files.get(spec.file))?.toString('utf8') ?? 'null')?.[spec.identity] ?? null;
    } catch {
      tree.identity = null;
    }
  }
  // Oldest commit of each identity: once it is an ancestor, that record's files may be in the tree.
  const firstCommit = new Map();
  for (const tree of [...trees].reverse()) if (tree.identity && !firstCommit.has(tree.identity)) firstCommit.set(tree.identity, tree.commit);
  const snapshots = new Map();
  for (const identity of identities) {
    const others = identities.filter((value) => value !== identity).map((value) => firstCommit.get(value)).filter(Boolean);
    const own = trees.find((tree) => tree.identity === identity && others.every((ancestor) => !isAncestor(root, ancestor, tree.commit)));
    if (own) snapshots.set(identity, own);
  }
  return snapshots;
}

// Work items naming a collided source: a reference carries the source's original file
// name, which says mechanically which of the records it meant.
async function sourceReferencePlan(root, sourceId, keptName, moves) {
  const plan = { stay: [], move: [], unresolved: [] };
  for (const [workId, meta] of await currentRecords(root, 'work')) {
    for (const ref of meta?.sources ?? []) {
      if (ref.id !== sourceId) continue;
      const movedTo = moves.filter((item) => item.title === ref.name);
      const stays = keptName === ref.name;
      if (stays && !movedTo.length) plan.stay.push(workId);
      else if (!stays && movedTo.length === 1) plan.move.push({ workId, identity: movedTo[0].identity });
      else plan.unresolved.push(`${workId} references ${sourceId} as "${ref.name ?? '(no name)'}"`);
    }
  }
  return plan;
}

// A read-only plan; applySplit writes it.
export async function planSplit(root, kind, id) {
  const spec = COLLISION_KINDS[kind];
  const { available, collisions } = await detectCollisions(root, kind);
  if (!available) throw new Error(`\`yallaflow ${spec.command}\` reads the ${spec.label} history from Git; this workspace has no Git history.`);
  const collision = collisions.find((item) => item.id === id);
  if (!collision) throw new Error(`${id} holds a single ${spec.label} in Git history (or its other ${spec.label}s were already split off). Nothing to split.`);

  const identities = [collision.current.identity, ...collision.others.map((item) => item.identity)];
  const snapshots = ownSnapshots(root, kind, id, identities);
  const missing = collision.others.filter((item) => !snapshots.has(item.identity));
  if (missing.length) {
    throw new Error(`No commit holds the files of ${missing.map((item) => `"${item.title}"`).join(', ')} on their own (before the other ${spec.label}'s files were merged in), so they cannot be restored without guessing. Nothing was changed.`);
  }
  const current = snapshots.get(collision.current.identity) ?? null;

  const dir = path.join(workspacePath(root), spec.dir, id);
  const files = await workingFiles(dir);
  const hashes = hashFiles(root, files.map((file) => path.join(dir, file)));
  const keep = [];
  const remove = [];
  const restore = [];
  const unresolved = [];
  files.forEach((file, index) => {
    const sha = hashes[index];
    // The identity file defines the record the directory holds now; it is never the other side's.
    if (file === spec.file || current?.files.get(file) === sha) return keep.push(file);
    const owned = collision.others.some((item) => snapshots.get(item.identity).files.get(file) === sha);
    if (owned) return (current?.files.has(file) ? restore : remove).push(file);
    const otherHasIt = collision.others.some((item) => snapshots.get(item.identity).files.has(file));
    if (!otherHasIt) return keep.push(file); // only ever the current record's, or added after the merge
    unresolved.push(file);
  });

  const moves = collision.others.map((item) => ({ ...item, commit: snapshots.get(item.identity).commit, files: [...snapshots.get(item.identity).files.keys()].sort() }));
  const references = kind === 'source' ? await sourceReferencePlan(root, id, collision.current.title, moves) : null;
  if (references) unresolved.push(...references.unresolved);
  return { kind, id, current: { ...collision.current, commit: current?.commit ?? null }, moves, keep, remove, restore, unresolved, references };
}

// Paths outside the record directory that name the ID; after the split they mean the
// record that stays. Reported for review, never rewritten — which record they meant is
// not mechanically known.
async function referencesOutside(root, kind, id, handled) {
  const base = workspacePath(root);
  const token = idToken(id);
  const own = path.join(COLLISION_KINDS[kind].dir, id);
  const hits = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(base, full);
      if (entry.isDirectory()) {
        if (relative === own || relative === 'local') continue;
        await walk(full);
      } else if (TEXT_FILE.test(entry.name) && !handled.has(relative) && (await readFile(full, 'utf8')).match(token)) {
        hits.push(`${WORKSPACE_DIR}/${relative}`);
      }
    }
  };
  await walk(base);
  return hits.sort();
}

// A moved work item's source references: the ID it knew may since have been split off
// to a new ID (renumberedFrom), so resolve each by ID and original file name.
async function resolveSourceRef(ref, sources) {
  const direct = sources.get(ref.id);
  if (!direct || direct.sourceName === ref.name) return ref.id;
  for (const [sourceId, record] of sources) if (record?.renumberedFrom?.id === ref.id && record.sourceName === ref.name) return sourceId;
  return ref.id;
}

async function writeRestored(root, kind, plan, item, newId, now) {
  const spec = COLLISION_KINDS[kind];
  const target = path.join(workspacePath(root), spec.dir, newId);
  const tree = treeAt(root, item.commit, recordDir(kind, plan.id));
  const blobs = readBlobs(root, [...tree.values()]);
  const token = idToken(plan.id);
  for (const [file, sha] of tree) {
    const destination = path.join(target, file);
    await mkdir(path.dirname(destination), { recursive: true });
    let content = blobs.get(sha);
    if (TEXT_FILE.test(file)) {
      let text = content.toString('utf8').replace(token, newId);
      if (file === spec.file) {
        const record = JSON.parse(text);
        record.renumberedFrom = { id: plan.id, identity: item.identity, commit: item.commit, reason: `${kind} ID collision`, at: now };
        text = `${JSON.stringify(record, null, 2)}\n`;
      }
      if (kind === 'work' && file === 'work.md') {
        text = `${text.replace(/\n*$/, '\n')}\n## Renumbered\n\n**From:** ${plan.id} (work ID collision)\n**Restored from commit:** ${item.commit}\n**Timestamp:** ${now}\n`;
      }
      content = text;
    }
    await writeFile(destination, content);
  }
  return target;
}

export async function applySplit(root, plan, { now = new Date().toISOString() } = {}) {
  if (plan.unresolved.length) throw new Error(`Cannot split ${plan.id}: ${plan.unresolved.length} item(s) cannot be attributed to one side.`);
  const spec = COLLISION_KINDS[plan.kind];
  const base = workspacePath(root);
  const dir = path.join(base, spec.dir, plan.id);
  const handled = new Set();
  const moved = [];
  const keptSources = plan.kind === 'work' ? new Set((JSON.parse(await readFile(path.join(dir, spec.file), 'utf8')).sources ?? []).map((ref) => ref.id)) : null;

  for (const item of plan.moves) {
    const newId = plan.kind === 'work' ? await nextWorkId(root) : await nextSourceId(root);
    const target = await writeRestored(root, plan.kind, plan, item, newId, now);
    if (plan.kind === 'work') {
      // The moved item's sources link to it under its new ID; the old ID keeps a source
      // only while the item that stays references it too.
      const metaFile = path.join(target, spec.file);
      const meta = JSON.parse(await readFile(metaFile, 'utf8'));
      const sources = await currentRecords(root, 'source');
      for (const ref of meta.sources ?? []) ref.id = await resolveSourceRef(ref, sources);
      await writeYaml(metaFile, meta);
      for (const ref of meta.sources ?? []) {
        if (!await exists(sourceRecordPath(root, ref.id))) continue; // a missing source is doctor's to report
        // A collided source not split yet still holds the other file: `source split` links it later.
        if (sources.get(ref.id)?.sourceName !== ref.name) continue;
        await linkSourceToWork(root, ref.id, newId);
        if (!keptSources.has(ref.id)) await unlinkSourceFromWork(root, ref.id, plan.id);
      }
    } else {
      // Work items that referenced the moved source by its file name now name its new ID.
      const record = JSON.parse(await readFile(path.join(target, spec.file), 'utf8'));
      record.linkedWork = [];
      await writeYaml(path.join(target, spec.file), record);
      for (const { workId } of plan.references.move.filter((entry) => entry.identity === item.identity)) {
        const metaFile = path.join(base, 'work', workId, 'meta.yaml');
        const meta = JSON.parse(await readFile(metaFile, 'utf8'));
        for (const ref of meta.sources ?? []) if (ref.id === plan.id && ref.name === item.title) ref.id = newId;
        await writeYaml(metaFile, meta);
        handled.add(path.join('work', workId, 'meta.yaml'));
        await linkSourceToWork(root, newId, workId);
      }
    }
    moved.push({ ...item, newId });
  }

  const currentTree = plan.current.commit ? treeAt(root, plan.current.commit, recordDir(plan.kind, plan.id)) : new Map();
  const ownBlobs = readBlobs(root, plan.restore.map((file) => currentTree.get(file)).filter(Boolean));
  for (const file of plan.restore) await writeFile(path.join(dir, file), ownBlobs.get(currentTree.get(file)));
  for (const file of plan.remove) {
    await rm(path.join(dir, file));
    let parent = path.dirname(path.join(dir, file));
    while (parent !== dir && (await readdir(parent)).length === 0) {
      await rmdir(parent);
      parent = path.dirname(parent);
    }
  }
  if (plan.kind === 'source') {
    // The source that stays links exactly to the work items that still reference it.
    const keptFile = path.join(dir, spec.file);
    const kept = JSON.parse(await readFile(keptFile, 'utf8'));
    const movedAway = new Set(plan.references.move.map((entry) => entry.workId));
    kept.linkedWork = [...new Set([...kept.linkedWork.filter((workId) => !movedAway.has(workId)), ...plan.references.stay])];
    await writeYaml(keptFile, kept);
  }
  return { moved, references: await referencesOutside(root, plan.kind, plan.id, handled) };
}
