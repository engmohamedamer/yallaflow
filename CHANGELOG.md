# Changelog

All notable changes to YallaFlow are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

YallaFlow has not yet made a public npm release (`package.json` remains `"private": true`). Every version below is an **internal-only prerelease**, git-tagged for internal use and never published to the npm registry. See [`docs/releasing.md`](docs/releasing.md) for the versioning policy that will apply once a public release begins, and [`docs/roadmap.md`](docs/roadmap.md) for planned work.

## [Unreleased]

Nothing yet.

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
