# Changelog

All notable changes to YallaFlow are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

YallaFlow has not yet made a public npm release (`package.json` remains `"private": true`). Every version below is an **internal-only prerelease**, git-tagged for internal use and never published to the npm registry. See [`docs/releasing.md`](docs/releasing.md) for the versioning policy that will apply once a public release begins, and [`docs/roadmap.md`](docs/roadmap.md) for planned work.

## [Unreleased]

Nothing yet.

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
