// Connect a folder from the console (PF-0123, 1.5.2): an existing codebase or an empty folder
// becomes a YallaFlow project through Core's own `yallaflow init` (its read-only bootstrap
// check and byte-exact rollback), never through console writes.
//
// - previewConnect: read-only. The folder is resolved with the folder chooser's rules (inside
//   home, not hidden, real directory). It reports what the folder is (YallaFlow project /
//   existing code / empty), the detected stack (manifest hints, size-capped, no symlinks
//   followed), whether it is a Git repository (no Git command runs; uncommitted work is never
//   touched), exactly
//   which files init creates or changes, and anything that makes init unsafe. A hash binds
//   the developer's confirmation to this exact preview.
// - The connect itself recomputes the preview, refuses a changed or unsafe one, runs
//   `yallaflow init` in the folder through the runner, and leaves registration to the server.
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { bootstrapInitPlan } from '../agent/bootstrap.js';
import { classifyProject, inventoryRepository } from '../inventory/inventory.js';
import { laneIdentity } from '../execution/lanes.js';
import { HttpError } from './create.js';
import { homeRoot, resolveInsideHome } from './folders.js';

const isDir = async (target) => { try { return (await lstat(target)).isDirectory(); } catch { return false; } };
const present = async (target) => { try { await lstat(target); return true; } catch { return false; } };

// The closest YallaFlow workspace above the folder (inside home), if any.
async function enclosingProject(folder, home) {
  let current = path.dirname(folder);
  while (current.startsWith(home) && current !== path.dirname(current)) {
    if (await isDir(path.join(current, '.yallaflow'))) return current;
    if (current === home) break;
    current = path.dirname(current);
  }
  return null;
}

export async function previewConnect(requested, { home } = {}) {
  const base = await homeRoot(home);
  let folder;
  try {
    folder = await resolveInsideHome(requested, base);
  } catch (error) {
    throw new HttpError(error.status ?? 400, error.code ?? 'BAD_PATH', error.message);
  }
  if (folder === base) throw new HttpError(400, 'HOME_FOLDER', 'Choose a project folder inside your home folder, not the home folder itself.');
  const name = path.basename(folder);
  const problems = [];
  const lane = await laneIdentity(folder).catch(() => null);
  if (lane) problems.push({ code: 'LANE', message: 'This folder is a YallaFlow lane (a worktree YallaFlow created). Open its home project instead.' });
  if (await isDir(path.join(folder, '.yallaflow'))) {
    return finish({ path: folder, name, kind: 'yallaflow', action: 'open', stack: [], git: await present(path.join(folder, '.git')), uncommitted: null, plan: [], problems });
  }
  const enclosing = await enclosingProject(folder, base);
  if (enclosing) problems.push({ code: 'NESTED', message: `This folder is inside the YallaFlow project ${enclosing}. Open that project, or choose a folder outside it.` });

  const inventory = await inventoryRepository(folder);
  const classification = classifyProject(inventory);
  // Framework hints read from manifests (e.g. Laravel 11 from composer.json), names only.
  const stack = [...new Set(inventory.manifests.flatMap((entry) => (entry.frameworks ?? []).map((hint) => (hint.major ? `${hint.framework} ${hint.major}` : hint.framework)).filter(Boolean)))].slice(0, 8);
  const manifests = inventory.manifests.map((entry) => entry.path).slice(0, 8);
  const empty = inventory.sourceFiles.total === 0 && inventory.manifests.length === 0 && !(inventory.containerCi?.length);
  const git = await present(path.join(folder, '.git'));
  // PF-0139: a Git repository in a folder above this one (inside home) — found by name only,
  // no Git command — so the console never offers `git init` inside an existing repository.
  let gitAbove = false;
  for (let current = path.dirname(folder); !git && current.startsWith(base) && current !== path.dirname(current); current = path.dirname(current)) {
    if (await present(path.join(current, '.git'))) { gitAbove = true; break; }
    if (current === base) break;
  }
  // The agent files init's bootstrap step writes (and why it would refuse) come from Core.
  const bootstrap = await bootstrapInitPlan(folder);
  const plan = [{ path: '.yallaflow/', op: 'create' }, ...bootstrap.plan];
  problems.push(...bootstrap.problems);
  return finish({
    path: folder,
    name,
    kind: classification.kind === 'brownfield' ? 'existing-code' : empty ? 'empty' : 'folder',
    projectKind: classification.kind,
    action: 'init',
    stack,
    manifests,
    sourceFiles: inventory.sourceFiles.total,
    // No Git command runs here: a previewed folder's own Git config could name programs (filters)
    // that `git status` would start. Init never touches uncommitted work either way.
    git,
    gitAbove,
    uncommitted: null,
    plan,
    problems
  });
}

function finish(preview) {
  // The confirmation covers what would be written and why it is allowed.
  const bound = { path: preview.path, kind: preview.kind, action: preview.action, plan: preview.plan, problems: preview.problems.map((problem) => problem.code) };
  return { ...preview, planHash: createHash('sha256').update(JSON.stringify(bound)).digest('hex') };
}

// Runs Core's init after the developer confirmed this exact preview. Returns the folder to register.
export async function connectFolder(body, runner, { home } = {}) {
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort() : [];
  if (keys.join(',') !== 'confirm,planHash,root' || body.confirm !== true || typeof body.root !== 'string' || typeof body.planHash !== 'string') {
    throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Send { root, planHash, confirm: true } after reviewing the preview.');
  }
  const preview = await previewConnect(body.root, { home });
  if (preview.planHash !== body.planHash) throw Object.assign(new HttpError(409, 'PREVIEW_CHANGED', 'The folder changed since you reviewed it. Review the new preview.'), { extra: { preview } });
  if (preview.problems.length) throw Object.assign(new HttpError(409, preview.problems[0].code, preview.problems.map((problem) => problem.message).join(' ')), { extra: { preview } });
  if (preview.action === 'open') return { root: preview.path, initialized: false, preview };
  // One connect per folder at a time (a double submit must not run two inits whose rollbacks
  // could remove each other's work), and the folder must still be a real folder right now.
  if (connecting.has(preview.path)) throw new HttpError(409, 'CONNECT_BUSY', 'This folder is already being set up.');
  connecting.add(preview.path);
  try {
    const now = await lstat(preview.path).catch(() => null);
    if (!now?.isDirectory() || now.isSymbolicLink()) throw new HttpError(409, 'PREVIEW_CHANGED', 'The folder changed since you reviewed it. Review the new preview.');
    return await runInit(preview, runner);
  } finally {
    connecting.delete(preview.path);
  }
}

const connecting = new Set();
async function runInit(preview, runner) {
  const result = await runner.runAside(preview.path, ['init']);
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout).trim().split('\n').filter(Boolean).slice(-6).join('\n') || 'yallaflow init failed.';
    throw new HttpError(422, 'INIT_FAILED', message);
  }
  return { root: preview.path, initialized: true, preview };
}
