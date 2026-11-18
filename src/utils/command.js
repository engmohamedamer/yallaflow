// One cross-platform way to find and start a developer tool (PF-0157): the New Project
// wizard's generators (composer, npx, npm), its prerequisite checks and the console's tool
// chips all use the lookup and launch rules the agent side already has (src/agents/detect.js,
// PF-0148). No shell is ever used.
//
// - Lookup: a bare name is searched in the absolute PATH folders of the child's own
//   environment; on Windows with the PATHEXT extensions YallaFlow can start.
// - Launch: a Windows .cmd/.bat shim is never run by a shell. The program it points to is
//   started directly (see launchSpec), or the tool is reported as not startable.
// - Environment: children get an allow-list, never the whole environment. Windows programs
//   need a few system variables (SystemRoot, APPDATA, TEMP, …) that have no POSIX name.
//
// Windows and macOS behavior here is exercised with injected platform data only; it is not
// verified on those systems.
import path from 'node:path';
import { envValue, launchSpec, which } from '../agents/detect.js';

// What Windows programs need to start, find the user's folders and reach the network. None
// of these carries a credential.
export const WINDOWS_ENV = Object.freeze([
  'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec',
  'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP',
  'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles',
  'USERNAME', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'
]);

// The allow-listed environment for a child: `names` everywhere, plus WINDOWS_ENV on Windows
// (read whatever the variable's case; written under the listed name).
export function safeEnvironment(names, source = process.env, platform = process.platform) {
  const env = {};
  const wanted = platform === 'win32' ? [...new Set([...names, ...WINDOWS_ENV])] : names;
  for (const name of wanted) {
    const value = envValue(source, name, platform);
    if (typeof value === 'string') env[name] = value;
  }
  return env;
}

// A Windows system program (reg.exe, taskkill.exe) by its full path in System32, never by a
// PATH lookup: a folder earlier on PATH cannot put its own program in its place.
export function windowsSystemProgram(name, env = process.env) {
  const root = envValue(env, 'SystemRoot', 'win32') ?? envValue(env, 'windir', 'win32');
  const base = typeof root === 'string' && path.win32.isAbsolute(root) && !/[%$]/.test(root) ? root : 'C:\\Windows';
  return path.win32.join(base, 'System32', name);
}

// → { ok: true, file, args } to pass to spawn/execFile with shell:false, or
//   { ok: false, reason: 'not-found' | 'not-startable', message }.
// `env` is the child's environment: the tool is found on the PATH the child itself gets.
export async function resolveCommand(argv, env, { platform = process.platform, deps = {} } = {}) {
  const [name, ...args] = argv;
  const find = deps.which ?? ((program) => which(program, env, { platform, ...(deps.isFile ? { isFile: deps.isFile } : {}) }));
  const file = await find(name);
  if (!file) return { ok: false, reason: 'not-found', message: `${name} was not found on PATH` };
  try {
    // A PHP archive behind a shim (Composer's Windows installer) is started with php itself.
    const spec = await launchSpec(file, args, { platform, php: () => find('php'), ...(deps.isFile ? { isFile: deps.isFile } : {}), ...(deps.readText ? { readText: deps.readText } : {}), ...(deps.node ? { node: deps.node } : {}) });
    return { ok: true, file: spec.file, args: spec.args, found: file };
  } catch (error) {
    return { ok: false, reason: 'not-startable', message: error.message, found: file };
  }
}
