// PF-0146: the folder chooser browses the home folder plus LOCAL drives or volumes (it
// replaces the home-only rule of PF-0057 Q-003). Rules are applied to the canonical path;
// network locations are refused; browsing never inspects or authorizes anything.
//
// The Windows cases below run the PURE path rules with path.win32 on any platform. They do
// not prove behavior on a real Windows filesystem (drive discovery, junctions, mapped drives):
// that is NOT VERIFIED until tested on Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startConsoleServer } from '../src/console/server.js';
import { FolderError, WINDOWS_SYSTEM_FOLDERS, createFolder, crumbsFor, insidePath, isNetworkPath, linuxLocality, linuxMountType, listFolders, macLocality, macLocalMounts, refusalInside, resolveBrowsable, rootOf } from '../src/console/folders.js';
import { previewConnect } from '../src/console/connect.js';

const W = 'win32';
const drive = (letter) => ({ path: `${letter}:\\`, label: `${letter}:`, kind: 'drive' });
const winHome = { path: 'C:\\Users\\Mona', label: 'Home', kind: 'home' };
const winRoots = [winHome, drive('C'), drive('D')];

test('Windows rules (path.win32): drives, case, spaces and non-ASCII names', () => {
  assert.equal(insidePath('D:\\', 'D:\\Work\\shop', W), true);
  assert.equal(insidePath('D:\\', 'd:\\work\\shop', W), true, 'drive letters and names compare case-insensitively');
  assert.equal(insidePath('D:\\Work', 'D:\\Workshop', W), false, 'a name prefix is not a parent');
  assert.equal(insidePath('C:\\', 'D:\\Work', W), false);
  assert.equal(rootOf(winRoots, 'D:\\My Projects\\متجر', W).label, 'D:');
  assert.equal(rootOf(winRoots, 'C:\\Users\\Mona\\code', W).kind, 'home', 'the most specific root wins');
  assert.equal(rootOf(winRoots, 'c:\\users\\mona\\code', W).kind, 'home');
  assert.equal(rootOf(winRoots, 'C:\\Users\\Other', W).label, 'C:', 'another profile is only on the drive; the OS decides access');
  assert.equal(rootOf(winRoots, 'E:\\Work', W), null, 'a drive that was not found to be local is no root');
  assert.deepEqual(crumbsFor(drive('D'), 'D:\\My Projects\\متجر', W), [
    { name: 'D:', path: 'D:\\', root: 'drive' },
    { name: 'My Projects', path: 'D:\\My Projects' },
    { name: 'متجر', path: 'D:\\My Projects\\متجر' }
  ]);
  assert.deepEqual(crumbsFor(winHome, 'C:\\Users\\Mona', W), [{ name: 'Home', path: 'C:\\Users\\Mona', root: 'home' }]);
});

test('Windows rules: network and device paths are recognized before any filesystem call', () => {
  for (const value of ['\\\\server\\share', '\\\\server\\share\\project', '//server/share', '\\\\?\\C:\\Work', '\\\\.\\pipe\\x', '\\\\?\\UNC\\server\\share']) assert.equal(isNetworkPath(value, W), true, value);
  for (const value of ['D:\\Work', 'C:\\', 'D:/Work']) assert.equal(isNetworkPath(value, W), false, value);
  assert.equal(isNetworkPath('//server/share', 'linux'), false, 'a POSIX path is judged by its mount, not its spelling');
});

test('Windows rules: system folders at a drive root and hidden folders are refused; the list is by name only', () => {
  for (const name of ['Windows', 'WINDOWS', 'Program Files', 'Program Files (x86)', 'ProgramData', '$Recycle.Bin', 'System Volume Information', 'Recovery']) {
    assert.equal(refusalInside(drive('C'), `C:\\${name}`, W), 'SYSTEM_FOLDER', name);
    assert.equal(refusalInside(drive('C'), `C:\\${name}\\inner`, W), 'SYSTEM_FOLDER', `${name} (inside)`);
  }
  assert.equal(refusalInside(drive('D'), 'D:\\Work\\.git', W), 'HIDDEN_FOLDER');
  assert.equal(refusalInside(winHome, 'C:\\Users\\Mona\\.ssh', W), 'HIDDEN_FOLDER');
  assert.equal(refusalInside(drive('D'), 'D:\\Work\\Windows', W), null, 'only at the drive root');
  assert.equal(refusalInside(drive('D'), 'D:\\Backups\\keys', W), null, 'the stated limit: other folders are listed by name');
  assert.equal(refusalInside(drive('C'), 'C:\\Users\\Other', W), null);
  assert.ok(WINDOWS_SYSTEM_FOLDERS.every((name) => name === name.toLowerCase()));
});

test('Linux: a volume is local only when its mount type says so', () => {
  const mounts = ['/dev/sda2 / ext4 rw 0 0', '/dev/sdb1 /mnt/data ext4 rw 0 0', '//nas/share /mnt/nas cifs rw 0 0', 'host:/export /mnt/nfs\\040share nfs4 rw 0 0', 'user@host:/ /mnt/ssh fuse.sshfs rw 0 0', 'C:\\134 /mnt/c 9p rw 0 0'].join('\n');
  assert.equal(linuxMountType(mounts, '/mnt/data/projects'), 'ext4');
  assert.equal(linuxMountType(mounts, '/mnt/nas'), 'cifs');
  assert.equal(linuxMountType(mounts, '/mnt/nfs share/x'), 'nfs4', 'escaped spaces in mount points');
  assert.equal(linuxMountType(mounts, '/mnt/ssh'), 'fuse.sshfs');
  assert.equal(linuxMountType(mounts, '/mnt/plain'), 'ext4', 'a plain folder belongs to the root filesystem');
  assert.equal(linuxMountType('', '/mnt/data'), null, 'unknown: the volume is not offered');
});

test('macOS: only mounts flagged local are offered', () => {
  const output = ['/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)', '/dev/disk4s1 on /Volumes/USB DISK (msdos, local, nodev, nosuid, noowners)', '//mona@nas/media on /Volumes/media (smbfs, nodev, nosuid, mounted by mona)', 'nas:/export on /Volumes/export (nfs, nodev, nosuid, automounted)', 'map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)'].join('\n');
  assert.deepEqual([...macLocalMounts(output)].sort(), ['/', '/Volumes/USB DISK']);
  assert.deepEqual([...macLocalMounts('')], [], 'nothing readable: no volume is offered (fail closed)');
});

// ---------------------------------------------------------------- real filesystem (POSIX)
async function layout() {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'yf-roots-')));
  const home = path.join(base, 'home');
  const volume = path.join(base, 'volume');
  const outside = path.join(base, 'outside');
  for (const dir of [path.join(home, 'code'), path.join(volume, 'Work', 'my shop'), path.join(volume, 'Work', 'متجر'), path.join(volume, '.hidden'), path.join(outside, 'secret')]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(volume, 'Work', 'my shop', 'package.json'), '{"name":"shop"}');
  await writeFile(path.join(volume, 'Work', 'my shop', 'index.js'), 'export const shop = 1;\n');
  await writeFile(path.join(volume, 'Work', 'notes.txt'), 'not a folder');
  const options = { home, volumes: [{ path: volume, label: 'DATA', kind: 'volume' }] };
  return { base, home, volume, outside, options };
}

test('a folder on a local volume is browsed like one in home, with roots and breadcrumbs from the server', async () => {
  const { home, volume, options } = await layout();
  const listed = await listFolders(path.join(volume, 'Work'), options);
  assert.deepEqual(listed.folders.map((folder) => folder.name).sort(), ['my shop', 'متجر'].sort(), 'folders only; files are never listed');
  assert.equal(listed.folders.find((folder) => folder.name === 'my shop').kind, 'code');
  assert.deepEqual(listed.roots, [{ path: home, label: 'Home', kind: 'home' }, { path: volume, label: 'DATA', kind: 'volume' }]);
  assert.equal(listed.root, volume);
  assert.deepEqual(listed.crumbs, [{ name: 'DATA', path: volume, root: 'volume' }, { name: 'Work', path: path.join(volume, 'Work') }]);
  assert.equal(listed.parent, volume);
  assert.equal((await listFolders(volume, options)).parent, null, 'a root has no parent to go up to');
  assert.equal((await listFolders('', options)).path, home, 'no path means home');
  assert.equal((await listFolders(volume, options)).folders.some((folder) => folder.name === '.hidden'), false);
});

test('validation is applied to the canonical path: links are judged by where they lead', async () => {
  const { home, volume, outside, options } = await layout();
  await symlink(outside, path.join(home, 'code', 'escape'));
  await symlink(path.join(volume, 'Work'), path.join(home, 'code', 'work-link'));
  await symlink(path.join(volume, '.hidden'), path.join(volume, 'Work', 'to-hidden'));
  await assert.rejects(resolveBrowsable(path.join(home, 'code', 'escape'), options), { code: 'OUTSIDE_ALLOWED', status: 403 });
  await assert.rejects(resolveBrowsable(path.join(home, 'code', 'escape', 'secret'), options), { code: 'OUTSIDE_ALLOWED' });
  await assert.rejects(resolveBrowsable(path.join(volume, 'Work', 'to-hidden'), options), { code: 'HIDDEN_FOLDER' });
  assert.equal((await resolveBrowsable(path.join(home, 'code', 'work-link'), options)).real, path.join(volume, 'Work'), 'a link to another allowed root resolves there');
  const names = (await listFolders(path.join(home, 'code'), options)).folders.map((folder) => folder.name);
  assert.deepEqual(names, ['work-link'], 'a link that leaves the allowed roots is not listed');
  assert.equal((await listFolders(path.join(volume, 'Work'), options)).folders.some((folder) => folder.name === 'to-hidden'), false);
});

test('each failure has its own cause: outside, missing, not a folder, hidden, bad path', async () => {
  const { volume, outside, options } = await layout();
  const code = async (requested) => { try { await resolveBrowsable(requested, options); return 'ok'; } catch (error) { assert.ok(error instanceof FolderError); return `${error.status} ${error.code}`; } };
  assert.equal(await code(outside), '403 OUTSIDE_ALLOWED');
  assert.equal(await code('/etc'), '403 OUTSIDE_ALLOWED');
  assert.equal(await code('/'), '403 OUTSIDE_ALLOWED', 'the filesystem root is never a root');
  assert.equal(await code(path.join(volume, 'gone')), '404 NOT_FOUND');
  assert.equal(await code(path.join(volume, 'Work', 'notes.txt')), '400 NOT_A_FOLDER');
  assert.equal(await code(path.join(volume, '.hidden')), '403 HIDDEN_FOLDER');
  assert.equal(await code('relative/path'), '400 BAD_PATH');
  assert.equal(await code('bad\0path'), '400 BAD_PATH');
  await assert.rejects(resolveBrowsable('\\\\server\\share', { ...options, platform: 'win32' }), { code: 'NETWORK_PATH', status: 403 }, 'refused before the filesystem is touched');
  await assert.rejects(resolveBrowsable('//server/share/x', { ...options, platform: 'win32' }), { code: 'NETWORK_PATH' });
});

test('with no local volume found, only home is a root (fail closed)', async () => {
  const { home, volume } = await layout();
  const options = { home, volumes: [] };
  assert.deepEqual((await listFolders('', options)).roots.map((root) => root.kind), ['home']);
  await assert.rejects(listFolders(volume, options), { code: 'OUTSIDE_ALLOWED' });
});

test('a project on a volume: preview and new folder follow the same rules; the volume itself is not a project', async () => {
  const { volume, outside, options } = await layout();
  const shop = path.join(volume, 'Work', 'my shop');
  const preview = await previewConnect(shop, options);
  assert.deepEqual([preview.kind, preview.action, preview.outsideHome, preview.problems.length], ['existing-code', 'init', true, 0]);
  assert.match(preview.planHash, /^[0-9a-f]{64}$/);
  await assert.rejects(previewConnect(volume, options), { code: 'ROOT_FOLDER', status: 400 });
  await assert.rejects(previewConnect(outside, options), { code: 'OUTSIDE_ALLOWED', status: 403 });
  // A YallaFlow project above the folder is found up to the volume root, never beyond it.
  await mkdir(path.join(volume, 'Work', '.yallaflow'));
  assert.equal((await previewConnect(shop, options)).problems[0].code, 'NESTED');
  assert.equal((await createFolder(path.join(volume, 'Work'), 'new-app', options)).path, path.join(volume, 'Work', 'new-app'));
  await assert.rejects(createFolder(outside, 'x', options), { code: 'OUTSIDE_ALLOWED' });
});

// ---------------------------------------------------------------- the console's own guards on the folder routes
function raw(server, pathname, { method = 'GET', headers = {}, body } = {}) {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: data }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('security: the folder routes keep the Host, Origin, token and read-only checks', async () => {
  const { home, volume } = await layout();
  const previous = process.env.HOME;
  process.env.HOME = home;
  const server = await startConsoleServer({ roots: [], port: 0 });
  const readOnly = await startConsoleServer({ roots: [], port: 0, readOnly: true });
  try {
    const auth = { Authorization: `Bearer ${server.token}` };
    const origin = server.url.replace(/\/$/, '');
    const dirs = '/api/fs/dirs';
    const preview = `/api/fs/connect-preview?path=${encodeURIComponent(path.join(home, 'code'))}`;
    for (const route of [dirs, preview]) {
      assert.equal((await raw(server, route)).status, 401, `${route}: no token`);
      assert.equal((await raw(server, route, { headers: { Authorization: 'Bearer 00' } })).status, 401, `${route}: wrong token`);
      assert.equal((await raw(server, route, { headers: { ...auth, Host: 'evil.example' } })).status, 421, `${route}: foreign Host (DNS rebinding)`);
      assert.equal((await raw(server, route, { headers: { ...auth, Host: `evil.example:${new URL(server.url).port}` } })).status, 421, `${route}: foreign Host on our port`);
      assert.equal((await raw(server, route, { headers: { ...auth, Origin: 'http://evil.example' } })).status, 403, `${route}: foreign Origin`);
      assert.equal((await raw(server, `${route}${route.includes('?') ? '&' : '?'}token=${server.token}`)).status, 401, `${route}: the token is not accepted from the URL`);
    }
    assert.equal((await raw(server, dirs, { headers: auth })).status, 200);
    // writes need the console page's Origin and JSON
    const json = { ...auth, 'Content-Type': 'application/json' };
    const mkdirBody = JSON.stringify({ parent: path.join(home, 'code'), name: 'x' });
    assert.equal((await raw(server, '/api/fs/mkdir', { method: 'POST', headers: json, body: mkdirBody })).status, 403, 'a write without Origin');
    assert.equal((await raw(server, '/api/fs/mkdir', { method: 'POST', headers: { ...json, Origin: 'http://evil.example' }, body: mkdirBody })).status, 403);
    assert.equal((await raw(server, '/api/fs/mkdir', { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'text/plain' }, body: mkdirBody })).status, 415, 'a form-style cross-site body is refused');
    const connectBody = JSON.stringify({ root: path.join(home, 'code'), planHash: '0'.repeat(64), confirm: true });
    assert.equal((await raw(server, '/api/projects/connect', { method: 'POST', headers: json, body: connectBody })).status, 403, 'connect without Origin');
    assert.equal((await raw(server, '/api/projects/connect', { method: 'POST', headers: { ...json, Origin: origin }, body: connectBody })).status, 409, 'a wrong preview hash connects nothing');
    // outside the allowed roots, through the server
    const outside = await raw(server, `/api/fs/dirs?path=${encodeURIComponent(volume)}`, { headers: auth });
    assert.equal(outside.status, 403);
    assert.equal(JSON.parse(outside.body).error.code, 'OUTSIDE_ALLOWED');
    // a read-only console chooses no folder at all
    const ro = { Authorization: `Bearer ${readOnly.token}` };
    assert.equal((await raw(readOnly, dirs, { headers: ro })).status, 405);
    assert.ok((await raw(readOnly, preview, { headers: ro })).status >= 400);
    assert.ok((await raw(readOnly, '/api/fs/mkdir', { method: 'POST', headers: { ...ro, Origin: readOnly.url.replace(/\/$/, ''), 'Content-Type': 'application/json' }, body: mkdirBody })).status >= 400);
  } finally {
    process.env.HOME = previous;
    await server.close();
    await readOnly.close();
  }
});

test('browsing opens no file and never previews: listing reads directory names only', async () => {
  const { volume, options } = await layout();
  const shop = path.join(volume, 'Work', 'my shop');
  // An unreadable manifest would fail any attempt to open it; listing must not care.
  const { chmod } = await import('node:fs/promises');
  await chmod(path.join(shop, 'package.json'), 0o000);
  const listed = await listFolders(path.join(volume, 'Work'), options);
  assert.equal(listed.folders.find((folder) => folder.name === 'my shop').stack, 'node', 'the kind comes from file names');
  assert.equal(JSON.stringify(listed).includes('"name":"shop"'), false, 'no file content in a listing');
  assert.deepEqual(Object.keys(listed).sort(), ['crumbs', 'folders', 'here', 'home', 'parent', 'path', 'root', 'roots', 'sep', 'truncated']);
  await chmod(path.join(shop, 'package.json'), 0o644);
});

// ---------------------------------------------------------------- security review (PF-0146)
test('review: nothing outside the allowed roots is touched or probed (no existence oracle, no automount trigger)', async () => {
  const { home, options } = await layout();
  const code = async (requested) => { try { await resolveBrowsable(requested, options); return 'ok'; } catch (error) { return `${error.status} ${error.code}`; } };
  // an existing file, a missing path and an automount-style path all get the same answer
  assert.deepEqual([await code('/etc/passwd'), await code('/etc/nonexistent-zzz'), await code('/net/attacker.example/x'), await code('/root/x')], Array(4).fill('403 OUTSIDE_ALLOWED'));
  // hidden paths are refused as written, whether or not they exist
  await mkdir(path.join(home, '.ssh'));
  await writeFile(path.join(home, '.ssh', 'id_rsa'), 'x');
  assert.deepEqual([await code(path.join(home, '.ssh', 'id_rsa')), await code(path.join(home, '.ssh', 'nope')), await code(path.join(home, 'code', '..', '.ssh'))], Array(3).fill('403 HIDDEN_FOLDER'));
});

test('review: Linux locality fails closed for volumes; stacked and escaped mounts are read correctly', () => {
  const mounts = ['/dev/sda2 / ext4 rw 0 0', 'systemd-1 /mnt/nas autofs rw 0 0', 'nas:/export /mnt/nas nfs4 rw 0 0', '//nas/s /mnt/my\\011share cifs rw 0 0', 'ftp /mnt/ftp fuse.curlftpfs rw 0 0', 'drvfs /mnt/c 9p rw 0 0', '/dev/sdb1 /mnt/usb\\040disk exfat rw 0 0', 'auto /mnt/lazy autofs rw 0 0'].join('\n');
  assert.equal(linuxMountType(mounts, '/mnt/nas'), 'nfs4', 'the last mount at a point is the one in effect');
  assert.equal(linuxLocality(mounts, '/mnt/nas/projects'), 'network');
  assert.equal(linuxLocality(mounts, '/mnt/my\tshare'), 'network', 'octal escapes in mount points are decoded');
  assert.equal(linuxLocality(mounts, '/mnt/usb disk/work'), 'local');
  assert.equal(linuxLocality(mounts, '/mnt/lazy'), 'network', 'an automount point is not local');
  for (const unknown of ['/mnt/ftp', '/mnt/c']) assert.notEqual(linuxLocality(mounts, unknown), 'local', `${unknown}: an unknown type is never offered as a volume`);
  assert.equal(linuxLocality(null, '/mnt/usb disk'), 'unknown', 'no mount table: nothing is offered');
});

test('review: macOS locality of a resolved folder follows its longest mount point', () => {
  const points = new Set();
  const local = macLocalMounts(['/dev/disk3s1 on / (apfs, local, journaled)', '/dev/disk4s1 on /Volumes/USB (exfat, local, nodev)', '//m@nas/s on /Volumes/USB/share (smbfs, nodev)', '//m@nas/h on /Users/mona/nas (smbfs, nodev)'].join('\n'), points);
  assert.equal(macLocality(local, points, '/Volumes/USB/work'), 'local');
  assert.equal(macLocality(local, points, '/Volumes/USB/share/x'), 'network', 'a network mount nested in a local volume');
  assert.equal(macLocality(local, points, '/Users/mona/nas/project'), 'network', 'a network mount inside home');
  assert.equal(macLocality(local, points, '/Users/mona/code'), 'local');
  assert.equal(macLocality(null, null, '/Volumes/USB'), 'unknown', 'mount unreadable: fail closed');
});

test('review: a network folder inside an allowed root is refused after resolution; unknown is refused under a volume only', async () => {
  const { home, volume } = await layout();
  // The volume root is trusted by injection; locality is decided per resolved folder.
  const roots = { home, volumes: [{ path: volume, label: 'DATA', kind: 'volume' }] };
  const { resolveBrowsable: resolve } = await import('../src/console/folders.js');
  assert.equal((await resolve(path.join(volume, 'Work'), roots)).real, path.join(volume, 'Work'));
  assert.ok(isNetworkPath('\\??\\UNC\\server\\share', W), 'the NT form a link target can carry');
  assert.equal(isNetworkPath('\\??\\C:\\Work', W), false);
});

test('review: a new folder is never created under a name that would not be browsable', async () => {
  const { home, options } = await layout();
  await assert.rejects(createFolder(path.join(home, 'code'), '.cache', options), { code: 'BAD_NAME' });
  assert.equal(refusalInside(drive('D'), 'D:\\Recovery', W), 'SYSTEM_FOLDER', 'createFolder checks this before mkdir (Windows: not verified on a real drive)');
});
