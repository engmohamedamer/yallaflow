// What the developer sees before trusting a service (PF-0072): the effective configuration,
// the definition hash the trust will be bound to, the inputs it covers and does not cover,
// anything blocking (owner requirement S1), the current trust state and whether the
// service is shared infrastructure (judged from current evidence, S3). Read-only.
import { definitionParts, loadRuntimeProfiles, resolveServiceCwd } from './profile.js';
import { executionReview } from './inputs.js';
import { trustState } from './trust.js';
import { sharedNow } from './discover.js';

export async function reviewService(root, id) {
  const profiles = await loadRuntimeProfiles(root);
  const service = profiles.services.find((entry) => entry.id === id);
  if (!service) throw Object.assign(new Error(`No service ${id} in the runtime profile.`), { code: 'RUNTIME_UNKNOWN_SERVICE' });
  let folder = null;
  let folderError = null;
  try { folder = await resolveServiceCwd(root, service); } catch (error) { folderError = error.message; }
  let inputs = { covered: [], notCovered: [], blocking: [] };
  try { inputs = await executionReview(root, service); } catch (error) { inputs.blocking = [{ item: 'inputs', reason: error.message }]; }
  const blocking = [...inputs.blocking, ...(folderError ? [{ item: 'folder', reason: folderError }] : [])];
  let definitionHash = null;
  if (!blocking.length) { try { definitionHash = (await definitionParts(root, service)).hash; } catch (error) { blocking.push({ item: 'definition', reason: error.message }); } }
  let trust;
  try { trust = await trustState(root, service); } catch (error) { trust = { trusted: false, reason: 'blocked', blocking: [{ item: 'definition', reason: error.message }] }; }
  return {
    id: service.id,
    effective: {
      name: service.name, kind: service.kind, command: service.command, cwd: service.cwd, folder, source: service.source,
      profile: service.source === 'local' ? '.yallaflow/local/runtime.yaml' : '.yallaflow/runtime.yaml', overridden: service.overridden,
      env: service.env, ports: service.ports, ready: service.ready, stopSignal: service.stopSignal, stopTimeoutSeconds: service.stopTimeoutSeconds,
      readyTimeoutSeconds: service.readyTimeoutSeconds, dependsOn: service.dependsOn, links: service.links, sharedMarker: service.shared
    },
    definitionHash,
    covered: inputs.covered,
    notCovered: inputs.notCovered,
    blocking,
    trust,
    shared: await sharedNow(root, service)
  };
}
