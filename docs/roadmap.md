# Roadmap

YallaFlow applies Adaptive Spec-Driven Development: workflow depth follows the kind and scope of work instead of forcing every request through one specification template.

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
- **Codex adapter** and **Claude adapter** — first-party agent adapters/plugins building on `resources/agents/codex/` and `resources/agents/claude/`
- **Agent bootstrap/session guidance** — a deterministic session-start sequence so a cold agent session reliably loads `.yallaflow/AGENT.md` and calls `yallaflow resume` before acting
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
