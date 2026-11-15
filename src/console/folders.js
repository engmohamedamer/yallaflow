// Console folder chooser (1.4.0, PF-0057; roots since PF-0146): lists the subfolders of a
// folder so the developer never has to type an absolute path.
//
// - Directories only: no file is listed, opened or read; a folder's contents are only
//   probed for three markers (.git, .yallaflow, empty) with lstat/readdir. Browsing never
//   inspects a project and never authorizes anything: the preview and the connect are
//   separate steps with their own checks (connect.js).
// - Allowed roots (PF-0146, replaces the home-only rule of PF-0057 Q-003): the home folder,
//   plus LOCAL drives (Windows) or LOCAL mounted volumes (/Volumes on macOS; /media/<user>,
//   /run/media/<user> and /mnt on Linux). Nothing else; the filesystem root is never a root.
// - Network locations are refused. A UNC or device path is refused BEFORE any filesystem
//   call (opening one would contact the server it names). A drive or volume whose locality
//   cannot be established is not offered (fail closed).
// - A requested path must first be, as written, under an allowed root with no hidden segment:
//   nothing outside the roots is ever touched (no existence probing, no automount trigger).
//   Then every rule is applied again to the canonical path (realpath): a junction or symbolic
//   link is judged by where it leads, and a link whose target is a network path is not
//   followed. Comparison is case-insensitive on Windows.
// - Locality (security review, PF-0146): a volume is offered only when its filesystem is on a
//   list of local types (Linux) or flagged local by `mount` (macOS); unknown means not offered.
//   Inside the home folder, which was always browsable, a folder on a known network
//   filesystem is refused; an unknown type there is allowed.
// - Hidden folders (a leading dot) are never browsed. A short list of system folders at a
//   Windows drive root is left out too; that list is a courtesy by name, not a security
//   boundary: any other folder on an allowed drive is listed by name.
// - Read-only, except createFolder (PF-0123): one new, empty folder, only when asked for.
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';

export const MAX_ENTRIES = 500;

export class FolderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- pure path rules
export const pathFor = (platform = process.platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix);
const fold = (value, platform) => (platform === 'win32' ? String(value).toLowerCase() : String(value));

// Is `target` the folder `base` or inside it? Case-insensitive on Windows.
export function insidePath(base, target, platform = process.platform) {
  const p = pathFor(platform);
  const a = fold(base, platform);
  const b = fold(target, platform);
  return b === a || b.startsWith(a.endsWith(p.sep) ? a : `${a}${p.sep}`);
}

// A network or device path on Windows: \\server\share, //server/share, \\?\…, \\.\…
export function isNetworkPath(value, platform = process.platform) {
  // Also the NT object form a link target can carry: \??\UNC\server\share
  return platform === 'win32' && (/^[\\/]{2}/.test(String(value)) || /^\\\?\?\\UNC\\/i.test(String(value)));
}

// System folders at a Windows drive root that are never browsed (a courtesy, by name).
export const WINDOWS_SYSTEM_FOLDERS = Object.freeze(['windows', 'program files', 'program files (x86)', 'programdata', 'recovery', 'perflogs', 'system volume information', 'msocache', 'config.msi']);

// Why a canonical path inside `root` may not be browsed, or null. Pure: no filesystem access.
export function refusalInside(root, real, platform = process.platform) {
  const p = pathFor(platform);
  const segments = p.relative(root.path, real).split(p.sep).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) return 'HIDDEN_FOLDER';
  if (platform === 'win32' && root.kind === 'drive' && segments.length) {
    const first = segments[0].toLowerCase();
    if (first.startsWith('$') || WINDOWS_SYSTEM_FOLDERS.includes(first)) return 'SYSTEM_FOLDER';
  }
  return null;
}

// The most specific allowed root that holds a canonical path, or null.
export function rootOf(roots, real, platform = process.platform) {
  return roots.filter((root) => insidePath(root.path, real, platform)).sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

// Breadcrumbs from the root to the folder, so the page never splits a path itself.
export function crumbsFor(root, real, platform = process.platform) {
  const p = pathFor(platform);
  const segments = p.relative(root.path, real).split(p.sep).filter(Boolean);
  return [{ name: root.label, path: root.path, root: root.kind }, ...segments.map((name, index) => ({ name, path: p.join(root.path, ...segments.slice(0, index + 1)) }))];
}

// ---------------------------------------------------------------- roots
// Filesystems known to be on this machine. A volume is offered only with one of these
// (fail closed: an unknown type, a FUSE mount or an automount point is not offered).
const LOCAL_FILESYSTEMS = /^(ext[234]|xfs|btrfs|f2fs|jfs|reiserfs|zfs|bcachefs|vfat|msdos|exfat|ntfs3?|fuseblk|hfs|hfsplus|apfs|iso9660|udf)$/i;
// Filesystems known to be on a network. Inside home, only these are refused.
const NETWORK_FILESYSTEMS = /^(nfs\d?|cifs|smb\d?|smbfs|ncpfs|afs|afpfs|webdav|davfs2?|ceph|glusterfs|lustre|beegfs|ocfs2|gfs2|autofs|curlftpfs|fuse\.(sshfs|rclone|davfs2?|s3fs|gcsfuse|glusterfs|curlftpfs|cifs|smb.*|nfs.*))$/i;

const unescapeMount = (value) => value.replace(/\\([0-7]{3})/g, (_all, octal) => String.fromCharCode(parseInt(octal, 8)));
// Linux: the filesystem type of the mount that holds a path (/proc/mounts), or null. Of
// several mounts at the same point, the last one listed is the one in effect.
export function linuxMountType(mounts, target) {
  let best = null;
  for (const line of String(mounts).split('\n')) {
    const [, point, type] = line.split(' ');
    if (!point || !type) continue;
    const at = unescapeMount(point);
    if ((target === at || target.startsWith(at.endsWith('/') ? at : `${at}/`)) && (!best || at.length >= best.at.length)) best = { at, type };
  }
  return best?.type ?? null;
}

// Is a canonical folder on this machine, as far as its mount says? → 'local' | 'network' | 'unknown'
export function linuxLocality(mounts, target) {
  const type = mounts === null ? null : linuxMountType(mounts, target);
  return !type ? 'unknown' : NETWORK_FILESYSTEMS.test(type) ? 'network' : LOCAL_FILESYSTEMS.test(type) ? 'local' : 'unknown';
}
export function macLocality(local, mountPoints, target) {
  if (!local || !mountPoints) return 'unknown';
  const at = [...mountPoints].filter((point) => target === point || target.startsWith(point.endsWith('/') ? point : `${point}/`)).sort((a, b) => b.length - a.length)[0];
  return !at ? 'unknown' : local.has(at) ? 'local' : 'network';
}

// macOS: the mount points `mount` reports with the "local" flag.
export function macLocalMounts(output, all = null) {
  const local = new Set();
  for (const line of String(output).split('\n')) {
    const found = / on (\/.*) \(([^)]*)\)\s*$/.exec(line);
    if (!found) continue;
    all?.add(found[1]);
    if (found[2].split(',').map((flag) => flag.trim()).includes('local')) local.add(found[1]);
  }
  return local;
}

// One fixed program, no shell, no arguments: macOS's own mount table.
const macMountTable = () => new Promise((resolve) => {
  execFile('/sbin/mount', [], { timeout: 3000, windowsHide: true, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : stdout));
});
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => { const timer = setTimeout(() => resolve(null), ms); timer.unref?.(); })]);
const isDir = async (target) => { try { return (await stat(target)).isDirectory(); } catch { return false; } };

// → { roots, network: drive letters that are mapped network drives }
async function windowsDrives() {
  const roots = [];
  const network = [];
  await Promise.all('CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (letter) => {
    const drive = `${letter}:\\`;
    // A mapped network drive resolves to its \\server\share path; it is never offered.
    const real = await within(realpath(drive).catch(() => null), 1500);
    if (real && isNetworkPath(real, 'win32')) { network.push(drive); return; }
    if (!real || !(await within(isDir(real), 1500))) return;
    roots.push({ path: real, label: `${letter}:`, kind: 'drive' });
  }));
  return { roots: roots.sort((a, b) => a.label.localeCompare(b.label)), network };
}

async function volumesUnder(parents, isLocal) {
  const roots = [];
  for (const parent of parents) {
    const base = await realpath(parent).catch(() => null);
    if (!base) continue;
    let names = [];
    try { names = (await readdir(base, { withFileTypes: true })).filter((entry) => !entry.name.startsWith('.') && entry.isDirectory()).map((entry) => entry.name).sort(); } catch { continue; }
    for (const name of names.slice(0, 40)) {
      // Real folders only: a link under a volume folder is never a root (it could lead anywhere).
      const real = await realpath(nodePath.join(base, name)).catch(() => null);
      if (!real || real !== nodePath.join(base, name) || !(await isDir(real)) || !isLocal(real)) continue;
      if (!roots.some((root) => root.path === real)) roots.push({ path: real, label: name, kind: 'volume' });
    }
  }
  return roots;
}

// → { roots, locality(real): 'local' | 'network' | 'unknown', network }
async function discover(platform) {
  if (platform === 'win32') {
    const found = await windowsDrives();
    return { roots: found.roots, network: found.network, locality: () => 'local' };
  }
  if (platform === 'darwin') {
    const output = await macMountTable();
    const points = new Set();
    const local = output === null ? null : macLocalMounts(output, points);
    const locality = (real) => macLocality(local, local ? points : null, real);
    return { roots: local ? await volumesUnder(['/Volumes'], (real) => local.has(real)) : [], network: [], locality };
  }
  if (platform === 'linux') {
    const mounts = await readFile('/proc/mounts', 'utf8').catch(() => null);
    const locality = (real) => linuxLocality(mounts, real);
    const user = os.userInfo().username;
    return { roots: mounts === null ? [] : await volumesUnder([`/media/${user}`, `/run/media/${user}`, '/mnt'], (real) => locality(real) === 'local'), network: [], locality };
  }
  return { roots: [], network: [], locality: () => 'unknown' };
}

let cached = null; // { at, platform, found }: rediscovered at most every 15 s
export async function discoverVolumes(platform = process.platform) {
  if (cached && cached.platform === platform && Date.now() - cached.at < 15_000) return cached.found;
  let found;
  try { found = await discover(platform); } catch { found = { roots: [], network: [], locality: () => 'unknown' }; }
  cached = { at: Date.now(), platform, found };
  return found;
}

export async function homeRoot(home = os.homedir()) {
  try {
    return await realpath(home);
  } catch {
    throw new FolderError(500, 'HOME_UNAVAILABLE', 'Your home folder could not be read.');
  }
}

// The allowed roots: home first, then local drives or volumes. `volumes` replaces discovery
// (tests); `platform` selects the path rules. → { roots, network, locality, aliases }
async function browseContext({ home, platform = process.platform, volumes } = {}) {
  const base = await homeRoot(home);
  const found = volumes ? { roots: volumes, network: [], locality: () => 'local' } : await discoverVolumes(platform);
  const roots = [{ path: base, label: 'Home', kind: 'home' }, ...found.roots.filter((root) => fold(root.path, platform) !== fold(base, platform))];
  // The home folder as the user may write it (before links are resolved) is accepted too.
  const written = pathFor(platform).resolve(home ?? os.homedir());
  return { roots, network: found.network, locality: found.locality, aliases: fold(written, platform) === fold(base, platform) ? [] : [{ path: written, label: 'Home', kind: 'home' }] };
}
export async function allowedRoots(options = {}) {
  return (await browseContext(options)).roots;
}

const REFUSALS = Object.freeze({
  HIDDEN_FOLDER: [403, 'Hidden folders are not browsed.'],
  SYSTEM_FOLDER: [403, 'System folders are not browsed.'],
  NETWORK_PATH: [403, 'Network folders are not supported in this version. Choose a folder on a local drive.'],
  OUTSIDE_ALLOWED: [403, 'This folder cannot be browsed: only your home folder and local drives or volumes are available.']
});
const refuse = (code) => new FolderError(REFUSALS[code][0], code, REFUSALS[code][1]);
const fsError = (error) => (error?.code === 'EACCES' || error?.code === 'EPERM'
  ? new FolderError(403, 'UNREADABLE', 'You do not have permission to open this folder.')
  : new FolderError(404, 'NOT_FOUND', 'That folder does not exist.'));

// Windows: no component of a path may be a link (or junction) whose target is a network
// path; such a link is refused without being followed. A link to a local path is checked
// the same way, a few levels deep. NOT VERIFIED on real Windows.
async function refuseNetworkLinks(target, platform, depth = 0) {
  if (platform !== 'win32' || depth > 8) return;
  const p = pathFor(platform);
  const parsed = p.parse(target);
  let current = parsed.root;
  for (const segment of target.slice(parsed.root.length).split(p.sep).filter(Boolean)) {
    current = p.join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) return; // missing: realpath reports it
    if (!info.isSymbolicLink()) continue;
    const to = await readlink(current).catch(() => null);
    if (to === null) return;
    if (isNetworkPath(to, platform)) throw refuse('NETWORK_PATH');
    await refuseNetworkLinks(p.resolve(p.dirname(current), to), platform, depth + 1);
  }
}

// Resolves a requested folder (absolute, or empty for home) to a real folder under an allowed
// root. → { real, root, roots }.
export async function resolveBrowsable(requested, options = {}) {
  const platform = options.platform ?? process.platform;
  const p = pathFor(platform);
  const context = await browseContext(options);
  const { roots } = context;
  if (requested === undefined || requested === null || requested === '') return { real: roots[0].path, root: roots[0], roots };
  if (typeof requested !== 'string' || requested.length > 4096 || requested.includes('\0')) throw new FolderError(400, 'BAD_PATH', 'Send an absolute folder path.');
  // Before any filesystem call: opening a network path would contact the server it names.
  if (isNetworkPath(requested, platform)) throw refuse('NETWORK_PATH');
  if (!p.isAbsolute(requested)) throw new FolderError(400, 'BAD_PATH', 'Send an absolute folder path.');
  const wanted = p.resolve(requested);
  if (isNetworkPath(wanted, platform)) throw refuse('NETWORK_PATH');
  // As written, the path must already be under an allowed root, with no hidden or system
  // segment: nothing else on the machine is touched or probed.
  const written = rootOf([...roots, ...context.aliases], wanted, platform);
  if (!written) {
    if (platform === 'win32') {
      const drive = p.parse(wanted).root;
      if (context.network.some((entry) => fold(entry, platform) === fold(drive, platform))) throw refuse('NETWORK_PATH');
      if (!roots.some((root) => root.kind === 'drive' && fold(root.path, platform) === fold(drive, platform))) throw new FolderError(404, 'DRIVE_UNAVAILABLE', `The drive ${drive.replace(/\\$/, '')} is not available.`);
    }
    throw refuse('OUTSIDE_ALLOWED');
  }
  const early = refusalInside(written, wanted, platform);
  if (early) throw refuse(early);
  await refuseNetworkLinks(wanted, platform);
  let real;
  try {
    real = await realpath(wanted);
  } catch (error) {
    throw fsError(error);
  }
  if (isNetworkPath(real, platform)) throw refuse('NETWORK_PATH');
  const root = rootOf(roots, real, platform);
  if (!root) throw refuse('OUTSIDE_ALLOWED');
  const refusal = refusalInside(root, real, platform);
  if (refusal) throw refuse(refusal);
  // Where the folder really lives: a network mount is refused; under a volume, anything not
  // known to be local is refused too.
  const locality = context.locality(real);
  if (locality === 'network' || (locality === 'unknown' && root.kind === 'volume')) throw refuse('NETWORK_PATH');
  let info;
  try {
    info = await stat(real);
  } catch (error) {
    throw fsError(error);
  }
  if (!info.isDirectory()) throw new FolderError(400, 'NOT_A_FOLDER', 'That path is not a folder.');
  return { real, root, roots, locality: context.locality };
}

const present = async (file) => { try { await lstat(file); return true; } catch { return false; } };

// PF-0123: what kind of codebase a folder holds, from file NAMES only (the same directory read
// that tells whether it is empty; no file is opened). The first match wins.
const STACK_MARKERS = Object.freeze([
  ['laravel', (names) => names.has('artisan') && names.has('composer.json')],
  ['php', (names) => names.has('composer.json')],
  ['node', (names) => names.has('package.json')],
  ['python', (names) => names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')],
  ['go', (names) => names.has('go.mod')],
  ['ruby', (names) => names.has('Gemfile')],
  ['java', (names) => names.has('pom.xml') || names.has('build.gradle') || names.has('build.gradle.kts')],
  ['rust', (names) => names.has('Cargo.toml')],
  ['dotnet', (names) => [...names].some((name) => /\.(sln|csproj|fsproj)$/.test(name))]
]);

async function markers(dir) {
  const [git, yallaflow] = await Promise.all([present(nodePath.join(dir, '.git')), present(nodePath.join(dir, '.yallaflow'))]);
  let empty = false;
  let readable = true;
  let stack = null;
  try {
    const handle = await readdir(dir);
    empty = handle.length === 0;
    const names = new Set(handle);
    stack = STACK_MARKERS.find(([, test]) => test(names))?.[0] ?? null;
  } catch {
    readable = false;
  }
  // yallaflow: a YallaFlow project · code: an existing codebase (a known manifest, or a Git
  // repository with files) · empty · folder: anything else.
  const kind = yallaflow ? 'yallaflow' : stack || (git && !empty) ? 'code' : empty ? 'empty' : 'folder';
  return { git, yallaflow, empty, readable, stack, kind };
}

// PF-0123: a new folder for the new-project location. One plain name (no separators, not
// hidden, no control characters), created with a non-recursive mkdir inside a real folder that
// passes the same checks as browsing. An existing name is never reused.
const FOLDER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;
export async function createFolder(parentRequested, name, options = {}) {
  const { real: parent, root } = await resolveBrowsable(parentRequested, options);
  if (typeof name !== 'string' || !FOLDER_NAME.test(name) || name.trim() !== name || name.endsWith('.')) {
    throw new FolderError(400, 'BAD_NAME', 'Use letters, numbers, spaces, dots, dashes or underscores; it cannot start with a dot.');
  }
  const target = nodePath.join(parent, name);
  // A name that would not be browsable afterwards (a system folder at a drive root) is never created.
  const refusal = refusalInside(root, target, options.platform ?? process.platform);
  if (refusal) throw refuse(refusal);
  try {
    await mkdir(target);
  } catch (error) {
    if (error.code === 'EEXIST') throw new FolderError(409, 'EXISTS', 'A folder with that name already exists here.');
    if (error.code === 'EACCES' || error.code === 'EPERM') throw new FolderError(403, 'UNWRITABLE', 'You cannot create a folder here.');
    throw new FolderError(500, 'MKDIR_FAILED', 'The folder could not be created.');
  }
  return listFolders(target, options);
}

// { path, parent (null at a root), home, root, roots, crumbs, sep,
//   folders: [{ name, path, git, yallaflow, empty, readable }], truncated }
export async function listFolders(requested, options = {}) {
  const platform = options.platform ?? process.platform;
  const { real: dir, root, roots, locality = () => 'local' } = await resolveBrowsable(requested, options);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw new FolderError(404, 'NOT_FOUND', 'That folder does not exist.');
    throw new FolderError(403, 'UNREADABLE', 'You do not have permission to open this folder.');
  }
  const candidates = entries
    .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const folders = [];
  let considered = 0;
  for (const entry of candidates) {
    if (folders.length >= MAX_ENTRIES) break;
    considered += 1;
    const full = nodePath.join(dir, entry.name);
    // System folders at a drive root are left out of the list as well as refused by path.
    if (refusalInside(root, full, platform)) continue;
    let real = full;
    if (entry.isSymbolicLink()) {
      // A link (or a Windows junction) is listed only when it leads to a browsable local folder.
      try {
        // A link whose target is a network path is skipped without being followed.
        if (isNetworkPath(await readlink(full), platform)) continue;
        real = await realpath(full);
        const target = rootOf(roots, real, platform);
        if (isNetworkPath(real, platform) || !target || refusalInside(target, real, platform)) continue;
        const where = locality(real);
        if (where === 'network' || (where === 'unknown' && target.kind === 'volume') || !(await stat(real)).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    folders.push({ name: entry.name, path: full, link: entry.isSymbolicLink(), ...(await markers(real)) });
  }
  const same = (a, b) => fold(a, platform) === fold(b, platform);
  return {
    path: dir,
    parent: same(dir, root.path) ? null : nodePath.dirname(dir),
    home: roots[0].path,
    root: root.path,
    roots: roots.map(({ path: at, label, kind }) => ({ path: at, label, kind })),
    crumbs: crumbsFor(root, dir, platform),
    sep: pathFor(platform).sep,
    here: await markers(dir),
    folders,
    truncated: candidates.length > considered
  };
}
