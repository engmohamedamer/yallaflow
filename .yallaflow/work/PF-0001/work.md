# PF-0001 — v0.3.9 Frictionless Project Onboarding & Context UX

## Raw Request

v0.3.9 — Frictionless Project Onboarding & Context UX: bounded nested Brownfield detection and deterministic repository inventory, frictionless Brownfield baseline orchestration, material documentation discovery via existing sources, project-first brief, accurate freshness guidance, update-UX decision

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** New user-facing capability across init (project-kind detection), a new deterministic repository-inventory primitive, brief output, and the versioned Agent Contract; changes public CLI behavior and agent-facing contracts that pinned workspaces depend on, so it needs specification and planning review gates rather than bounded depth.
**Timestamp:** 2026-09-29T08:37:26.404Z
**Workflow:** feature
**Required capabilities:** discover, clarify, brainstorm, specify, plan, implement, verify, converge, review
**Behavior contract:** registry v5
**Skills:** context-discovery, requirement-clarification, design-exploration, specification, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

- Baseline: HEAD 6727412 = v0.3.8-internal.1 (tag on HEAD, pushed); package/CLI 0.3.8-internal.1; 563/563 tests pass.
- `detectProjectKind` (src/core/workspace.js) checks root markers only, and a bare `.git` alone classifies a project as brownfield.
- `deterministicDiscovery` (src/core/discovery.js) reads root manifests only; nested applications (APD: `app/frontend-beneficiary`, `app/frontend-corporate`, `app/backend/*` with no root manifest and no Git) are invisible, which is the observed APD "greenfield detection gap".
- `brief` prints YallaFlow status first and never proposes a baseline for a brownfield workspace without project memory.
- Agent Contract v4's baseline sequence does not authorize the Agent to run the onboarding steps on its own, does not ask for material-document discovery, and does not separate durable facts from transient runtime state.
- Freshness (src/context/freshness.js) already uses content hashes and works without Git, but no guidance says so.
- Intake (src/intake/constants.js) already owns the supported document formats (native text, office, PDF, image tiers).

## Open Questions

Structured material questions are authoritative in `questions.yaml`.

None open: every material design question was answered by the user on 2026-09-29 (see Confirmed Decisions).

## Confirmed Decisions

User-approved on 2026-09-29 (design review):

1. Public command name: `yallaflow inspect`.
2. A bare `.git` directory is not sufficient to classify a project as Brownfield; a newly initialized empty Git repository remains Greenfield.
3. The Brownfield threshold stays at 10 recognized source files, as a named deterministic constant with 9-vs-10 boundary tests. Tune it later from dogfood evidence.
4. No risk/importance designation in the context ledger; no schema bump. NEEDS CARE means only mechanically identifiable conditions: unresolved, disputed, MAY_BE_STALE, STALE_EVIDENCE. It never implies that it contains every project risk; the Agent interprets confirmed/fresh facts (security, architecture, debt).
5. Agent Contract v4 → v5.
6. Skill Registry stays v5; no informational skill-version metadata without runtime compatibility semantics. Stop and report before changing it.
7. Commit YallaFlow's own `.yallaflow` workspace with this release (not gitignored) after verifying doctor passes, no secrets, no machine-specific absolute paths, no unsafe/local-only artifacts, no transient runtime state.

Refinements:

- A. NEEDS CARE is not a general "risk" section: it is knowledge whose state/freshness is mechanically known to need care.
- B. Inventory reuses package-owned intake/document-format constants (PDF, DOCX, XLSX, PPTX, other office, text document formats) instead of an independent list; inspect never ingests or reads documents.
- C. Deterministic framework/version hints for known manifests — at minimum `@angular/core`, `react`, `vue`, `next`, `@nestjs/core`, Laravel, Spring Boot — reported only when deterministically available. APD-shaped fixtures report both nested Angular apps with distinct majors. No semantic labels (e.g. "microservice").
- D. Agent Contract v5 distinguishes "do not change application code" (Brownfield onboarding may run baseline start, source registration, checkpoint completion, baseline draft) from "completely read-only / no writes" (no `.yallaflow` mutation either). Human baseline approval remains mandatory.

Specification review (2026-09-29, changes requested, then revised):

- **Risk 1 → alternative (b), refined.** A recognized manifest alone does not make a project Brownfield. Brownfield = (a recognized manifest and at least 1 recognized source file), or at least 10 recognized source files, or meaningful container/CI configuration. Otherwise Greenfield. A bare `.git` stays Greenfield, an `npm init`-only `package.json` stays Greenfield, and `--type` remains the explicit override. This is an intentional correction of v0.3.8 behaviour.
- **Addition 1 struck.** No `inspect --json`; text output only. The inventory stays a clean internal structure.
- **Addition 2 struck.** Framework hints are exactly `@angular/core`, `react`, `vue`, `next`, `@nestjs/core`, `laravel/framework`, and Spring Boot, plus the v0.3.8 carry-overs `vite` and `yiisoft/yii2`. No Nuxt, Svelte, Express, or Symfony.
- **Addition 3 kept.** The wider manifest list is used for inventory; manifests still need corroborating source files to classify.
- **Addition 4 kept.** Preserve-only formats (`.odg`, `.epub`) may be candidates, labelled "preserve-only, no text extraction".
- **Addition 5 kept.** Nested hints go into `tech-stack.md` on a new Brownfield init, labelled as an init-time deterministic bootstrap snapshot, not approved project memory. Existing workspaces are never rewritten on read.
- **Addition 6 revised.** The brief shows fact text per area, in a fixed area order with per-area bounds, ordered by fact ID, under a hard overall cap.
- **Addition 7 kept, contextual.** The non-Git freshness explanation is shown only when the workspace is not Git-backed.

Final review decisions (2026-09-29, specification and plan approved):

- **Meaningful container/CI.** A recognized file with at least one non-whitespace line that is not an obvious full-line comment (starting with `#` or `//`). No semantic parsing. The recognized set explicitly includes `.circleci/config.yml`.
- **`[needs care]` marker kept.** It may appear on a normal area entry while the fact also appears in the bounded NEEDS CARE section. This is mechanical state/freshness, not risk classification.
- **Summary cap.** About 160 Unicode code points (not bytes). Embedded whitespace and newlines are normalized to single spaces for one-line output. Short summaries are not modified, and an ellipsis is added only when truncation occurs.

Pre-freeze refinements (2026-09-29, approved by the user; recorded as a ruling in progress.yaml):

- **`INVENTORY_MAX_DEPTH` = 16** is the final v0.3.9 value, replacing the originally reviewed 6. The walk stays deterministically bounded by depth and by `INVENTORY_MAX_ENTRIES` (50,000), and truncation is reported. Depth 6 is too shallow for real Brownfield layouts with deep Java/package trees. No schema or architecture change results from this.
- **Container/CI hint consistency.** The init-time `tech-stack.md` "Repository hints" come from the same inventory used for classification: meaningful `Dockerfile`/`Dockerfile.*`/`*.Dockerfile`, Docker Compose, and recognized CI files, each named with its path(s). There is no semantic interpretation and no new persistence.

Release constraints: package `0.3.9-internal.1`; existing workspace schemas unchanged; v0.3.8 workspaces read with zero bytes mutated; no silent AGENT.md/bootstrap rewrite; no commit/tag/push/publish without approval.

## Discovery

See the context-discovery checkpoint summary and Known Facts. Reusable primitives: evidence hashing and freshness (src/context/), sources/intake (src/intake/, src/core/sources.js), baseline store (src/baseline/), context summary/ledger, workspace assessment (src/core/assessment.js).

## Architecture / Technical Decisions

- **Confirmed** — one new primitive: a bounded, deterministic, in-memory repository inventory (`src/inventory/`). It is never persisted.
- **Confirmed** — one new public command, `yallaflow inspect` (text output only; no `--json` in v0.3.9), is read-only and works with or without a workspace.
- **Confirmed** — no new workflow: Brownfield onboarding reuses `baseline start|draft|approve`, `intake add`, and `checkpoint`.
- **Confirmed** — no LLM calls, embeddings, search, or vector DB; no schema changes; no automatic baseline approval; no team/multi-user changes; no v0.4 execution work; no self-update network mechanism.
- **Confirmed** — Agent Contract v5; Skill Registry v5 unchanged (the repository-baseline skill text is refined; skill text is package-owned and retrieved live, as in earlier releases).
- **Not applicable** — database, authorization, external integrations.

## Design

Approved by the user on 2026-09-29, with decisions 1–7 and refinements A–D applied.

**Outcome.** A developer (or Agent) in an existing repository gets from "nothing" to "a reviewed, evidence-backed baseline" without guessing what YallaFlow needs, and a fresh session learns the project before YallaFlow's own bookkeeping.

**M1 — Brownfield detection and repository inventory (`src/inventory/`).**
- `inventoryRepository(root)` walks the tree breadth-first with sorted entries (depth bound 16; see Pre-freeze refinements). It never follows symlinks and skips a named `IGNORED_DIRECTORIES` list (VCS, `.yallaflow`, dependency, build output, caches, IDE). It is bounded by `INVENTORY_MAX_DEPTH` and `INVENTORY_MAX_ENTRIES` and reports truncation instead of silently stopping. It returns an in-memory object only and never persists anything.
- It records the following:
  - Recognized manifests at any depth within the bounds.
  - Recognized source files, counted by extension (`SOURCE_CODE_EXTENSIONS`).
  - Documentation candidates, whose extensions come from intake's package-owned `DOCUMENT_FORMAT_EXTENSIONS` (office, PDF, and prose text formats, derived from `EXTENSION_FORMATS`).
  - Git presence, and repository hints (Docker Compose, CI).
- Framework hints are read from manifest bytes only, with a size cap. Unreadable or malformed manifests are reported, never thrown.
  - `package.json`: `@angular/core`, `react`, `vue`, `next`, `@nestjs/core`, `vite` (v0.3.8 carry-over).
  - `composer.json`: `laravel/framework`, `yiisoft/yii2` (v0.3.8 carry-over).
  - `pom.xml`: the `spring-boot-starter-parent` parent, a `spring-boot-dependencies` BOM, or `org.springframework.boot` artifacts.
  - `build.gradle(.kts)`: the `org.springframework.boot` plugin.
  - Each hint carries the declared version string, and a major version only when the declared range starts with a literal number (a `${property}` is resolved only from a literal `<properties>` entry in the same file).
  - No semantic labels ("microservice", "monolith").
- `classifyProject(inventory)` returns brownfield when any of these holds:
  - a recognized manifest exists **and** at least 1 recognized source file exists;
  - recognized source files ≥ `BROWNFIELD_SOURCE_FILE_THRESHOLD` (10);
  - meaningful container/CI configuration exists (defined below).

  Otherwise it returns greenfield. A manifest alone, including the wider inventory list (`requirements.txt`, Gradle, .NET, Flutter, Ruby, …), never classifies; `.git` never classifies. Reasons are returned with the result.
- **Meaningful container/CI configuration** is a recognized file with at least one non-whitespace line that is not a full-line comment (`#` or `//`), read size-capped, within the inventory bounds. The recognized files (`CONTAINER_CI_FILES`) are:
  - `Dockerfile` / `Dockerfile.*` / `*.Dockerfile`;
  - `docker-compose.yml|yaml`, `compose.yml|yaml`;
  - `.gitlab-ci.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`, `.circleci/config.yml`;
  - `.github/workflows/*.yml|yaml`.

  An empty or comment-only file is not meaningful.
- `detectProjectKind` delegates to it. `deterministicDiscovery` (init's `tech-stack.md`) keeps its root-level stack lines unchanged and adds nested manifests with their paths. The file's label says it is an init-time deterministic bootstrap snapshot, not approved project memory. It is written only by a new Brownfield `init` and never rewritten on read.

**M1 — `yallaflow inspect` (text output only).**
- Read-only. It uses the workspace root when one exists, otherwise the current directory.
- It prints the classification with reasons, Git presence, workspace state, scan bounds and truncation, manifests with framework hints, source-file counts, documentation candidates (bounded list with the total; each labelled with its intake handling, preserve-only formats marked "preserve-only, no text extraction"), container/CI configuration, and exactly one next action:
  - no workspace → `yallaflow init`
  - brownfield without project memory or baseline → `yallaflow baseline start`
  - baseline in progress → `yallaflow baseline status`
  - otherwise → `yallaflow brief`
- Output contains no timestamps or mtimes, so it is deterministic.

**M2 — Frictionless Brownfield baseline orchestration (no new workflow).**
- `init` on a brownfield project suggests `yallaflow inspect`, then `yallaflow baseline start`.
- `brief`'s primary concern for a brownfield workspace with no project memory and no active work is the baseline, then its next step (checkpoint/draft → human `baseline show` + `baseline approve`).
- `baseline start` and `baseline draft` output name the inventory, source-registration, and human-approval steps.
- Agent Contract v5 **Brownfield onboarding sequence**, following refinement D:
  - When the user asks to understand or orient to a brownfield project, the Agent may run `inspect`, `baseline start`, `intake add` (material documents), the `repository-baseline` checkpoint, and `baseline draft` without further permission. These are authorized YallaFlow workspace writes.
  - "Do not change application code" forbids only application-code changes.
  - An explicit "read-only / do not write anything" request forbids `.yallaflow` writes too. The Agent then uses only read-only commands (`inspect`, `brief`, `status`, `context status`, `baseline status/show`).
  - The Agent never approves a baseline; a human runs `baseline approve`.

**M3 — Material documentation discovery / source use.**
- `inspect` lists documentation candidates but never reads them.
- The repository-baseline skill and Contract v5 direct the Agent to:
  - review the candidates and read the material ones;
  - register a material PDF/DOCX/XLSX/PPTX document with `yallaflow intake add <baseline-id> <path>` and read its extracted text with `yallaflow source show SRC-#### --content`, rather than guessing at binary content;
  - cite in-repo documents as repository evidence;
  - record documents it did not read as `not-inspected` limitations.
- A document's claim is evidence for what the document says. It is not proof that the code does it.

**M4 — Project-first brief.**
- `brief` leads with the project block, then work, then YallaFlow status.
- The project block has these parts, with fixed area order, stable fact-ID order within each area, no ranking, and no ledger field:
  - Project name and kind.
  - Per-area current-fact counts.
  - Current-fact summaries per area, with fixed caps:

    | Area | Facts shown |
    |---|---|
    | Project | up to 3 |
    | Tech Stack | up to 3 |
    | Architecture | up to 3 |
    | Database | up to 2 |
    | Integrations | up to 2 |
    | Environments | up to 2 |
    | Conventions | count + up to 1 sample |
    | Business Rules | count + up to 1 sample |

    Each area that has more facts shows "… +N more". A fact that also needs care carries a `[needs care]` marker. Each summary is whitespace-normalized to one line and, only when longer than 160 Unicode code points, truncated with "…".
  - **NEEDS CARE**: a de-duplicated list of non-superseded facts that are unresolved, disputed, MAY_BE_STALE, or STALE_EVIDENCE, capped at 5 with a "… N more" pointer to `context status`. It is labelled as mechanical state/freshness, not a risk register. UNKNOWN (no verification point) is counted separately, not as needing care.
  - No memory + brownfield → the inventory headline and the baseline suggestion.
- Hard overall cap: the brief never exceeds 45 lines. It stays strictly read-only.

**M5 — Context/freshness guidance hardening.**
- Contract v5, the repository-baseline skill, and `context status` state the following:
  - Repository-evidence freshness compares content hashes and needs no Git; Git commits are an optional fallback.
  - MAY_BE_STALE ≠ false, and UNKNOWN ≠ stale.
  - `context status` adds a contextual note **only when the workspace is not Git-backed**:
    - repository file evidence still uses SHA-256 content hashes;
    - a changed file can still become MAY_BE_STALE;
    - a missing file can become STALE_EVIDENCE;
    - directory evidence without Git has no verification point and is UNKNOWN, which is not stale.

    In a Git-backed workspace the output is unchanged.
  - Transient runtime state (running containers, open ports, current branch, process lists, tokens, machine-specific absolute paths) is never a durable fact. The durable configuration that declares it may be, and a transient observation belongs in work notes or limitations.

**M6 — Update UX.**
- Documentation only: `docs/upgrading-to-v0.3.9.md` and an installation "Updating YallaFlow" section (install the target tag, `yallaflow --version`, `upgrade status|plan`, explicit `agent refresh`, `doctor`).
- No self-update or network check.

**Rejected alternatives.**
- Persisting the inventory: it would duplicate the repository and go stale.
- A ledger risk/importance field: it needs a schema bump and implies semantic judgment.
- Heuristic weighting instead of a fixed threshold.
- An `onboard` workflow: it duplicates the baseline lifecycle.
- Automatic document ingestion during inspect: it is unbounded and ingests without consent.

## Specification

### Goal and Scope

v0.3.9-internal.1, "Frictionless Project Onboarding & Context UX", covers M1–M6 as designed.

**Out of scope:**
- persisted inventory, and ledger/baseline/source/any other schema change;
- risk/importance designations;
- LLM calls, embeddings, search, or vector DBs;
- a new workflow or automatic baseline approval;
- team/multi-user features and v0.4 execution work;
- self-update or network version checks;
- Skill Registry changes.

### Actors and Permissions

- **Developer / human reviewer:** approves specification, plan, and baseline gates. Only a human runs `yallaflow baseline approve`.
- **Agent:** runs read-only commands freely. Under a "do not change application code" instruction it may perform the Brownfield onboarding YallaFlow writes (REQ-004). Under an explicit "read-only / no writes" instruction it performs no `.yallaflow` writes.
- **CLI:** deterministic only. It validates and records, and never interprets meaning.

### Functional Requirements and Business Rules

- **REQ-001 Repository inventory.** A bounded, deterministic, in-memory inventory of the project tree. It lists manifests (root and nested), recognized source-file counts by extension, documentation candidates, Git presence, and repository hints. It is never persisted.
- **REQ-002 Brownfield classification.**
  - A project is Brownfield when (a recognized manifest and ≥ 1 recognized source file), or recognized source files ≥ `BROWNFIELD_SOURCE_FILE_THRESHOLD` = 10, or meaningful container/CI configuration exists within the inventory bounds. Otherwise it is Greenfield.
  - A manifest alone never classifies, and neither does `.git`.
  - `init --type` still overrides the classification.
- **REQ-003 `yallaflow inspect`.** Public, read-only, text output only, and works without a workspace. It prints the inventory, the classification with reasons, and one next action. Deterministic framework/version hints cover exactly `@angular/core`, `react`, `vue`, `next`, `@nestjs/core`, `laravel/framework`, and Spring Boot, plus the v0.3.8 carry-overs `vite` and `yiisoft/yii2`.
- **REQ-004 Brownfield onboarding orchestration.**
  - `init`, `inspect`, and `brief` point a Brownfield workspace that lacks project memory to the existing baseline lifecycle, and report the next baseline step up to human approval.
  - Agent Contract v5 authorizes the onboarding YallaFlow writes under "do not change application code", forbids them under explicit read-only, and keeps human approval mandatory.
- **REQ-005 Material documentation.**
  - Documentation candidates are recognized through the intake-owned format constants and labelled with their intake handling; preserve-only formats are marked as having no text extraction.
  - The Agent is guided to register material documents as sources and read their extracted text.
  - Inspect never reads document contents.
- **REQ-006 Project-first brief.**
  - `brief` shows project knowledge before YallaFlow status: current-fact text per area in a fixed order with per-area bounds, ordered by fact ID, under a hard overall cap.
  - NEEDS CARE is exactly unresolved ∪ disputed ∪ MAY_BE_STALE ∪ STALE_EVIDENCE over non-superseded facts, described as mechanical state/freshness and never as a complete risk register.
- **REQ-007 Freshness and durability guidance.** Content-hash freshness without Git, UNKNOWN ≠ stale, MAY_BE_STALE ≠ false, and transient runtime state is not durable memory. Stated in Contract v5 and the repository-baseline skill; `context status` adds the explanation only when the workspace is not Git-backed.
- **REQ-008 Update UX documentation.** Documented update path with no network mechanism.
- **REQ-009 Versions and compatibility.**
  - Package 0.3.9-internal.1, Agent Contract v5, Skill Registry v5.
  - Workspace schemas unchanged.
  - Read commands on a v0.3.8 workspace mutate zero bytes.
  - AGENT.md and provider bootstrap blocks change only through explicit `agent refresh` / `agent setup`.
- **REQ-010 Durable dogfood workspace.** YallaFlow's own `.yallaflow` is committed (not gitignored) and is doctor-clean, without secrets, machine-specific absolute paths, local-only artifacts, or transient state.

### Workflows and Lifecycle

**Onboarding (Brownfield):**
1. `init` (auto-classified).
2. `inspect`.
3. `baseline start`.
4. Agent discovery, including documentation candidates, with `intake add <baseline-id> <doc>` for material documents.
5. `checkpoint <baseline-id> --skill repository-baseline --complete`.
6. `baseline draft --file`.
7. The human runs `baseline show` and then `baseline approve` (or `feedback --changes-requested`).

No new stages or workflow.

### Data and Integrations

- The inventory is an in-memory object only, never serialized to disk. Text output is sorted, with no timestamps or mtimes.
- No new files under `.yallaflow`. The existing sources, baseline, and ledger formats are unchanged.

### Validation and Error Behavior

- Unreadable directories are skipped and counted.
- Malformed or oversized manifests are reported as `unreadable` with a reason, never thrown.
- Bounds hit → `truncated: true`, with the bound named.
- `inspect` with extra positional arguments → a usage error. `inspect --help` is handled by the existing help strategy.
- Symlinks are not followed.

### Security and Privacy

- `inspect` reads only directory entries and manifest bytes (size-capped), and never follows symlinks.
- Output uses root-relative paths only, with no absolute machine paths.
- It performs no network access and never executes project code.

### UI / Screens

CLI text output only (`inspect`, `brief`, `init`, `baseline start|draft`, `context status`).

### Acceptance Criteria

- **AC-001:** Inventory traversal is deterministic (sorted), skips `IGNORED_DIRECTORIES`, never follows symlinks, enforces `INVENTORY_MAX_DEPTH` (16, approved pre-freeze refinement) / `INVENTORY_MAX_ENTRIES` (50,000), and reports truncation.
- **AC-002:** Inventory reports root and nested manifests, per-extension source counts, documentation candidates, Git presence, and repository hints, and persists nothing.
- **AC-003:** Framework hints report the declared version, and a major version only when deterministically parseable, for exactly `@angular/core`, `react`, `vue`, `next`, `@nestjs/core`, `laravel/framework`, and Spring Boot (Maven parent/BOM/artifacts, Gradle plugin), plus `vite` and `yiisoft/yii2`. No other framework hints and no semantic labels.
- **AC-004:** Documentation candidates derive from intake's package-owned format constants (including PDF, DOCX, XLSX, PPTX, and text document formats). Each is labelled with its intake handling, and preserve-only formats (e.g. `.odg`, `.epub`) are marked "preserve-only, no text extraction". Inspect never reads or ingests their contents.
- **AC-005:** Classification rules:
  - A bare `.git` (including an empty `git init` repo) → greenfield.
  - An `npm init`-only `package.json`, or any manifest with no recognized source file → greenfield.
  - Manifest + 1 recognized source file → brownfield.
  - 9 recognized source files and nothing else → greenfield; 10 → brownfield.
  - Meaningful container/CI configuration → brownfield; an empty or comment-only one → no effect.
  - The threshold is the named constant `BROWNFIELD_SOURCE_FILE_THRESHOLD`.
- **AC-006:** `init` uses the new classification (explicit `--type` wins). An APD-shaped tree with only nested applications is initialized as brownfield, and its `tech-stack.md` lists the nested hints under a label stating it is an init-time deterministic bootstrap snapshot, not approved project memory. Existing workspaces are never rewritten on read.
- **AC-007:** `yallaflow inspect` works with and without a workspace, prints text only (no `--json`), names one next action, and writes zero bytes.
- **AC-008:** On an APD-shaped fixture, inspect reports both nested Angular applications with their distinct Angular majors, the Spring Boot backend manifests, and the documentation candidates.
- **AC-009:** A brownfield workspace without project memory is pointed to `baseline start` by `init`, `inspect`, and `brief`. An in-progress baseline reports its next step through to human approval. No command approves a baseline automatically.
- **AC-010:** Agent Contract v5 distinguishes "do not change application code" (onboarding may run baseline start, intake add, the checkpoint, and baseline draft) from explicit read-only (no `.yallaflow` writes), and requires human baseline approval.
- **AC-011:** The repository-baseline skill and Contract v5 direct the Agent to:
  - review documentation candidates;
  - register material documents with `intake add` and read them via `source show --content`;
  - cite in-repo documents as repository evidence;
  - record documents it did not read as limitations.
- **AC-012:** `brief` leads with a project block before work and YallaFlow status. It shows current-fact text per area in fixed order with fixed per-area caps (Project 3, Tech Stack 3, Architecture 3, Database 2, Integrations 2, Environments 2, Conventions and Business Rules a count plus 1 sample each), NEEDS CARE up to 5, and fact-ID order. It never exceeds 45 lines and remains read-only.
- **AC-013:** NEEDS CARE lists exactly the non-superseded unresolved, disputed, MAY_BE_STALE, and STALE_EVIDENCE facts, labels them as mechanical state/freshness rather than a complete risk list, and adds no ledger field or schema change.
- **AC-014:** Contract v5 and the repository-baseline skill state that content-hash freshness works without Git, that UNKNOWN ≠ stale and MAY_BE_STALE ≠ false, and that transient runtime state is not durable project memory. In a non-Git workspace only, `context status` explains that file evidence uses SHA-256 hashes, changed files can become MAY_BE_STALE, missing files STALE_EVIDENCE, and directory evidence is UNKNOWN (not stale). Git-backed output is unchanged.
- **AC-015:** The documentation describes updating YallaFlow (target tag install, version check, `upgrade status|plan`, explicit `agent refresh`, `doctor`) with no self-update or network mechanism.
- **AC-016:** Versions and compatibility:
  - Package 0.3.9-internal.1, Agent Contract v5, Skill Registry v5.
  - Every workspace schema is unchanged.
  - Read commands on a v0.3.8 workspace mutate zero bytes.
  - A v4 AGENT.md is reported as outdated and never rewritten without `agent refresh`.
- **AC-017:** YallaFlow's own `.yallaflow` passes doctor, contains no secrets, absolute machine paths, local-only artifacts, or transient runtime state, and is not gitignored.

### Unresolved Items

None. Threshold tuning is deferred to dogfood evidence by decision 3.

## Implementation Plan

Ordered, each step independently testable. `npm run check` is run after each milestone.

1. **Shared document formats (B).** In `src/intake/constants.js`:
   - export `DOCUMENT_FORMAT_EXTENSIONS`, derived from `EXTENSION_FORMATS` (office and PDF tiers, including preserve-only office);
   - export `TEXT_DOCUMENT_EXTENSIONS` (`.md`, `.markdown`, `.rst`, `.txt`), defined next to the native-text table.

   No intake behavior change.
2. **Inventory primitive (M1).** In `src/inventory/`:
   - `constants.js`: `BROWNFIELD_SOURCE_FILE_THRESHOLD = 10`, `INVENTORY_MAX_DEPTH`, `INVENTORY_MAX_ENTRIES`, `IGNORED_DIRECTORIES`, `SOURCE_CODE_EXTENSIONS`, `MANIFEST_FILES`, `MAX_MANIFEST_BYTES`, `DOCUMENT_CANDIDATE_LIMIT`.
   - `frameworks.js`: pure manifest parsers for `package.json`, `composer.json`, `pom.xml`, and Gradle (the approved hint list only), plus `majorOf(declared)`.
   - `CONTAINER_CI_FILES` and the meaningful-content check (non-whitespace line not starting with `#` or `//`, size-capped).
   - `inventory.js`: `inventoryRepository(root)` (sorted BFS, lstat, no symlinks, bounds, truncation) and `classifyProject(inventory)`.
3. **Classification wiring (M1).**
   - `detectProjectKind` delegates to `classifyProject(await inventoryRepository(root))`.
   - `deterministicDiscovery` reuses the inventory's framework hints: root lines stay unchanged and nested manifests gain a path suffix.
   - `init` prints the inspect → baseline next steps for brownfield.
4. **`yallaflow inspect` (M1/M2).**
   - `src/commands/inspect.js` handles text output only.
   - The CLI dispatch, help, `COMMAND_USAGE`, and help-safety tables are updated.
   - The next action comes from workspace state (`findProjectRoot`, `listWork`/`findBaselineWork`, `loadContextLedger` existence), read-only.
5. **Brief and baseline orchestration (M2/M4).**
   - `src/context/summary.js`: shared `needsCare(summary)` (unresolved ∪ disputed ∪ MAY_BE_STALE ∪ STALE_EVIDENCE, de-duplicated, flags per fact).
   - `brief` is restructured project-first (Project → Work → YallaFlow).
   - `primaryConcern` gains the Brownfield baseline branch (no memory → `baseline start`, and baseline in progress → its next step up to human approval).
   - `baseline start`/`draft` output names inventory, source registration, and human approval.
6. **Guidance (M2/M3/M5).**
   - Agent Contract v5 body: the Brownfield onboarding sequence (authorization distinction D), material documentation, NEEDS CARE semantics, hash freshness without Git, and transient runtime state. Bump `AGENT_CONTRACT_VERSION` to 5 with a changelog comment.
   - `resources/skills/repository-baseline.md`: inventory, documents, durable vs transient, and freshness.
   - `context status`: the non-Git freshness note, shown only when the workspace is not Git-backed.
   - Skill Registry untouched.
7. **Versions/docs (M6).**
   - Package `0.3.9-internal.1` (`package.json`, lockfile, `src/version.js` if it holds it).
   - CHANGELOG, `docs/cli.md`, `docs/upgrading-to-v0.3.9.md`, installation "Updating YallaFlow", `docs/acceptance-scenarios.md`, `docs/limitations.md`, roadmap.
8. **Tests.** New `test/inventory.test.js` and `test/inspect.test.js`, plus brief/onboarding and v0.3.8 zero-byte compatibility tests. Existing tests are adjusted only where output was intentionally redesigned (brief layout, contract version). APD-shaped fixture in `test-support/apd-fixture.js`.
9. **Verification.**
   - Full suite and syntax check.
   - APD-shaped dogfood: init, inspect, baseline start, intake add, checkpoint, draft, then stop at human approval.
   - Fresh-session/context-reuse scenarios.
   - Read-only inspect of the real APD tree, with before/after hash equality.
   - Doctor, `git diff --check`, `npm pack --dry-run`, secret/path scans, and compatibility checks.
   - Explicit `agent refresh` of this repo's AGENT.md (v4 → v5), and durable-workspace checks on `.yallaflow`.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

Knowledge review decision (2026-09-29): **no candidates promoted** (`yallaflow knowledge review PF-0001 --none`).

- **Dogfood findings are transient observations, not project facts.** These are execution evidence for this work item: the APD-shaped fixture results; the real APD counts (28 manifests, 1,530 source files, 57-fact brief at 37 lines); the tree-hash equalities; the strace directory listing; the v0.3.8 compatibility hashes. They stay in the verification ledger and this work record.
- **The durable outcomes are already in authoritative, versioned repository artifacts:**
  - the classification rule and bounds: `src/inventory/constants.js`, `src/inventory/inventory.js`;
  - the approved `INVENTORY_MAX_DEPTH` = 16 refinement: the ruling in `progress.yaml`, `docs/acceptance-scenarios.md`, `CHANGELOG.md`;
  - the Agent Contract v5 semantics: `src/agent/contract.js`;
  - the known boundaries: `docs/limitations.md`.

  Restating them as CTX facts would duplicate repository truth.
- **YallaFlow's own project memory is still empty (no ledger).** It should start from a reviewed Brownfield baseline of this repository, not from a few isolated promotions that `brief` would then present as the whole project. That baseline is a future work item, deliberately not done inside this release.

Knowledge review after the portability reopen (2026-09-29): again **no candidates promoted** (`knowledge review PF-0001 --none`). What the fresh-clone check found is now recorded where it lives:
- the product behavior: absent lazy directories are valid (`src/core/workspace.js` `LAZY_WORKSPACE_DIRS`, `src/commands/doctor.js`, `test/workspace-portability.test.js`, CHANGELOG);
- this repository's rule to commit verification logs (`.gitignore` `!.yallaflow/**/*.log`).

The clone observations themselves are test evidence (V-004), not project facts.

## Result

v0.3.9-internal.1 delivered, as specified and approved, including the pre-freeze refinements and the fresh-clone portability fix:
- **Verification:** V-004 (602/602) passed.
- **Convergence:** CV-004 has 17/17 criteria satisfied.
- **Review:** independent review findings are fixed.
- **Real APD 57-fact acceptance** (read-only, zero bytes changed):
  - the brief is 37 physical lines;
  - project facts appear before YallaFlow metadata;
  - NEEDS CARE holds only CTX-0020 (unresolved);
  - every overflow is marked;
  - no directory outside `.yallaflow` was listed.

