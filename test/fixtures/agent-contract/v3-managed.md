<!-- yallaflow-agent-contract:begin version=3 sha256=b4ad4b68f019c14709c3a1a3136feeba27cc52c21919b87ae3fdfdf05d4e1860 — managed by YallaFlow; keep project-specific instructions outside this block; update with `yallaflow agent refresh` -->
# YallaFlow Agent Contract

YallaFlow is the engineering governance layer for this repository: durable project memory, adaptive workflows, and evidence-backed delivery. It applies Adaptive Spec-Driven Development where the work needs it — specification depth must match the work type and scope. The Agent orchestrates; YallaFlow governs; project memory persists.

## Core rules

1. Discover before asking. Technical unknowns belong in repository discovery; ask only about material business ambiguity or unavailable information.
2. Understand before changing. Route the request to the correct workflow and establish the required evidence/spec first.
3. Prove before claiming. No work item may become DONE without fresh verification evidence.
4. Remember after finishing. Promote only durable knowledge into context/ or decisions/; keep execution noise with the work item.
5. Revalidate before trusting stale knowledge. Project context whose supporting evidence changed since it was verified may be stale; revalidate it before relying on it.
6. Investigation is read-only unless the work item is explicitly converted to an implementation workflow.
7. Record material deviations or assumptions as rulings in the work item progress ledger.

## Start sequence

In a fresh session, run yallaflow brief first: one read-only orientation (agent contract state, active and most recent work, project memory, sources, pending legacy reconciliation) that names the next command to run. It does not replace yallaflow resume/handoff/guide; it tells you which one applies. For a brownfield project with an approved baseline (.yallaflow/PROJECT.md and context/ populated by `yallaflow baseline approve`), read PROJECT.md and only the context docs relevant to the current request first; do not blindly rescan the whole repository for every request — but repository evidence remains authoritative when durable context is stale (see the project memory sequence). Otherwise read .yallaflow/config.yaml, .yallaflow/PROJECT.md, .yallaflow/state/current.yaml, then load only the context relevant to the current work item.

## Routing sequence

For an unclassified request, create an intake with yallaflow start, classify it using the allowed work_type, scope, and confidence values, explain the reason, then apply the decision with yallaflow route. The CLI validates and persists the decision; it does not perform semantic inference. Scope classification is not just about code size: consider financial/accounting invariants, security/privacy impact, authorization changes, persistent data-model/migration changes, cross-module derived state, external integration contracts, public APIs, irreversible behavior, and concurrency/transaction rules. A small UI change can stay bounded; a small-looking change touching system-wide financial correctness may warrant architectural depth and its specification/planning review gates. YallaFlow validates the allowed values only — it never classifies semantically itself.

Direct classified commands are shortcuts only for work whose type and scope are already known: yallaflow feature|bug|investigate|change|refactor|release "<title>" --scope <spike|bounded|architectural>. --scope is required; never guess or default a scope to make a direct command succeed. If the type or scope is not already known, use yallaflow start and classify with yallaflow route instead. If YallaFlow rejects a type/scope combination (for example feature with spike), do not force or work around it — choose a supported classification (e.g. investigation, or bug with spike, for exploratory work) or route through yallaflow start.

## Behavior contract sequence

Skills define engineering behavior. Work items pin the behavior they were created with. Before engineering work, run yallaflow guide for the work item. Follow the pinned skill order and retrieve exact package-owned instructions with yallaflow skill. Record completed work explicitly with yallaflow checkpoint; never infer completion from conversation. Workflow stages remain authoritative; do not modify application code when guidance reports that modification is not authorized. Once a required review gate is approved, continue automatically to the next configured boundary or blocker — do not ask again for permission that was already given (e.g. after "approve and execute", proceed to the next ready step without a redundant confirmation prompt).

## Brownfield baseline sequence

For an existing repository with no durable project context yet, run yallaflow baseline start (read-only), perform repository/runtime discovery, complete the repository-baseline checkpoint, then record findings with yallaflow baseline draft --file <baseline.json> — every fact needs a status (confirmed/inferred/unresolved), evidence, and source (repository/runtime/user-confirmed); prior chat/model memory is never evidence. Things the discovery could not inspect go in the draft's limitations array, not in facts. A human reviews the draft (yallaflow baseline show/status) and either yallaflow baseline approve or yallaflow baseline feedback --changes-requested. Only an approved baseline updates durable project memory (context/index.yaml and its PROJECT.md/context/ projection). The baseline is the initial foundation; normal work keeps project memory current — there is no baseline refresh.

## Project memory sequence

Work records preserve history. Project memory preserves current understanding. The canonical project memory is .yallaflow/context/index.yaml (CTX-#### facts, each current, superseded, or disputed, with confidence, provenance, evidence, and a verification point); PROJECT.md and context/*.md are its projection and show current knowledge only.

Before work: read the relevant current context; check freshness with yallaflow context status (or yallaflow context affected) for the areas the work touches; rediscover only where supporting evidence changed (MAY_BE_STALE / STALE_EVIDENCE), a fact is DISPUTED, or knowledge is unresolved. MAY_BE_STALE does not mean false.

During work: do not silently trust stale context, and do not rescan unrelated areas that fresh durable context already covers. Record what you could not inspect (no production access, not sampled, out of scope) with yallaflow limitation add — a discovery limitation is work-scoped and is never a project fact.

After work: propose durable knowledge and explicitly relate it to existing facts when it reconfirms (--reconfirms CTX-####: still true, fresh evidence), supersedes (--supersedes CTX-####: no longer true; the old fact becomes history), or disputes (--disputes CTX-####: conflicting evidence you cannot settle) them. YallaFlow validates the referenced fact and the transition; it never infers semantic equivalence or truth. Never rewrite historical work to reflect newly discovered truth.

## Legacy context reconciliation sequence

Legacy (v0.3.5 append-only) project knowledge is not canonical current truth until it is reconciled; migration is not reconciliation. Use yallaflow context reconcile start (never a blind yallaflow context adopt), inspect candidates with yallaflow context reconcile show, and declare one explicit relationship per RC-#### candidate — new, merge-with, reconfirms, supersedes, disputes, skip (with a reason), or limitation — with yallaflow context reconcile plan --file <decisions.json>, following yallaflow skill context-reconciliation. merge-with collapses two or more legacy candidates that are the same statement into one canonical fact (its target is another RC-#### candidate); reconfirms records one more historical observation of a truth already represented (an existing CTX-#### fact or another candidate's fact, of the same kind of knowledge). Relate a candidate to an existing CTX fact with reconfirms, supersedes, or disputes, never merge-with. Base every relationship on evidence and reasoning, never on wording similarity alone; do not semantically merge facts you have not examined. When you cannot safely decide whether items are duplicates, separate facts, a supersession, or a contradiction, leave the candidate undecided and record a question (yallaflow question add <reconciliation-work-id>) for human review — never guess. Preview the resulting memory with yallaflow context reconcile preview; a human approves with yallaflow context reconcile approve; only then yallaflow context reconcile apply. Never approve on the human's behalf, and never rewrite historical work (baseline.yaml, knowledge.yaml, earlier work.md) to make a migration cleaner: work history is immutable, reconciliation interprets it, project memory evolves.

## YallaFlow state ownership

Never edit YallaFlow-owned structured or history state directly when a supported command exists — run the command. CLI-owned: work/<id>/meta.yaml, progress.yaml, progress.md, knowledge.yaml, reviews.yaml, questions.yaml, baseline.yaml, discovery.yaml, decomposition.yaml, reconciliation.yaml, legacy-context.md (retired legacy sections), evidence/ (verification ledger), context/index.yaml, sources/ (originals and metadata), state/current.yaml, and decisions/ ADRs YallaFlow generated. Generated projections (the managed blocks in PROJECT.md, context/*.md, and AGENT.md) are regenerated with yallaflow context render / yallaflow agent refresh, never hand-edited. work.md is shared: you write its narrative sections (discovery notes, specification, plan, findings, result), but its CLI-appended lifecycle records (Routing Decision, Source Added, Request Revised) are history — never edit them. If a state file looks wrong, run yallaflow doctor and fix it through commands, not by editing.

## Sources, evidence, and generated artifacts

Material user-provided artifacts must not exist only in conversation memory. A source is an original user/project input (screenshot, PDF, DOCX, spreadsheet, requirement file) and lives, immutable, under .yallaflow/sources/SRC-####; evidence is proof produced during engineering or verification (work/<id>/evidence/, verification runs); a generated artifact is an optional output of the work itself. When a user-provided artifact materially affects a work request and you can access its file path, register the original with yallaflow intake add <work-id> <file> (or yallaflow intake <file> for new work) so it is linked to the work item; for DONE work add --reason, which records it as a recovered source added after completion (never as if it existed during execution). If you cannot access its bytes or path (e.g. an image pasted into chat), do not claim it was preserved: record yallaflow limitation add <work-id> --type uncaptured-artifact --area requirement --summary "<what the artifact showed>" --reason "<why it could not be captured>", and describe what it showed in the work item. Not every request needs a file — only artifacts that materially shape the requirement. Never register verification output as a source, and never edit a preserved source; capture a new version instead.

## Knowledge sequence

Work progress is not project knowledge, and a local ruling is not automatically an ADR. Near completion, propose only stable future-facing knowledge with yallaflow knowledge propose, citing evidence as existing repository paths (optionally path#symbol or path:12-40), runtime:<observation>, verification:V-###, or user:<confirmation>. Promote or reject every candidate, or explicitly record yallaflow knowledge review --none. Never promote execution noise or infer durable knowledge with keyword matching.

## Verification

Prefer argv verification: yallaflow verify <work-id> -- <executable> [args...]. Use --shell "<command>" only when shell operators (pipes, redirection, &&) are actually needed. Failed attempts remain in the append-only evidence ledger; re-run correctly rather than hiding them.

## Handoff and completion language

Conversation context is disposable; project state is durable. At a safe boundary — or when the session itself is getting large — checkpoint progress, leave the working tree intact, and run yallaflow handoff before continuing in a fresh session; it surfaces the PRIMARY UNRESOLVED OBJECTIVE when one exists (from a reopen reason, a checkpoint revision reason, or an active blocker) so a new session does not have to infer it from lifecycle history alone. Only say a project is complete when the parent/project work item itself is DONE; a child reaching DONE is child-level completion (e.g. "PF-0006 DONE, 5/7 required children complete"), never "project complete". YallaFlow never commits automatically and never requires a clean Git tree for DONE, but a dirty tree at a DONE boundary is worth a source-control checkpoint before unrelated work begins.
<!-- yallaflow-agent-contract:end -->
