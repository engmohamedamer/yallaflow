// PF-0176 (W6b): the Windows process layer of the Run Manager, exercised with SIMULATED Windows
// data (process tables, netstat output, taskkill) on whatever machine runs the tests. These show
// that the rules are written as intended; they are not a real-Windows result. The real-process
// lifecycle is in runtime-lifecycle-os.test.js, which runs on every operating system in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WINDOWS_TABLE_ARGV, clearProcessTable, parseProcessTable, readWindowsTable, serviceEnvironment, windowsDescendants, windowsPowerShell, windowsStopTree, windowsTableUnreadable } from '../src/runtime/process.js';
import { parseWindowsListeners } from '../src/runtime/observe.js';
import { runtimeCapabilities } from '../src/runtime/supervisor.js';

const T = (offset) => `2026-11-18T10:00:${String(offset).padStart(2, '0')}.1234567Z`;
const TABLE = [
  `100|4|${T(0)}|explorer.exe`,
  `2000|100|${T(10)}|node.exe`, // the service leader (npm-cli.js)
  `2100|2000|${T(11)}|cmd.exe`, // npm's script shell
  `2200|2100|${T(12)}|node.exe`, // vite
  `2300|2200|${T(13)}|esbuild.exe`,
  `2400|2000|${T(5)}|old.exe`, // its parent pid names 2000, but it was created before 2000: a reused pid
  'garbage line',
  `3000|100||System Idle`
].join('\r\n');

test('process table: pid, parent, creation time and name from the fixed query; unusable lines are skipped', () => {
  const table = parseProcessTable(TABLE);
  assert.deepEqual(table.get(2200), { pid: 2200, ppid: 2100, start: T(12), name: 'node.exe' });
  assert.equal(table.has(3000), false, 'no creation time: no identity');
  assert.equal(table.size, 6);
  assert.deepEqual(WINDOWS_TABLE_ARGV.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(WINDOWS_TABLE_ARGV[3], /^Get-CimInstance -ClassName Win32_Process \| ForEach-Object/);
  assert.doesNotMatch(WINDOWS_TABLE_ARGV[3], /\$\{|Invoke-Expression|iex|Start-Process|Stop-Process/i, 'a constant, read-only query');
  assert.equal(windowsPowerShell({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});

test('descendants: the whole tree by parent link, never a process created before its parent, never from a leader that changed', () => {
  const table = parseProcessTable(TABLE);
  assert.deepEqual(windowsDescendants(table, 2000, T(10)).map((entry) => entry.pid), [2100, 2200, 2300]);
  assert.deepEqual(windowsDescendants(table, 2000, T(10))[1], { pid: 2200, start: T(12) });
  assert.deepEqual(windowsDescendants(table, 2000, T(40)), [], 'the pid belongs to another program now: nothing is expanded');
  assert.deepEqual(windowsDescendants(table, 2000, null), []);
  assert.deepEqual(windowsDescendants(table, 9999, T(1)), []);
  assert.deepEqual(windowsDescendants(null, 2000, T(10)), []);
});

// A simulated system: a live table that kill changes.
function system(lines, { stubborn = [] } = {}) {
  const table = parseProcessTable(lines.join('\n'));
  const calls = { kill: [] };
  return {
    calls,
    table,
    readTable: async () => new Map(table),
    kill: (pid) => { calls.kill.push(pid); if (!stubborn.includes(pid)) table.delete(pid); },
    sleep: async () => {}
  };
}
const RUN = { pid: 2000, startTime: T(10) };

test('stop: the verified leader and each process it started are ended one by one; nothing else', async () => {
  const s = system(TABLE.split('\r\n'));
  const result = await windowsStopTree(RUN, { ...s, waitMs: 1000 });
  assert.deepEqual(result, { survivors: [], verified: true, leaderMatched: true });
  assert.deepEqual(s.calls.kill.sort(), [2000, 2100, 2200, 2300]);
  assert.ok(s.table.has(100), 'unrelated processes stay');
  assert.ok(s.table.has(2400), 'an older process that names the leader as parent (a reused parent pid) is not part of the tree');
});

test('review finding 1: a leader pid now held by another program — nothing at all is signalled, not even its children', async () => {
  // The service died; Windows gave pid 2000 to another program, which has children of its own.
  const lines = [`100|4|${T(0)}|explorer.exe`, `2000|100|${T(40)}|other.exe`, `2100|2000|${T(41)}|other-child.exe`, `2200|2100|${T(42)}|other-grandchild.exe`];
  const s = system(lines);
  const result = await windowsStopTree(RUN, { ...s, waitMs: 1000 });
  assert.deepEqual(s.calls.kill, [], 'no kill');
  assert.equal(result.leaderMatched, false);
  assert.equal(s.table.size, 4);
});

test('a child started during the stop is included; a reused pid of a member is not expanded', async () => {
  const s = system(TABLE.split('\r\n'), { stubborn: [2000] });
  let pass = 0;
  const readTable = async () => {
    pass += 1;
    if (pass === 2) s.table.set(2500, { pid: 2500, ppid: 2200, start: T(50), name: 'late.exe' });
    return new Map(s.table);
  };
  const result = await windowsStopTree(RUN, { ...s, readTable, waitMs: 1 });
  assert.ok(s.calls.kill.includes(2500), 'the late child is ended too');
  assert.deepEqual(result.survivors, [2000], 'what refused to end is reported, never claimed stopped');
  // 2100 dies and its pid is reused by an unrelated program with its own child: not expanded.
  const lines = TABLE.split('\r\n').filter((line) => !line.startsWith('2100|')).concat([`2100|100|${T(60)}|unrelated.exe`, `2600|2100|${T(61)}|unrelated-child.exe`]);
  const r = system(lines);
  await windowsStopTree(RUN, { ...r, waitMs: 1000 });
  assert.ok(!r.calls.kill.includes(2100) && !r.calls.kill.includes(2600), 'the reused pid and its child are untouched');
  assert.ok(r.table.has(2100) && r.table.has(2600));
});

test('an unreadable process table signals nothing and is reported as such', async () => {
  const blind = { readTable: async () => null, kill: () => assert.fail('no kill without a table'), sleep: async () => {} };
  assert.deepEqual(await windowsStopTree(RUN, { ...blind, waitMs: 1 }), { survivors: [], verified: false, leaderMatched: false });
  clearProcessTable();
  assert.equal(await readWindowsTable({ fresh: true, read: () => null }), null);
  assert.equal(windowsTableUnreadable(), true, 'identity checks then answer "unverifiable", never "not ours"');
  assert.ok(await readWindowsTable({ fresh: true, read: () => parseProcessTable(TABLE) }));
  assert.equal(windowsTableUnreadable(), false);
  clearProcessTable();
});

test('netstat: listening TCP sockets with their pid, whatever the language of the state column', () => {
  const text = [
    'Active Connections',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012',
    '  TCP    127.0.0.1:5173         0.0.0.0:0              ABHÖREN         2200',
    '  TCP    [::]:5173              [::]:0                 LISTENING       2200',
    '  TCP    127.0.0.1:5173         127.0.0.1:50123        ESTABLISHED     2200',
    '  UDP    0.0.0.0:5353           *:*                                    3000'
  ].join('\r\n');
  assert.deepEqual(parseWindowsListeners(text), [{ port: 135, pid: 1012 }, { port: 5173, pid: 2200 }]);
});

test('a Windows service gets the system variables programs need, and still no credential', () => {
  const env = serviceEnvironment(['APP_ENV'], { Path: 'C:\\x', SystemRoot: 'C:\\Windows', APPDATA: 'C:\\U\\R', TEMP: 'C:\\T', APP_ENV: 'local', GITHUB_TOKEN: 'g', OPENAI_API_KEY: 'k' }, 'win32');
  assert.equal(env.PATH, 'C:\\x');
  for (const name of ['SystemRoot', 'APPDATA', 'TEMP', 'APP_ENV']) assert.ok(env[name], name);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.deepEqual(Object.keys(serviceEnvironment([], { PATH: '/bin', HOME: '/h', SECRET: 's' }, 'linux')).sort(), ['HOME', 'PATH'], 'Linux and macOS unchanged');
});

test('capabilities: Windows runs services but not Compose, and stops forcefully; only Linux is verified on a real machine', () => {
  assert.deepEqual(runtimeCapabilities('win32'), { platform: 'win32', lifecycle: true, compose: false, gracefulStop: false, verified: false });
  assert.deepEqual(runtimeCapabilities('linux'), { platform: 'linux', lifecycle: true, compose: true, gracefulStop: true, verified: true });
  assert.equal(runtimeCapabilities('darwin').verified, false);
  assert.equal(runtimeCapabilities('freebsd').lifecycle, false);
});
