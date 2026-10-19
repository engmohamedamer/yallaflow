import * as github from './github.js';
import * as jira from './jira.js';
import * as azureDevops from './azure-devops.js';

// Requirements-provider registry (v1.1.0). An adapter is a self-contained module:
//   id, label, credentialVariables
//   parseRef(input)            -> ref | null       (short form or web URL)
//   describeRef(ref)           -> display key
//   normalize(rawPayload)      -> normalized ticket (pure; see ticket.js)
//   fetchTicket(ref, opts)     -> { payload, credential }   (only for --fetch)
//   attachmentRequest(ref, o)  -> { headers, allowedOrigin? } for attachment downloads
// Adding a provider means adding one module here; the intake core never changes.
export const PROVIDERS = Object.freeze({ [github.id]: github, [jira.id]: jira, [azureDevops.id]: azureDevops });
export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

export function providerById(providerId) {
  const adapter = PROVIDERS[providerId];
  if (!adapter) throw new Error(`Unknown requirements provider ${JSON.stringify(providerId)}. Use one of: ${PROVIDER_IDS.join(', ')}.`);
  return adapter;
}

// The first adapter that recognizes `input` as a ticket reference, or null.
export function resolveTicketRef(input) {
  for (const adapter of Object.values(PROVIDERS)) {
    const ref = adapter.parseRef(String(input ?? '').trim());
    if (ref) return { adapter, ref };
  }
  return null;
}
