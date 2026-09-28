import path from 'node:path';
import { createHash } from 'node:crypto';
import { exists, readText, writeText } from '../utils/fs.js';

// Package-owned agent guidance (.yallaflow/AGENT.md) with an explicit contract
// version. AGENT.md is project-owned: YallaFlow manages only the marked block below,
// never overwrites the file on detection, and changes it only through the deliberate,
// idempotent `yallaflow agent refresh`.
//
// Bump AGENT_CONTRACT_VERSION whenever agentContractBody() changes meaningfully.
//   1 — v0.3.6: living project memory, freshness, reconfirm/supersede/dispute,
//       durable material-artifact capture, argv-first verification.
//   2 — v0.3.6: direct classified commands require an explicit --scope; never guess
//       a scope, use `start` + `route` when type/scope are unknown, never force an
//       unsupported type/scope combination.
//   3 — v0.3.7: legacy context must be reconciled (explicit, reviewed relationships)
//       before it becomes canonical truth; never rewrite historical work; never edit
//       CLI-owned YallaFlow state directly; `yallaflow brief` for fresh orientation.
export const AGENT_CONTRACT_VERSION = 3;

const BEGIN = /^<!-- yallaflow-agent-contract:begin version=(\d+) sha256=([0-9a-f]{64})[^\n]*-->\n/m;
const END = '<!-- yallaflow-agent-contract:end -->';

// Byte-exact fingerprints of every AGENT.md YallaFlow generated before the contract
// was versioned (recovered from git history). Only a file matching one of these —
// i.e. never edited — may be replaced without --preserve-existing.
export const LEGACY_GENERATED_CONTRACTS = Object.freeze({
  '8e9e3a4c947671f7e73aa674579b1865c3aa6cccd92f621189258d90018eba18': 'v0.1–v0.3.4',
  a58e50cf7305d5d660ac0299784ab6c5f32c254ebfd9638e5bab5ecf127ca8e7: 'v0.3.5'
});

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function renderAgentContractBlock(version = AGENT_CONTRACT_VERSION, body = agentContractBody()) {
  return `<!-- yallaflow-agent-contract:begin version=${version} sha256=${sha256(body)} — managed by YallaFlow; keep project-specific instructions outside this block; update with \`yallaflow agent refresh\` -->\n${body}${END}\n`;
}

export function renderAgentContractFile() {
  return renderAgentContractBlock();
}

function agentFile(root) {
  return path.join(root, '.yallaflow', 'AGENT.md');
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
    version: Number(begin[1]),
    recordedHash: begin[2],
    body,
    modified: sha256(body) !== begin[2],
    prefix: content.slice(0, begin.index),
    suffix: content.slice(blockEnd)
  };
}

// Read-only. States:
//   current            managed block at the installed version, unmodified
//   outdated           managed block from an older contract version, unmodified
//   modified           managed block edited by hand (hash mismatch)
//   newer              managed block from a newer package than the one installed
//   legacy-generated   unversioned pre-v0.3.6 AGENT.md, byte-identical to what YallaFlow generated
//   legacy-customized  unversioned AGENT.md that differs from every generated template
//   broken             begin marker without end marker
//   missing            no AGENT.md
export async function inspectAgentContract(root) {
  const file = agentFile(root);
  const installed = AGENT_CONTRACT_VERSION;
  if (!await exists(file)) return { state: 'missing', installed };
  const content = await readText(file);
  const block = parseBlock(content);
  if (!block) {
    const legacy = LEGACY_GENERATED_CONTRACTS[sha256(content)];
    return legacy ? { state: 'legacy-generated', installed, legacy } : { state: 'legacy-customized', installed };
  }
  if (block.broken) return { state: 'broken', installed };
  if (block.modified) return { state: 'modified', installed, version: block.version };
  if (block.version > installed) return { state: 'newer', installed, version: block.version };
  if (block.version < installed) return { state: 'outdated', installed, version: block.version };
  return { state: 'current', installed, version: block.version };
}

export function describeAgentContractState(status) {
  const target = `v${status.installed}`;
  return {
    current: `current (agent contract ${target})`,
    outdated: `outdated (v${status.version} → ${target}); run \`yallaflow agent refresh\``,
    modified: `the YallaFlow-managed block was edited by hand; move custom text outside the block, or run \`yallaflow agent refresh --preserve-existing\``,
    newer: `written by a newer YallaFlow (v${status.version} > installed ${target}); upgrade YallaFlow instead of refreshing`,
    'legacy-generated': `predates versioned agent contracts (unmodified ${status.legacy} template); run \`yallaflow agent refresh\``,
    'legacy-customized': 'predates versioned agent contracts and contains custom edits; run `yallaflow agent refresh --preserve-existing` (your content is kept verbatim below the new managed block)',
    broken: 'managed-block begin marker without end marker; fix AGENT.md manually',
    missing: 'AGENT.md is missing; run `yallaflow agent refresh` to recreate it'
  }[status.state];
}

const PRESERVED_HEADING = '## Preserved project instructions';

function preservedSection(text, now) {
  return `\n${PRESERVED_HEADING}\n\n> Preserved verbatim by \`yallaflow agent refresh --preserve-existing\` on ${now} from the previous AGENT.md. ` +
    'Review it: remove guidance now superseded by the YallaFlow-managed contract above, and keep project-specific instructions.\n\n' +
    `${text.trimEnd()}\n`;
}

// Deliberate refresh. Idempotent: a current contract is left byte-for-byte unchanged.
// Never discards user-authored content: content outside the managed block is kept in
// place; a customized unversioned file or a hand-edited block is refused unless
// --preserve-existing, which keeps it verbatim under a clearly labelled heading.
export async function refreshAgentContract(root, { preserveExisting = false, dryRun = false } = {}, now = new Date().toISOString()) {
  const status = await inspectAgentContract(root);
  const file = agentFile(root);
  const fresh = renderAgentContractBlock();
  let next = null;
  let action;

  if (status.state === 'current') {
    return { status, action: 'unchanged', written: false };
  }
  if (status.state === 'newer') throw new Error(`AGENT.md was written by a newer YallaFlow contract (v${status.version}); refusing to downgrade it to v${status.installed}.`);
  if (status.state === 'broken') throw new Error('AGENT.md has a YallaFlow managed-block begin marker without its end marker; fix it manually before refreshing.');

  const content = status.state === 'missing' ? '' : await readText(file);
  if (status.state === 'missing' || status.state === 'legacy-generated') {
    next = fresh;
    action = status.state === 'missing' ? 'created' : 'replaced-generated';
  } else if (status.state === 'outdated') {
    const block = parseBlock(content);
    next = `${block.prefix}${fresh}${block.suffix}`;
    action = 'updated-managed-block';
  } else if (status.state === 'legacy-customized' || status.state === 'modified') {
    if (!preserveExisting) {
      throw new Error(
        `AGENT.md ${status.state === 'modified' ? 'has hand edits inside the YallaFlow-managed block' : 'predates versioned agent contracts and contains custom content'}; ` +
        'refusing to replace it silently.\n\nRe-run with --preserve-existing to install the current managed contract and keep the existing content verbatim below it ' +
        '(add --dry-run first to preview). No files were changed.'
      );
    }
    if (status.state === 'modified') {
      const block = parseBlock(content);
      next = `${block.prefix}${fresh}${block.suffix}${preservedSection(block.body, now)}`;
    } else {
      next = `${fresh}${preservedSection(content, now)}`;
    }
    action = 'installed-with-preserved-content';
  }

  if (!dryRun) await writeText(file, next);
  return { status, action, written: !dryRun, preview: dryRun ? next : undefined };
}

export function agentContractBody() {
  return `# YallaFlow Agent Contract\n\nYallaFlow is the engineering governance layer for this repository: durable project memory, adaptive workflows, and evidence-backed delivery. It applies Adaptive Spec-Driven Development where the work needs it — specification depth must match the work type and scope. The Agent orchestrates; YallaFlow governs; project memory persists.\n\n## Core rules\n\n1. Discover before asking. Technical unknowns belong in repository discovery; ask only about material business ambiguity or unavailable information.\n2. Understand before changing. Route the request to the correct workflow and establish the required evidence/spec first.\n3. Prove before claiming. No work item may become DONE without fresh verification evidence.\n4. Remember after finishing. Promote only durable knowledge into context/ or decisions/; keep execution noise with the work item.\n5. Revalidate before trusting stale knowledge. Project context whose supporting evidence changed since it was verified may be stale; revalidate it before relying on it.\n6. Investigation is read-only unless the work item is explicitly converted to an implementation workflow.\n7. Record material deviations or assumptions as rulings in the work item progress ledger.\n\n## Start sequence\n\nIn a fresh session, run yallaflow brief first: one read-only orientation (agent contract state, active and most recent work, project memory, sources, pending legacy reconciliation) that names the next command to run. It does not replace yallaflow resume/handoff/guide; it tells you which one applies. For a brownfield project with an approved baseline (.yallaflow/PROJECT.md and context/ populated by \`yallaflow baseline approve\`), read PROJECT.md and only the context docs relevant to the current request first; do not blindly rescan the whole repository for every request — but repository evidence remains authoritative when durable context is stale (see the project memory sequence). Otherwise read .yallaflow/config.yaml, .yallaflow/PROJECT.md, .yallaflow/state/current.yaml, then load only the context relevant to the current work item.\n\n## Routing sequence\n\nFor an unclassified request, create an intake with yallaflow start, classify it using the allowed work_type, scope, and confidence values, explain the reason, then apply the decision with yallaflow route. The CLI validates and persists the decision; it does not perform semantic inference. Scope classification is not just about code size: consider financial/accounting invariants, security/privacy impact, authorization changes, persistent data-model/migration changes, cross-module derived state, external integration contracts, public APIs, irreversible behavior, and concurrency/transaction rules. A small UI change can stay bounded; a small-looking change touching system-wide financial correctness may warrant architectural depth and its specification/planning review gates. YallaFlow validates the allowed values only — it never classifies semantically itself.\n\nDirect classified commands are shortcuts only for work whose type and scope are already known: yallaflow feature|bug|investigate|change|refactor|release \"<title>\" --scope <spike|bounded|architectural>. --scope is required; never guess or default a scope to make a direct command succeed. If the type or scope is not already known, use yallaflow start and classify with yallaflow route instead. If YallaFlow rejects a type/scope combination (for example feature with spike), do not force or work around it — choose a supported classification (e.g. investigation, or bug with spike, for exploratory work) or route through yallaflow start.\n\n## Behavior contract sequence\n\nSkills define engineering behavior. Work items pin the behavior they were created with. Before engineering work, run yallaflow guide for the work item. Follow the pinned skill order and retrieve exact package-owned instructions with yallaflow skill. Record completed work explicitly with yallaflow checkpoint; never infer completion from conversation. Workflow stages remain authoritative; do not modify application code when guidance reports that modification is not authorized. Once a required review gate is approved, continue automatically to the next configured boundary or blocker — do not ask again for permission that was already given (e.g. after \"approve and execute\", proceed to the next ready step without a redundant confirmation prompt).\n\n## Brownfield baseline sequence\n\nFor an existing repository with no durable project context yet, run yallaflow baseline start (read-only), perform repository/runtime discovery, complete the repository-baseline checkpoint, then record findings with yallaflow baseline draft --file <baseline.json> — every fact needs a status (confirmed/inferred/unresolved), evidence, and source (repository/runtime/user-confirmed); prior chat/model memory is never evidence. Things the discovery could not inspect go in the draft's limitations array, not in facts. A human reviews the draft (yallaflow baseline show/status) and either yallaflow baseline approve or yallaflow baseline feedback --changes-requested. Only an approved baseline updates durable project memory (context/index.yaml and its PROJECT.md/context/ projection). The baseline is the initial foundation; normal work keeps project memory current — there is no baseline refresh.\n\n## Project memory sequence\n\nWork records preserve history. Project memory preserves current understanding. The canonical project memory is .yallaflow/context/index.yaml (CTX-#### facts, each current, superseded, or disputed, with confidence, provenance, evidence, and a verification point); PROJECT.md and context/*.md are its projection and show current knowledge only.\n\nBefore work: read the relevant current context; check freshness with yallaflow context status (or yallaflow context affected) for the areas the work touches; rediscover only where supporting evidence changed (MAY_BE_STALE / STALE_EVIDENCE), a fact is DISPUTED, or knowledge is unresolved. MAY_BE_STALE does not mean false.\n\nDuring work: do not silently trust stale context, and do not rescan unrelated areas that fresh durable context already covers. Record what you could not inspect (no production access, not sampled, out of scope) with yallaflow limitation add — a discovery limitation is work-scoped and is never a project fact.\n\nAfter work: propose durable knowledge and explicitly relate it to existing facts when it reconfirms (--reconfirms CTX-####: still true, fresh evidence), supersedes (--supersedes CTX-####: no longer true; the old fact becomes history), or disputes (--disputes CTX-####: conflicting evidence you cannot settle) them. YallaFlow validates the referenced fact and the transition; it never infers semantic equivalence or truth. Never rewrite historical work to reflect newly discovered truth.\n\n## Legacy context reconciliation sequence\n\nLegacy (v0.3.5 append-only) project knowledge is not canonical current truth until it is reconciled; migration is not reconciliation. Use yallaflow context reconcile start (never a blind yallaflow context adopt), inspect candidates with yallaflow context reconcile show, and declare one explicit relationship per RC-#### candidate — new, merge-with, reconfirms, supersedes, disputes, skip (with a reason), or limitation — with yallaflow context reconcile plan --file <decisions.json>, following yallaflow skill context-reconciliation. merge-with collapses two or more legacy candidates that are the same statement into one canonical fact (its target is another RC-#### candidate); reconfirms records one more historical observation of a truth already represented (an existing CTX-#### fact or another candidate's fact, of the same kind of knowledge). Relate a candidate to an existing CTX fact with reconfirms, supersedes, or disputes, never merge-with. Base every relationship on evidence and reasoning, never on wording similarity alone; do not semantically merge facts you have not examined. When you cannot safely decide whether items are duplicates, separate facts, a supersession, or a contradiction, leave the candidate undecided and record a question (yallaflow question add <reconciliation-work-id>) for human review — never guess. Preview the resulting memory with yallaflow context reconcile preview; a human approves with yallaflow context reconcile approve; only then yallaflow context reconcile apply. Never approve on the human's behalf, and never rewrite historical work (baseline.yaml, knowledge.yaml, earlier work.md) to make a migration cleaner: work history is immutable, reconciliation interprets it, project memory evolves.\n\n## YallaFlow state ownership\n\nNever edit YallaFlow-owned structured or history state directly when a supported command exists — run the command. CLI-owned: work/<id>/meta.yaml, progress.yaml, progress.md, knowledge.yaml, reviews.yaml, questions.yaml, baseline.yaml, discovery.yaml, decomposition.yaml, reconciliation.yaml, legacy-context.md (retired legacy sections), evidence/ (verification ledger), context/index.yaml, sources/ (originals and metadata), state/current.yaml, and decisions/ ADRs YallaFlow generated. Generated projections (the managed blocks in PROJECT.md, context/*.md, and AGENT.md) are regenerated with yallaflow context render / yallaflow agent refresh, never hand-edited. work.md is shared: you write its narrative sections (discovery notes, specification, plan, findings, result), but its CLI-appended lifecycle records (Routing Decision, Source Added, Request Revised) are history — never edit them. If a state file looks wrong, run yallaflow doctor and fix it through commands, not by editing.\n\n## Sources, evidence, and generated artifacts\n\nMaterial user-provided artifacts must not exist only in conversation memory. A source is an original user/project input (screenshot, PDF, DOCX, spreadsheet, requirement file) and lives, immutable, under .yallaflow/sources/SRC-####; evidence is proof produced during engineering or verification (work/<id>/evidence/, verification runs); a generated artifact is an optional output of the work itself. When a user-provided artifact materially affects a work request and you can access its file path, register the original with yallaflow intake add <work-id> <file> (or yallaflow intake <file> for new work) so it is linked to the work item; for DONE work add --reason, which records it as a recovered source added after completion (never as if it existed during execution). If you cannot access its bytes or path (e.g. an image pasted into chat), do not claim it was preserved: record yallaflow limitation add <work-id> --type uncaptured-artifact --area requirement --summary \"<what the artifact showed>\" --reason \"<why it could not be captured>\", and describe what it showed in the work item. Not every request needs a file — only artifacts that materially shape the requirement. Never register verification output as a source, and never edit a preserved source; capture a new version instead.\n\n## Knowledge sequence\n\nWork progress is not project knowledge, and a local ruling is not automatically an ADR. Near completion, propose only stable future-facing knowledge with yallaflow knowledge propose, citing evidence as existing repository paths (optionally path#symbol or path:12-40), runtime:<observation>, verification:V-###, or user:<confirmation>. Promote or reject every candidate, or explicitly record yallaflow knowledge review --none. Never promote execution noise or infer durable knowledge with keyword matching.\n\n## Verification\n\nPrefer argv verification: yallaflow verify <work-id> -- <executable> [args...]. Use --shell \"<command>\" only when shell operators (pipes, redirection, &&) are actually needed. Failed attempts remain in the append-only evidence ledger; re-run correctly rather than hiding them.\n\n## Handoff and completion language\n\nConversation context is disposable; project state is durable. At a safe boundary — or when the session itself is getting large — checkpoint progress, leave the working tree intact, and run yallaflow handoff before continuing in a fresh session; it surfaces the PRIMARY UNRESOLVED OBJECTIVE when one exists (from a reopen reason, a checkpoint revision reason, or an active blocker) so a new session does not have to infer it from lifecycle history alone. Only say a project is complete when the parent/project work item itself is DONE; a child reaching DONE is child-level completion (e.g. \"PF-0006 DONE, 5/7 required children complete\"), never \"project complete\". YallaFlow never commits automatically and never requires a clean Git tree for DONE, but a dirty tree at a DONE boundary is worth a source-control checkpoint before unrelated work begins.\n`;
}
