import path from 'node:path';
import { lstat, open, readdir } from 'node:fs/promises';
import { DOCUMENT_FORMAT_EXTENSIONS, EXTENSION_FORMATS } from '../intake/constants.js';
import { manifestHints, hasHintParser } from './frameworks.js';
import {
  BROWNFIELD_SOURCE_FILE_THRESHOLD,
  CI_WORKFLOW_DIRECTORY,
  CONFIG_COMMENT_PREFIXES,
  CONTAINER_CI_FILES,
  CONTAINER_CI_PATHS,
  DOCUMENT_RETAIN_LIMIT,
  IGNORED_DIRECTORIES,
  INVENTORY_MAX_DEPTH,
  INVENTORY_MAX_ENTRIES,
  MANIFEST_EXTENSIONS,
  MANIFEST_FILES,
  MAX_CONFIG_BYTES,
  MAX_MANIFEST_BYTES,
  SOURCE_CODE_EXTENSIONS
} from './constants.js';

const IGNORED = new Set(IGNORED_DIRECTORIES);
const SOURCE = new Set(SOURCE_CODE_EXTENSIONS);
const MANIFESTS = new Set(MANIFEST_FILES);
const MANIFEST_EXTS = new Set(MANIFEST_EXTENSIONS);
const DOCUMENTS = new Set(DOCUMENT_FORMAT_EXTENSIONS);
const CONTAINER_CI = new Set(CONTAINER_CI_FILES);

// Code-point order: identical on every platform and locale.
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function extensionOf(name) {
  const ext = path.extname(name).toLowerCase();
  return ext && ext !== name.toLowerCase() ? ext : '';
}

// How intake would treat a documentation candidate if it were registered. Inventory
// never reads the document; this is looked up from the package-owned format table.
export function documentHandling(ext) {
  const format = EXTENSION_FORMATS[ext];
  if (!format) return 'unknown';
  if (format.adapter === 'text') return 'native text';
  if (format.adapter === 'binary') return 'preserve-only, no text extraction';
  return 'text extraction on intake';
}

// Deterministic kind of a recognized container/CI file, from its name and location only.
// The order is the fixed reporting order used by tech-stack.md hints.
export const CONTAINER_CI_KINDS = Object.freeze([
  'Dockerfile', 'Docker Compose', 'GitHub Actions', 'GitLab CI', 'Azure Pipelines', 'Bitbucket Pipelines', 'Jenkins', 'CircleCI'
]);

export function containerCiKind(relative) {
  const name = path.posix.basename(relative);
  if (name === 'Dockerfile' || /^Dockerfile\..+/.test(name) || /.+\.Dockerfile$/.test(name)) return 'Dockerfile';
  if (/^(docker-)?compose\.ya?ml$/.test(name)) return 'Docker Compose';
  if (name === '.gitlab-ci.yml') return 'GitLab CI';
  if (name === 'azure-pipelines.yml') return 'Azure Pipelines';
  if (name === 'bitbucket-pipelines.yml') return 'Bitbucket Pipelines';
  if (name === 'Jenkinsfile') return 'Jenkins';
  if (relative === '.circleci/config.yml' || relative.endsWith('/.circleci/config.yml')) return 'CircleCI';
  return 'GitHub Actions';
}

function isContainerCi(relative, name) {
  if (CONTAINER_CI.has(name) || /^Dockerfile\..+/.test(name) || /.+\.Dockerfile$/.test(name)) return true;
  const posix = relative.split(path.sep).join('/');
  if (CONTAINER_CI_PATHS.some((suffix) => posix === suffix || posix.endsWith(`/${suffix}`))) return true;
  const parent = path.posix.dirname(posix);
  return /\.ya?ml$/.test(name) && (parent === CI_WORKFLOW_DIRECTORY || parent.endsWith(`/${CI_WORKFLOW_DIRECTORY}`));
}

async function readPrefix(file, limit) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

// Meaningful = at least one non-whitespace line that is not a full-line comment.
export function isMeaningfulConfig(text) {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed && !CONFIG_COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
  });
}

async function inspectManifest(absolute, relative, name, size) {
  const entry = { path: relative, name, frameworks: [] };
  if (!hasHintParser(name)) return entry;
  if (size > MAX_MANIFEST_BYTES) return { ...entry, unreadable: `larger than ${MAX_MANIFEST_BYTES} bytes; not read` };
  try {
    return { ...entry, ...manifestHints(name, await readPrefix(absolute, MAX_MANIFEST_BYTES)) };
  } catch (error) {
    return { ...entry, unreadable: `could not read: ${error.code ?? error.message}` };
  }
}

async function inspectContainerCi(absolute, relative) {
  const kind = containerCiKind(relative);
  try {
    return { path: relative, kind, meaningful: isMeaningfulConfig(await readPrefix(absolute, MAX_CONFIG_BYTES)) };
  } catch (error) {
    return { path: relative, kind, meaningful: false, unreadable: `could not read: ${error.code ?? error.message}` };
  }
}

// Read-only and in-memory. Breadth-first over sorted entries, so the same tree always
// yields the same inventory and the same truncation point. Symbolic links are never
// followed. Only manifest and container/CI bytes are read (size-capped); source files
// and documents are only named and counted. Paths are root-relative (POSIX).
export async function inventoryRepository(root, limits = {}) {
  const maxDepth = limits.maxDepth ?? INVENTORY_MAX_DEPTH;
  const maxEntries = limits.maxEntries ?? INVENTORY_MAX_ENTRIES;
  const inventory = {
    limits: { maxDepth, maxEntries },
    scanned: { entries: 0, directories: 0 },
    truncated: { entries: false, depthLimitedDirectories: 0 },
    skipped: { ignoredDirectories: 0, symlinks: 0, unreadableDirectories: 0 },
    git: false,
    manifests: [],
    sourceFiles: { total: 0, byExtension: {} },
    documents: { total: 0, entries: [] },
    containerCi: []
  };
  try {
    inventory.git = Boolean(await lstat(path.join(root, '.git')));
  } catch {
    inventory.git = false;
  }

  const queue = [{ relative: '', depth: 0 }];
  walk: while (queue.length) {
    const { relative, depth } = queue.shift();
    let entries;
    try {
      entries = (await readdir(path.join(root, relative), { withFileTypes: true })).sort(byName);
    } catch {
      inventory.skipped.unreadableDirectories += 1;
      continue;
    }
    inventory.scanned.directories += 1;
    for (const dirent of entries) {
      if (inventory.scanned.entries >= maxEntries) {
        inventory.truncated.entries = true;
        break walk;
      }
      inventory.scanned.entries += 1;
      const name = dirent.name;
      const childRelative = relative ? `${relative}/${name}` : name;
      if (dirent.isSymbolicLink()) {
        inventory.skipped.symlinks += 1;
        continue;
      }
      if (dirent.isDirectory()) {
        if (IGNORED.has(name)) inventory.skipped.ignoredDirectories += 1;
        else if (depth + 1 > maxDepth) inventory.truncated.depthLimitedDirectories += 1;
        else queue.push({ relative: childRelative, depth: depth + 1 });
        continue;
      }
      if (!dirent.isFile()) continue;
      const absolute = path.join(root, childRelative);
      const ext = extensionOf(name);
      if (MANIFESTS.has(name) || MANIFEST_EXTS.has(ext)) {
        const size = (await lstat(absolute).catch(() => ({ size: 0 }))).size;
        inventory.manifests.push(await inspectManifest(absolute, childRelative, name, size));
        continue;
      }
      if (isContainerCi(childRelative, name)) {
        inventory.containerCi.push(await inspectContainerCi(absolute, childRelative));
        continue;
      }
      if (SOURCE.has(ext)) {
        inventory.sourceFiles.total += 1;
        inventory.sourceFiles.byExtension[ext] = (inventory.sourceFiles.byExtension[ext] ?? 0) + 1;
      } else if (DOCUMENTS.has(ext)) {
        inventory.documents.total += 1;
        if (inventory.documents.entries.length < DOCUMENT_RETAIN_LIMIT) {
          inventory.documents.entries.push({ path: childRelative, extension: ext, handling: documentHandling(ext) });
        }
      }
    }
  }
  return inventory;
}

export function listSome(paths, limit = 3) {
  return paths.length > limit ? `${paths.slice(0, limit).join(', ')}, +${paths.length - limit} more` : paths.join(', ');
}

// Deterministic Brownfield rule (v0.3.9): a recognized manifest together with at least
// one recognized source file, or BROWNFIELD_SOURCE_FILE_THRESHOLD recognized source
// files, or meaningful container/CI configuration. A manifest alone (`npm init`) or a
// bare `.git` never classifies. Returns the kind and the reasons behind it.
export function classifyProject(inventory) {
  const sources = inventory.sourceFiles.total;
  const manifests = inventory.manifests.length;
  const meaningfulCi = inventory.containerCi.filter((entry) => entry.meaningful);
  const reasons = [];
  if (manifests && sources >= 1) reasons.push(`${manifests} recognized manifest(s) with ${sources} recognized source file(s)`);
  if (sources >= BROWNFIELD_SOURCE_FILE_THRESHOLD) reasons.push(`${sources} recognized source files (≥ ${BROWNFIELD_SOURCE_FILE_THRESHOLD})`);
  if (meaningfulCi.length) reasons.push(`meaningful container/CI configuration (${listSome(meaningfulCi.map((entry) => entry.path))})`);
  if (reasons.length) return { kind: 'brownfield', reasons };

  if (manifests) reasons.push(`${manifests} recognized manifest(s) but no recognized source file — a manifest alone is not Brownfield`);
  reasons.push(`${sources} recognized source file(s) (< ${BROWNFIELD_SOURCE_FILE_THRESHOLD})`);
  const unreadableCi = inventory.containerCi.filter((entry) => entry.unreadable);
  if (unreadableCi.length) reasons.push(`container/CI configuration could not be read (${listSome(unreadableCi.map((entry) => entry.path))})`);
  if (inventory.containerCi.length > unreadableCi.length) reasons.push('container/CI configuration present but empty or comment-only');
  if (inventory.git) reasons.push('.git present — Git alone never classifies a project');
  return { kind: 'greenfield', reasons };
}
