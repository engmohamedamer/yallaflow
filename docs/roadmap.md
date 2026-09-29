# Roadmap

YallaFlow is an AI-agnostic engineering governance layer for coding agents — durable project memory, adaptive workflows, and evidence-backed delivery. It applies Adaptive Spec-Driven Development where the work needs it: workflow depth follows the kind and scope of work instead of forcing every request through one specification template.

## v0.1 — Foundation
- CLI: init, start, feature, bug, investigate, change, status, resume, doctor
- Greenfield/brownfield workspace model
- Deterministic repository bootstrap hints
- Persistent project memory and work registry
- Work ledgers and read-only investigation guard
- Package-owned workflow contracts

## v0.2 — Behavior Engine
- Agent-supplied intent + scope routing contract
- Pending intake and durable routing audit
- Deterministic workflow policy resolver
- Versioned Skill Registry and pinned behavior contracts
- Deterministic behavior guidance and write-authorization gates
- Durable skill checkpoints and resumable progress
- Work-scoped evidence references and local execution rulings
- Future skill execution and workflow composition
- Formal transition validator
- Verification evidence schema
- Explicit knowledge candidates, review, traceable context promotion, and ADR creation
- Agent behavior scenario tests

## v0.2.5 — Core Revision & Specification Layer
- Dedicated read-only `specification` skill, distinct from design and planning, pinned in Skill Registry v2
- Stage-gated lifecycle: a workflow stage can only be exited once the checkpoint it requires is completed, closing the stage/checkpoint drift gap
- Audited checkpoint correction (`yallaflow checkpoint revise`) with a durable history of prior/new status, reason, and timestamp; corrections can move the current stage backward without losing completed downstream checkpoints
- Structured, work-scoped decision/question ledger (`questions.yaml`) with business and architecture categories, CLI (`yallaflow question add|list|answer|resolve`), and readiness-blocking material questions
- Delivery readiness model (`yallaflow ready`) distinguishing SPEC_READY, PLAN_READY, and DONE from workflow stage; `yallaflow advance` explains blocking requirements instead of failing silently
- Knowledge review permitted at a stable SPEC_READY/PLAN_READY endpoint for design/spec-sourced candidates (`--source design-spec`), without requiring implementation verification evidence; implementation-runtime knowledge still respects the verification gate
- Concise work titles (`--title`) shown in `status`/`resume`/`guide` instead of the raw request; raw request preserved unmodified
- Namespace `--help` for `checkpoint`, `question`, and `knowledge`

## v0.2.6 — Core Freeze & Release Readiness
- Public documentation synchronized with the accepted v0.2.5 runtime (README, architecture, this roadmap, CONTRIBUTING, agent adapter docs)
- Canonical domain-terminology reference in `docs/architecture.md`
- Documented, un-executed release/versioning policy distinguishing package, Skill Registry, knowledge-policy, and workspace-schema versions (`docs/releasing.md`)
- `CHANGELOG.md` covering the foundation through the accepted Core, grouped under Unreleased pending the first publish
- Explicit architecture-freeze statement naming the contracts v0.3 must build on rather than redesign
- No runtime, workflow, skill, state-model, or dependency changes

## v0.3 — Real-World Intake & Agent Integration

### v0.3.1 — File Intake Foundation

- Intake Adapter boundary (`src/intake/`): Source → Intake Adapter → Normalized Intake Contract, kept separate from workspace storage and from routing
- File intake: `yallaflow intake <file>` for `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`; a clear, literal rejection (not a silent guess) for anything else
- Workspace source storage (`.yallaflow/sources/SRC-####/`): byte-for-byte original file preserved, a validated `source.json` record (content type, capture timestamp, SHA-256 checksum, linked work IDs), never overwritten on re-ingestion
- `sources: [{ id, type, name }]` linkage on the created work item (an array, not locked to exactly one source); `guide`/`resume`/`status` show it; `yallaflow source list` / `yallaflow source show [--content]` for inspection
- Optional `--title` on `intake` (or a mechanical filename-derived default) flows into the work item's title once routed, without YallaFlow ever inferring a title or routing decision from the file's contents
- Full backward compatibility: `yallaflow start "<text>"` unchanged; workspaces without `sources/` remain valid; no read ever creates `sources/`

### v0.3.2 — Universal File Intake

- Format detection (`src/intake/detect.js`) by content signature, not extension alone; a fake `.docx` is detected as a mismatch and preserved as generic binary rather than parsed as if valid
- Extensible adapter registry (`src/intake/registry.js` + `src/intake/adapters/`): one adapter module per format family, no switch statement scattered through CLI code
- Office/OpenDocument extraction (`.docx .pptx .xlsx .rtf .odt .ods .odp`) via `officeparser`, with a structured pass for `.xlsx` (real sheet names + grid tables) and `.pptx` (per-slide sections)
- PDF extraction via a first-party `pdfjs-dist`-based adapter, per page, with page boundaries preserved and a documented reading-order caveat for RTL/complex layouts
- Images (`.png .jpg .jpeg .webp .gif .bmp .tif .tiff .svg`) accepted as sources with cheap header metadata (format, dimensions where trivial to read) — no OCR/vision performed or claimed
- Generic binaries, `.odg`/`.epub`, and dangerous containers (`.zip .tar .gz .7z .rar`, never auto-unpacked) accepted as `original-only` sources instead of being rejected
- Graceful degradation: extraction failures and oversize files fall back to `original-only` with a clear reason, never a silent partial result
- `yallaflow intake <file> [<file> ...]` accepts multiple sources at once; `yallaflow intake add <work-id> <file> [<file> ...]` attaches sources to an existing (pending or routed) work item — closing the multi-source model `sources` was already designed for
- Security hardening: no macro/embedded-script/OLE execution, no external fetches, decompression-bomb and entry-count limits on zip-based formats, path-traversal guards on every stored file name
- `source.json` schema v2 (detected format, content availability, separate `original`/`representation` file references); v1 records from v0.3.1 remain readable without migration

### Still planned (not yet implemented)

- **Tracker intake** — Azure DevOps, Jira, and GitHub Issues as requirement sources, with attachments and source traceability back to the originating ticket
- ~~**Codex adapter** and **Claude adapter**~~ and ~~**agent bootstrap/session guidance**~~ — delivered in v0.3.8 as thin, versioned bootstrap blocks (`yallaflow agent setup codex|claude`) pointing to `.yallaflow/AGENT.md`; deeper provider integration (hooks, plugins) remains future work
- Git worktree safety and baseline verification for multi-source/multi-agent execution
- Future semantic deduplication and optional assisted knowledge extraction (still explicitly agent-proposed, not inferred by YallaFlow)
- OCR/vision understanding of images and scanned PDFs (deliberately not introduced this release — see the parser-decisions notes in `CHANGELOG.md`)
- `.odg` and `.epub` text extraction (recognized formats, preserved as original-only; no maintained lightweight parser evaluated for them yet)
- `yallaflow intake-dir` (recursive directory ingestion) — multiple explicit file arguments to `intake`/`intake add` were chosen instead as the simpler, safer public UX

### v0.3.3 — Workflow Integrity & Recovery

The first full human pilot (Nice Day Contract Hub) reached `DONE`, and in doing so exposed workflow-integrity gaps in the state model itself:

- `yallaflow reopen <work-id> --to implementation|verification|review --reason "..."` — the only supported way to safely reactivate `DONE` work; no manual state-file editing
- Generalized stage-exit gates: `IMPLEMENTATION`/`VERIFICATION`/`code-review` checkpoint completion is now required for every workflow, not only architectural feature work
- `checkpoint revise` cascades downstream (revising `implementation` invalidates `verification`/`code-review`) and is rejected outright on `DONE` work in favor of `reopen`
- Append-only verification evidence ledger (`evidence/verification.json` schema v2, `V-001`, `V-002`, ...) and `yallaflow verify list`; legacy single-record files remain readable, never rewritten by a read
- `yallaflow resume <work-id>` actually inspects the given work item, read-only, instead of silently falling back to the active one
- `doctor` lifecycle-integrity checks (stage/checkpoint contradictions, missing/failed/stale verification evidence, impossible `DONE` states)

### v0.3.4 — Work Decomposition, Review Gates & Agent Handoff

The same pilot's implementation phase, run as one giant architectural work item, was too large to review, verify progress on, or hand off between agent sessions:

- Durable work decomposition (`yallaflow decompose propose|validate|execute|status`): a `PLAN_READY` parent's Agent-proposed child breakdown, validated (structure, dependencies, no cycles) and persisted, never invented by YallaFlow itself; each child is a normal, fully-lifecycled YallaFlow work item
- Requirements/acceptance-criteria traceability reporting (referenced, cross-cutting, unassigned) and a dependency graph that gates child executability
- `yallaflow progress`/`yallaflow next` for project-level status and dependency-unblocked candidates, without YallaFlow ever picking one for the Agent
- Durable interaction modes (`autonomous` / **`adaptive`** (default) / `gated`) and review gates (`yallaflow approve` / `yallaflow feedback`) at `specification`/`plan`/`decomposition`/etc. boundaries — optional stops layered on top of, never replacing, the hard correctness gates
- `yallaflow handoff [work-id]`: a compact, read-only report letting a new agent/session continue from durable YallaFlow state, Git, and verification evidence — without the prior session's chat history
- `advance`/`verify` accept an optional explicit work item, so a decomposed child can be driven without becoming the workspace's single "active" focus

### v0.3.5 — Brownfield Baseline & Execution Resilience

Findings from multiple real human pilots (greenfield SRS/file-intake, full project decomposition and feature-by-feature execution, mid-feature and cross-provider agent handoff, reopen-after-DONE recovery, brownfield discovery with no existing docs, and brownfield feature implementation with durable-knowledge reuse):

- First-class Brownfield Baseline (`yallaflow baseline start|draft|status|show|approve|feedback`): a reviewed, evidence-backed (confirmed/inferred/unresolved) understanding of an existing repository, promoted into durable `PROJECT.md`/`context/*.md` only on approval — reusing the investigation work lifecycle and the existing review-gate ledger rather than a second system
- `<command> --help`/`-h` can no longer mutate workspace state under any namespace (previously `start --help` created a pending work item; `verify --help` could attempt to run `--help` as a command)
- `yallaflow request revise <work-id> --text TEXT --reason TEXT` — the supported, auditable correction path for a pending/unrouted work item's raw request
- `yallaflow init` also refuses to silently reinitialize over a `.yallaflow` that is Git-tracked (index or HEAD) but missing from the working tree
- Verification execution rewritten to argv-mode-by-default (`shell: false`, exact argv boundaries preserved), with explicit `--shell`/`--script` modes and fixed stdin inheritance; the evidence ledger gained additive execution-metadata fields
- `handoff`/`resume` surface a `PRIMARY UNRESOLVED OBJECTIVE` (reopen/revision/blocker) and are explicit that a child's `DONE` is not project completion
- Risk-aware routing/question guidance (financial, security/privacy, authorization, data-model, integration-contract, and irreversibility considerations) and no redundant re-confirmation once a review gate is already approved

### v0.3.6 — Living Project Memory & Context Integrity

Findings from the real YaSchools Brownfield pilot (baseline → reviewed durable context → fresh agent reuse → scoped investigation → knowledge promotion → bounded implementation → verification):

- One canonical, structured project-context ledger (`.yallaflow/context/index.yaml`, `CTX-####` facts) with state (`current`/`superseded`/`disputed`) separate from confidence, provenance, originating work, structured evidence (path + content hash + Git commit; never contents), and verification point; `PROJECT.md`/`context/*.md` become projections of current facts (one managed block per document, human content preserved)
- Knowledge evolution through the existing candidate flow: `knowledge propose --reconfirms|--supersedes|--disputes CTX-####` — the Agent declares the relationship, YallaFlow validates the transition; work history is never rewritten
- Mechanical Git/content-hash freshness (`FRESH`/`MAY_BE_STALE`/`STALE_EVIDENCE`/`UNKNOWN`) and change impact; read-only `yallaflow context status|list|show|history|affected`; `context render` for explicit projection repair
- Work-scoped discovery limitations (`yallaflow limitation add|list`, baseline `limitations`) that can never become project facts
- Brownfield Baseline approval feeds the ledger; v0.3.5 workspaces are never migrated on read, with an explicit `yallaflow context adopt [--dry-run]` upgrade
- Doctor context integrity (lineage, lifecycle, provenance, evidence metadata, projection drift, promoted limitations; freshness as warnings), and handoff/resume relevant-context summaries
- Sparse workspace: optional work artifact directories are created lazily; `execution/` reserved and no longer created; `attachments/` retired in favor of `sources/`
- One canonical work-creation path: direct `feature|bug|investigate|...` shortcuts require `--scope` and create routed, contract-pinned work (no new contract-less work)
- Pre-freeze integrity: every command-reachable state passes `doctor` (investigation DONE/verification consistency); atomic ledger writes with idempotent retry and `context render` recovery; versioned `AGENT.md` agent contract with `yallaflow agent status|refresh`; auditable recovered sources for DONE work
- Durable user-provided artifacts: material screenshots/files registered as immutable, linked `SRC-####` sources (checksum-verified by `doctor`, located by `handoff`/`resume`), or recorded as `uncaptured-artifact` limitations when inaccessible
- `guide`/`advance` report the current objective, blocker, and exact next valid action from one shared resolver; agent guidance prefers argv verification

Deliberately not in scope: automatic semantic refresh or LLM comparison in the CLI, automatic baseline refresh (a second approved baseline is still refused), team mode, and any graph/vector store.

### v0.3.7 — Context Reconciliation & Upgrade Intelligence

Finding from the clean YaSchools v0.3.5 → v0.3.6 upgrade: 53 legacy context sections, several describing the same durable truth from different work items — blind adoption would duplicate current facts.

- Reviewable legacy knowledge reconciliation (`yallaflow context reconcile start|status|show|plan|preview|approve|feedback|apply`): stable `RC-####` candidates, explicit Agent relationships (`new`, `merge-with`, `reconfirms`, `supersedes`, `disputes`, `skip`, `limitation`), hash-bound human review, read-only preview of the resulting memory, atomic idempotent apply, partial apply with unresolved pairs held as questions
- Backward-compatible multi-origin facts; legacy Markdown retired only when byte-for-byte generated (archived verbatim), hand-edited sections kept for review; `context adopt` limited to provably duplicate-free cases
- Read-only upgrade intelligence (`yallaflow upgrade status|plan`) and fresh-agent orientation (`yallaflow brief`)
- Explicit YallaFlow state ownership (CLI-owned vs projection vs shared `work.md` vs human) with deterministic doctor checks; Agent Contract v3; Skill Registry v4 (`context-reconciliation`)

Deliberately not in scope: semantic/fuzzy deduplication, embeddings or LLM calls in the CLI, an automatic "upgrade everything" command, locking, team mode.

### v0.3.8 — Delivery Convergence & Agent Continuity

Passing tests did not prove that the delivered implementation matched the approved intent, a new requirement source attached mid-implementation left the approved specification and plan standing, and a cold agent session still depended on the developer to point it at YallaFlow:

- Stable, Agent-proposed requirement and acceptance-criterion identity (`REQ-###`, `AC-###`, cross-work `PF-####/AC-###`) in `work/<id>/requirements.yaml`, with provenance to the request, specification sections, linked sources, and answered questions; required at the intent checkpoint of feature work and architectural changes (Skill Registry v5 pins `delivery-convergence` there, and nowhere else)
- Append-only convergence ledger: per-criterion `satisfied`/`partial`/`missing`/`contradicts` findings with reasons and evidence, unrequested behavior (`UR-###`) accepted or removed, derived staleness (reopen, revision, criterion change, impact, changed evidence) — never converted, never deleted
- Convergence as a DONE gate for delivery contracts only; SPEC_READY/PLAN_READY unchanged; reopen/revise/failing verification invalidate it through the existing cascade
- Deterministic change impact: a source attached or requirements changed after the intent is fixed raises a pending impact; the Agent assesses each completed stage; YallaFlow applies audited checkpoint revision (no second lifecycle engine, no deleted evidence)
- Ledger-backed decomposition traceability: child references resolve against the parent's requirements; children answer for their assigned criteria
- Compact delivery block in `guide`/`resume`/`handoff`/`brief`; doctor delivery integrity (errors for contradictions, warnings for evidence drift)
- First-party agent bootstrap for Codex (`AGENTS.md`) and Claude (`CLAUDE.md`), versioned and refreshable; Agent Contract v4

Deliberately not in scope: team mode, locking, remote sync, tracker/email intake, dashboards, semantic inference or LLM calls in the CLI, an execution engine, multi-agent orchestration, model-tier routing.

### v0.3.9 — Frictionless Project Onboarding & Context UX

Dogfooding on an APD-shaped repository showed that v0.3.8's `init` called it Greenfield. That repository has no root manifest, no Git, two nested Angular portals on different majors, Spring Boot backend modules, and design documents. Separately, a bare `.git` was enough to call an empty directory Brownfield. And a fresh session learned YallaFlow's bookkeeping before it learned the project:

- A bounded, deterministic, in-memory repository inventory (`src/inventory/`). It never follows symlinks, respects fixed depth and entry bounds and reports truncation, and is never persisted. It covers:
  - nested manifests with deterministic framework/version hints;
  - recognized source files;
  - documentation candidates in intake's own formats;
  - container/CI configuration.
- Brownfield classification from that inventory:
  - a manifest plus source, 10 or more source files, or meaningful container/CI configuration;
  - a bare `.git` or a manifest alone is Greenfield;
  - `--type` still overrides.
- `yallaflow inspect` — read-only, text only, works before `init`, and names one next action.
- Frictionless Brownfield onboarding through the existing baseline lifecycle, with no new workflow. `init`, `inspect`, `brief`, and `baseline` name every step up to human approval. Agent Contract v5 separates "do not change application code" (onboarding writes to `.yallaflow` allowed) from "read-only" (no writes).
- Material documentation guidance: register material documents as sources and read their extracted text, without the CLI ever reading documents itself.
- A project-first `brief`:
  - current-fact text per area, with fixed caps;
  - a mechanical NEEDS CARE list (unresolved, disputed, MAY_BE_STALE, STALE_EVIDENCE), which is not a risk register;
  - a hard 45-line cap.
- Freshness guidance: content-hash freshness without Git, and a contextual `context status` note only when there is no Git commit to compare against. Transient runtime state is never durable memory.
- Documented update procedure; no self-update.

Deliberately not in scope: `inspect --json`, persisted inventory, schema changes, ledger risk/importance fields, LLM calls, embeddings or search in the CLI, automatic baseline approval, self-update or network checks, team mode, v0.4 execution work.

## v0.4 — Execution
- Execution contracts
- Reviewed/native/multi-agent policies
- Model-tier routing
- Reviewer packages and durable rulings

## v1.0
- Stable plugin API
- Migration system
- Console / optional UI
- Evaluation harness and documented behavior guarantees

## Rename follow-up
- Define the supported migration path from `.projectflow/` to `.yallaflow/`.
- Decide whether and how to migrate persistent `PF-####` work IDs to a brand-neutral format such as `WORK-####`.
