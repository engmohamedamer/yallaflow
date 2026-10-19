import { assertTrustedOrigin, basicAuth, httpGetJson, readCredential } from './http.js';
import { adfToMarkdown, criteriaFromFieldText, extractAcceptanceSection, isHttpUrl, TICKET_SHAPE_VERSION } from './ticket.js';

// Jira adapter (v1.1.0). Accepts the REST issue object (GET /rest/api/3/issue/{key},
// ideally with ?expand=names so a custom "Acceptance Criteria" field can be found by
// name) — which is also what the Atlassian MCP returns — or REST v2 (Data Center).
export const id = 'jira';
export const label = 'Jira';
export const credentialVariables = ['JIRA_EMAIL + JIRA_API_TOKEN', 'JIRA_PAT'];

const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

// jira:KEY-123 (base URL from config/JIRA_BASE_URL) | https://<site>/browse/KEY-123 | …?selectedIssue=KEY-123
export function parseRef(input) {
  const short = /^jira:([A-Za-z][A-Za-z0-9_]+-\d+)$/i.exec(input);
  if (short) return { provider: id, key: short[1].toUpperCase(), baseUrl: null };
  if (!isHttpUrl(input)) return null;
  const url = new URL(input);
  const key = /\/browse\/([A-Z][A-Z0-9_]+-\d+)\/?$/.exec(url.pathname)?.[1] ?? url.searchParams.get('selectedIssue');
  if (!key || !KEY.test(key)) return null;
  const prefix = url.pathname.split('/browse/')[0];
  return { provider: id, key, baseUrl: `${url.origin}${prefix.includes('/jira/') ? '' : prefix}`.replace(/\/+$/, '') };
}

export function describeRef(ref) {
  return ref.key;
}

function resolveBase(ref, config, env) {
  const base = ref.baseUrl ?? config.baseUrl ?? env.JIRA_BASE_URL ?? null;
  if (!base || !isHttpUrl(base)) {
    throw new Error('Jira needs a site URL: pass the issue URL (https://<site>/browse/KEY-1), or set requirements.providers.jira.baseUrl in .yallaflow/config.yaml, or JIRA_BASE_URL.');
  }
  const trimmed = String(base).replace(/\/+$/, '');
  // Jira Cloud sites are *.atlassian.net; any other site (Data Center) must be configured.
  assertTrustedOrigin(trimmed, { label: 'Jira', trustedHosts: [/^[a-z0-9-]+\.atlassian\.net$/i], configured: [config.baseUrl, env.JIRA_BASE_URL], hint: 'For Jira Data Center, set requirements.providers.jira.baseUrl in .yallaflow/config.yaml (or JIRA_BASE_URL).' });
  return trimmed;
}

function credentialHeaders(env) {
  const email = readCredential(env, ['JIRA_EMAIL']);
  const token = readCredential(env, ['JIRA_API_TOKEN']);
  if (email && token) return { api: 3, credential: 'JIRA_EMAIL + JIRA_API_TOKEN', headers: { Authorization: basicAuth(email.value, token.value) } };
  const pat = readCredential(env, ['JIRA_PAT']);
  if (pat) return { api: 2, credential: 'JIRA_PAT', headers: { Authorization: `Bearer ${pat.value}` } };
  throw new Error('Jira --fetch needs credentials in the environment: JIRA_EMAIL and JIRA_API_TOKEN (Jira Cloud), or JIRA_PAT (Jira Data Center). They are never stored.');
}

export async function fetchTicket(ref, { env = process.env, config = {}, fetchImpl } = {}) {
  const base = resolveBase(ref, config, env);
  const auth = credentialHeaders(env);
  const payload = await httpGetJson(`${base}/rest/api/${auth.api}/issue/${encodeURIComponent(ref.key)}?expand=names`, {
    headers: auth.headers, allowedOrigin: new URL(base).origin, maxBytes: 10 * 1024 * 1024, fetchImpl
  });
  return { payload, credential: auth.credential, base };
}

// Jira attachment content lives on the same site, behind the same credentials.
export function attachmentRequest(ref, { env = process.env, config = {} } = {}) {
  const base = resolveBase(ref, config, env);
  return { headers: credentialHeaders(env).headers, allowedOrigin: new URL(base).origin };
}

export function normalize(raw) {
  const fields = raw?.fields;
  if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string' || !fields || typeof fields !== 'object') {
    throw new Error('Not a Jira issue payload: expected an issue object with key and fields (GET /rest/api/3/issue/{key}).');
  }
  const origin = isHttpUrl(raw.self) ? new URL(raw.self).origin : null;
  const description = richText(fields.description);
  const names = raw.names && typeof raw.names === 'object' ? raw.names : {};
  const acField = Object.keys(names).find((fieldId) => /acceptance criteria/i.test(String(names[fieldId])) && fields[fieldId]);
  const acceptanceCriteria = acField
    ? criteriaFromFieldText(richText(fields[acField]), `field:${acField} (${names[acField]})`)
    : extractAcceptanceSection(description);
  const comments = (fields.comment?.comments ?? []).map((comment, index) => ({
    id: String(comment.id ?? index + 1),
    author: comment.author?.displayName ?? null,
    createdAt: comment.created ?? null,
    body: richText(comment.body),
    bot: comment.author?.accountType === 'app'
  }));
  const attachments = (fields.attachment ?? []).map((entry) => ({
    id: entry.id,
    name: String(entry.filename ?? `attachment-${entry.id}`).replace(/[\\/]/g, '_'),
    url: entry.content,
    sizeBytes: Number.isInteger(entry.size) ? entry.size : undefined,
    contentType: entry.mimeType
  }));
  return {
    yallaflowTicket: TICKET_SHAPE_VERSION,
    provider: id,
    instance: origin,
    key: raw.key,
    url: origin ? `${origin}/browse/${raw.key}` : null,
    title: String(fields.summary ?? raw.key),
    type: fields.issuetype?.name ?? null,
    state: fields.status?.name ?? null,
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    author: fields.reporter?.displayName ?? fields.creator?.displayName ?? null,
    createdAt: fields.created ?? null,
    updatedAt: fields.updated ?? null,
    revision: fields.updated ?? null,
    description,
    acceptanceCriteria,
    comments,
    attachments
  };
}

// REST v3 rich text is Atlassian Document Format; v2 returns wiki-markup strings.
function richText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return adfToMarkdown(value);
}
