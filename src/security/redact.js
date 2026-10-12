import { appendFile } from 'node:fs/promises';
import { writeText } from '../utils/fs.js';

// Durable secret redaction (v0.3.10-internal.4). A real Brownfield pilot showed an
// Agent copying a credential from `.env` into a baseline fact, its evidence, and a
// checkpoint summary — and YallaFlow persisted it verbatim into committed state.
//
// This is the one sanitizer for YallaFlow-owned durable state. It is applied at the
// persistence boundary (writeYaml, the context-ledger writer, work records, generated
// ADRs, verification logs, extracted source text) — never to developer files, the
// agent instruction files, human content outside managed blocks, or source originals,
// which stay byte-for-byte as the developer supplied them.
//
// Conservative by design: only values in recognizably secret positions are replaced;
// the key, header name, or URL user stays, so `DB_PASSWORD=real-secret` persists as
// `DB_PASSWORD=<redacted>` and the path `.env` remains valid evidence. Ordinary
// technical text (`TOKEN_TTL=3600`, `token: string`, prose about passwords) is left
// alone. Redaction is idempotent and does no semantic interpretation.
export const REDACTED = '<redacted>';

// Key names whose value is a secret: after camelCase is split, the name must END with
// one of these words (TOKEN_TTL, PASSWORD_MIN_LENGTH, and API_KEY_HEADER are
// configuration, not secrets). Bare `pass` is deliberately absent ("tests pass: 12").
const SECRET_KEY = /(?:^|[_.-])(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|app[_-]?key|access[_-]?key|access[_-]?key[_-]?id|secret[_-]?key|secret[_-]?key[_-]?base|private[_-]?key|client[_-]?secret|signing[_-]?key|encryption[_-]?key|master[_-]?key|session[_-]?key|dsn|connection[_-]?string)$|^(?:pgpassword|mysql_pwd|db_pass)$/;
// Words that name a secret only when the value also looks like one
// ("credentials: include" and "cookie: yes" are ordinary settings).
const WEAK_SECRET_KEY = /(?:^|[_.-])(?:credential|credentials|cookie|pass)$/;

export function isSecretKey(key) {
  return SECRET_KEY.test(normalizeKey(key));
}

function normalizeKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// A credential-looking token: long enough and containing a digit, or very long.
function tokenLike(value) {
  return (value.length >= 12 && /\d/.test(value)) || value.length >= 32;
}

const TYPE_WORDS = /^(?:string|str|number|int|integer|float|double|bool|boolean|any|unknown|object|bytes|text|char|varchar|secret|password|token|null|none|optional|required)\??[,;]?$/i;

// Every pattern starts only where a token starts (a lookbehind on the token's own
// characters), so scanning stays linear on long unbroken text such as base64 blobs.
const PATTERNS = [
  // PEM private keys (any algorithm), including multi-line blocks.
  [/(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----)/g, (_, begin, end) => `${begin}${REDACTED}${end}`],
  // HTTP Authorization / Proxy-Authorization headers: keep the scheme, drop the
  // credential. Without a scheme only a token-like value is a credential
  // ("Authorization: role-based policies" is prose).
  [/(?<![A-Za-z0-9-])((?:proxy-)?authorization[ \t]*[:=][ \t]*["']?)(?:(bearer|basic|token|digest)[ \t]+)?([^\s"',;]+)/gi,
    (match, head, scheme, value) => (isRedacted(value) || (!scheme && !tokenLike(value)) ? match : `${head}${scheme ? `${scheme} ` : ''}${REDACTED}`)],
  // Bare bearer tokens in prose or command lines ("bearer authentication" is prose).
  [/(?<![A-Za-z0-9])(bearer[ \t]+)([A-Za-z0-9\-._~+/]{8,}=*)/gi, (match, head, value) => (tokenLike(value) ? `${head}${REDACTED}` : match)],
  // Cookie headers carry session secrets (name=value pairs).
  [/(?<![A-Za-z0-9-])((?:set-)?cookie[ \t]*:[ \t]*)([^\s=;]+=[^\r\n]+)/gi, (match, head, value) => (isRedacted(value) ? match : `${head}${REDACTED}`)],
  // Credentials embedded in URLs (postgres://user:pass@host, redis://:pass@host).
  [/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@"'<>]{0,256}:)([^\s@/"'<>]{1,512})(@)/gi, (match, head, value, at) => (isRedacted(value) ? match : `${head}${REDACTED}${at}`)],
  // Secret-valued command-line flags with a space separator (--password hunter2).
  [/(?<![A-Za-z0-9-])(--(?:password|passwd|token|secret|api-key|access-token|client-secret|private-key)[ \t]+)([^\s"'-][^\s"']*)/gi, (match, head, value) => (isRedacted(value) || isReference(value) ? match : `${head}${REDACTED}`)],
  // Well-known token formats, wherever they appear.
  [/(?<![A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9\-_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{35}|sk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{36}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})(?![A-Za-z0-9_-])/g, () => REDACTED]
];

// Secret-named assignments: KEY=value, KEY: "value", "key": "value", key = 'value',
// 'key' => 'value', key := value — on one line. Scanned explicitly so that a
// non-secret key never swallows the text after it ("Steps: DB_PASSWORD=…" still
// reaches DB_PASSWORD), and each key is examined once (linear time). A key starts at
// a token boundary or after a flag dash (--access-token=…), never mid-word.
const ASSIGNMENT = /(["']?)(?<![A-Za-z0-9_.])(?<![A-Za-z0-9_.]-)([A-Za-z_][A-Za-z0-9_.-]{0,127})\1([ \t]*(=>|:=|=|:)[ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;}\])]+)/g;

function redactAssignments(text) {
  const pattern = new RegExp(ASSIGNMENT.source, 'g');
  let result = '';
  let copied = 0;
  let match;
  while ((match = pattern.exec(text))) {
    const [whole, quote, key, , , value] = match;
    const normalized = normalizeKey(key);
    const strong = SECRET_KEY.test(normalized);
    const weak = !strong && WEAK_SECRET_KEY.test(normalized) && tokenLike(value.replace(/^["']|["']$/g, ''));
    if (!strong && !weak) {
      pattern.lastIndex = match.index + quote.length + key.length; // rescan after the key
      continue;
    }
    result += text.slice(copied, match.index) + redactAssignment(...match);
    copied = match.index + whole.length;
  }
  return result + text.slice(copied);
}

function redactAssignment(match, quote, key, separator, operator, value) {
  const quoted = /^["']/.test(value);
  const inner = quoted ? value.slice(1, -1) : value;
  if (!inner.trim() || isRedacted(inner) || isReference(inner)) return match;
  if (!quoted) {
    if (/[([]/.test(inner)) return match; // code: a call or an index (getenv("X"), os.environ["X"])
    // `token: string` / `password: Optional[str]` / `apiKey: ApiKey` is a type
    // annotation, not a value.
    if (operator === ':' && (TYPE_WORDS.test(inner) || /[<[|?]/.test(inner) || /^[A-Z][a-z]+(?:[A-Z][a-z]+)*[,;]?$/.test(inner))) return match;
  }
  return `${quote}${key}${quote}${separator}${quoted ? `${value[0]}${REDACTED}${value[0]}` : REDACTED}`;
}

function isRedacted(value) {
  return value.includes(REDACTED);
}

// Placeholders and indirections name where a secret comes from without containing it.
function isReference(value) {
  return /^(?:\$\{?[A-Za-z_][\w.]*(?::-[^}]*)?\}?|%[A-Za-z_]\w*%|<[^>]*>|\{\{[^}]*\}\}|process\.env\b.*|env\(.*|getenv\(.*|null|nil|none|true|false|undefined|\*+|x{3,}|changeme|\.\.\.|…)$/i.test(value.trim());
}

export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  // Overlapping forms can expose a further match once one is redacted; a second
  // pass reaches the fixed point (redaction is idempotent).
  let result = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = redactOnce(result);
    if (next === result) break;
    result = next;
  }
  return result;
}

function redactOnce(text) {
  let result = text;
  for (const [pattern, replace] of PATTERNS) result = result.replace(pattern, replace);
  return redactAssignments(result);
}

// A command for the Agent to copy, with the developer's text as one POSIX
// single-quoted argument — no command substitution or variable expansion.
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Redacts every string value (never object keys) in a JSON-compatible value.
export function redactDeep(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactDeep(entry)]));
  }
  return value;
}

export function containsSecret(text) {
  return typeof text === 'string' && redactSecrets(text) !== text;
}

// Writers for YallaFlow-owned durable text (work records, ADRs, logs, extracted text).
export async function writeRedactedText(file, text) {
  await writeText(file, redactSecrets(text));
}

export async function appendRedactedText(file, text) {
  await appendFile(file, redactSecrets(text), 'utf8');
}
