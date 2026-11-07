// Create Work from the console (v1.2.0) — the console's only write.
//
// Every change goes through this package's own CLI (runner.write: argv, no shell, the
// CLI's own validation, workspace lock and audit). Nothing here writes .yallaflow itself.
// - `start --keep-active --via console --request-id ID -- <request>`: creates the item
//   without replacing an unfinished active one, records an unverified console
//   attestation (Q-004), and returns the existing item for a repeated request ID.
// - `route …` only when the user chose a type and scope; otherwise the agent classifies.
// - `intake add <id> <file> --via console` per attachment, from a private temp folder
//   that is always removed. A failed attachment never hides the created item.
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { loadSource } from '../core/sources.js';
import { isWorkId } from '../core/ids.js';
import { availabilityNote } from '../flow/snapshot.js';
import { canReviseRequest } from '../behavior/routing.js';
import { loadWorkProgress } from '../core/progress.js';
import { resolveWorkflowPolicy } from '../behavior/policy.js';
import { MAX_EXTRACTION_INPUT_BYTES } from '../intake/constants.js';

export const CREATE_TYPES = Object.freeze(['feature', 'bug', 'change', 'investigation']);
export const CREATE_SCOPES = Object.freeze(['bounded', 'architectural', 'spike']);
export const MAX_REQUEST_CHARS = 20_000;
export const MAX_JSON_BYTES = 64 * 1024;
// Core's own limit for a file it still reads as text (owner decision, PF-0032 ruling):
// one source of truth, never a separate console number.
export const MAX_UPLOAD_BYTES = MAX_EXTRACTION_INPUT_BYTES;
// Requirement documents, images and data files that intake extracts or previews.
export const UPLOAD_EXTENSIONS = Object.freeze([
  '.md', '.txt', '.rst', '.pdf', '.docx', '.pptx', '.xlsx', '.rtf', '.odt', '.ods', '.odp',
  '.csv', '.json', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.gif', '.webp'
]);
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// The CLI's own message for a refused command (its stderr), without Node noise.
function cliMessage(result) {
  const text = (result.stderr || result.stdout || '').trim();
  return text.split('\n').filter((line) => line.trim()).slice(0, 6).join('\n') || `yallaflow exited with ${result.status}`;
}

function cliCode(message) {
  if (/WORKSPACE_BUSY|busy/i.test(message)) return 'WORKSPACE_BUSY';
  if (/PROJECT_UNDERSTANDING_REQUIRED|project understanding/i.test(message)) return 'PROJECT_UNDERSTANDING_REQUIRED';
  return 'CLI_REFUSED';
}

// A short, faithful title from the user's own words: the first line, cut at a word.
export function titleFrom(request) {
  const first = request.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const flat = first.replace(/\s+/g, ' ');
  if (flat.length <= 90) return flat;
  const cut = flat.slice(0, 90);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60)).trim()}…`;
}

export function validateCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'BAD_REQUEST', 'Expected a JSON object.');
  const { requestId, request, type = null, scope = null } = body;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new HttpError(400, 'BAD_REQUEST', 'requestId must be 8-64 letters, digits or hyphens.');
  if (typeof request !== 'string' || !request.trim()) throw new HttpError(400, 'BAD_REQUEST', 'Describe the work in a few words.');
  if (request.length > MAX_REQUEST_CHARS) throw new HttpError(400, 'BAD_REQUEST', `The requirement is longer than ${MAX_REQUEST_CHARS} characters; attach it as a file instead.`);
  if (type !== null && !CREATE_TYPES.includes(type)) throw new HttpError(400, 'BAD_REQUEST', `type must be one of ${CREATE_TYPES.join(', ')}, or null to let the agent classify it.`);
  if (type === null && scope !== null) throw new HttpError(400, 'BAD_REQUEST', 'Choose a work type before a size.');
  if (type !== null && !CREATE_SCOPES.includes(scope)) throw new HttpError(400, 'BAD_REQUEST', 'Choose a size for this work type.');
  if (type !== null) {
    try {
      resolveWorkflowPolicy(type, scope); // Core's own rule for which type/scope pairs exist
    } catch (error) {
      throw new HttpError(422, 'INVALID_CLASSIFICATION', error.message);
    }
  }
  return { requestId, request: request.trim(), type, scope };
}

export async function readMeta(root, workId) {
  return readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
}

export async function createWork(root, input, runner) {
  const start = await runner.write(root, ['start', '--keep-active', '--via', 'console', '--request-id', input.requestId, '--', input.request]);
  if (start.status !== 0) {
    const message = cliMessage(start);
    throw new HttpError(cliCode(message) === 'WORKSPACE_BUSY' ? 503 : 422, cliCode(message), message);
  }
  const match = /^(Created|Already created) (\S+?)(?=[\s:;]|$)/m.exec(start.stdout);
  if (!match || !isWorkId(match[2])) throw new HttpError(500, 'CLI_OUTPUT', `Unexpected output from yallaflow start: ${start.stdout.slice(0, 200)}`);
  const id = match[2];
  const created = match[1] === 'Created';
  let classifyError = null;
  if (input.type) {
    const meta = await readMeta(root, id);
    if (meta.routingStatus === 'pending') {
      // `--opt=value` keeps a title that starts with "-" from being read as an option.
      const route = await runner.write(root, ['route', id, `--type=${input.type}`, `--scope=${input.scope}`, '--confidence=high', '--reason=Classified by the user in the YallaFlow console.', `--title=${titleFrom(input.request)}`]);
      if (route.status !== 0) classifyError = cliMessage(route);
    }
  }
  const meta = await readMeta(root, id);
  if (input.type && !classifyError && meta.routingStatus !== 'routed') classifyError = 'YallaFlow did not record the classification.';
  return {
    id,
    created,
    deferred: Boolean(meta.activation?.deferred),
    keptActive: meta.activation?.deferred ? meta.activation.keptActive : null,
    ...(classifyError ? { classifyError } : {})
  };
}

// A safe plain file name: no directories, no control characters, a bounded length.
export function safeFileName(raw) {
  let name = '';
  try {
    name = decodeURIComponent(String(raw ?? ''));
  } catch {
    name = String(raw ?? '');
  }
  name = name.normalize('NFC').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().replace(/^\.+/, '');
  const ext = path.extname(name);
  // File systems limit names in bytes (usually 255): keep at most 200, cut on a code point.
  if (Buffer.byteLength(name) > 200) {
    let stem = name.slice(0, name.length - ext.length);
    while (stem && Buffer.byteLength(stem + ext) > 200) stem = Array.from(stem).slice(0, -1).join('');
    name = `${stem}${ext}`;
  }
  return name;
}

// Streams the request body into a private temp folder, enforcing the size limit.
export async function receiveFile(request, name) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-upload-')); // 0700
  const file = path.join(dir, name);
  const hash = createHash('sha256');
  let size = 0;
  let handle;
  try {
    handle = await open(file, 'wx', 0o600);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw new HttpError(400, 'BAD_FILE_NAME', `This file name cannot be stored: ${error.code ?? error.message}`);
  }
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'TOO_LARGE', `The file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB, YallaFlow's limit for a file it can still read as text.`);
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  await handle.close();
  return { dir, file, size, sha256: hash.digest('hex') };
}

export async function linkedSourceWithHash(root, meta, sha256) {
  for (const ref of meta.sources ?? []) {
    try {
      const record = await loadSource(root, ref.id);
      const known = record.original?.sha256 ?? record.metadata?.sha256;
      if (known && known.replace(/^sha256:/, '') === sha256) return record.id;
    } catch {
      // a missing source is doctor's to report
    }
  }
  return null;
}

// What YallaFlow could actually do with the file, from its stored source record.
export async function availabilityOf(root, sourceId) {
  try {
    const record = await loadSource(root, sourceId);
    return { contentAvailability: record.contentAvailability ?? null, availabilityNote: availabilityNote(record) };
  } catch {
    return { contentAvailability: null, availabilityNote: null };
  }
}

export async function attachFile(root, workId, request, runner, { revision = false } = {}) {
  const requestId = request.headers['x-request-id'];
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new HttpError(400, 'BAD_REQUEST', 'X-Request-Id is required.');
  let meta;
  try {
    meta = await readMeta(root, workId);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', `Work item ${workId} was not found.`);
  }
  const assertEditable = async (current) => {
    const progress = current.routingStatus === 'pending' ? null : await loadWorkProgress(root, current);
    if (!canReviseRequest(current, progress)) throw new HttpError(409, 'REQUEST_STARTED', 'Request attachments can only be added before work starts.');
  };
  // Creation retains its request binding. Revisions use the existing edit policy,
  // including for work originally created by the CLI.
  if (revision) await assertEditable(meta);
  else if (meta.attestation?.recordedVia !== 'console' || meta.attestation.requestId !== requestId) {
    throw new HttpError(403, 'NOT_THIS_REQUEST', 'Files can be attached here only to the work item this console request created.');
  }
  const name = safeFileName(request.headers['x-file-name']);
  const ext = path.extname(name).toLowerCase();
  if (!name || !ext || name === ext) throw new HttpError(400, 'BAD_REQUEST', 'The file needs a name with an extension.');
  if (!UPLOAD_EXTENSIONS.includes(ext)) throw new HttpError(415, 'UNSUPPORTED_FILE', `${ext} files cannot be attached here. Supported: ${UPLOAD_EXTENSIONS.join(' ')}.`);
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) throw new HttpError(413, 'TOO_LARGE', `The file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB, YallaFlow's limit for a file it can still read as text.`);

  const received = await receiveFile(request, name);
  try {
    if (!received.size) throw new HttpError(400, 'EMPTY_FILE', `${name} is empty.`);
    // The duplicate check and the attach run as one step in the project's write queue, so
    // two identical uploads at once (a double click, a retry) still store one copy.
    const outcome = await runner.exclusive(root, async (exec) => {
      const current = await readMeta(root, workId);
      if (revision) await assertEditable(current);
      const existing = await linkedSourceWithHash(root, current, received.sha256);
      if (existing) return { existing };
      return { result: await exec(['intake', 'add', workId, received.file, '--via', 'console', ...(revision ? ['--before-start'] : [])]) };
    });
    if (outcome.existing) return { source: outcome.existing, name, duplicate: true, ...(await availabilityOf(root, outcome.existing)) };
    const result = outcome.result;
    if (result.status !== 0) {
      const message = cliMessage(result);
      throw cliCode(message) === 'WORKSPACE_BUSY' ? new HttpError(503, 'WORKSPACE_BUSY', message) : new HttpError(422, 'ATTACH_REFUSED', message);
    }
    const source = /Sources? captured: (\S+)/.exec(result.stdout)?.[1] ?? null;
    return { source, name, duplicate: false, ...(await availabilityOf(root, source)) };
  } finally {
    await rm(received.dir, { recursive: true, force: true });
  }
}
