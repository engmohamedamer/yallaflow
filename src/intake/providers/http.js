// The only network client in YallaFlow (v1.1.0). It exists solely for the explicit,
// opt-in `yallaflow intake ticket <ref> --fetch`; no other command imports it.
//
// Guarantees:
//   - GET only; nothing is ever sent to a tracker except the request itself.
//   - Credentials go only to the provider's own API origin. A redirect is followed only
//     within that origin (at most 3 hops); a cross-origin redirect is refused, so a token
//     can never be forwarded to another host.
//   - Response size is capped and the request times out; nothing is retried silently.
//   - The token never appears in an error message, a log, or YallaFlow state.
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 30_000;

export async function httpGet(url, { headers = {}, allowedOrigin, maxBytes, fetchImpl = globalThis.fetch, accept = 'application/json' } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime has no fetch(); Node.js >= 20.16.0 is required for --fetch.');
  let current = new URL(url);
  // An uncredentialed request (e.g. a public attachment on a CDN) may follow an https
  // redirect anywhere; a credentialed one never leaves its origin.
  const credentialed = Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const allowed = credentialed ? current.origin === allowedOrigin : current.protocol === 'https:' || current.origin === allowedOrigin;
    if (!allowed) throw new Error(`Refusing to send a request outside ${allowedOrigin}: ${current.origin}.`);
    let response;
    try {
      response = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: accept, 'User-Agent': 'yallaflow', ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      throw new Error(`Could not reach ${current.origin} (${error.name === 'TimeoutError' ? 'timed out' : error.message}).`);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), current);
      continue;
    }
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? ' Check that the credential environment variable is set and has read access.'
        : response.status === 404 ? ' Check the reference, and that the credential can see it.' : '';
      throw new Error(`${current.origin} answered ${response.status} ${response.statusText || ''}`.trim() + ` for ${current.pathname}.${hint}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Response from ${current.origin}${current.pathname} exceeds the ${maxBytes}-byte limit.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Response from ${current.origin}${current.pathname} exceeds the ${maxBytes}-byte limit.`);
    return { buffer, contentType: response.headers.get('content-type') ?? null, url: current.href };
  }
  throw new Error(`Too many redirects fetching ${url}.`);
}

export async function httpGetJson(url, options) {
  const { buffer } = await httpGet(url, options);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error(`Response from ${new URL(url).origin} was not valid JSON.`);
  }
}

// Which origin may receive tracker credentials (v1.1.0 release review): never one taken
// from a ticket reference alone. Allowed: an https origin whose host matches the
// provider's own hosted service (api.github.com, *.atlassian.net, dev.azure.com, …), or
// an origin the project configured explicitly (config.yaml requirements.providers, or a
// documented environment variable) — the only way to trust a self-hosted or http host.
export function assertTrustedOrigin(base, { label, trustedHosts = [], configured = [], hint }) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`${label}: ${base} is not a URL.`);
  }
  const configuredOrigins = configured.filter(Boolean).map((value) => {
    try { return new URL(value).origin; } catch { return null; }
  }).filter(Boolean);
  if (configuredOrigins.includes(url.origin)) return url.origin;
  if (url.protocol === 'https:' && trustedHosts.some((pattern) => pattern.test(url.hostname))) return url.origin;
  throw new Error(`${label}: refusing to send credentials to ${url.origin}, which is not a known ${label} host${url.protocol === 'https:' ? '' : ' (and is not https)'}. ${hint}`);
}

export function basicAuth(user, secret) {
  return `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
}

// Reads the first set variable of `names`. Values are returned only to build a request
// header and are never stored or printed.
export function readCredential(env, names) {
  for (const name of names) {
    if (typeof env[name] === 'string' && env[name].trim()) return { name, value: env[name].trim() };
  }
  return null;
}
