# Current Limitations (1.1)

Known gaps and deliberate boundaries. Planned work is tracked in [`roadmap.md`](roadmap.md).

## Scope and distribution

- **Node.js CLI.** Requires Node.js ≥ 20.16.0 on the developer's machine and in CI (not in your application). Install from npm (`npm install -g yallaflow`).
- **Local-first; teams share through Git.** A single-user workspace is the default. A Shared Project ([`shared-projects.md`](shared-projects.md)) shares project memory through ordinary Git; there is no server, locking, real-time visibility, accounts, or permissions.
- **Platform coverage.** The regression suite runs in POSIX environments (developed and released on Linux); Windows has not been verified.
- **Agent compliance is guidance.** YallaFlow governs through its Agent Contract and deterministic CLI gates; it cannot stop an agent or person from editing files directly (see [`security.md`](security.md#what-yallaflow-does-not-enforce)). First-party agent setup covers Claude Code and Codex; other agents can follow `.yallaflow/AGENT.md` when pointed to it.

## Setup

- **`init` always writes both agent pointers.** It adds the managed block to `CLAUDE.md` and `AGENTS.md`, even if your team uses only one agent. The blocks are small and inert for other tools; there is no opt-out flag yet, so delete the unused file if you do not want it (`agent setup` re-creates it).

## Shared Projects

- **The first-use gate uses the recorded project kind.** A repository recorded Greenfield (e.g. misclassified by v0.3.8 `init`) is not gated, even if it later grows Brownfield-sized; `inspect` reports such a mismatch. There is no audited waiver: an urgent change to an un-understood Brownfield project needs an approved baseline first.
- **The pre-baseline gate blocks work creation, not conversation.** Until a Brownfield baseline is approved, `start`, the direct work commands, file `intake`, and `route` refuse normal engineering work. Whether a request is transient operational help (start a dev server, show logs, `git status`) or project-semantic engineering work is the Agent's interpretation; YallaFlow only enforces the boundary when work is created. A pending or routed work item an earlier release created before the baseline stays readable; it cannot be routed or enter an application-writing stage until the baseline is approved.
- **The original request is carried as the baseline objective.** It is shown again after approval (by `baseline approve` and `brief`, until a later work item exists); YallaFlow does not create the continued work item itself — the Agent starts it.
- **Secret redaction is pattern-based.** It recognizes secret-named assignments, Authorization/Bearer/Basic values, cookies, private keys, URL credentials, and well-known token formats. A secret with no recognizable name or format is not detected, and a few ordinary values in secret positions (for example `password: hunter2` in an example) are redacted too. The preserved original of a captured source is never altered; `intake` warns when it appears to contain secrets. State written by earlier releases is not rewritten until YallaFlow next writes that file — and then only its recognizable secret values change. Consequences in that rare case (an earlier record that held a secret): a v0.3.5 legacy context section containing one is kept for manual review instead of being retired automatically; in a Shared Project, the first internal.4 write of such a fact changes its fingerprint, so it can be reported as changed in parallel once; an internal.3 `doctor` reading an internal.4-rendered projection of such a fact reports projection drift. The `work.md` Routing Decision check and reconciliation approval fingerprints are redaction-invariant.
- **Coverage is declared, not measured.** `baseline show` reports what the Agent declared it inspected and sampled, the recorded limitations, unresolved facts, and the repository paths its evidence cites; YallaFlow does not observe which files the Agent actually read.
- **Working-tree provenance is Git-dependent and informational.** `head`/`modified`/`untracked` is recorded only in a Git work tree with a commit; content hashes alone decide freshness.
- **Pre-v6 skill-text drift is not recoverable.** Registry v1–v5 now resolve the v0.3.9 instruction bytes. Work created by v0.3.8 under v5 originally read an earlier `repository-baseline` text that v0.3.9 had replaced in place; the pin cannot tell which, so such work now gets the v0.3.9 text.

- **Git is the transport, not a live server.** `shared status` sees only work present in the current checkout; unfetched or unmerged branches are invisible.
- **Integration is a deliberate step on the integration branch.** Merged knowledge waits as staged deltas until someone runs `yallaflow shared integrate` on an up-to-date checkout of the integration branch and commits the result. With a protected integration branch, that commit goes through a short PR.
- **A v0.3.9 CLI predates the version check.** It cannot refuse a Shared Project on its own. Its `doctor` fails on config schema v2, and `shared check` in CI flags the sequential IDs or ungoverned ledger writes it may produce. Upgrade every teammate together.
- **Checkout-tag collisions are negligible, not impossible.** Each checkout draws a 10-character Crockford-base32 tag from `crypto.randomBytes` (50 bits): about 1 in 10^15 per pair, roughly a 1-in-a-billion chance even across 50,000 checkouts. A collision would surface as a Git merge conflict on that work's files, never as a silent merge. Copying a checkout regenerates the tag, but restoring an identical copy of `local/` into the same path does not.
- **Semantic duplicates are not detected.** Only exact statements in the same area merge mechanically. Judging that two differently worded facts are the same is the agent's job.
- **`external` source storage is a declared policy only.** Sources stay in Git; Git LFS is your choice; no storage service is built.
- **Single-user knowledge proposed before sharing** must be re-proposed to relate to an existing fact after sharing (no fingerprint was recorded).

## Intake

- **Tracker import is read-only and per ticket.** GitHub Issues, Jira, and Azure DevOps tickets import one at a time ([guide](connected-requirements-and-quality.md#connected-requirements)); there is no sync, webhook, query/bulk import, or writeback (comments, status). Email and chat adapters do not exist. Acceptance criteria are taken mechanically from a dedicated field or an "Acceptance Criteria" section (heading, bold, or plain label line); anything else is left in the description for the agent to read. Jira wiki markup (REST v2) is kept as written, not converted.
- **Live tracker calls are verified against recorded payloads and a local test server**, not against the hosted services in the release suite. GitHub Enterprise and Azure DevOps Server need their base URL in config.
- **`--fetch` attachments on GitHub** are downloaded without credentials (they are hosted outside the API origin), so attachments of private repositories may not download; they are listed as not downloaded.
- **No OCR or vision.** Images and scanned PDFs are preserved as sources, but no text is extracted.
- **PDF reading order** follows the content stream and may differ from visual order, notably for right-to-left scripts. `.odg`/`.epub` text extraction is not implemented.

## Workflow

- **YallaFlow does not run your agent.** It governs state; reasoning, code edits, and classification are the agent's. Write authorization is guidance the agent must follow.
- **Direct commands require `--scope`.** YallaFlow never guesses scope; use `yallaflow start` to let the agent classify.
- **Investigations cannot be reopened.** New proof after an investigation is DONE belongs in a new work item.
- **No execution engine yet.** Execution contracts and reviewed/multi-agent execution policies are future work.

## Onboarding and inventory

- **Classification is a deterministic heuristic.** Brownfield means a recognized manifest plus at least one recognized source file, at least 10 recognized source files (`BROWNFIELD_SOURCE_FILE_THRESHOLD`), or meaningful container/CI configuration. The threshold was chosen, not measured, and will be tuned from dogfood evidence. Example or generated code outside the ignored directories counts, and sources in an unrecognized language do not. `init --type` overrides.
- **Bounded, so possibly partial.** The inventory never follows symlinks and skips a fixed set of dependency, build, cache, and IDE directories. It stops at depth 16 or 50,000 entries, and a truncated scan says so. It never reads `.gitignore`.
- **Framework hints come from manifest declarations only.** The hinted frameworks are Angular, React, Vue, Next.js, NestJS, Vite, Laravel, Yii2, and Spring Boot.
  - The version shown is what the manifest declares; lockfiles and installed packages are not read.
  - A major version appears only when the declared version is a literal.
  - Maven `${property}` versions resolve only from a literal, project-level `<properties>` entry in the same file; parent POMs in other files are not followed. An unresolvable reference is shown as declared (for example `${project.parent.version}`), without a major version. A module that references Spring Boot with no version at all shows *version not declared in this manifest*.
  - Gradle `//` and `/* */` comments are ignored, but hints are otherwise pattern-matched, not parsed.
  - At most 40 nested hints are written into `tech-stack.md` (`TECH_STACK_HINT_LIMIT`), plus a "+N more" line.
  - No semantic labels such as "microservice" are inferred.
- **Documents are listed, never read.** `inspect` names documentation candidates in the formats intake supports. Reading them is the Agent's job, through `intake add` and `source show --content`.
- **The recorded project kind is never rewritten.** A workspace classified differently by an earlier version keeps its `config.yaml` kind; `inspect` and `brief` report the difference.
- **`tech-stack.md`'s nested hints are an init-time snapshot.** They are not refreshed and are not approved project memory.

## Project memory

- **No semantic judgment.** YallaFlow never detects duplicate or contradictory prose. The agent must declare `--reconfirms`, `--supersedes`, or `--disputes` — and, for legacy knowledge, an explicit reconciliation action per candidate. The only automatic comparison is exact textual identity (`exactDuplicateOf`), which is reported, never acted on.
- **Reconciliation is manual by design.** Every legacy candidate needs an Agent decision and a human review; a large v0.3.5 workspace takes real reviewing effort. Undecided candidates can wait, but their legacy sections stay until reconciled.
- **Reconciled legacy facts have `UNKNOWN` freshness.** Their original verification point is unknown; reconfirm them with fresh evidence through normal work.
- **Hand-edited legacy sections are never removed automatically.** After reconciliation they remain outside the managed block until a human removes them (`doctor` warns).
- **State ownership is not enforced by locks.** Agents are told not to edit CLI-owned files, and `doctor` detects what is deterministic (schemas, fingerprints, drift, checksums, the `work.md` Routing Decision); free-form edits to narrative text are not detectable, by design.
- **Freshness is mechanical and coarse.** Only repository evidence has a verification point; runtime and user-confirmed facts show `UNKNOWN`.
  - File evidence is compared by SHA-256 content hash, with or without Git.
  - Directory evidence needs a Git commit, and is `UNKNOWN` without one. With Git, any change under a cited directory marks the fact `MAY_BE_STALE`.
- **NEEDS CARE is not a risk register.** It lists only facts that are unresolved, disputed, `MAY_BE_STALE`, or `STALE_EVIDENCE`. A confirmed, fresh fact about a security or architectural risk is ordinary knowledge the Agent interprets; the ledger has no risk or importance field.
- **The brief is bounded.** It shows at most a few facts per area in fact-ID order, with no ranking, and truncates each summary to about 160 code points. `yallaflow context list` shows everything.
- **Limitation detection is exact-text only.** A limitation reworded as a fact is not caught.
- **No baseline refresh.** Only one approved baseline per workspace; living memory keeps it current.
- **Ledger and Markdown projection are not one transaction.** A rendering failure leaves canonical knowledge intact; `yallaflow context render` repairs the Markdown.
- **No knowledge graph, embeddings, or search.** The ledger is a small local file.

## Delivery convergence

- **Convergence is the Agent's judgment.** YallaFlow validates that every finding names a real, active criterion, carries a reason and evidence, and that `satisfied` rests on more than free text; it cannot tell whether the judgment is right. Review the assessment like any other engineering claim.
- **Applies to feature work and architectural changes only.** Bounded changes, bugs, refactors, releases, investigations, and work routed before v0.3.8 have no requirement identity, convergence, or impact gate — by design.
- **Staleness is mechanical.** A repository file cited as evidence that changes (any byte) makes the finding stale, even when the change is unrelated to the criterion; directory evidence uses Git diff. Runtime, user, and reference evidence cannot go stale mechanically.
- **Impact is raised for two events only:** a source attached, or requirements changed, after the intent checkpoint was completed. A change of intent communicated only in conversation is invisible to YallaFlow until the Agent records it.
- **One pending impact at a time.** Further triggers join it; it is assessed as a whole.
- **Decomposed children do not receive their parent's impacts.** A parent revising a criterion a child answers for makes the child's finding stale (reported, and DONE is blocked for a child not yet DONE); the parent owns the impact assessment.
- **No human review gate for convergence.** Convergence is a hard correctness gate; there is no optional `approve --stage convergence` in this release.

## Optional quality (AI QC and Smart Demo)

- **YallaFlow does not drive the browser.** The agent runs Playwright (CLI or MCP) and records what it did; YallaFlow validates the honesty rules and hashes the artifacts but cannot observe the run itself. Agent-driven results are labelled `agent-driven`; only a `yallaflow-verified` scenario rests on a command YallaFlow executed.
- **No Playwright bundled.** QC and demos need Playwright available to the agent (`playwright-cli`, Playwright MCP, or the project's `@playwright/test`). Video recording needs Playwright's ffmpeg (`npx playwright install ffmpeg`); without it, a recorder can report a video it never wrote — `demo record` refuses a missing file.
- **Media and reports are local by default.** A fresh clone has `qc.json`/`demo.json` (results, approvals, hashes) but neither the media nor the reports. `qc status` and `demo status` say how many recorded files are present on that machine. Reports are written again on the next QC or demo record. Commit media only by setting `quality.media.commit: true` (consider Git LFS for videos).
- **Strict QC approval is a signal, not a lock.** It never blocks `finish` or DONE; enforce it in your own review or release process if you need a hard gate.
- **Recording on two branches of one work item.** Evidence is never overwritten: every record writes its own new media folder. In a Shared Project, record IDs are branch-safe (`QC-<tag>-0001`). In a single-user project, two branches can both create `QC-001`. Merging them conflicts in `qc.json`/`demo.json`; resolve it by keeping both entries. `doctor` then warns about the duplicate ID, and citing it is refused until the scenario is recorded again.
- **Exploratory coverage is what was explored.** QC records the scenarios that ran; it does not measure coverage.

## Agent bootstrap

- **Two providers.** `agent setup` supports Codex (`AGENTS.md`) and Claude (`CLAUDE.md`). Other agents can follow `.yallaflow/AGENT.md` directly.
- **Instruction files only.** No hooks, plugins, or settings files are written; whether a session actually reads the bootstrap file is up to the agent product.
- **Mixed versions (1.1.0).** A 1.0.x CLI reads a workspace that used tickets, QC, and demos (status, guide, doctor, convergence; tested against the real v1.0.1), but has no `qc`/`demo`/`intake ticket` commands and does not know registry v9's on-demand skills or Agent Contract v10 (reported as newer, never downgraded).
- **Mixed versions (older).** A v0.3.7 CLI does not know the delivery gate and can complete v0.3.8-routed feature work without convergence (v0.3.8's `doctor` then reports it). Upgrade everyone together.

## Upgrades

- **`AGENT.md` refresh is manual.** Existing workspaces keep their old agent guidance until `yallaflow agent refresh` is run (`yallaflow upgrade status` reports it). The same holds for provider bootstrap blocks.
- **No automatic upgrade.** `upgrade status|plan` only report; each step is a deliberate command. There is no self-update or network version check ([installation.md](installation.md#updating-yallaflow)).
- **No downgrades or mixed versions** once a newer version has written to a workspace ([upgrading-to-v0.3.9.md](upgrading-to-v0.3.9.md#mixed-versions-and-downgrades), [upgrading-to-v0.3.8.md](upgrading-to-v0.3.8.md#mixed-versions-and-downgrades), [upgrading-to-v0.3.7.md](upgrading-to-v0.3.7.md#mixed-versions-and-downgrades)).
- **Clone portability depends on your `.gitignore`.** Absent lazy directories are healthy, but a repository-wide `*.log` ignore rule drops verification logs unless you add `!.yallaflow/**/*.log`.
- **Legacy `.projectflow/` workspaces** are not migrated automatically, and the `PF-####` work ID format is unchanged.
