// Trust from a test the way the console does it: in-process, bound to the reviewed hash
// (the CLI itself trusts only for a person at a terminal, PF-0072 review finding 2).
import { loadRuntimeProfiles } from '../src/runtime/profile.js';
import { trustService } from '../src/runtime/trust.js';

export async function trustAsConsole(root, id, expect) {
  const service = (await loadRuntimeProfiles(root)).services.find((entry) => entry.id === id);
  if (!service) throw Object.assign(new Error(`No service ${id}`), { code: 'RUNTIME_UNKNOWN_SERVICE' });
  return trustService(root, service, { expect });
}

// Synchronous variant for tests written around spawnSync: runs the console's in-process call
// in a child Node and prints the result or the error as the CLI's JSON would.
import { spawnSync } from 'node:child_process';
const SELF = new URL(import.meta.url).href;
const PLAN = new URL('../src/runtime/plan.js', import.meta.url).href;
export function consoleTrustSync(root, id, expect, env = {}) {
  const code = `import(${JSON.stringify(SELF)}).then((m) => m.trustAsConsole(${JSON.stringify(root)}, ${JSON.stringify(id)}, ${JSON.stringify(expect)})).then((r) => console.log(JSON.stringify({ ok: true, trustedAt: r.trustedAt })), (e) => { console.log(JSON.stringify({ error: { code: e.code ?? 'ERROR', message: e.message } })); process.exitCode = 1; });`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}
export function consoleSaveSync(root, ids, options = {}, env = {}) {
  const code = `import(${JSON.stringify(PLAN)}).then((m) => m.savePlanServices(${JSON.stringify(root)}, ${JSON.stringify(ids)}, ${JSON.stringify(options)})).then((r) => console.log(JSON.stringify({ ok: true, ...r })), (e) => { console.log(JSON.stringify({ error: { code: e.code ?? 'ERROR', message: e.message } })); process.exitCode = 1; });`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}
