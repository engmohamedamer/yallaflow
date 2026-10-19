import { assertTrustedOrigin, httpGetJson, readCredential } from './http.js';
import { extractAcceptanceSection, isHttpUrl, TICKET_SHAPE_VERSION } from './ticket.js';

// GitHub Issues adapter (v1.1.0). Accepts what an agent typically already has:
//   gh issue view N --json number,title,body,state,url,labels,author,comments,updatedAt
//   the REST issue object (GET /repos/{o}/{r}/issues/{n}), optionally wrapped as
//   { "issue": {...}, "comments": [...] } with the REST comments list.
export const id = 'github';
export const label = 'GitHub Issues';
export const credentialVariables = ['GITHUB_TOKEN', 'GH_TOKEN'];

// github:owner/repo#12 | https://github.com/owner/repo/issues/12 (or a GitHub Enterprise host)
export function parseRef(input) {
  const short = /^github:([\w.-]+)\/([\w.-]+)#(\d+)$/i.exec(input);
  if (short) return { provider: id, owner: short[1], repo: short[2], number: Number(short[3]), webOrigin: 'https://github.com' };
  if (!isHttpUrl(input)) return null;
  const url = new URL(input);
  const match = /^\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)\/?$/.exec(url.pathname);
  if (!match) return null;
  return { provider: id, owner: match[1], repo: match[2], number: Number(match[3]), webOrigin: url.origin };
}

export function describeRef(ref) {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

// github.com uses api.github.com; any other host (GitHub Enterprise) must be configured
// explicitly — a ticket URL alone never decides where the token goes.
function apiBase(ref, config = {}) {
  if (config.apiUrl) return String(config.apiUrl).replace(/\/+$/, '');
  if (ref.webOrigin === 'https://github.com') return 'https://api.github.com';
  throw new Error(`GitHub: ${ref.webOrigin} is not github.com. For GitHub Enterprise, set requirements.providers.github.apiUrl in .yallaflow/config.yaml (e.g. ${ref.webOrigin}/api/v3); YallaFlow never sends a token to a host taken only from a ticket URL.`);
}

export async function fetchTicket(ref, { env = process.env, config = {}, fetchImpl } = {}) {
  const base = apiBase(ref, config);
  assertTrustedOrigin(base, { label: 'GitHub', trustedHosts: [/^api\.github\.com$/], configured: [config.apiUrl], hint: 'Set requirements.providers.github.apiUrl for GitHub Enterprise.' });
  const credential = readCredential(env, credentialVariables);
  const headers = {
    'X-GitHub-Api-Version': '2022-11-28',
    ...(credential ? { Authorization: `Bearer ${credential.value}` } : {})
  };
  const options = { headers, allowedOrigin: new URL(base).origin, maxBytes: 10 * 1024 * 1024, fetchImpl, accept: 'application/vnd.github+json' };
  const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.number}`;
  const issue = await httpGetJson(`${base}${path}`, options);
  const comments = await httpGetJson(`${base}${path}/comments?per_page=100`, options);
  return { payload: { issue, comments }, credential: credential?.name ?? null };
}

// Attachments on GitHub live on github.com / githubusercontent.com, not on the API
// origin, so they are downloaded without credentials (public assets only), and only
// from those hosts.
const ATTACHMENT_URL = /^https:\/\/(github\.com\/user-attachments\/|([\w-]+\.)*githubusercontent\.com\/)/i;

export function attachmentRequest() {
  return { headers: {}, allowAttachmentUrl: (url) => ATTACHMENT_URL.test(url) };
}

export function normalize(raw) {
  const issue = raw?.issue && typeof raw.issue === 'object' ? raw.issue : raw;
  if (!issue || typeof issue !== 'object' || !Number.isInteger(issue.number) || typeof issue.title !== 'string') {
    throw new Error('Not a GitHub issue payload: expected an issue object with number and title (gh issue view --json … or the REST issue).');
  }
  const webUrl = issue.html_url ?? (isHttpUrl(issue.url) && !/\/repos\//.test(issue.url) ? issue.url : null);
  const location = webUrl ? parseRef(webUrl) : null;
  const rawComments = Array.isArray(raw?.comments) ? raw.comments : Array.isArray(issue.comments) ? issue.comments : [];
  const body = typeof issue.body === 'string' ? issue.body : '';
  const comments = rawComments.map((comment, index) => {
    const login = comment.user?.login ?? comment.author?.login ?? null;
    return {
      id: String(comment.id ?? comment.databaseId ?? index + 1),
      author: login,
      createdAt: comment.created_at ?? comment.createdAt ?? null,
      body: typeof comment.body === 'string' ? comment.body : '',
      bot: comment.user?.type === 'Bot' || /\[bot\]$/i.test(login ?? '')
    };
  });
  return {
    yallaflowTicket: TICKET_SHAPE_VERSION,
    provider: id,
    instance: location?.webOrigin ?? null,
    key: location ? describeRef(location) : `#${issue.number}`,
    url: webUrl,
    title: issue.title,
    type: issue.pull_request || issue.isPullRequest ? 'pull request' : 'issue',
    state: typeof issue.state === 'string' ? issue.state.toLowerCase() : null,
    labels: (issue.labels ?? []).map((entry) => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean),
    author: issue.user?.login ?? issue.author?.login ?? null,
    createdAt: issue.created_at ?? issue.createdAt ?? null,
    updatedAt: issue.updated_at ?? issue.updatedAt ?? null,
    revision: issue.updated_at ?? issue.updatedAt ?? null,
    description: body,
    acceptanceCriteria: extractAcceptanceSection(body),
    comments,
    attachments: markdownAttachments([body, ...comments.map((comment) => comment.body)])
  };
}

// Files and images uploaded into issue text (github.com/user-attachments/…,
// *.githubusercontent.com/…). Links to other sites are not attachments.
function markdownAttachments(texts) {
  const seen = new Map();
  const pattern = /(!?)\[([^\]]*)\]\((https:\/\/[^)\s]+)\)|<img[^>]*src="(https:\/\/[^"]+)"[^>]*>/gi;
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const url = match[3] ?? match[4];
      if (!ATTACHMENT_URL.test(url)) continue;
      if (seen.has(url)) continue;
      const tail = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'attachment');
      const name = (match[2] && /\.[a-z0-9]{2,5}$/i.test(match[2]) ? match[2] : tail).replace(/[\\/]/g, '_');
      seen.set(url, { name, url });
    }
  }
  return [...seen.values()];
}
