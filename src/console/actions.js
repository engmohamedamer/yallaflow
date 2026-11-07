// Console work management (1.4.0, PF-0043). Every action is the canonical CLI command,
// run through the console's runner (argv only, no shell, one write at a time per
// project), so Core keeps every rule: stage blockers, the lifecycle guard, the project
// version, validation. The console never writes .yallaflow itself.
//
// Review-gate decisions (owner decision SRC-0032, Option B): an explicit LOCAL-USER
// decision, not a trusted identity. The person sees the gate's material, types the exact
// gate name and a mandatory note; the unchanged `approve`/`feedback` command records it,
// and only for that child process the runner passes YALLAFLOW_DECISION_PROVENANCE, so the
// record says "console, identity not verified". CLI decisions are recorded as before.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HttpError } from './create.js';
import { isWorkId } from '../core/ids.js';
import { DECISION_PROVENANCE_ENV } from '../reviews/store.js';

export const MAX_TEXT = 10_000;
const REOPEN_TARGETS = ['implementation', 'verification', 'review'];
const OUTCOMES = ['cancelled', 'superseded', 'duplicate'];
// Gates decided in the console. Baseline and reconciliation keep their own commands.
export const CONSOLE_GATES = Object.freeze(['discovery', 'clarification', 'design', 'specification', 'plan', 'decomposition', 'implementation', 'verification']);

function text(value, name, { required = true, maxLength = MAX_TEXT } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(422, 'MISSING', `${name} is required.`);
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(422, 'MISSING', `${name} is required.`);
  if (value.length > maxLength) throw new HttpError(422, 'TOO_LONG', `${name} is limited to ${maxLength} characters.`);
  if (value.includes('\0')) throw new HttpError(422, 'INVALID', `${name} contains a NUL character.`);
  return value.trim();
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) throw new HttpError(422, 'INVALID', `${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}

// Text always travels as --option=value, so a value starting with "--" can never become
// an option of its own.
const opt = (name, value) => `--${name}=${value}`;

export function actionArgs(action, workId, input = {}) {
  if (!isWorkId(workId)) throw new HttpError(400, 'BAD_WORK', 'Invalid work item.');
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  switch (action) {
    case 'activate': return ['activate', workId];
    case 'advance': return ['advance', workId];
    case 'reopen': {
      const reason = text(body.reason, 'A reason');
      if (body.to === undefined || body.to === null || body.to === '') return ['reopen', workId, opt('reason', reason)];
      return ['reopen', workId, opt('to', oneOf(body.to, REOPEN_TARGETS, 'The reopen target')), opt('reason', reason)];
    }
    case 'revise':
      return ['request', 'revise', workId, opt('text', text(body.text, 'The revised request', { maxLength: 20_000 })), opt('reason', text(body.reason, 'A reason'))];
    case 'answer': {
      const question = String(body.question ?? '');
      if (!/^Q-\d{3,}$/.test(question)) throw new HttpError(422, 'INVALID', 'Name the question (Q-###).');
      return ['question', 'answer', workId, opt('id', question), opt('answer', text(body.answer, 'The answer'))];
    }
    case 'hold':
      return ['work', 'hold', workId, opt('reason', text(body.reason, 'A reason')), ...(body.confirmMinimumVersion === true ? [opt('accept-minimum-version', '1.4.0')] : [])];
    case 'resume': {
      const note = text(body.note, 'A note', { required: false });
      return ['work', 'resume', workId, ...(note ? [opt('note', note)] : [])];
    }
    case 'close': {
      const outcome = oneOf(body.outcome, OUTCOMES, 'The outcome');
      const by = body.by === undefined || body.by === null || body.by === '' ? null : String(body.by);
      if (by !== null && !isWorkId(by)) throw new HttpError(422, 'INVALID', 'The replacing work item is not a valid id.');
      return ['work', 'close', workId, opt('outcome', outcome), opt('reason', text(body.reason, 'A reason')), ...(by ? [opt('by', by)] : []), ...(body.confirmMinimumVersion === true ? [opt('accept-minimum-version', '1.4.0')] : [])];
    }
    default:
      throw new HttpError(404, 'NOT_FOUND', 'Unknown action.');
  }
}

// Core's own message for a refused command, without Node noise.
function cliText(result) {
  return (result.stderr || result.stdout || '').trim().split('\n').filter((line) => line.trim()).slice(0, 12).join('\n') || `yallaflow exited with ${result.status}`;
}

export async function runAction(root, action, workId, body, runner) {
  const args = actionArgs(action, workId, body);
  const result = await runner.write(root, args);
  if (result.status === 0) return { ok: true, output: result.stdout.trim().split('\n').filter(Boolean) };
  const message = cliText(result);
  if (/--accept-minimum-version 1\.4\.0/.test(message) && /require YallaFlow >= 1\.4\.0/.test(message)) {
    throw new HttpError(409, 'CONFIRM_MINIMUM_VERSION', message, { required: '1.4.0' });
  }
  throw new HttpError(409, 'REFUSED', message);
}

// ----- review-gate decisions -----

const GATE_SECTIONS = Object.freeze({
  discovery: ['Discovery'],
  clarification: ['Requirement', 'Acceptance Criteria', 'Open Questions'],
  design: ['Architecture / Technical Decisions', 'Design'],
  specification: ['Specification', 'Specification / Expected Behavior'],
  plan: ['Implementation Plan'],
  decomposition: ['Implementation Plan'],
  implementation: ['Implementation Plan', 'Result'],
  verification: ['Verification Evidence', 'Result']
});

// A `## Heading` section of work.md (up to the next `## `), or null.
function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  // Template sub-headings with nothing under them are left out: only written material is shown.
  const body = lines.slice(start + 1, end < 0 ? undefined : end);
  const kept = body.filter((line, index) => {
    if (!/^### /.test(line)) return true;
    const next = body.slice(index + 1).find((candidate) => candidate.trim());
    return Boolean(next) && !/^### /.test(next);
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() || null;
}

async function gateMaterial(root, workId, gate, read) {
  const detail = await read(['work', 'show', workId, '--json']);
  if (detail.status !== 0) throw new HttpError(404, 'NOT_FOUND', cliText(detail));
  const work = JSON.parse(detail.stdout);
  const markdown = await readFile(path.join(root, '.yallaflow', 'work', workId, 'work.md'), 'utf8').catch(() => '');
  const sections = (GATE_SECTIONS[gate] ?? []).map((heading) => ({ heading, text: section(markdown, heading) })).filter((entry) => entry.text);
  const entry = (work.gates ?? []).find((candidate) => candidate.gate === gate) ?? null;
  const warnings = [];
  if (work.item?.lifecycle) warnings.push(`This item is ${work.item.lifecycle.state === 'closed' ? 'closed without delivery' : 'on hold'}.`);
  const open = (work.questions ?? []).filter((question) => question.material && !question.answer && !['answered', 'resolved'].includes(question.status));
  if (open.length) warnings.push(`${open.length} material question(s) are still open: ${open.map((question) => question.id).join(', ')}.`);
  if (gate === 'verification' && work.convergence && !work.convergence.converged) warnings.push('Delivery convergence is not currently satisfied.');
  const latest = (work.verification ?? []).at(-1) ?? null;
  if (latest && !latest.success) warnings.push(`The latest verification (${latest.id}) failed.`);
  const material = {
    workId, gate, title: work.item?.title ?? workId, stage: work.item?.stage ?? null,
    gateStatus: entry?.status ?? null, requestedAt: entry?.requestedAt ?? null, history: entry?.history ?? [],
    sections,
    requirements: (work.requirements ?? []).filter((item) => item.status === 'active').map((item) => ({ id: item.id, statement: item.statement })),
    criteria: (work.criteria ?? []).filter((item) => item.status === 'active').map((item) => ({ id: item.id, statement: item.statement, convergence: item.convergence })),
    verification: latest ? { id: latest.id, success: latest.success, at: latest.at } : null,
    warnings
  };
  const digest = createHash('sha256').update(JSON.stringify(material)).digest('hex');
  return { ...material, digest };
}

export async function gateReview(root, workId, gate, runner) {
  if (!isWorkId(workId)) throw new HttpError(400, 'BAD_WORK', 'Invalid work item.');
  oneOf(gate, CONSOLE_GATES, 'The gate');
  // The same step and the same builder a decision uses, so the digest shown is the one checked.
  return runner.exclusive(root, (exec) => gateMaterial(root, workId, gate, exec));
}

const decided = new Map(); // requestId -> result (this console run)

function claimedGitName(root) {
  const result = spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim().slice(0, 200) : null;
}

export async function decideGate(root, workId, gate, input, runner) {
  if (!isWorkId(workId)) throw new HttpError(400, 'BAD_WORK', 'Invalid work item.');
  oneOf(gate, CONSOLE_GATES, 'The gate');
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  // Everything is validated before a repeated request is recognized, and a repeat is
  // recognized only for the same project, item and gate.
  const decision = oneOf(body.decision, ['approve', 'request_changes'], 'The decision');
  const requestId = String(body.requestId ?? '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new HttpError(422, 'INVALID', 'A request id is required.');
  if (body.confirmGate !== gate) throw new HttpError(422, 'CONFIRMATION', `Type the gate name exactly ("${gate}") to confirm.`);
  const note = text(body.note, 'A decision note');
  const digest = String(body.digest ?? '');
  const key = JSON.stringify([root, workId, gate, requestId]);
  if (decided.has(key)) return { ...decided.get(key), duplicate: true };
  return runner.exclusive(root, async (exec) => {
    if (decided.has(key)) return { ...decided.get(key), duplicate: true };
    const current = await gateMaterial(root, workId, gate, exec);
    // A gate waiting for review, or one sent back with "request changes" (Core keeps that
    // status until it is decided again). requestedAt and the digest below guard staleness.
    if (!['awaiting_review', 'changes_requested'].includes(current.gateStatus)) throw new HttpError(409, 'STALE', `The ${gate} gate is ${current.gateStatus ?? 'not requested'}, so there is nothing to decide. Reload to see its current state; nothing was recorded.`);
    if (current.requestedAt !== (body.requestedAt ?? null) || current.digest !== digest) {
      throw new HttpError(409, 'STALE', `The ${gate} gate or its material changed since you reviewed it. Reload and review it again; nothing was recorded.`);
    }
    const provenance = JSON.stringify({ via: 'console', host: os.hostname(), claimedGitName: claimedGitName(root) });
    const args = decision === 'approve'
      ? ['approve', workId, `--stage=${gate}`, opt('note', note)]
      : ['feedback', workId, `--stage=${gate}`, '--changes-requested', opt('note', note)];
    const result = await exec(args, { env: { [DECISION_PROVENANCE_ENV]: provenance } });
    if (result.status !== 0) throw new HttpError(409, 'REFUSED', cliText(result));
    const outcome = { ok: true, decision, gate, workId, recorded: 'console, identity not verified', output: result.stdout.trim().split('\n').filter(Boolean) };
    decided.set(key, outcome);
    if (decided.size > 500) decided.delete(decided.keys().next().value);
    return outcome;
  });
}
