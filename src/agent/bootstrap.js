import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { exists, readText, writeText } from '../utils/fs.js';

// First-party agent bootstrap (v0.3.8). A provider's own session-start file in the
// repository root (AGENTS.md for Codex, CLAUDE.md for Claude) gets one thin,
// versioned, YallaFlow-managed block that points a cold session at the canonical
// contract, .yallaflow/AGENT.md. The block carries no domain rules of its own — those
// live only in AGENT.md — so there is exactly one behavioral contract.
//
// The file itself is project-owned: content outside the block is never rewritten,
// and which providers are set up is read from the markers alone (no extra state).
// Provider knowledge is confined to this module.
//
// Bump BOOTSTRAP_VERSION whenever bootstrapBody() changes meaningfully.
//   1 — v0.3.8: detect → AGENT.md → brief → resume/guide → contract → record.
//   2 — v0.3.10: orient automatically before the first request (the developer never
//       has to say "use YallaFlow"); finish with `yallaflow finish`.
//   3 — v1.0.1: route engineering work before the first edit (reuse a covering active
//       work item; small changes are bounded and gate-free; operational help needs no
//       work item); tracking is never optional, and untracked edits are recovered.
export const BOOTSTRAP_VERSION = 3;

export const BOOTSTRAP_PROVIDERS = Object.freeze({
  codex: Object.freeze({ id: 'codex', label: 'Codex', file: 'AGENTS.md' }),
  claude: Object.freeze({ id: 'claude', label: 'Claude', file: 'CLAUDE.md' })
});

const BEGIN = /^<!-- yallaflow-bootstrap:begin provider=([a-z]+) version=(\d+) sha256=([0-9a-f]{64})[^\n]*-->\n/m;
const END = '<!-- yallaflow-bootstrap:end -->';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function resolveBootstrapProvider(name) {
  const provider = BOOTSTRAP_PROVIDERS[name];
  if (!provider) throw new Error(`Unknown agent provider: ${JSON.stringify(name)}. Use one of: ${Object.keys(BOOTSTRAP_PROVIDERS).join(', ')}.`);
  return provider;
}

// The session-start sequence is provider-independent; only how the canonical contract
// is loaded differs. Claude Code expands `@path` imports in CLAUDE.md, so the contract
// is loaded directly; Codex has no import syntax, so it is told to read the file.
export function bootstrapBody(provider) {
  const load = provider.id === 'claude'
    ? 'The canonical YallaFlow agent contract is imported here:\n\n@.yallaflow/AGENT.md\n'
    : 'The canonical YallaFlow agent contract is `.yallaflow/AGENT.md`. Read it before any project work.\n';
  return '## YallaFlow\n\n' +
    'This repository uses YallaFlow: engineering governance and durable project memory for coding agents. ' +
    'This block only points to the YallaFlow contract; it does not restate it.\n\n' +
    `${load}\n` +
    'At the start of every session — automatically, before handling the first request; the developer does not need to say "use YallaFlow":\n\n' +
    '1. Confirm `.yallaflow/` exists. If it does not, ignore this section.\n' +
    '2. Follow `.yallaflow/AGENT.md` — it is the only YallaFlow behavioral contract.\n' +
    '3. Run `yallaflow brief` for a read-only orientation and the next command to run, then handle the request.\n' +
    '4. For active or resumable work, run `yallaflow resume <work-id>` (or `yallaflow handoff <work-id>`).\n' +
    '5. Run `yallaflow guide <work-id>` for the current objective, blocker, and next valid action.\n' +
    '6. Before the first edit to source, tests, migrations, configuration, or any engineering artifact, even a small one: continue the active work item that covers the request or route one (`yallaflow start`), and edit only once `yallaflow guide` authorizes it. Small changes route as bounded work: no spec or plan review by default. Operational help needs no work item.\n' +
    '7. Follow the pinned Behavior Contract (`yallaflow skill <skill-id>`); never edit engineering artifacts while guidance says it is not authorized.\n' +
    '8. Record progress, decisions, and evidence only through `yallaflow` commands — never edit `.yallaflow/` structured state by hand.\n' +
    '9. Before saying a task is done, run `yallaflow finish <work-id>`. Tracking is never optional and never offered after the fact. Recover untracked edits as AGENT.md describes.\n';
}

export function renderBootstrapBlock(provider, version = BOOTSTRAP_VERSION, body = bootstrapBody(provider)) {
  return `<!-- yallaflow-bootstrap:begin provider=${provider.id} version=${version} sha256=${sha256(body)} — managed by YallaFlow; keep your own instructions outside this block; update with \`yallaflow agent refresh\` -->\n${body}${END}\n`;
}

function providerFile(root, provider) {
  return path.join(root, provider.file);
}

function parseBlock(content) {
  const begin = BEGIN.exec(content);
  if (!begin) return null;
  const bodyStart = begin.index + begin[0].length;
  const endIndex = content.indexOf(END, bodyStart);
  if (endIndex < 0) return { broken: true };
  let blockEnd = endIndex + END.length;
  if (content[blockEnd] === '\n') blockEnd += 1;
  const body = content.slice(bodyStart, endIndex);
  return {
    provider: begin[1],
    version: Number(begin[2]),
    body,
    modified: sha256(body) !== begin[3],
    prefix: content.slice(0, begin.index),
    suffix: content.slice(blockEnd)
  };
}

// Read-only. States:
//   not-installed  no provider file, or a provider file without a YallaFlow block
//   current        block at the installed version, unmodified
//   outdated       block from an older bootstrap version, unmodified
//   modified       block edited by hand (hash mismatch)
//   newer          block written by a newer YallaFlow
//   broken         begin marker without end marker, or a block for another provider
export async function inspectBootstrap(root, provider) {
  const file = providerFile(root, provider);
  const installed = BOOTSTRAP_VERSION;
  const base = { provider: provider.id, file: provider.file, installed };
  if (!await exists(file)) return { ...base, state: 'not-installed', fileExists: false };
  const block = parseBlock(await readText(file));
  if (!block) return { ...base, state: 'not-installed', fileExists: true };
  if (!block.broken && block.provider !== provider.id) {
    // One file serving two providers (e.g. CLAUDE.md symlinked to AGENTS.md) carries
    // the other provider's block; that is a deliberate setup, not corruption.
    const other = BOOTSTRAP_PROVIDERS[block.provider];
    if (other && await sameFile(file, providerFile(root, other))) return { ...base, state: 'shared', fileExists: true, sharedWith: other.id };
  }
  if (block.broken || block.provider !== provider.id) return { ...base, state: 'broken', fileExists: true };
  const found = { ...base, fileExists: true, version: block.version };
  if (block.modified) return { ...found, state: 'modified' };
  if (block.version > installed) return { ...found, state: 'newer' };
  if (block.version < installed) return { ...found, state: 'outdated' };
  return { ...found, state: 'current' };
}

async function sameFile(a, b) {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
}

export async function inspectAllBootstraps(root) {
  return Promise.all(Object.values(BOOTSTRAP_PROVIDERS).map((provider) => inspectBootstrap(root, provider)));
}

export function describeBootstrapState(status) {
  const setup = `yallaflow agent setup ${status.provider}`;
  return {
    'not-installed': status.fileExists ? `${status.file} has no YallaFlow bootstrap block; run \`${setup}\`` : `not set up; run \`${setup}\``,
    current: `current (bootstrap v${status.installed})`,
    shared: `the same file as the ${status.sharedWith} bootstrap (${status.file} links to it); nothing to set up`,
    outdated: `outdated (v${status.version} → v${status.installed}); run \`yallaflow agent refresh\``,
    modified: `the YallaFlow-managed block in ${status.file} was edited by hand; move custom text outside the block, or run \`${setup} --preserve-existing\``,
    newer: `written by a newer YallaFlow (v${status.version} > installed v${status.installed}); upgrade YallaFlow instead`,
    broken: `${status.file} has a malformed YallaFlow bootstrap block (missing end marker or wrong provider); fix it manually`
  }[status.state];
}

const PRESERVED_HEADING = '## Preserved YallaFlow bootstrap edits';

// Installs or updates the provider's block. Idempotent: a current block is left
// byte-for-byte unchanged. Content outside the block is always kept in place; a new
// block is appended after existing content, never inserted into it. A hand-edited
// block is refused unless --preserve-existing, which keeps the edited text verbatim
// under a labelled heading right after the new block.
export async function setupBootstrap(root, provider, { preserveExisting = false, dryRun = false } = {}, now = new Date().toISOString()) {
  const status = await inspectBootstrap(root, provider);
  const file = providerFile(root, provider);
  const fresh = renderBootstrapBlock(provider);
  if (status.state === 'current') return { status, action: 'unchanged', written: false };
  if (status.state === 'shared') throw new Error(`${provider.file} is the same file as the ${status.sharedWith} bootstrap file and already carries its YallaFlow block; no separate ${provider.id} block is needed. No files were changed.`);
  if (status.state === 'newer') throw new Error(`${provider.file} has a YallaFlow bootstrap block from a newer YallaFlow (v${status.version}); refusing to downgrade it to v${status.installed}. No files were changed.`);
  if (status.state === 'broken') throw new Error(`${provider.file} has a malformed YallaFlow bootstrap block (missing end marker or another provider's block); fix it manually. No files were changed.`);

  const content = status.fileExists ? await readText(file) : '';
  let next;
  let action;
  if (status.state === 'not-installed') {
    const separator = content === '' ? '' : content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    next = `${content}${separator}${fresh}`;
    action = status.fileExists ? 'appended' : 'created';
  } else if (status.state === 'outdated') {
    const block = parseBlock(content);
    next = `${block.prefix}${fresh}${block.suffix}`;
    action = 'updated-managed-block';
  } else {
    if (!preserveExisting) {
      throw new Error(
        `${provider.file} has hand edits inside the YallaFlow-managed bootstrap block; refusing to replace them silently.\n\n` +
        'Move project-specific instructions outside the block, or re-run with --preserve-existing to install the current block and keep the edited text ' +
        'verbatim right after it (add --dry-run first to preview). No files were changed.'
      );
    }
    const block = parseBlock(content);
    const preserved = `\n${PRESERVED_HEADING}\n\n> Preserved verbatim by \`yallaflow agent setup ${provider.id} --preserve-existing\` on ${now}. ` +
      'Review it and keep only project-specific instructions.\n\n' + `${block.body.trimEnd()}\n`;
    next = `${block.prefix}${fresh}${preserved}${block.suffix}`;
    action = 'installed-with-preserved-content';
  }
  if (!dryRun) await writeText(file, next);
  return { status, action, written: !dryRun, preview: dryRun ? next : undefined };
}

// Used by `agent refresh`: updates only installed, unmodified, outdated blocks.
// Anything else is reported, never forced.
export async function refreshBootstraps(root, { dryRun = false } = {}) {
  const results = [];
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) {
    const status = await inspectBootstrap(root, provider);
    if (status.state === 'outdated') results.push(await setupBootstrap(root, provider, { dryRun }));
    else if (!['not-installed', 'shared'].includes(status.state)) results.push({ status, action: status.state === 'current' ? 'unchanged' : 'skipped', written: false });
  }
  return results;
}

// ---------------------------------------------------------------------------
// All first-party providers at once (v0.3.10-internal.3, used by `yallaflow init`):
// the same per-provider installer as `agent setup`, plus a read-only preflight and a
// byte-exact snapshot so a failed init can restore every file it touched.

// Claude first, then Codex — the order onboarding text and init output use.
function onboardingProviders() {
  return [BOOTSTRAP_PROVIDERS.claude, BOOTSTRAP_PROVIDERS.codex];
}

export function agentLabels() {
  return onboardingProviders().map((provider) => ({ claude: 'Claude Code', codex: 'Codex' }[provider.id])).join(' or ');
}

export function bootstrapFileNames() {
  return onboardingProviders().map((provider) => provider.file).join(' and ');
}

const UNSAFE_BOOTSTRAP_STATES = Object.freeze(['modified', 'newer', 'broken']);

export async function assertAllBootstrapsInstallable(root) {
  const problems = [];
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) {
    const status = await inspectBootstrap(root, provider);
    if (UNSAFE_BOOTSTRAP_STATES.includes(status.state)) problems.push(`${provider.file}: ${describeBootstrapState(status)}`);
  }
  if (problems.length) {
    throw new Error(
      `YallaFlow cannot install the agent bootstrap safely:\n${problems.map((entry) => `- ${entry}`).join('\n')}\n\n` +
      'Fix the file(s) above (YallaFlow never overwrites edited content), then run the command again.\n\nNo files were changed.'
    );
  }
}

// The same installer as `yallaflow agent setup`: append a managed block to existing
// content, update an outdated unmodified block, leave a current block or a file that
// already serves another provider (symlinked CLAUDE.md/AGENTS.md) untouched.
export async function installAllBootstraps(root) {
  const results = [];
  for (const provider of onboardingProviders()) {
    const status = await inspectBootstrap(root, provider);
    if (status.state === 'shared') {
      results.push({ file: provider.file, action: `shared with ${status.sharedWith}` });
      continue;
    }
    const result = await setupBootstrap(root, provider);
    results.push({ file: provider.file, action: { created: 'created', appended: 'block added (existing content kept)', 'updated-managed-block': 'block updated', unchanged: 'already current' }[result.action] ?? result.action });
  }
  return results;
}

export async function snapshotBootstrapFiles(root) {
  const files = [];
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) {
    const file = path.join(root, provider.file);
    const info = await lstat(file).catch(() => null);
    // readFile/writeFile follow a symlink, so a linked CLAUDE.md/AGENTS.md restores its target.
    files.push({ file, existed: Boolean(info), content: info ? await readFile(file).catch(() => null) : null });
  }
  return files;
}

export async function restoreBootstrapFiles(snapshot) {
  for (const entry of snapshot) {
    if (!entry.existed) {
      await rm(entry.file, { force: true });
      continue;
    }
    if (entry.content === null) continue;
    // Rewrite only what actually changed, so an untouched (even read-only) file never
    // turns a rollback into a second failure.
    const current = await readFile(entry.file).catch(() => null);
    if (!current || !current.equals(entry.content)) await writeFile(entry.file, entry.content);
  }
}
