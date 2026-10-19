import { assertTrustedOrigin, basicAuth, httpGetJson, readCredential } from './http.js';
import { criteriaFromFieldText, extractAcceptanceSection, htmlToText, isHttpUrl, TICKET_SHAPE_VERSION } from './ticket.js';

// Azure DevOps Boards adapter (v1.1.0). Accepts the work-item REST object
// (GET {org}/{project}/_apis/wit/workitems/{id}?$expand=all), optionally wrapped as
// { "workItem": {...}, "comments": {...comments list response...} }.
export const id = 'azure-devops';
export const label = 'Azure DevOps Boards';
export const credentialVariables = ['AZURE_DEVOPS_EXT_PAT'];

const AC_FIELD = 'Microsoft.VSTS.Common.AcceptanceCriteria';

// ado:org/project#45 | https://dev.azure.com/org/project/_workitems/edit/45 | https://org.visualstudio.com/project/_workitems/edit/45
export function parseRef(input) {
  const short = /^ado:([^/#\s]+)\/([^#]+)#(\d+)$/i.exec(input);
  if (short) return { provider: id, base: `https://dev.azure.com/${encodeURIComponent(short[1])}`, project: short[2].trim(), number: Number(short[3]), shortForm: true };
  if (!isHttpUrl(input)) return null;
  const url = new URL(input);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const edit = parts.indexOf('_workitems');
  if (edit < 1 || parts[edit + 1] !== 'edit' || !/^\d+$/.test(parts[edit + 2] ?? '')) return null;
  const project = parts[edit - 1];
  const prefix = parts.slice(0, edit - 1).map(encodeURIComponent).join('/');
  return { provider: id, base: `${url.origin}${prefix ? `/${prefix}` : ''}`, project, number: Number(parts[edit + 2]) };
}

export function describeRef(ref) {
  return `${ref.project}#${ref.number}`;
}

// The short form assumes Azure DevOps Services; requirements.providers.azure-devops.baseUrl
// (e.g. an Azure DevOps Server collection URL) replaces that default. A full URL is used as given.
function resolveBase(ref, config) {
  const base = String(ref.shortForm && config.baseUrl ? config.baseUrl : ref.base).replace(/\/+$/, '');
  // Azure DevOps Services is dev.azure.com / *.visualstudio.com; Azure DevOps Server must be configured.
  assertTrustedOrigin(base, { label: 'Azure DevOps', trustedHosts: [/^dev\.azure\.com$/i, /^[a-z0-9-]+\.visualstudio\.com$/i], configured: [config.baseUrl], hint: 'For Azure DevOps Server, set requirements.providers.azure-devops.baseUrl in .yallaflow/config.yaml.' });
  return base;
}

function credentialHeaders(env) {
  const pat = readCredential(env, credentialVariables);
  if (!pat) throw new Error('Azure DevOps --fetch needs a personal access token with Work Items (Read) scope in AZURE_DEVOPS_EXT_PAT. It is never stored.');
  return { credential: pat.name, headers: { Authorization: basicAuth('', pat.value) } };
}

export async function fetchTicket(ref, { env = process.env, config = {}, fetchImpl } = {}) {
  const base = resolveBase(ref, config);
  const auth = credentialHeaders(env);
  const options = { headers: auth.headers, allowedOrigin: new URL(base).origin, maxBytes: 10 * 1024 * 1024, fetchImpl };
  const project = encodeURIComponent(ref.project);
  const workItem = await httpGetJson(`${base}/${project}/_apis/wit/workitems/${ref.number}?$expand=all&api-version=7.1`, options);
  const comments = await httpGetJson(`${base}/${project}/_apis/wit/workItems/${ref.number}/comments?api-version=7.1-preview.4`, options);
  return { payload: { workItem, comments }, credential: auth.credential, base };
}

export function attachmentRequest(ref, { env = process.env, config = {} } = {}) {
  return { headers: credentialHeaders(env).headers, allowedOrigin: new URL(resolveBase(ref, config)).origin };
}

export function normalize(raw) {
  const item = raw?.workItem && typeof raw.workItem === 'object' ? raw.workItem : raw;
  const fields = item?.fields;
  if (!item || !Number.isInteger(item.id) || !fields || typeof fields !== 'object' || typeof fields['System.Title'] !== 'string') {
    throw new Error('Not an Azure DevOps work-item payload: expected an object with id and fields["System.Title"] (GET _apis/wit/workitems/{id}).');
  }
  const webUrl = item._links?.html?.href ?? null;
  const project = fields['System.TeamProject'] ?? null;
  const description = htmlToText(fields['System.Description'] ?? '');
  const acText = htmlToText(fields[AC_FIELD] ?? '');
  const rawComments = Array.isArray(raw?.comments) ? raw.comments : Array.isArray(raw?.comments?.comments) ? raw.comments.comments : [];
  return {
    yallaflowTicket: TICKET_SHAPE_VERSION,
    provider: id,
    instance: isHttpUrl(webUrl) ? new URL(webUrl).origin : isHttpUrl(item.url) ? new URL(item.url).origin : null,
    key: project ? `${project}#${item.id}` : `#${item.id}`,
    url: isHttpUrl(webUrl) ? webUrl : null,
    title: fields['System.Title'],
    type: fields['System.WorkItemType'] ?? null,
    state: fields['System.State'] ?? null,
    labels: typeof fields['System.Tags'] === 'string' ? fields['System.Tags'].split(';').map((tag) => tag.trim()).filter(Boolean) : [],
    author: fields['System.CreatedBy']?.displayName ?? (typeof fields['System.CreatedBy'] === 'string' ? fields['System.CreatedBy'] : null),
    createdAt: fields['System.CreatedDate'] ?? null,
    updatedAt: fields['System.ChangedDate'] ?? null,
    revision: item.rev ?? null,
    description,
    acceptanceCriteria: acText ? criteriaFromFieldText(acText, `field:${AC_FIELD}`) : extractAcceptanceSection(description),
    comments: rawComments.map((comment, index) => ({
      id: String(comment.id ?? index + 1),
      author: comment.createdBy?.displayName ?? null,
      createdAt: comment.createdDate ?? null,
      body: htmlToText(comment.text ?? ''),
      bot: false
    })),
    attachments: (item.relations ?? []).filter((relation) => relation?.rel === 'AttachedFile').map((relation) => ({
      name: String(relation.attributes?.name ?? 'attachment').replace(/[\\/]/g, '_'),
      url: relation.url,
      sizeBytes: Number.isInteger(relation.attributes?.resourceSize) ? relation.attributes.resourceSize : undefined
    }))
  };
}
