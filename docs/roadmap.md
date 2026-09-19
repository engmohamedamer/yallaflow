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

### Still planned (not yet implemented)

- **Tracker intake** — Azure DevOps, Jira, and GitHub Issues as requirement sources, with attachments and source traceability back to the originating ticket
- **Codex adapter** and **Claude adapter** — first-party agent adapters/plugins building on `resources/agents/codex/` and `resources/agents/claude/`
- **Agent bootstrap/session guidance** — a deterministic session-start sequence so a cold agent session reliably loads `.yallaflow/AGENT.md` and calls `yallaflow resume` before acting
- Git worktree safety and baseline verification for multi-source/multi-agent execution
- Future semantic deduplication and optional assisted knowledge extraction (still explicitly agent-proposed, not inferred by YallaFlow)
- `yallaflow intake add PF-0001 <file>` — attaching an additional source to an existing work item (the schema already supports a work item referencing more than one source; only the CLI verb is missing)

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
