# Changelog

All notable changes to YallaFlow are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

YallaFlow has not yet made a public npm release (`package.json` remains `"private": true`). Every version below is an **internal-only prerelease**, git-tagged for internal use and never published to the npm registry. See [`docs/releasing.md`](docs/releasing.md) for the versioning policy that will apply once a public release begins, and [`docs/roadmap.md`](docs/roadmap.md) for planned work.

## [Unreleased]

Nothing yet.

## [0.3.4-internal.1] - 2026-09-20 — Work Decomposition, Review Gates & Agent Handoff

**Internal prerelease. Not published to npm.** The Nice Day pilot's second lesson: one architectural work item covering an entire project produced a single implementation session too large to review, verify, or hand off cleanly. This milestone makes that decomposition — which the agent was already doing mentally — explicit, durable, and governed by YallaFlow, without YallaFlow ever inventing the split itself. `Agent orchestrates. YallaFlow governs.`

#### Added — Work decomposition (`src/decomposition/`)
- `yallaflow decompose propose <parent-id> --file <decomposition.json>`: once a work item reaches `PLAN_READY` (reusing the existing readiness model — no new "ready" concept), the Agent submits a structured proposal (`children: [{ key, title, type, scope, required, requirements, acceptanceCriteria, dependsOn }]`, plus optional `requirementsUniverse`/`acceptanceCriteriaUniverse`). YallaFlow validates structure, self-dependencies, unknown dependencies, and dependency cycles, and persists it — it never invents feature boundaries or performs semantic requirement splitting.
- `yallaflow decompose validate <parent-id>`: re-validates the stored proposal and reports requirements/acceptance-criteria traceability coverage (referenced, cross-cutting/duplicated — reported, not rejected, since a requirement may legitimately span several children — and unassigned, only when a universe was declared).
- `yallaflow decompose execute <parent-id>`: the one explicit, one-time boundary between planning and executing. Creates a normal, fully routed YallaFlow work item per child (own work type, scope, pinned Behavior Contract, checkpoints, verification, review, knowledge, DONE — no separate lightweight task engine), then advances the parent into its write stage. Never runs implicitly as a side effect of `propose`/`validate`.
- `yallaflow decompose status <parent-id>`: read-only decomposition state, child progress, and traceability report.
- `yallaflow progress <parent-id>`: required/optional child counts and a `✓ done / → active / ○ ready / ⊘ blocked` view, with a `completed / required` count — no misleading percentage.
- `yallaflow next <parent-id>`: reports every dependency-unblocked child; it never picks one — prioritization stays with the Agent.
- Canonical ownership model: the parent's `decomposition.yaml` is the single source of truth for the child graph (keys, requirements/AC references, `dependsOn`, `required`); each child's own `meta.yaml`/`progress.yaml`/evidence remain its own lifecycle's single source of truth (just `parent`/`decompositionKey` back-references) — no duplicated, competing state.
- A decomposed parent's `IMPLEMENTATION`-stage exit gate is replaced by "every required child is DONE" (its own `implementation` checkpoint is never meant to complete — the children are the implementation); its `VERIFICATION`/`code-review`/knowledge stages are unchanged, for a final project-level pass.

#### Added — Interaction modes & review gates (`src/behavior/interaction.js`, `src/reviews/`)
- Durable per-project interaction policy in `config.yaml` (`interaction: { profile, mode, gates }`), set at `yallaflow init [--mode autonomous|adaptive|gated]` (default **adaptive** — the developer-oriented default from PART 8). A mode only selects a *default* gate preset; any of the 8 named gates (`discovery, clarification, design, specification, plan, decomposition, implementation, verification`) can be overridden per project.
  - `autonomous`: no optional gates. `adaptive`: `specification`, `plan`, `decomposition` stop for review; routine technical boundaries proceed automatically. `gated`: every boundary stops.
  - Hard safety checks (checkpoint completion, verification evidence, knowledge review, dependency-completion for children) are never routed through the gate system and so can never be weakened by any mode.
- `yallaflow approve <work-id> --stage GATE [--note TEXT]` / `yallaflow feedback <work-id> --stage GATE --changes-requested [--note TEXT]`: durable review state (`awaiting_review` / `approved` / `changes_requested`) in `.yallaflow/work/<id>/reviews.yaml`, with full history — workflow evidence, not an authentication claim.
- A blocked transition auto-requests review the first time it's hit and reports an actionable error (e.g. `specification review is awaiting_review in the current interaction mode — awaiting approval before execution. Run \`yallaflow approve ... \`.`).
- Review freshness: a material revision to specification/plan/implementation/verification (via `checkpoint revise`, `reopen`, or a re-`decompose propose` after approval) invalidates that gate's approval — and every downstream gate in the same dependency chain — back to `awaiting_review`, with the prior approval preserved in history, never deleted.

#### Added — Agent handoff
- `yallaflow handoff [work-id]`: a single, compact, read-only report for a new agent/session with no access to prior chat history — title/parent, type/scope/stage/readiness, completed/pending/blocked skills, open questions, review gates awaiting approval, latest verification, knowledge-review status, read-only Git summary (branch, clean/dirty, changed/untracked counts — never mutated), write authorization, and next objective; for a decomposed parent, also child DONE/active/blocked/ready counts, next executable candidates, and unresolved traceability gaps. Built from the same shared resolvers `guide`/`resume` already use (`loadWorkProgress`, `evaluateReadiness`, `buildBehaviorGuidance`, `discoverGitState`) rather than a fourth lifecycle interpretation.
- `resume` → "what should I continue doing"; `guide` → "what workflow/skill behavior applies"; `handoff` → "compact complete context for another agent/session." Distinct, non-overlapping responsibilities.

#### Changed
- `yallaflow advance [work-id]` and `yallaflow verify [work-id] -- <command>` now accept an optional explicit work item, mirroring `checkpoint`/`guide`/`ready`/`resume` — required for a decomposed child to be advanced/verified without becoming the workspace's single "active" focus.
- `doctor` gained decomposition/review integrity checks: a child referencing a missing parent, a parent referencing a missing/uncreated child, a required child incorrectly considered complete (parent DONE while a required child isn't), decomposition execution started without a required approval, and a completed checkpoint whose required review isn't approved. Reports only; never auto-repairs.

#### Compatibility
- Fully additive: a work item with no `parent`, no `decomposition.yaml`, behaves exactly as in v0.3.3. No migration-on-read; existing v0.1–v0.3.3 workspaces, reopen behavior, the verification ledger, source intake, and the knowledge workflow are unaffected.
- Session-level interaction-mode overrides (a temporary "work autonomously until PLAN_READY" instruction on top of the project default) are explicitly **not** implemented this milestone — only the durable project policy is — per this milestone's own scope guidance to land the project policy first and treat session override as follow-up.

## [0.3.3-internal.1] - 2026-09-20 — Workflow Integrity & Recovery

**Internal prerelease. Not published to npm.** Closes the workflow-integrity defects (GAP-REC-001 through GAP-REC-005) surfaced by the first full human pilot, where DONE work could not be safely reopened, checkpoint revisions could leave `meta.status` contradicting the checkpoint ledger, `IMPLEMENTATION`/`VERIFICATION` could be left without their own checkpoint completed, verification evidence was overwritten on every `verify` call, and `resume <work-id>` ignored the given ID. No feature decomposition, team mode, or model/provider work is included — this milestone is entirely about making existing single-work-item state trustworthy.

#### Added
- `yallaflow reopen <work-id> --to implementation|verification|review --reason "..."`: the only supported way to reactivate DONE work. Resets the checkpoints downstream of the reopen target to `pending` (and `implementation` itself to `in_progress`), marks a freshness boundary (`meta.lastInvalidationAt`) so stale evidence can never satisfy a later completion gate, resets a completed knowledge review to pending only when reopening to `implementation`, and records the event in a new `meta.lifecycleHistory` array. Fully audit-only otherwise: no evidence, checkpoint history, or knowledge candidate is ever deleted.
- `yallaflow verify list [work-id]`: lists every recorded verification run. `evidence/verification.json` is now an append-only ledger (`schemaVersion: 2`, `runs: [...]`, ids `V-001`, `V-002`, ...); each `yallaflow verify -- <command>` appends a new run (and its own `V-00N-verification.log`) instead of overwriting the previous one.
- `yallaflow resume <work-id>` now actually inspects the given work item instead of silently falling back to the active one. Inspecting a non-active item is clearly labeled and never mutates `state/current.yaml` — `yallaflow resume` (no argument) is unaffected.
- `doctor` gained lifecycle-integrity checks: DONE with an incomplete `implementation`/`verification`/`code-review` checkpoint, a completed `verification` checkpoint with no (or stale, or failed) evidence, and DONE with an incomplete required knowledge review. Reported as actionable `FAIL` lines; never auto-repaired.
- `meta.completionHistory` records every DONE transition (timestamp + the verification run ids that satisfied it), so a work item that reaches DONE a second time preserves, rather than overwrites, the first completion.

#### Changed — workflow-integrity fixes (breaking within 0.x; see `docs/releasing.md`)
- **Stage-exit gates are now generalized, not just architectural.** Leaving the `IMPLEMENTATION`/`EXECUTION` stage now requires the `implementation` checkpoint to be `completed` (when the Behavior Contract includes it), and leaving `VERIFICATION` now requires the `verification` checkpoint to be `completed`, for every workflow — not only the architectural-feature pre-implementation chain. Reaching `DONE` additionally requires the `code-review` checkpoint to be `completed` when the contract includes it (no workflow defines a distinct `REVIEW` stage, so this is enforced at the existing `VERIFICATION → DONE` gate, alongside the pre-existing verification-evidence and knowledge-review checks).
- **`checkpoint revise` now cascades downstream.** Revising `implementation`, `verification`, or `code-review` resets whichever of the later two are `completed` back to `pending` (correction history preserved; pre-implementation design/spec checkpoint revisions are unaffected — they still only correct `meta.status` backward, matching the existing "stage vs. delivery readiness are independent" behavior). `checkpoint revise` on a `DONE` work item is now rejected with instructions to use `yallaflow reopen` instead of silently mutating completed execution state.
- Completing `verification` now also requires its evidence to postdate the most recent implementation reopen/revision (`meta.lastInvalidationAt`), and completing `code-review` now requires `verification` to already be `completed`.
- `yallaflow verify`'s console output now includes the run id (`Verification PASSED (exit 0) — V-001.`).

#### Fixed
- GAP-REC-001 (no supported reopen path) — resolved via `yallaflow reopen`.
- GAP-REC-002 (checkpoint revision could contradict `meta.status`/readiness) — resolved: revision always reconciles stage and marks a freshness boundary through one shared resolver (`core/transitions.js` + `core/workflows.js`'s generalized `requiredSkillForStage`/`stageForSkill`).
- GAP-REC-003 (incomplete IMPLEMENTATION/VERIFICATION exit gate) — resolved via the generalized stage-exit gate above.
- GAP-REC-004 (verification evidence overwritten) — resolved via the append-only verification ledger.
- GAP-REC-005 (`resume <work-id>` ignored its argument) — resolved.

#### Compatibility
- A pre-existing single-record `evidence/verification.json` (no `schemaVersion`) remains fully readable and is never rewritten by a read; it is normalized in memory to run `V-001` and only becomes an on-disk v2 ledger once a *new* `yallaflow verify` appends to it.
- Existing v0.1–v0.3.2 workspaces, DONE work, progress ledgers, knowledge, questions, and registry v2 contracts are read exactly as before — no migration-on-read, no destructive rewrite.

## [0.3.0-internal.2] - 2026-09-19 — Universal File Intake

**Internal prerelease. Not published to npm.** Closes out the file-intake architecture: one `yallaflow intake <file>` command now handles plain text, Office/OpenDocument documents, PDF, and images, instead of only the narrow plain-text set from `0.3.0-internal.1`.

#### Added
- Format detection (`src/intake/detect.js`) by content signature (magic bytes), not extension alone. A file wrongly named `.docx`/`.pdf`/`.rtf` is detected as a mismatch and preserved as generic binary rather than parsed as if it were valid.
- Extensible adapter registry (`src/intake/registry.js` + `src/intake/adapters/{text,office,rtf,pdf,image,binary}.js`): one adapter per format family; adding a format means adding a registry entry and an adapter, never a switch statement in CLI code.
- Office/OpenDocument extraction for `.docx .pptx .xlsx .rtf .odt .ods .odp`, with a structured pass for `.xlsx` (real sheet names, markdown grid tables via `src/intake/extractors/xlsx.js`) and `.pptx` (`# Slide N` sections via `src/intake/extractors/pptx.js`); `.rtf` via a small first-party control-word stripper (`src/intake/extractors/rtf.js`).
- PDF extraction (`src/intake/extractors/pdf.js`), per page (`# Page N` sections), with document title/producer metadata where present. Documented limitation: word order within a line follows the PDF content stream, not necessarily visual reading order — most noticeable for RTL scripts.
- Images (`.png .jpg .jpeg .webp .gif .bmp .tif .tiff .svg`) accepted as sources with cheap header metadata (format, dimensions for PNG/GIF/BMP/JPEG/SVG where trivial to read). No OCR or vision understanding is performed or claimed.
- Generic binaries, recognized-but-not-yet-implemented `.odg`/`.epub`, and dangerous containers (`.zip .tar .gz .tgz .7z .rar`, never auto-unpacked) are now accepted as `original-only` sources instead of being rejected.
- Graceful degradation: a corrupt file of an otherwise-supported format, or a file over the extraction size limit, is preserved as `original-only` with a printed warning and a reason recorded in `metadata`, instead of failing the whole intake or silently truncating.
- `yallaflow intake <file> [<file> ...] [--title TITLE]` accepts multiple sources in one command; `yallaflow intake add <work-id> <file> [<file> ...]` attaches sources to an existing pending or routed work item. Chosen over a recursive `intake-dir` command as the simpler, safer public UX (no hidden-file/`.git`/`node_modules` traversal rules to get right).
- `yallaflow source show <id> --content` now explains "no text representation is available" for `original-only` sources instead of dumping binary bytes; `yallaflow source list`/`show` and `guide`/`resume`/`status` display detected format and content availability (`native text` / `extracted text available` / `original preserved, no text extracted`).

#### Changed
- `source.json` schema bumped to v2: adds `detectedFormat` and `contentAvailability`; splits `original` (path/sha256/sizeBytes of the preserved file) from `representation` (path/sizeBytes of `extracted.txt`, present only when `contentAvailability` is `extracted`). v1 records from `0.3.0-internal.1` remain fully readable — `loadSourceText()` abstracts the version difference away from display code — and are never migrated or rewritten.

#### Security
- No macro, embedded-script, or OLE-object execution; no external link/content fetching; archives are never auto-unpacked.
- Zip-based formats (`.docx/.pptx/.xlsx/.odt/.ods/.odp`) are read through `yauzl` with an entry-count cap and a cumulative decompressed-byte cap, refusing to continue rather than risking a decompression bomb.
- Every stored file name is validated against path traversal (`assertSafeSourceName`, `assertWithinDirectory`) before it is ever used to build a filesystem path.
- PDF parsing runs pdfjs-dist with `isEvalSupported: false`, no worker thread, no font loading, and no auto-fetch, and never touches its sandbox/scripting module — embedded PDF JavaScript is never evaluated.
- A hard-coded `Promise.withResolvers` shim (not a dependency) lets the patched pdfjs-dist major version run on our documented Node ≥20 baseline; see "Parser decisions" below for why the version matters.

#### Parser decisions

New runtime dependencies (all MIT-licensed except pdfjs-dist, which is Apache-2.0):

| Package | Version pinned | Why |
| --- | --- | --- |
| `officeparser` | `5.2.2` (exact) | Broadest single library covering `.docx/.pptx/.xlsx/.odt/.ods/.odp` text extraction cleanly, including correct Arabic/Unicode handling (verified against a real Arabic DOCX). Pinned below its `6.x`/`7.x`/`8.x` lines deliberately: those versions add `tesseract.js` (OCR) as a **hard**, non-optional dependency — a heavyweight addition this release explicitly declines to introduce without separate justification (per the milestone brief). `5.2.2` has no OCR dependency. |
| `pdfjs-dist` | `6.3.289`, forced via a package.json `overrides` entry | `officeparser@5.2.2` declares `pdfjs-dist: ^5.3.31` for its own (unused-by-us) PDF path. That range resolves to a version affected by [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j) — arbitrary JavaScript execution on a malicious PDF (high severity) — which is unacceptable given "never execute embedded scripts." `6.3.289` is patched. Since `officeparser`'s own PDF code path is incompatible with pdfjs-dist 6.x's API (verified directly — it throws), YallaFlow never calls it; PDF intake goes through our own first-party adapter using the forced, patched version instead. The override means only one (patched) pdfjs-dist copy is ever installed. |
| `@xmldom/xmldom` | `^0.8.10` | Already a transitive dependency of `officeparser`; depended on directly for our own `.xlsx`/`.pptx` structured extraction (parsing `workbook.xml`/`sheetN.xml`/`slideN.xml`). Mature, MIT, no known advisories. |
| `yauzl` | `^3.1.3` | Already a transitive dependency of `officeparser`; depended on directly, with our own entry-count/decompressed-size caps, for the same structured extraction. Mature, MIT, no known advisories. |

**Evaluated and explicitly not adopted:** `file-type` (for our own format-signature detection) — the version range compatible with the rest of this dependency tree carries a moderate-severity DoS advisory ([GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473), an infinite loop on malformed ASF/WMV input). `officeparser` still depends on it internally for its own Buffer-input format sniffing (verified this still fails safely — a corrupted/mismatched buffer produces a clean error, not a hang), so the advisory remains in the dependency tree (`npm audit` reports it) but is never reached by code this project calls directly: our own format detection (`src/intake/detect.js`) is a small, first-party magic-byte check covering only the specific formats this project supports, deliberately avoiding the vulnerable range for anything we invoke ourselves.

**Runtime note:** `pdfjs-dist@6.x` declares `engines.node: >=22.13.0` and uses `Promise.withResolvers` natively; this repository's baseline is Node ≥20, so `src/intake/extractors/pdf.js` applies a minimal, well-known polyfill for that one method. `npm install` prints an `EBADENGINE` warning as a result — expected, non-blocking, and verified working on Node 20.19 throughout this milestone's testing and dogfooding.

## [0.3.0-internal.1] - 2026-09-19 — File Intake Foundation

**Internal prerelease. Not published to npm.** The first v0.3 capability: a coding agent (or human) with an existing requirements file no longer has to paste it into a prompt.

#### Added
- Intake Adapter boundary (`src/intake/`): a source (today, a local file) is turned into a provider-neutral Normalized Intake Contract — `{ sourceType, sourceName, contentType, rawText, capturedAt, metadata }` — independent of workspace storage and routing, so a future tracker/message adapter can produce the same shape.
- `yallaflow intake <file> [--title TITLE]`: reads a local file, copies it byte-for-byte into `.yallaflow/sources/SRC-####/`, records a validated `source.json` (content type, capture timestamp, SHA-256 checksum, linked work IDs), and creates a pending work item referencing it via `meta.sources` (an array — a work item is never structurally limited to one source). Supported types: `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`; anything else is rejected with a clear, literal list — never a silent guess.
- `yallaflow source list` and `yallaflow source show <id> [--content]` for inspecting captured sources.
- `guide`, `resume`, and `status` show a `Source:` line whenever a work item has one, before and after routing.
- Re-ingesting identical content never overwrites a prior source (a new `SRC-####` is always allocated), with a checksum-match warning printed instead.
- `yallaflow doctor` reports how many sources are present, tolerating an absent `sources/` directory.

#### Compatibility
- `yallaflow start "<text>"` is completely unchanged; `createPendingIntake`'s new `options` parameter is additive and optional.
- Workspaces without a `sources/` directory remain fully valid; no read command (`doctor`, `source list`, `guide`, `resume`, `status`) ever creates it — only `yallaflow intake` does, lazily, on first use.

## [0.2.0-internal.1] - 2026-09-19 — Internal Pilot Baseline

**Internal prerelease. Not published to npm.** This is the reproducible baseline handed to the human internal pilot after Core froze and passed its standalone engineering dogfood. It brings together: Adaptive Spec-Driven Development with provider-agnostic work-type/scope routing; a versioned Skill Registry and pinned Behavior Contracts; a dedicated `specification` behavior distinct from design and planning; a structured questions ledger for business and architecture decisions; durable skill checkpoints with audited correction history; a delivery-readiness model (`SPEC_READY` / `PLAN_READY` / `DONE`) kept independent of workflow stage; verification gates; `resume`; knowledge promotion and ADRs; and backward-compatible handling of every earlier workspace shape (v0.1 through v0.2.5). Milestone-level detail below.

### v0.2.6 — Core Freeze & Release Readiness

No runtime changes. This milestone synchronized public documentation with the accepted v0.2.5 runtime and established release/versioning policy ahead of publishing.

#### Changed
- Rewrote `README.md` and `docs/architecture.md` to document the specification skill, structured questions/decision ledger, checkpoint revision and history, and the delivery readiness model (`SPEC_READY` / `PLAN_READY` / `DONE`).
- Added a canonical domain-terminology reference to `docs/architecture.md`.
- Updated `docs/roadmap.md`: corrected a stale, never-implemented "optional `yf` CLI alias" claim under v0.2; added the v0.2.6 entry; reframed v0.3 as "Real-World Intake & Agent Integration" with concrete planned themes.
- Updated `CONTRIBUTING.md` with principles covering the specification skill, questions ledger, checkpoint correction/history, and readiness model.
- Updated `resources/agents/claude/README.md` and `resources/agents/codex/README.md` to reference `yallaflow question` and `yallaflow ready`.

#### Added
- `docs/releasing.md`: versioning model (package vs. Skill Registry vs. knowledge-policy vs. workspace-schema versions) and a maintainer release checklist.
- This file.

### v0.2.5 — Core Revision & Specification Layer

Findings from a standalone greenfield dogfood run against v0.2.4 drove this revision. All items below are implemented and covered by the automated test suite.

#### Added
- Dedicated, read-only `specification` skill (capability `specify`), distinct from design and planning, added to Skill Registry v2 and to the architectural-feature Behavior Contract between `design-exploration` and `implementation-planning`.
- Stage-gated lifecycle: a workflow stage can only be exited once the checkpoint it requires is `completed`, closing the previously independent drift between workflow stage and checkpoint state.
- Audited checkpoint correction: `yallaflow checkpoint revise <work-id> --skill SKILL --status pending|in_progress|blocked --reason TEXT`, appending a `{ skill, from, to, reason, changedAt }` entry to the progress ledger's history. A correction can move the workflow stage backward without discarding other completed checkpoints.
- Structured, work-scoped decision ledger: `.yallaflow/work/<id>/questions.yaml`, with `yallaflow question add|list|answer|resolve`, `business`/`architecture` categories, and a `material` flag that blocks specification/plan readiness while open.
- Delivery readiness model: `yallaflow ready [work-id]` reports `SPEC_READY`, `PLAN_READY`, or `DONE` readiness derived from checkpoint and question state, independent of workflow stage. `yallaflow advance` now explains exactly which checkpoint or unresolved decision is blocking a transition instead of failing silently.
- Knowledge source distinction: `yallaflow knowledge propose --source design-spec|implementation-runtime`. `design-spec` knowledge may be reviewed and promoted at a stable `SPEC_READY`/`PLAN_READY` endpoint without implementation verification evidence; `implementation-runtime` knowledge still requires the normal verification gate.
- Concise work titles: `yallaflow route ... --title "<title>"`, shown in `status`/`resume`/`guide` instead of the full raw request. The raw request remains preserved unmodified.
- Namespace `--help` for `checkpoint`, `question`, and `knowledge`.

#### Changed
- Skill Registry bumped to version 2 (9 built-in skills). Work routed before this change keeps its pinned registry v1 contract unchanged.

### v0.2 — Behavior Engine

#### Added
- Agent-supplied intent + scope routing contract, with durable, auditable routing decisions.
- Deterministic workflow policy resolver mapping work type + scope to required capabilities.
- Versioned Skill Registry and Behavior Contracts pinned to routed work items.
- Deterministic behavior guidance (`yallaflow guide`) and write-authorization gates.
- Durable skill checkpoints (`yallaflow checkpoint`) and resumable progress (`yallaflow resume`).
- Work-scoped evidence references and local execution rulings.
- Formal transition validator (`yallaflow advance`) and a structured verification-evidence schema (`yallaflow verify`).
- Explicit knowledge candidates, review, traceable context promotion, and ADR creation (`yallaflow knowledge`).
- Agent behavior scenario tests.

### v0.1 — Foundation

#### Added
- Initial CLI: `init`, `start`, `feature`, `bug`, `investigate`, `change`, `status`, `resume`, `doctor`.
- Greenfield/brownfield workspace model with deterministic repository bootstrap hints.
- Persistent project memory and work registry under `.yallaflow/`.
- Work ledgers and a read-only investigation guard.
- Package-owned workflow contracts.
