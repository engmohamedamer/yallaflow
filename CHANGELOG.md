# Changelog

All notable changes to YallaFlow are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**1.0.0 is the first public release**, published to npm as `yallaflow`. From 1.0.0 the package follows Semantic Versioning with the compatibility promise in [`docs/releasing.md`](docs/releasing.md#semantic-versioning-and-the-10-compatibility-promise). Every earlier version below is an **internal prerelease**: git-tagged, never published to npm, and kept here as history.

## [Unreleased]

Nothing yet.

## [1.1.0] - 2026-10-19 — Connected Requirements & Optional AI Quality Delivery

Three optional, independent capabilities. Projects that do not use them see no change: no new configuration, files, dependencies, background services, or network access. Guide: [`docs/connected-requirements-and-quality.md`](docs/connected-requirements-and-quality.md).

### Added

- **Connected Requirements** — `yallaflow intake ticket` imports a GitHub Issue, Jira issue, or Azure DevOps work item into the existing lifecycle, as a new pending intake or attached to existing work (`--work`).
  - **Offline by default.** It reads the raw payload the agent obtained with its own integration: `gh issue view --json`, the REST issue, a Jira REST/MCP result, or an Azure DevOps work item. A provider-neutral normalized ticket is also accepted.
  - **The ticket becomes an ordinary immutable source.** The original payload is preserved. A rendered Markdown view starts with an untrusted-content banner and carries locators (`[description]`, `[ac:N]`, `[comment:<id>]`). Acceptance criteria come from a dedicated field or an "Acceptance Criteria" section (heading, bold label, or plain `Acceptance Criteria:` line; bullets, `1.`/`1)`/`1-` items, or prose), bot comments are excluded, and each attachment becomes its own source (`--attachment`).
  - **Re-imports and DONE work.** A re-import creates a new source that names the previous one. DONE work needs `--reason`, and impact is raised when intent is already fixed, exactly as with `intake add`.
  - **Traceability.** Requirements cite tickets through the existing `{"type":"source","source":"SRC-####","locator":"ac:2"}` provenance.
  - **Optional `--fetch [--attachments]`.** References are `github:owner/repo#N`, `jira:KEY-N`, `ado:org/project#N`, or the ticket URL. Requests are read-only `GET` with a timeout and a size cap. Credentials come only from environment variables (`GITHUB_TOKEN`/`GH_TOKEN`, `JIRA_EMAIL`+`JIRA_API_TOKEN` or `JIRA_PAT`, `AZURE_DEVOPS_EXT_PAT`); credentials go only over https to the hosted tracker (`api.github.com`, `*.atlassian.net`, `dev.azure.com`, `*.visualstudio.com`) or to a host you configured explicitly in `requirements.providers` (the only way to use GitHub Enterprise, Jira Data Center, Azure DevOps Server, or http) — a ticket URL alone never decides where a token goes. They never follow a cross-origin redirect, and are never stored or printed. This is YallaFlow's only network access, loaded lazily by this one command.
  - **Optional config.** `requirements.providers.<github|jira|azure-devops>` holds base URLs for GitHub Enterprise, Jira sites, and Azure DevOps Server. Credential keys there are rejected.
- **Optional AI QC** — `yallaflow qc plan|record|status`, on request only, for routed work at any stage (DONE included) without rerouting or reopening it.
  - **Plans.** Scenarios trace to active acceptance criteria, and uncovered criteria are reported. Exploratory charters are supported.
  - **Results.** The agent drives Playwright (`playwright-cli` preferred, Playwright MCP supported) or runs existing Playwright tests through `yallaflow verify` (`origin: yallaflow-verified`).
  - **Honesty rules.** `passed` needs executed steps plus an artifact or a passed verification run; `failed` needs the actual behavior and reproducible steps; `blocked`/`not-run` need a reason. A violating record is rejected with nothing written.
  - **Policies.** Advisory (default) reports failures and never blocks. Strict is opt-in through the plan or `quality.qc.policy`; it grants *quality approval* only when every required scenario last passed against its current definition, and that is reported separately. A project-wide `strict` is a floor that a plan cannot weaken (the stricter of plan and current config governs). DONE semantics are unchanged.
  - **Separation from verification.** QC records live in `work/<id>/quality/qc.json`, separate from the `V-###` verification ledger. Convergence may cite `qc:QC-001#S-01`: only a passed scenario supports `satisfied`, and a later failure makes the finding stale.
- **Optional Smart Demo & recording** — `yallaflow demo propose|approve|record|status`, on request only and independent of QC.
  - **Proposals.** Scenarios are prioritized and criteria-linked, each with an audience (business or developer), a rationale, its steps, and whether to record it, plus the items deliberately left out.
  - **Approval before recording.** The developer's explicit approval is recorded in their words and bound to that exact proposal (`--only` approves a subset). Recording against an unapproved or changed proposal is refused.
  - **Video is optional** (Playwright `video-start` / `video-chapter` / `video-stop`). Every run carries a fixed "not test evidence" disclaimer, and `demo:` citations are refused as acceptance evidence.
- **Local artifacts and reports.**
  - Videos, screenshots, and traces are copied into `work/<id>/quality/media/` with SHA-256 and size.
  - A YallaFlow-written `media/.gitignore` keeps them out of Git; `quality.media.commit: true` opts in to committing them.
  - `quality/report.md` and a standalone `quality/report.html` (static, inline CSS, no scripts, no external requests) are regenerated after every write. Links are relative and resolve locally, and missing or changed media is flagged.
  - A non-local target needs `--allow-remote`, credentials embedded in target URLs are refused, and text records are redacted.
- **On-demand skills** — Skill Registry v9 adds `invocation: 'on-demand'` and the skills `requirement-import`, `ai-qc`, and `smart-demo`. They are never part of a workflow policy: every required chain is identical to v8. `yallaflow skill <id> --work <id>` serves them for any routed work item. QC and demo records stamp the exact skill version and hash they followed.
- `finish` adds quality lines (QC outcome, quality approval, demo summary, report path) only for work that used QC or a demo. They never change readiness.

### Changed

- **Agent Contract v10.** Covers importing tickets as sources, treating ticket and attachment text as untrusted data, using QC and demos only on explicit request, never claiming an unexecuted pass, and recording a demo only after the developer approves its scope. Existing projects upgrade with `yallaflow agent refresh`. The bootstrap block stays v3.
- **`verify` captures up to 64 MiB of output** (was Node's 1 MiB default, which killed verbose suites and recorded them as failed).
- **`doctor` validates** the optional `requirements` and `quality` config blocks and the QC/demo ledgers.

### Compatibility

- MINOR release. No workspace or file schema changed (`source.json` stays v2, `config.yaml` v1/v2). New ledgers start at schema v1. There are still four runtime dependencies, and Playwright is never a YallaFlow dependency. Knowledge Policy v1 and the Shared Project minimum (`0.3.10-internal.1`) are unchanged.
- A 1.0.x CLI keeps reading a workspace that used every new capability; this is tested against the real v1.0.1. A workspace that used none of them keeps the 1.0.x shape. See [`docs/upgrading-to-v1.1.0.md`](docs/upgrading-to-v1.1.0.md).

## [1.0.1] - 2026-10-15 — Route engineering work before the first edit

### Fixed

- **Work-routing bypass.** In 1.0.0 an agent could load project memory, edit application code without a work item, and then offer YallaFlow tracking as optional. The only edit rule was "do not modify code while guidance says it is not authorized", and that rule says nothing when no work item exists. **Agent Contract v9** now requires a routed work item, at a stage whose guidance authorizes modification, before the first intentional edit to source, tests, migrations, configuration, or any other engineering artifact. The developer never has to ask for this.
  - An active work item that covers the request is reused, never duplicated.
  - Small changes route as bounded work: in the default adaptive mode, no specification or plan review and no lengthy specification. Review gates that a project's interaction mode enables still apply, and the agent never approves them itself.
  - Operational help (dev server, logs, `git status`) still needs no work item.
  - The agent never asks whether to track a change, and never offers tracking after the fact.
  - Edits already made without a work item are recovered: kept, disclosed, routed, and recorded as a ruling. They are verified fresh and never backdated.
- **Bootstrap block v3** in `CLAUDE.md`/`AGENTS.md` carries the same precondition as a numbered step.
- `yallaflow brief`, when no work is active, says to route an engineering change before its first edit.

### Compatibility

- Existing projects upgrade explicitly with `yallaflow agent refresh`, which rewrites only the YallaFlow-managed blocks. Nothing is rewritten on read, and work items and project memory are untouched. A 1.0.0 CLI reports a v9 contract as newer and never downgrades it. See [`docs/upgrading-to-v1.0.1.md`](docs/upgrading-to-v1.0.1.md), which also covers recovery of untracked changes.
- Skill Registry v8, Knowledge Policy v1, and all workspace/schema versions are unchanged. The Shared Project minimum stays `0.3.10-internal.1`.
- The contract is guidance, not a technical lock: YallaFlow cannot stop a direct file write by itself. Git drift detection and optional provider hooks are possible follow-ups.

## [1.0.0] - 2026-10-13 — First public release

Give AI your project, not just your prompt.

YallaFlow is an AI-agnostic engineering governance layer for coding agents: durable project memory, adaptive workflows, and evidence-backed delivery. You describe the intent; YallaFlow supplies the project.

```bash
npm install -g yallaflow
cd your-project
yallaflow init
```

Then open Claude Code or Codex and describe what you want.

### What you get

- **One-command onboarding.** `yallaflow init` sets up `.yallaflow/` and connects Claude Code and Codex by adding a small pointer to `CLAUDE.md` and `AGENTS.md`, keeping anything already there.
- **Automatic agent bootstrapping.** Every session orients itself from project state. Nobody has to say "use YallaFlow", choose a workflow, or carry the project in the prompt.
- **Brownfield project understanding.** On an existing repository, the first meaningful request triggers one deep, evidence-backed understanding of the project — focused by that request — which the developer reviews. Reply "Approve" and the original request continues. No engineering work starts on a project YallaFlow does not yet understand.
- **Greenfield support.** A new project is never scanned; understanding grows from the product intent, supplied requirements, and approved decisions.
- **Durable, evidence-backed project memory.** Facts carry status, provenance, evidence, and freshness. Memory evolves by reconfirming, superseding, or disputing facts — history is never rewritten.
- **Purpose-aware discovery.** "We will redesign the UI without changing business behavior" focuses discovery where that goal needs it; the purpose stays work intent, never a project fact.
- **Freshness and precise revalidation.** Evidence is content-hashed; stale or disputed knowledge is revalidated where it changed instead of rescanning the repository. Understand once, revalidate precisely.
- **An adaptive work lifecycle.** Features, bugs, investigations, changes, refactors, and releases each get a workflow proportional to their type and scope, with pinned, immutable skill instructions.
- **Verification and delivery convergence.** "Done" requires fresh verification evidence; feature work is also checked against its approved requirements and acceptance criteria.
- **Evidence-backed DONE.** `yallaflow finish` checks lifecycle, knowledge review, and integrity before the agent says the work is ready.
- **Source and SRS intake.** Text, Office/OpenDocument, PDF, and image inputs are preserved as immutable, traceable sources with safe text extraction (no macros, scripts, or external fetches).
- **Agent and session continuity.** Close the chat, switch agents; the engineering state lives with the project (`brief`, `resume`, `handoff`).
- **Shared Projects through Git.** A team shares one reviewed project understanding through ordinary commits, with branch-safe work and source IDs, branch-local knowledge deltas, one canonical integration point, and a read-only CI gate (`yallaflow shared check`). Developers work with Git; agents work with YallaFlow.
- **Conversational human approvals.** Review gates such as the project baseline are approved in the agent conversation and recorded with the developer's own words; the agent never approves on its own.
- **Secret redaction.** Recognizable secret values are redacted before anything is persisted to YallaFlow state; your own files and preserved originals are never modified.
- **Local-first, no YallaFlow cloud.** No server, no account, no telemetry, no LLM calls. YallaFlow never commits, pushes, or merges for you.

### Why 1.0 now

The product has been exercised through real Brownfield projects, fresh-user onboarding, self-dogfooding (YallaFlow's own development, including this release, is governed by YallaFlow), multiple coding agents, and multi-developer pilot use. Its CLI surface, durable workspace format, and Behavior Contract model are now stable enough to promise standard Semantic Versioning compatibility.

### Compatibility

- 1.0.0 is the `0.3.10-internal.4` runtime, unchanged: Agent Contract v8, bootstrap block v2, Skill Registry v8, Knowledge Policy v1, and all workspace/schema versions are the same. Upgrading from `0.3.10-internal.4` needs no action; earlier prerelease workspaces are read as-is — see [`docs/upgrading-to-v1.0.md`](docs/upgrading-to-v1.0.md).
- Shared Projects that require `>= 0.3.10-internal.1` accept 1.0.0.
- Requires Node.js >= 20.16.0. Windows is not verified yet. Known dependency advisory: one moderate, mitigated `file-type` advisory via `officeparser` (see [`docs/security.md`](docs/security.md#dependencies)).

### Release changes

- `package.json`: removed `"private": true`; added license, repository, homepage, bugs, keywords, and `publishConfig.access: public`. Package version `1.0.0`.
- npm publishing through GitHub Actions with npm Trusted Publishing and provenance (`.github/workflows/release.yml`); no long-lived npm token. Each release is validated (tag = version, on `main`), tested on Node 20, 22, and 24, smoke-tested from the packed tarball, and published at most once. `1.0.0` itself is published manually by the package owner, because npm configures trusted publishers in an existing package's settings (see `docs/releasing.md`).
- Documentation: npm as the primary install, the 1.0 compatibility promise (`docs/releasing.md`), `docs/upgrading-to-v1.0.md`, and updated installation, security, limitations, roadmap, CLI, and Shared Project CI examples.

## [0.3.10-internal.4] - 2026-10-12 — Pilot hardening

**Internal prerelease. Not published to npm.** Focused hardening from a real Brownfield pilot, on top of the immutable `0.3.10-internal.3`. Developed as a YallaFlow-governed work item in YallaFlow's own repository, which now has an approved self-baseline.

- **Pre-baseline engineering gate.** In a Brownfield project without approved understanding (including while a draft awaits approval), normal engineering work is refused before anything is written.
  - `start "<request>"`, `feature`/`bug`/`investigate`/`change`/`refactor`/`release`, `intake <file>`, and `route` fail with `PROJECT_UNDERSTANDING_REQUIRED` (exit 1), create no work item or source, and name `yallaflow baseline start --objective "<the request>"` (or the current baseline step) as the next valid action.
  - A read-only question is engineering work too: understand deeply once, revalidate precisely afterwards.
  - Read-only orientation, the baseline lifecycle, `intake add` to the baseline, and source reads stay available. Greenfield and approved Brownfield projects are unchanged.
  - Work created before the gate by an earlier release keeps the internal.3 write gate and cannot be routed until the baseline is approved.
- **The original request survives the baseline.** It becomes the baseline objective. After approval, `baseline approve` and `brief` name it as the next work (`yallaflow start "<request>"`) until a later work item exists, so the agent continues it without asking again and without a second repository-wide discovery.
- **Durable secret redaction.**
  - One sanitizer (`src/security/redact.js`) runs at YallaFlow's persistence boundary: structured state, the context ledger and its projection, work records, ADRs, verification logs and command lines, and extracted source text.
  - It covers secret-named assignments, Authorization/Bearer/Basic values, cookies, private keys, URL credentials, and well-known token formats. `DB_PASSWORD=real-secret` is stored as `DB_PASSWORD=<redacted>`; `.env` stays valid evidence.
  - It is conservative and idempotent. Developer files and preserved source originals are never modified; `intake` warns when a captured original appears to contain secrets.
- **PROJECT.md is a real projection.** Once project memory holds a current fact, the untouched init starter prompts are retired; human-written sections stay and nothing is invented. `doctor` warns when an earlier approval left them; `yallaflow context render` repairs it.
- **Baseline coverage transparency.** `baseline draft` accepts an optional `coverage: { "inspected": [...], "sampled": [...] }` (an additive `baseline.yaml` field). `baseline draft`/`status`/`show` print inspected, sampled, not inspected, unavailable, and unresolved coverage plus the repository paths the evidence cites against the inventory, and never claim completeness.
- **Working-tree evidence provenance.** In a Git work tree, newly normalized repository evidence records `workingTree: head | modified | untracked` (an additive evidence field). Content hashes still decide freshness and work without Git, and the projection output is unchanged.
- **Agent Contract v8** covers:
  - the pre-baseline refusal and the original request as the baseline objective, continued automatically after approval;
  - transient operational assistance (Docker, dev server, logs, `git status`, processes) versus project-semantic engineering work;
  - declared coverage, and never copying secret values into YallaFlow state.
- **Skill Registry v8** ships `repository-baseline` instruction **v4**. v3 is archived byte-for-byte, so work pinned to v7 keeps v3.
- **Docs.**
  - The README and the practical guide explain the Brownfield first request (fix or question), approval, and continuation, plus the operational-help exception.
  - The CLI, security, limitations, upgrade, installation, and releasing docs are updated.
- Package `0.3.10-internal.4`. No persisted schema version changes: config, context ledger, knowledge, baseline, purpose, and source schemas are unchanged. Bootstrap block v2 is unchanged. The frozen internal.3 CLI reads an internal.4 workspace.

## [0.3.10-internal.3] - 2026-10-12 — One setup command

**Internal prerelease. Not published to npm.** A runtime onboarding fix on top of the immutable `0.3.10-internal.2`.

- **`yallaflow init` installs the agent bootstrap for both first-party agents** (`CLAUDE.md` for Claude, `AGENTS.md` for Codex), so `init` is the only setup command.
  - It reuses the `agent setup` installer: existing content is kept byte-for-byte and only the managed block is added or updated; a symlinked shared file gets one block.
  - A hand-edited, newer, or malformed block makes `init` refuse before writing anything.
  - A failure after the workspace was created rolls back `.yallaflow/` and every agent file it touched.
  - `yallaflow agent setup claude|codex` remains, for recovery and manual control.
- **Conversational baseline approval.** The agent presents the project understanding; the developer replies (e.g. "Approve"); the agent records that explicit approval with `baseline approve --note "<their words>"`. It never approves on its own judgment or infers approval. This ships as Agent Contract **v7** and `repository-baseline` instruction **v3** under Skill Registry **v7**; work pinned to v6 keeps instruction v2 (archived byte-for-byte).
- `init` output points to the agent ("open Claude Code or Codex and describe the work"); baseline next-step text describes the conversational approval.
- **Docs.**
  - The README and `docs/using-yallaflow.md` lead with install → `yallaflow init` → describe the work, task-first ("Fix invoice totals."), with the purpose-specific understanding request as an optional deeper step.
  - Commands are separated into developer / maintainer / manual-advanced, and the maintainer and developer team roles are shown explicitly.
  - Raw baseline commands remain only in the CLI, workflows, and guide references.
- Package `0.3.10-internal.3`. Config, context, knowledge, and source schemas are unchanged. Bootstrap block v2 is unchanged.

## [0.3.10-internal.2] - 2026-10-12 — Shared Project Intelligence (corrective re-release)

**Internal prerelease. Not published to npm.** The published `v0.3.10-internal.1` tag is immutable. This corrective release reconciles it with two documentation commits that landed on `main` after v0.3.9 ("docs: simplify first-use experience", "docs: clarify AI coding session in first-use flow"). The runtime behavior is identical to `0.3.10-internal.1` below; only the package version changes.

- The README keeps the rewritten first-use structure and adds the v0.3.10 messaging:
  - the setup line removes the need to say "Use YallaFlow";
  - real work on an existing project triggers the baseline automatically, and code changes wait for its approval;
  - the purpose-aware "Understand this project" example;
  - a "Working as a team" section and `yallaflow finish`;
  - links to Shared Projects and the upgrade guide.
- `docs/using-yallaflow.md` (new on `main`) is kept and updated for v0.3.10: install tag, automatic orientation, the Brownfield gate and discovery lens, the finish protocol, a team section, and commands.
- The install commands point at `v0.3.10-internal.2`. A Shared Project still requires `>= 0.3.10-internal.1` (unchanged).

## [0.3.10-internal.1] - 2026-10-12 — Shared Project Intelligence

**Internal prerelease. Not published to npm.**

> **Understand once. Share automatically. Revalidate precisely.** Developers work with Git; agents work with YallaFlow.

Two connected goals: understand an existing project deeply once, and let a whole engineering team reuse and evolve that understanding through ordinary Git work, without learning YallaFlow internals. Before this release, the sequential ID model was single-writer: two developers branching from the same base both allocated `PF-0043`, `SRC-0012`, and `CTX-0058`, and both rewrote the one ledger file.

#### Added — First-use project bootstrap
- `PROJECT_UNDERSTANDING_REQUIRED` is derived mechanically (`src/baseline/understanding.js`). `brief`, `start`, `route`, `guide`, and the direct work commands report it for a Brownfield project without approved understanding, so the agent runs the baseline first and then continues the request.
- **First-use Brownfield write gate.** While a project recorded as Brownfield has no approved understanding:
  - no work item can enter or continue an application-writing stage (`advance`), and `reopen --to implementation` is refused;
  - `guide`, `handoff`, `resume`, and `status` report write access NOT AUTHORIZED, and the NEXT VALID ACTION is the next baseline step (start → discovery → draft → human approval).
  - It reuses the existing baseline lifecycle; diagnosis and read-only work proceed, and Greenfield is never gated.
- An approved baseline unlocks normal work; fresh developers read approved memory and never re-baseline. Greenfield is never scanned.

#### Added — Purpose-aware discovery
- `baseline start --objective TEXT [--preserve TEXT]... [--focus TEXT]...` and `purpose set|show` record a discovery lens and preservation intent in `work/<id>/purpose.yaml`. These are work intent and never project truth; baseline approval never promotes them.
- There are three discovery modes: `bootstrap`, `intent`, and `freshness`.
- `CORE_COVERAGE` defines the canonical core of a first baseline. The `repository-baseline` and `context-discovery` skill texts teach the core, the lens, and the modes; no CLI keyword matching is involved.

#### Added — Shared Project Mode
- `yallaflow shared enable [--integration-branch B] [--dry-run]` is an explicit, one-time maintainer step.
  - It inspects Git tracking, project understanding, memory health and schema, adapters, and source sizes. It refuses an unhealthy, non-Git, or gitignored workspace.
  - The integration branch comes from `origin/HEAD` or `init.defaultBranch`, or must be named. It is never assumed to be `main` and no remote is contacted.
  - It writes config schema v2, `yallaflow.minimumVersion`, and `.yallaflow/.gitignore` (`local/`), and moves the active-work pointer to `.yallaflow/local/`. It never commits or pushes.
- No join command. Personal runtime state (`local/identity.yaml`, `local/state/current.yaml`) is gitignored; project truth is shared.
- **Branch-safe IDs** (`src/core/ids.js`):
  - `PF-<clone tag>-####` and `SRC-<clone tag>-####`. The per-checkout sequence is remembered in `local/identity.yaml`, so a branch switch or stash never reuses a number, and a copied checkout gets a new tag.
  - CTX IDs are allocated only at canonical integration.
  - Every hardcoded `PF-`/`SRC-` pattern (41 sites) now uses one definition. Legacy IDs stay readable forever.
- **Memory base** (`work/<id>/memory.yaml`): a deterministic content fingerprint of the ledger plus per-fact fingerprints, the Git actor, the clone tag, and the branch. It works without Git.
- **Work-local memory delta**:
  - On a feature branch, `knowledge promote` stages a reviewed context candidate (`staged`, a completed disposition: DONE does not wait).
  - Relations carry `factFingerprint` captured at proposal; staging refuses a fact that changed since.
  - ADRs stay direct (work-scoped paths).
- **Canonical integration**: `yallaflow shared integrate [--dry-run]` runs on the integration branch only.
  - One atomic ledger write, deterministic (same merge → identical files), and idempotent (an interrupted run finishes its bookkeeping without re-applying).
  - Exact duplicates become extra origins.
  - A changed referenced fact (`changed-since-base`) or competing supersede/dispute claims (`competing-update`) block; they are never guessed.
  - Provenance runs fact → work and candidate → actor, memory base, and integration record.
- The single-writer guard in `mutateContextLedger` refuses every canonical write (baseline approval, reconciliation apply, adoption) off the integration branch in a Shared Project.
- `yallaflow shared status [--verbose]`: a concise, read-only, checkout-scoped summary.
- `yallaflow shared check`: a provider-neutral, read-only CI gate. It makes no network or LLM calls and exits 1 with actionable output. GitHub Actions, Azure Pipelines, and GitLab examples are in `docs/shared-projects.md`.

#### Added — Finish protocol and developer language
- `yallaflow finish [work-id] [--verbose]` is a read-only completion check: lifecycle, integrity, compatibility, and shared-memory drift. It prints "Implemented and verified. … Ready to push." with no internal IDs; the agent steps and the `--verbose` audit stay available.
- `handoff` and `resume` show the memory base and staged or integrated knowledge; `knowledge promote` reports staging.

#### Added — Version consistency
- A Shared Project records `yallaflow.minimumVersion`. Every state-changing command stops before mutation on an incompatible CLI; `brief`, `doctor`, `upgrade status`, and `shared check` report `Installed … · Project requires …`. There is no self-update.

#### Added — Doctor / integrity
- Shared Project failures:
  - incompatible version, and config schema and shape;
  - sequential IDs created after sharing;
  - local state committed, or shared paths gitignored;
  - shared state stored under `local/`;
  - malformed memory records or actor metadata, and impossible memory bases;
  - staged deltas referencing missing CTX facts, and staged candidates without delta records;
  - canonical memory written without an integration record.
- Warnings: pending deltas needing reconciliation, incomplete integration bookkeeping, identical sources captured in parallel, sources above the size threshold, and a still-tracked `state/current.yaml`.

#### Changed
- Agent Contract **v6** and provider bootstrap block **v2**: automatic orientation, understanding first, purpose-aware discovery, the Shared Project sequence, the finish protocol, and developer language. The state ownership list includes `memory.yaml`, `purpose.yaml`, and `local/`.
- `brief` adds `Project understanding:` and, in a Shared Project, one shared line (integration branch, current branch, memory fingerprint, pending integrations, versions). The primary concern covers an incompatible version, blocked deltas, and integration-branch work.
- Generated `context/*.md` and `work.md` templates end with a single newline (the v0.3.9 `git diff --check` known issue).
- README, architecture, CLI, workflows, project-memory, installation, security, limitations, and roadmap docs; new `docs/shared-projects.md` and `docs/upgrading-to-v0.3.10.md`.

#### Versions
- Package `0.3.10-internal.1`; Agent Contract v6; bootstrap block v2.
- Config schema v2 only for Shared Projects (v1 unchanged).
- **Knowledge ledger schema v2.** It is written only when a ledger holds Shared Project shapes (`staged`, `stagedAt`, `relation.factFingerprint`). The frozen v0.3.9 reader rejects those fields, so v2 makes it refuse ("must use version 1") instead of misreading; every other ledger stays v1 and byte-readable by v0.3.9.
- **Skill Registry v6 with immutable instructions.**
  - The audit found that pins never covered instruction bytes: `yallaflow skill` served the installed text, and v0.3.9 had already refined `repository-baseline` in place under v5.
  - Every released instruction version now has fixed bytes and a SHA-256 (`src/skills/instructions.js`). Registry v1–v5 pin instruction v1 (the v0.3.9 bytes, archived); v6 pins `repository-baseline` and `context-discovery` v2.
  - `yallaflow skill <id> [--work <work-id>]` (default: the active work's pin) serves the exact pinned version. Editing a released version fails `doctor`.
- Context ledger and source schemas are unchanged.
- Checkout tags are 10 Crockford-base32 characters (50 bits, `crypto.randomBytes`).

#### Deliberately not in scope
Hosted/cloud YallaFlow, accounts, RBAC, invitations, real-time locks, a daemon, automatic commit/push/pull/rebase/merge, tracker integration, sprints, task assignment, dashboards, LLM calls or embeddings in the CLI, semantic auto-resolution, and the v0.4 execution engine.

## [0.3.9-internal.1] - 2026-09-29 — Frictionless Project Onboarding & Context UX

**Internal prerelease. Not published to npm.** Three problems drove this release:

- **APD was classified Greenfield.** On an APD-shaped repository (no root manifest and no Git; two nested Angular portals on Angular 16 and 8; Spring Boot backend modules; container files; design PDFs), v0.3.8's `init` recorded `greenfield`, so no baseline was ever proposed.
- **A bare `.git` meant Brownfield.** An empty `git init` directory was classified Brownfield.
- **The brief led with bookkeeping.** A fresh session's `brief` described YallaFlow's own state before it described the project.

> **Give the agent the project first.** YallaFlow inventories deterministically; the Agent interprets; a human approves the baseline.

#### Added — Bounded repository inventory (`src/inventory/`)
- `inventoryRepository(root)` is an in-memory, deterministic walk:
  - Breadth-first over code-point-sorted entries. It never follows symlinks and skips `IGNORED_DIRECTORIES` (VCS, `.yallaflow`, dependency installs, build output, caches, IDE state).
  - Bounded by `INVENTORY_MAX_DEPTH` (16; a pre-freeze refinement over the originally reviewed 6, for deep Java/package trees) and `INVENTORY_MAX_ENTRIES` (50,000). Truncation is reported.
  - Records recognized manifests at any depth, recognized source files counted by extension, documentation candidates, container/CI files, and Git presence.
  - Reads only manifest and container/CI bytes (size-capped) and is never persisted.
- Documentation candidates use intake's package-owned formats: new `DOCUMENT_FORMAT_EXTENSIONS` / `TEXT_DOCUMENT_EXTENSIONS` in `src/intake/constants.js`, derived from `EXTENSION_FORMATS`. Each candidate is labelled with its intake handling; `.odg` and `.epub` are marked *preserve-only, no text extraction*.
- Deterministic framework/version hints from manifest text:
  - `@angular/core`, `react`, `vue`, `next`, `@nestjs/core`, `vite` (package.json).
  - `laravel/framework`, `yiisoft/yii2` (composer.json).
  - Spring Boot: the Maven `spring-boot-starter-parent`, a `spring-boot-dependencies` BOM (with a same-file `${property}` resolved), a bare `org.springframework.boot` reference, or the Gradle plugin.
  - A major version is shown only when the declared version is a literal. No semantic labels. Malformed manifests are reported, never thrown.

#### Added — `yallaflow inspect`
- Read-only, text-only, and works with or without a workspace; writes nothing.
- Prints:
  - the classification with its reasons;
  - Git presence;
  - workspace state, including a recorded kind that differs from the inventory's;
  - scan bounds and truncation;
  - manifests with hints;
  - source-file counts;
  - bounded documentation candidates;
  - container/CI configuration;
  - one next action (`init`, `baseline start`, the next baseline step, or `brief`).

#### Changed — Brownfield classification (intentional correction)
- `init` and `detectProjectKind` classify from the inventory. Brownfield means one of:
  - a recognized manifest **and** at least one recognized source file;
  - at least `BROWNFIELD_SOURCE_FILE_THRESHOLD` (10) recognized source files;
  - meaningful container/CI configuration, i.e. at least one non-whitespace line that is not a full-line `#` or `//` comment, in `Dockerfile*`, compose files, `.gitlab-ci.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`, `.circleci/config.yml`, or `.github/workflows/*.yml|yaml`.
- Otherwise the project is Greenfield. A bare `.git` and an `npm init`-only `package.json` are Greenfield now. The wider manifest list (`requirements.txt`, Gradle, .NET, Flutter, Ruby, …) is discoverable, but on its own never classifies. `--type` still overrides.
- `init` prints the classification reason. A new Brownfield `init` writes nested manifest hints into `tech-stack.md` under an *init-time deterministic bootstrap snapshot — NOT approved project memory* label. Root-level stack lines are unchanged, and existing workspaces are never rewritten.

#### Changed — Frictionless Brownfield onboarding (no new workflow)
- `init`, `inspect`, and `brief` point a Brownfield workspace without project memory to `yallaflow baseline start`.
- `brief`, `inspect`, and `baseline status` share one read-only `baselineNextStep`: discovery checkpoint → draft → changes requested → awaiting human review. Nothing approves a baseline automatically.
- `baseline start` and `baseline draft` name the inventory, source registration (`intake add` + `source show --content`), and human approval.

#### Changed — Project-first brief
- `brief` reads Project → Work → YallaFlow and is capped at 45 lines (`BRIEF_MAX_LINES`).
- Current-fact text is shown in fixed area order with fixed caps:

  | Area | Facts shown |
  |---|---|
  | Project | 3 |
  | Tech Stack | 3 |
  | Architecture | 3 |
  | Database | 2 |
  | Integrations | 2 |
  | Environments | 2 |
  | Conventions | count + 1 sample |
  | Business Rules | count + 1 sample |

  Facts appear in fact-ID order. Summaries are whitespace-normalized and truncated with an ellipsis only beyond about 160 Unicode code points.
- **NEEDS CARE** (up to 5, via the shared `needsCare`) lists exactly the non-superseded facts that are unresolved, disputed, `MAY_BE_STALE`, or `STALE_EVIDENCE`. It is labelled as mechanical state/freshness, not a risk assessment. Such facts also carry `[needs care]` in their area entry. There is no ledger field and no schema change.
- Without project memory, `brief` shows the inventory headline and the baseline step. Package, contract, and bootstrap share one line.

#### Changed — Freshness guidance
- `context status` explains hash-based freshness only when the workspace has no Git commit to compare against:
  - file evidence is still checked by SHA-256 content hash (a changed file becomes MAY_BE_STALE, a missing one STALE_EVIDENCE);
  - directory evidence is UNKNOWN, which is not stale.

  The Git-backed output is unchanged.
- The `repository-baseline` skill text (Skill Registry unchanged) adds:
  - starting from `inspect`;
  - material documents;
  - durable vs. transient runtime state;
  - Git-free freshness;
  - the distinction between application-code and YallaFlow-workspace writes.

#### Changed — Agent Contract v5
- A **Brownfield onboarding sequence** replaces the baseline sequence. "Do not change application code" authorizes the onboarding YallaFlow writes (`baseline start`, `intake add`, the checkpoint, `baseline draft`); an explicit read-only / no-write request forbids `.yallaflow` writes too. A human always approves the baseline.
- Material-document discovery and source use are part of that sequence.
- NEEDS CARE semantics, with an explicit "not a risk list".
- Content-hash freshness without Git, and UNKNOWN is not stale.
- Transient runtime state is never a durable fact.
- The start sequence says `brief` is project-first.

#### Fixed — pre-freeze independent review
Each fix has a regression test.
- **Brief line cap.** The 45-line cap counts physical lines: embedded newlines in stored text (such as a pasted multi-line request) are collapsed, and the primary concern, next command, and contract pointer are reserved, so they are never truncated away.
- **Malformed baseline ledgers.** A malformed baseline or progress ledger no longer crashes `brief` or `inspect`; both point to `yallaflow doctor`, as v0.3.8's brief did.
- **Unreadable container/CI files** are reported as unreadable, not as empty.
- **Unresolvable Maven versions.** An unresolvable Maven `${property}` version is kept as declared (without a major version); resolution reads project-level `<properties>` only, not profile properties.
- **Bounded snapshot.** The nested hints written into `tech-stack.md` are capped at 40.
- **A committed workspace survives `git clone`.** This was found by the required fresh-clone acceptance check.
  - `init` creates empty `work/`, `decisions/`, and `releases/` directories, which Git does not store. A clone of a fresh workspace therefore failed `doctor`, and `listWork`/`nextWorkId` tried to read an absent `work/`.
  - These lazy directories (`LAZY_WORKSPACE_DIRS`) are now valid when absent, like `sources/`: `doctor` reports them as "absent — created when first needed", `work/` listing returns nothing, and the first work item recreates `work/`.
  - `doctor` still fails when a lazy path exists but is not a directory, or when `work/` is missing while `state/current.yaml` names active work.
  - No `.gitkeep` files are added; the product accepts the cloned state.
- **Container/CI hints match the classification.** `tech-stack.md`'s repository hints at `init` come from the same inventory that classifies the project: meaningful `Dockerfile`/`Dockerfile.*`/`*.Dockerfile`, Docker Compose, GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines, Jenkins, and CircleCI files, grouped by kind with their paths. Empty or comment-only files are not hinted. Before this fix, a root `Dockerfile` could make a project Brownfield while the hints said "No CI/container marker detected yet". The kind comes from the file name and location only, and nothing new is persisted.
- **Gradle comments** are ignored.
- **JSON manifests.** A BOM-prefixed JSON manifest parses. A parse failure reports a fixed reason and never echoes manifest content.

#### Documentation
- `docs/upgrading-to-v0.3.9.md`.
- An "Updating YallaFlow" procedure in `docs/installation.md`: install the target version, `--version`, `upgrade status|plan`, explicit `agent refresh`, `doctor`, commit. There is no self-update or network version check.
- Acceptance Scenario C (APD-shaped onboarding).
- Updated CLI reference, workflows, guide, architecture, project memory, limitations, and roadmap.

#### Compatibility
- Read commands on v0.3.5–v0.3.8 workspaces mutate zero bytes (tested, including `inspect` and `brief` on a v0.3.8-shaped workspace with a v4 contract).
- The recorded project kind is never rewritten.
- A v4 `AGENT.md` is reported as outdated and changes only through `yallaflow agent refresh`.
- No workspace schema changed, so v0.3.8 can still operate on a v0.3.9 workspace. After `agent refresh`, v0.3.8 reports the v5 block as *newer* and refuses to downgrade it.

#### Versions
- Package `0.3.9-internal.1`; Agent Contract **v5**.
- Skill Registry v5 (unchanged); provider bootstrap block v1 (unchanged).
- Context ledger, baseline, sources, reviews, delivery ledgers, knowledge policy, config, and state are all unchanged. See [`docs/upgrading-to-v0.3.9.md`](docs/upgrading-to-v0.3.9.md).

## [0.3.8-internal.1] - 2026-09-28 — Delivery Convergence & Agent Continuity

**Internal prerelease. Not published to npm.** Passing tests did not prove that the delivered implementation matched the approved intent; a requirement source attached mid-implementation left an approved specification and plan standing; and a cold Codex or Claude session still relied on the developer to point it at YallaFlow.

> **Verification ≠ review ≠ convergence. The Agent determines semantic meaning; YallaFlow validates and records it.**

#### Added — Requirement and acceptance-criterion identity (`src/delivery/requirements.js`)
- `yallaflow requirement record <work-id> --file requirements.json`, `requirement list`, `requirement show`. Work-scoped, Agent-proposed `REQ-###`/`AC-###` (cross-work `PF-####/AC-###`) in `work/<id>/requirements.yaml` (`schemaVersion: 1`), each a short statement with provenance (`request`, `specification` section, linked `source`, answered `question`) and a status (`active`, `withdrawn`/`deferred` with a reason, kept visible). Upsert with whole-file validation and zero mutation on any error: ID formats, duplicates, unknown parents, unlinked sources, missing questions, an active criterion under an inactive requirement, an active requirement without an active criterion. IDs are never reused (nor zero-padded twins such as `AC-0001` beside `AC-001`); revisions keep the previous content in history. A criterion a not-yet-DONE decomposed child answers for cannot be withdrawn or deferred on the parent. No implementation or convergence status is stored here.
- Completing the intent checkpoint (`specification`, else `requirement-clarification`) of a delivery-convergence contract requires at least one active criterion. Refused on DONE work.
- Decomposition: when the parent owns a requirements ledger, child references must resolve against it (bare or `PF-####/`-qualified) and the coverage universe is derived from its active set at read time (never copied into `decomposition.yaml`); references no longer active are reported. A child answers for the parent's criteria assigned to it (read through, never copied) and cannot record its own ledger. Parents without a ledger keep the v0.3.4 free-form labels.

#### Added — Convergence ledger and delivery gate (`src/delivery/convergence.js`)
- `yallaflow convergence record|status|show`. Append-only `work/<id>/convergence.yaml` (`schemaVersion: 1`) assessments `CV-###`: per criterion one Agent-declared finding — `satisfied`, `partial`, `missing`, `contradicts` — with a reason and evidence (repository paths with content hash and commit, `verification:V-###`, runtime/user observations, references, or a child's `convergence:PF-####/CV-###`). `satisfied` needs more than free-text references and cannot rest on a failed run; `convergence:` evidence must be a direct child's satisfied finding for that criterion and goes stale with it; `.yallaflow/` paths are not evidence; convergence is recorded only once verification is complete. Unrequested behavior `UR-###`: `open`, `accepted` (reason), `removed` (reason); accepted items stay in history. Findings are stored exactly as declared and never converted or deleted.
- Current convergence is derived per active criterion from its latest finding; a finding is stale when recorded before a reopen/revision or an impact that invalidated convergence, when its criterion was revised later, when a cited repository file changed or disappeared, or when it cites verification from before the latest invalidation.
- New Skill Registry v5 skill `delivery-convergence` (capability `converge`), pinned for `feature` (bounded, architectural) and `change` architectural only. DONE for those contracts requires the checkpoint, every active criterion currently satisfied, no open unrequested behavior, no pending impact, and every pinned checkpoint completed; blockers list each gap and the next valid action. SPEC_READY/PLAN_READY are unchanged. `CASCADE_CHAIN` is now implementation → verification → delivery-convergence → code-review, so reopen (to implementation or verification), revision, and a failing verification after the verification checkpoint was completed invalidate convergence; revising `delivery-convergence` alone keeps the verification freshness boundary. A gap recorded after the checkpoint was completed returns it to `in_progress`, audited.

#### Added — Change impact (`src/delivery/impact.js`, `src/delivery/assess.js`)
- A source attached (`intake add`) or requirements changed (`requirement record`) once the intent is fixed on in-flight work (the intent checkpoint completed, or any later checkpoint already started, so revising the intent checkpoint back does not bypass it) raises a pending `IM-###` in `work/<id>/impact.yaml` (`schemaVersion: 1`); further triggers join it. While pending, `advance`, checkpoint completion, and `convergence record` are refused and guidance withholds write authorization.
- `yallaflow impact status|assess`. The Agent gives every completed stage an `affected`/`unaffected` verdict with a reason. Deterministic rules: an affected post-implementation stage makes every later one affected; any affected stage, or a changed acceptance criterion, makes convergence affected. Affected checkpoints are revised through `checkpoint revise`'s path (history, stage correction to the earliest affected stage, gate invalidation, verification freshness boundary). No evidence is deleted. DONE work is unchanged (recovered source; reopen for new intent).

#### Added — First-party agent bootstrap (`src/agent/bootstrap.js`)
- `yallaflow agent setup codex|claude [--preserve-existing] [--dry-run]` adds one thin, versioned (v1), hash-checked block to the repository-root `AGENTS.md` (Codex) or `CLAUDE.md` (Claude, via Claude Code's documented `@.yallaflow/AGENT.md` import): the session-start sequence and a pointer, never a copy of the contract. Existing content is preserved byte-for-byte (the block is appended); idempotent; hand-edited blocks need `--preserve-existing`; newer blocks are never downgraded. `agent status` reports each provider's state from markers alone (a `CLAUDE.md` symlinked to `AGENTS.md` is reported as shared); `agent refresh` also updates unmodified, outdated blocks; `brief`, `upgrade status|plan`, and `doctor` (warnings) report them. Provider knowledge is confined to `src/agent/` and the agent command surface.
- Agent Contract v4: the delivery intent and convergence sequence; delivery state is work-delivery state, not project memory.

#### Changed — Reporting and integrity
- `guide`, `resume`, and `handoff` show one compact delivery block (requirement/criteria counts, convergence counts, blocking criteria, open unrequested behavior, pending impact) from `src/delivery/summary.js`, and `brief` its first two lines for the active work; `status` notes a pending impact. A pending impact becomes the primary unresolved objective and closes the write gate.
- `doctor` delivery integrity: errors for malformed ledgers, duplicate IDs, unknown requirement/criterion references, impossible statuses, unsupported `satisfied`, missing verification runs or child assessments, unlinked provenance, delivery state on work without a delivery contract, impact revisions without the audited progress entry, DONE with a pending impact, and completion states the findings never supported; warnings for convergence that was current but has gone stale since (evidence drift, a criterion revised later) — DONE history is never rewritten.
- Ownership: `requirements.yaml`, `convergence.yaml`, `impact.yaml` are CLI-owned; the repository-root bootstrap blocks are projections.
- The context ledger's atomic write (temp file + rename) is now a shared helper; the delivery ledgers use it.

#### Fixed
- `reopen --to review` no longer moves the verification freshness boundary: it re-reviews what was already implemented and verified. Previously it left a completed verification checkpoint that `doctor` then failed.
- Pre-freeze independent review of the new delivery model closed paths where supported commands produced a state `doctor` failed, or where stale or unrelated proof counted as current convergence. The resulting rules are listed above: intent stays fixed once downstream work exists (revising the intent checkpoint no longer bypasses impact assessment); a parent cannot withdraw a criterion an in-flight child answers for; child-convergence evidence must be a direct child's satisfied finding and goes stale with it; convergence requires completed verification; the decomposition coverage universe is derived rather than copied; YallaFlow state files are not evidence; zero-padded ID twins are refused; a `CLAUDE.md` symlinked to `AGENTS.md` is not reported as malformed. Each has a regression test.

#### Compatibility
- A v0.3.7 CLI can operate on a workspace later used by v0.3.8 without understanding Registry v5 convergence requirements: it can complete v0.3.8-routed feature work without convergence, which v0.3.8's `doctor` then reports as a failure. During the internal prerelease phase, upgrade every YallaFlow CLI operating on the same workspace together. No downgrade path.

#### Versions
- Package `0.3.8-internal.1`; Agent Contract v4; Skill Registry v5; new delivery ledgers `schemaVersion: 1`; provider bootstrap block v1. Knowledge policy and every existing schema are unchanged. Work pinned to registry ≤ v4 keeps its behavior; nothing is migrated on read. See [`docs/upgrading-to-v0.3.8.md`](docs/upgrading-to-v0.3.8.md).

## [0.3.7-internal.1] - 2026-09-24 — Context Reconciliation & Upgrade Intelligence

**Internal prerelease. Not published to npm.** Driven by the clean YaSchools v0.3.5 → v0.3.6 upgrade: `context adopt --dry-run` correctly found 53 legacy context sections, but some described the same durable truth from different work items (PF-0001 BF-013 and PF-0002 K-002 both state which root Codeception suites are enabled). Blind adoption would have created two current facts for one truth.

> **Migration is not reconciliation. Old knowledge is reviewed before it becomes current truth.** The Agent reasons; YallaFlow validates and applies; a human reviews.

#### Added — Legacy knowledge reconciliation (`src/reconciliation/`)
- `yallaflow context reconcile start|status|show|plan|preview|approve|feedback|apply`. `start` creates one read-only reconciliation work item (reusing the ordinary work lifecycle, like Brownfield Baseline) whose plan, `work/<id>/reconciliation.yaml` (`schemaVersion: 1`), freezes every legacy item as a stable `RC-####` candidate. Each candidate keeps its original work item, BF/K identifier, area, wording, confidence, provenance, evidence, recorded time, and legacy Markdown location. Legacy items are read from the structured records (approved `baseline.yaml` facts; promoted, non-decision `knowledge.yaml` candidates that never became a CTX fact), never from prose. Historical work is never rewritten; temporary migration state never enters `context/index.yaml`.
- Explicit Agent-declared relationships per candidate, recorded from a JSON file (`plan --file`, upserted, `"pending"` clears). The actions and their targets:
  - `new`
  - `merge-with`: collapse legacy candidates that are the same statement into one fact; target another `RC-####` only.
  - `reconfirms`: one more historical observation of a truth already represented; target a `CTX-####` or `RC-####`, same area required.
  - `supersedes` and `disputes`: target an `RC-####` or `CTX-####`.
  - `skip`: reason required.
  - `limitation`: type and reason required; kept as a work-scoped discovery limitation.

  History records `merged` vs `reconfirmed`, and preview labels every member with its action. A candidate that becomes a fact may set a clearer canonical summary or area. Whole-file validation with zero mutation on any error: unknown RC/CTX, self-relations, merge and supersession cycles, two successors or two disputes for one fact, supersede and dispute on one fact, targets that are undecided or not fact-producing, relations the ledger has moved past, and changes to already-applied decisions.
- Works with or without an existing v0.3.6 ledger: a legacy candidate can reconfirm, supersede, or dispute `CTX-0001` directly (and candidates merged with it land on `CTX-0001` too). The v0.3.6 ledger never has to be deleted.
- Deterministic exact-duplicate flag only (`exactDuplicateOf`: same area, NFC/whitespace/case-normalized summary, same evidence) plus `sameStatementAs CTX-####` for identical wording. Both are reported and never acted on. No fuzzy matching, embeddings, similarity scores, or LLM calls.
- Hash-bound human review through the existing `reviews.yaml` gate ledger (new `reconciliation` gate, outside every interaction-mode preset). `approve` requires the `context-reconciliation` checkpoint and a valid plan, and records a SHA-256 fingerprint of every candidate and decision. Any later plan change sends it back to review. A hand edit makes `apply` refuse and `doctor` fail. The generic `yallaflow approve --stage reconciliation` is refused.
- `preview` (read-only) runs the exact apply logic against an in-memory ledger copy (`simulateContextLedger`). It shows resulting current-fact counts, per-area totals, new facts with the CTX IDs apply will assign, merge groups with all origins, facts joined into existing CTX facts, supersessions, disputes, limitations, skips, pending items, and which legacy sections will be retired or kept.
- `apply` validates the whole plan against the live ledger first, then writes canonical memory in one atomic ledger write through the single ledger writer, so a merge group is never half-applied. Projection failure stays recoverable through `context render`. Retry and repeated apply are idempotent (no duplicate facts, origins, history, or limitations). The approved subset applies while undecided candidates stay pending; later rounds join facts earlier rounds produced. The reconciliation work item becomes DONE when the last candidate is applied, and `advance` cannot complete it around the plan.
- Unresolved ambiguity uses the existing questions ledger (`question add <reconciliation-id>`), never a guess. `status`, `handoff`, `resume`, and `brief` show progress and blockers without listing every candidate.
- New skill `context-reconciliation` (capability `reconcile`).

#### Changed — Context ledger schema v2 and multi-origin facts
- **Storage contract.** Context ledger schema v2 records each fact's provenance only in `origins` (every historical work item that established it, introducing origin first), with optional `reconciliation` references (`{ workId, candidate }`) and a new history action, `merged`. Schema v1 keeps the single `origin`. The two fields are never both present.
- **Reads.** v0.3.7 reads v1 as-is (no migration on read) and refuses any newer schema up front with an *upgrade YallaFlow* message. `upgrade status` reports the workspace's context schema, including one that is newer than supported.
- **Writes.** A mutation writes the lowest schema that can represent the result. Ordinary work on a v1 ledger keeps it v1, and therefore v0.3.6-readable, byte-stable for untouched facts. Content that needs v2 (multi-origin, reconciliation) moves it to v2, which `context reconcile apply` requires explicitly. The ledger is never downgraded, and conversion keeps each key's position.
- **v0.3.6 on a v2 ledger.** `doctor` fails on `schemaVersion must be 1` and every write refuses. Some v0.3.6 read-only commands predate any read-side version check (see the upgrade notes).
- Doctor rejects divergent or cross-schema provenance: both fields present, `origins` in v1, `origin` in v2, reconciliation data or `merged` history in v1, or an empty `origins`. Joining an existing fact (`attachOrigin`) adds provenance only; evidence, verification point, state, and freshness are untouched. Ledger validation rejects duplicate origins within a fact and one origin claimed by two facts ("applied twice"). `context show`, `context history`, and the Markdown projection list all origins; single-origin rendering is byte-for-byte unchanged.

#### Changed — Legacy Markdown ownership
- A reconciled legacy section that is byte-for-byte what v0.3.5 generated from its own structured record (exact regeneration; only the timestamp value is a wildcard) is archived verbatim in `work/<id>/legacy-context.md`, then removed from the durable document. Any hand edit, even inside a bullet value, keeps the section in place, and it is reported for review. Unreconciled sections stay until reconciled.

#### Changed — `context adopt` (safety)
- `context adopt --dry-run` is unchanged (read-only) and now says whether direct adoption is available. `context adopt` imports only when provably duplicate-free (exactly one legacy item and no current facts). Otherwise it is refused with zero mutation and points to `context reconcile start`. There is no `--force`.

#### Added — Upgrade intelligence and fresh-agent orientation
- `yallaflow upgrade status` / `upgrade plan`: one read-only, deterministic assessment aggregating the existing doctor report (refactored into a shared `collectDoctorReport`), agent-contract state, project memory, pending legacy facts, reconciliation progress, sources, work history, and Git durability, with an ordered list of deliberate commands. There is no automatic "upgrade everything" command.
- `yallaflow brief`: a concise, read-only orientation for a fresh Agent (agent contract, active and most recent work, project memory, pending reconciliation and its blockers, sources, primary next concern, next command). It never dumps context and points to `resume`/`handoff`/`context reconcile` rather than replacing them.

#### Added — YallaFlow state ownership
- Explicit ownership model (`src/core/ownership.js`, documented in project-memory.md): CLI-owned structured and history state, generated projections, the shared `work.md` (Agent writes narrative sections; CLI-appended lifecycle records are history), and human-owned settings. Every file a full lifecycle writes is classified (tested). `doctor` warns deterministically when a CLI-recorded Routing Decision in `work.md` no longer matches `meta.yaml`. There is no filesystem locking, and `.yallaflow` is not made read-only.

#### Added — Doctor reconciliation integrity
- Errors: malformed plan or invalid action; missing candidate origin (work item, baseline fact, or knowledge candidate); unknown RC/CTX targets; self-relations and cycles; conflicting relations; an approval that no longer matches the plan or its gate; an applied candidate whose CTX lineage is missing or points elsewhere; a skip/limitation candidate that also appears in the ledger; ledger lineage naming a reconciliation that does not record it; orphaned plans; more than one open reconciliation; DONE/applied mismatches; a reconciled legacy section still presented as current truth.
- Warnings: relations the ledger has since moved past; an interrupted apply; reconciled or adopted legacy sections kept because they were hand-edited; unreconciled legacy context (now pointing to `context reconcile start`).
- Baseline integrity accepts a legacy baseline fact settled by reconciliation (merged, disputed, skipped, or recorded as a limitation).

#### Changed — Agent Contract v3 (`AGENT_CONTRACT_VERSION` 2 → 3)
- New sections: *Legacy context reconciliation sequence* (reconcile before trusting; evidence-based relationships only; ask instead of guessing; never approve on the human's behalf; never rewrite historical work) and *YallaFlow state ownership*. The start sequence now begins with `yallaflow brief`. A v2 block is reported `outdated (v2 → v3)` and upgraded in place by `agent refresh`. The Claude/Codex adapters were updated to match.

#### Versions
- Package `0.3.7-internal.1`. Agent Contract v3 (behavior change). Skill Registry v4 (new skill; work pinned to v3 keeps its skills). Context ledger schema **1 → 2**, written only when content requires it (v0.3.6 cannot read v2; every v1 ledger stays valid and is never migrated on read). Reconciliation plan `schemaVersion: 1` (new).

#### Tests
- 508 tests, up from 450. New suites: `context-schema` (v1 → v2 storage contract, divergent provenance, newer-schema refusal, and mixed-version behavior against the real frozen v0.3.6 CLI extracted from its tag), `reconciliation`, `reconciliation-pilot` (the YaSchools upgrade class end to end, with an Agent-authored plan fixture), `upgrade-intelligence`, `state-ownership`, and `v037-compatibility`, which runs against a workspace fixture generated by the frozen v0.3.6 CLI (`test/fixtures/v0.3.6-workspace/`). Three v0.3.6 `context adopt` tests were rewritten to assert the new safety model (refusal with zero mutation, trivial adoption, and the same imports through reconciliation). Version-specific assertions follow the new contract and registry versions.

## [0.3.6-internal.1] - 2026-09-23 — Living Project Memory & Context Integrity

**Internal prerelease. Not published to npm.** Driven by the real YaSchools Brownfield pilot, which proved the baseline → reviewed durable context → fresh agent reuse → scoped investigation → knowledge promotion → bounded implementation → verification loop, and exposed that project knowledge goes stale as the repository evolves.

> **Work records preserve history. Project memory preserves current understanding.**

#### Positioning
- YallaFlow is now described as *an AI-agnostic engineering governance layer for coding agents, providing durable project memory, adaptive workflows, and evidence-backed delivery* (`package.json` description, README, architecture, roadmap, agent adapters, generated `AGENT.md`). Adaptive Spec-Driven Development remains the workflow philosophy — "when the work needs it, not ceremony for every task". A fifth core rule: **Revalidate before trusting stale knowledge.**

#### Added — Canonical project-context ledger (`src/context/`)
- **GAP-MEMORY-001/002/003:** one canonical structured source of truth for durable project knowledge, `.yallaflow/context/index.yaml` (JSON-compatible YAML, `schemaVersion: 1`), with exactly one writer (`mutateContextLedger`: validate → apply → validate → atomic ledger write via temp-file + rename → re-render the projection). Ledger and projection are not one transaction: a rendering failure leaves canonical knowledge intact, `doctor` reports the drift, `context render` repairs it, and retrying `knowledge promote`/`baseline approve` is idempotent (no duplicated facts, history, or lineage). Facts have stable `CTX-####` IDs, an area (the existing context kinds), a **state** (`current`/`superseded`/`disputed`) kept separate from **confidence** (`confirmed`/`inferred`/`unresolved`), provenance (`repository`/`runtime`/`user-confirmed`), the originating work item + candidate or baseline fact, structured evidence, a verification point (time + Git commit), supersession lineage, and an event history. Created lazily by the first write; reads never create it.
- Evidence normalization: existing repository paths (optionally `path#symbol` / `path:12-40`) record location, a sha256 content hash, and the current Git commit — never file contents (no secrets copied); `runtime:…`, `verification:V-###` (validated against the work item's verification ledger), and `user:…` evidence; anything else is a free-text reference without a verification point.
- **Markdown projection:** `PROJECT.md` and `context/*.md` each hold one managed block (`<!-- yallaflow-context:begin -->`…`end`) rendered deterministically from current facts, with disputed facts under an explicit "Disputed project knowledge" warning and superseded facts never shown. Content outside the block (human notes, bootstrap hints, v0.3.5 sections) is preserved byte-for-byte.
- Knowledge promotion and Brownfield Baseline approval now both feed the ledger (replacing the v0.3.5 append-only `appendMarkedSection` primitive) — still one mechanism per document.

#### Added — Knowledge evolution
- `yallaflow knowledge propose … --supersedes|--reconfirms|--disputes CTX-####` (plus optional `--confidence`, `--provenance`): the Agent declares the relationship; YallaFlow validates that the fact exists and the transition is legal, never inferring semantic equivalence (GAP-MEMORY-001, PART 12). On promotion: *supersede* creates a new current fact and marks the old one superseded with two-way lineage; *reconfirm* keeps the same fact and summary, replaces its evidence and verification point, and keeps the prior evidence in history (no duplicate); *dispute* marks the fact disputed with the conflicting evidence until it is reconfirmed or superseded. Evolution requires resolvable (non-reference) evidence. A fact can never gain two current successors. Historical work records are never edited (GAP-MEMORY-002).
- Candidates record their declared `relation` and resulting `factId`; v0.3.5 candidates without these fields remain valid.

#### Added — Freshness, change impact, and context commands
- **GAP-MEMORY-005/006:** mechanical freshness per fact — `FRESH` (evidence unchanged since verification), `MAY_BE_STALE` (changed — revalidate; never "false"), `STALE_EVIDENCE` (evidence gone), `UNKNOWN` (no verification point). Content-hash based for files (works with or without Git), Git-diff based for directory evidence. Nothing is ever rewritten, invalidated, or superseded automatically.
- New read-only commands: `yallaflow context status` (per-area current / may-be-stale / stale-evidence / disputed / unresolved / superseded counts and the facts to revalidate), `context list [--area] [--all]`, `context show <CTX-id>`, `context history <CTX-id>` (lineage + events), `context affected [--since REF] [path …]` (path → fact mapping only). Explicit maintenance: `context render` (regenerate managed blocks), `context adopt [--dry-run]` (v0.3.5 upgrade).
- `handoff`/`resume` show a compact "Relevant project context" block (totals, stale/disputed facts, and stale facts this work's candidates relate to) — never the whole ledger.

#### Added — Discovery limitations (GAP-MEMORY-004)
- `yallaflow limitation add [work-id] --type TYPE --area AREA --summary TEXT --reason TEXT` / `limitation list`: work-scoped records in `work/<id>/discovery.yaml` (created only on first add) of what an investigation could not inspect (`not-inspected`, `unavailable`, `out-of-scope`, `runtime-unavailable`, `insufficient-evidence`). Baseline drafts accept a `limitations` array, shown by `baseline show/status`, never promoted. `knowledge propose` refuses a candidate restating a limitation of the same work item; a baseline fact may not restate one of its own limitations; `doctor` fails if one reaches the ledger.

#### Changed — Sparse workspace (GAP-WORKSPACE-001/002)
- New work items (all creation paths: `start`/`intake`, direct `feature`/`bug`/…, decomposition children, `baseline start`) no longer create empty `attachments/`, `evidence/`, or `execution/`. `evidence/` is created by the first `verify`. **Decision:** `execution/` had no producer or consumer and is reserved for a future structured execution-artifact feature; `attachments/` had no writer (intake stores originals in workspace `sources/`). Existing directories stay valid and are never deleted.

#### Added — Durable user-provided artifacts
- Pilot finding: a bounded change requested with text + a UI screenshot kept the screenshot only in conversation memory. Audit showed the existing `SRC-####` source model and `yallaflow intake add <work-id> <file>` already capture any file (images as `original-only`) immutably and link it to an existing work item, so no competing attachment system was added. Gaps closed: the Agent contract (`## Sources, evidence, and generated artifacts`), `requirement-clarification` skill, and agent adapters now require registering *material* user-provided artifacts the Agent can access; `handoff`/`resume` list each linked source with the path to its preserved original; `doctor` fails on a missing source, a one-way link, or a preserved original that is missing or no longer matches its capture checksum; a new limitation type `uncaptured-artifact` (area `requirement`) records an artifact the Agent could not access instead of implying it was preserved. Source vs evidence vs generated artifact is now defined in the docs. `attachments/` is retired in favor of `sources/`.

#### Fixed — Pre-freeze integrity pass
- **Lifecycle invariant:** any state reachable through supported commands now satisfies `doctor`. An investigation could reach DONE with its pinned `verification` checkpoint pending, and read-only work could complete `verification` without evidence — both states `doctor` rejects. DONE now requires the pinned verification checkpoint for every workflow, and completing it requires fresh successful evidence for all work. A failing `verify` after the checkpoint was completed returns it to `in_progress` via the audited revision path; `verify` on DONE work is refused (reopen path, or a new work item for workflows that cannot be reopened). `doctor` was not weakened. Two existing tests that drove the contradictory paths now satisfy the proof requirement.
- **Ledger/projection crash recovery:** the ledger file is now written atomically (temp file + rename); a projection failure after the ledger write reports that canonical knowledge is intact and points to `yallaflow context render`; `knowledge promote` and `baseline approve` are idempotent on retry (`appliedTransition`), so a retry never duplicates facts, history, or lineage. Documentation no longer calls ledger + projection "atomic".

#### Changed — Direct work commands require --scope and create routed work
- **Breaking:** `yallaflow feature|bug|investigate|change|refactor|release <title>` now requires `--scope` and creates normal routed work through one canonical path, `createRoutedWork` (= `start` → `route`: decision and policy validated before any write), so direct-created work gets the same workflow, pinned Behavior Contract, Skill Registry version, read-only policy, knowledge policy, and initial stage as agent-routed work. Without `--scope` the command creates nothing and suggests `--scope` or `yallaflow start` — scope is never defaulted. The legacy contract-less `createWorkItem` was removed from product code; existing contract-less items stay readable.

#### Added — Agent contract upgrades
- Versioned, managed agent-contract block in `AGENT.md` (`AGENT_CONTRACT_VERSION` 2; v1 was superseded before release — v2 adds that direct classified commands require an explicit `--scope`, that agents must never guess a scope, must use `yallaflow start` + `route` when type/scope are unknown, and must not force unsupported type/scope combinations; a v1 block is reported `outdated (v1 → v2)` and upgraded in place by `agent refresh`). `doctor`/`status` warn when guidance predates the installed contract, without mutating anything. New `yallaflow agent status` and `yallaflow agent refresh [--preserve-existing] [--dry-run]`: updates only the managed block, replaces pre-v0.3.6 files only when byte-identical to a known generated template (v0.1–v0.3.4, v0.3.5), never silently replaces customized guidance, never downgrades, and is idempotent.

#### Added — Recovered sources
- `yallaflow intake add <work-id> <file> --reason TEXT`: attaching a source to DONE work requires a reason and records `linkedAt`, `workStatusAtLink: DONE`, `relationship: recovered-source`; the work stays DONE, `work.md` is untouched (append-only `progress.md` entry only), and `handoff`/`resume`/`source show` label it as not available during the original execution. Every new link records its timing and relationship. `doctor` checks recovered-link audit metadata.

#### Documentation — Product positioning and user docs
- README restructured as a concise front door around "Give AI your project, not just your prompt." and the engineering-governance-layer identity (durable project memory, adaptive workflows, evidence-backed delivery); Adaptive Spec-Driven Development kept as the methodology, no longer the sole product description. Added a "What YallaFlow is not" section and a documentation map.
- New docs: `docs/workflows.md` (Greenfield, Brownfield, Bug, Investigation, Bounded change, task with a screenshot/file, cross-agent handoff, context freshness — every sequence executed against the CLI), `docs/cli.md` (complete CLI reference), `docs/guide.md` (feature guide, moved and updated from the README), `docs/project-memory.md` (living context, freshness, and sources vs evidence vs generated artifacts vs discovery limitations), `docs/upgrading-to-v0.3.6.md`, `docs/security.md` (security and trust model), `docs/limitations.md`, and `docs/installation.md` (isolated/global CLI install; never add YallaFlow as a dependency of a legacy application, where npm can rewrite an old lockfile).
- Stale documentation corrected (Skill Registry version, release-policy version table now including the agent-contract version, contribution principles, pilot guide); consistency scan: all documented commands/flags exist, all links resolve, no obsolete `.projectflow`, verification syntax, or eager-directory workspace trees.
- Test hygiene: the legacy contract-less work fixture moved to `test-support/legacy-work.js` (outside Node's default `test/` discovery; not packaged), so the suite reports only real tests.

#### Changed — Workflow UX (GAP-WORKFLOW-001)
- `guide` ends with `CURRENT OBJECTIVE` / `BLOCKER` / `NEXT VALID ACTION` (+ whether advancing is allowed now), and `advance` reports the next boundary after each transition — both from one shared, read-only-capable resolver (`evaluateAdvance`) that `advance` itself enforces. `guide` never requests a review gate. `advance` error messages and stage transitions are unchanged.

#### Changed — Guidance (GAP-VERIFY-001, PART 18)
- Generated `AGENT.md` gains a **Project memory sequence** (before/during/after work), evidence forms, and verification guidance; skills `context-discovery`, `repository-baseline`, and `verification` and both agent adapters updated: prefer argv verification (`verify <id> -- <executable> [args…]`), `--shell` only for real shell operators; failed attempts stay in the append-only ledger. No change to verification behavior.

#### Doctor / integrity
- Context integrity errors: malformed ledger/fact fields, duplicate IDs, unknown or one-directional supersession lineage, cycles, impossible lifecycle states, missing origin work items, malformed evidence metadata or provenance, projection drift or a superseded fact still projected, and a discovery limitation recorded as a fact. Freshness (`MAY_BE_STALE`/`STALE_EVIDENCE`), disputed facts, and unadopted v0.3.5 context are warnings — stale knowledge is not corruption. Doctor never repairs.
- Baseline integrity accepts either a ledger fact originating from each approved `BF-###` (v0.3.6 or adopted) or its v0.3.5 marker.

#### Compatibility
- **No migration on read.** v0.3.5 workspaces open, report, and pass `doctor` unchanged. The ledger is created by the next baseline approval or promotion; legacy sections coexist with the managed block. `yallaflow context adopt` is the explicit, opt-in upgrade: it reads approved `baseline.yaml` facts and promoted `knowledge.yaml` candidates (work records untouched), creates adopted facts with `UNKNOWN` freshness, removes only legacy sections that exactly match the v0.3.5 template, and reports hand-edited ones.
- Rendered context uses `**Confidence:**`/`**State:**` in place of v0.3.5's `**Status:**` label (three baseline assertions updated accordingly). A second approved baseline is still refused (PART 23) — living memory replaces baseline refresh.
- Skill Registry stays at v3 (guidance text only); knowledge policy stays at v1.

#### Tests
- 123 new deterministic tests (450 total): context ledger, promotion, supersede/reconfirm/dispute, freshness and change impact, discovery limitations, sparse workspace, v0.3.5 compatibility and adoption, doctor context integrity, next-valid-action UX, and durable user-provided artifacts (`test/durable-artifacts.test.js`), investigation lifecycle consistency, ledger/projection failure recovery, agent-contract detection/refresh and the v1 → v2 contract upgrade, recovered sources, direct-command routing (`test/direct-commands.test.js`), and a four-scenario CLI-only YaSchools pilot regression (`test/pilot-regression-v4.test.js`).

## [0.3.5-internal.1] - 2026-09-22 — Brownfield Baseline & Execution Resilience

**Internal prerelease. Not published to npm.** Every finding here comes from real human pilots: a greenfield SRS/file-intake run, full project decomposition and feature-by-feature execution, mid-feature and cross-provider agent handoff, reopen-after-DONE recovery, brownfield repository discovery with no existing docs, and brownfield feature implementation with durable-knowledge reuse.

#### Added — Brownfield Baseline (`src/baseline/`)
- `yallaflow baseline start`: creates (or idempotently resumes) a read-only, investigation-type work item dedicated to repository baseline discovery — reusing the existing work-item/checkpoint/read-only-investigation lifecycle rather than a second work engine. One new, additive Skill Registry entry (`repository-baseline`; `REGISTRY_VERSION` 2→3 — existing pinned v2 contracts are unaffected).
- `yallaflow baseline draft <work-id> --file <baseline.json>`: records a structured, evidence-backed draft once the `repository-baseline` checkpoint is completed. Every fact carries an area, a confidence level (`confirmed` / `inferred` / `unresolved`), evidence references, and a provenance (`repository` / `runtime` / `user-confirmed`) — prior chat/model memory is never accepted as evidence.
- `yallaflow baseline status|show [work-id]`: read-only inspection of the current draft/approval state and its facts.
- `yallaflow baseline approve [work-id] [--note TEXT]` / `yallaflow baseline feedback [work-id] --changes-requested [--note TEXT]`: reuses the existing v0.3.4 review-gate ledger (`reviews.yaml`, a new `'baseline'` gate) for durable awaiting_review/approved/changes_requested history — approval is the only thing that promotes facts into durable docs; a requested change never lets a stale draft through.
- Two new knowledge kinds, `project` (→ `PROJECT.md`) and `tech-stack` (→ `context/tech-stack.md`), added to the existing knowledge-promotion machinery (`src/knowledge/promotion.js`) rather than a second promotion path — confirmed/inferred/unresolved facts alike are written through the same idempotent, marker-guarded append primitive ordinary work-scoped knowledge candidates already use, so there is exactly one mechanism per durable document regardless of which pipeline produced the content. Deterministic bootstrap content (`yallaflow init`'s tech-stack hints) is preserved, never overwritten.
- **Repeated-baseline safety** (pre-freeze hardening): `yallaflow baseline start` is refused outright once a baseline has already been approved (`"An approved Brownfield Baseline already exists. Baseline refresh is not supported in this release..."`), with zero workspace mutation on refusal — v0.3.5 does not implement baseline refresh, and a second baseline would either silently duplicate promoted context sections or need overwrite semantics this milestone doesn't define. Still-in-progress (draft, not yet approved) baselines remain safely resumable, unchanged.

#### Added — CLI safety and correction
- **GAP-CLI-001 fixed**: `<command> --help`/`-h` is now checked once, centrally, before any command branch runs — `yallaflow start --help` (previously created a pending work item from the literal text `--help`) and `yallaflow verify --help` (previously attempted to execute `--help` as a verification command) can no longer mutate state. Applied consistently across every namespace, including nested sub-actions (`baseline draft --help`, `request revise --help`, `verify list --help`, ...) via a per-namespace usage table, not scattered per-branch checks.
- **Help parsing corrected to respect payload boundaries** (pre-freeze hardening): the initial fix scanned every token in a command's arguments for `--help`/`-h`, which was too broad — it could swallow a `--help` meant for a *verified* command, e.g. `yallaflow verify PF-0001 -- node --help` would show YallaFlow's own help instead of running `node --help` as the verification. Corrected so the help scan never crosses a command's own documented `--` separator (`verify`'s payload boundary): everything after `--` is the child process's literal argv, always, never inspected for YallaFlow help intent. A `--help`/`-h` that arrives as part of an option's *value* (`start "Fix --help handling"`, `request revise --text "Document --help behavior"`) was never at risk either way, since the scan only ever matches a token that IS exactly `--help`/`-h`, never a substring.
- **GAP-CLI-002 fixed**: `yallaflow request revise <work-id> --text TEXT --reason TEXT` — the supported, auditable way to correct a pending/unrouted work item's raw request. Only valid before routing; preserves full revision history (`meta.requestHistory`) and never touches file-backed sources.
- **GAP-INIT-001 fixed**: `yallaflow init` now also checks whether `.yallaflow` is tracked by Git (index or HEAD) even when missing from the working tree, refusing to silently reinitialize a blank workspace over prior tracked history. No destructive auto-reset; the error names the restore path.

#### Changed — Verification execution model
- **GAP-VERIFY-001/002 fixed**: `yallaflow verify [work-id] -- <executable> [args...]` now executes with `shell: false` by default — argv boundaries (including arguments containing spaces) are preserved exactly, never reconstructed into a shell string. Explicit `--shell "<command>"` remains available for genuine shell syntax (pipes, redirection); `--script <path>` executes a script file directly. `stdio: ['inherit', 'pipe', 'pipe']` fixes previously-detached stdin while still capturing stdout/stderr into the evidence log.
- The verification ledger gains additive fields (`executionMode`, `executable`, `args`, `displayCommand`); existing `V-00N` runs and legacy (pre-v0.3.3) single-record files remain fully readable, unmigrated. `yallaflow verify list` now shows each run's execution mode.
- This is a deliberate breaking change to `verify`'s no-separator legacy fallback (removed) — every invocation must now name its mode (`--`, `--shell`, or `--script`) explicitly, closing exactly the "silent shell reinterpretation" gap the pilot hit.

#### Added — Handoff, interaction, and completion clarity
- **GAP-HANDOFF-001 fixed**: `handoff`/`resume` now surface a `PRIMARY UNRESOLVED OBJECTIVE` line (from the most recent reopen reason, checkpoint-revision reason, or active write-authorization blocker, whichever is most recent) before generic context, via a small shared resolver (`src/behavior/objective.js`) — reused by both commands rather than duplicated.
- **GAP-UX-002 addressed**: a `DONE` work item's output now explicitly states it is one work item, not necessarily the whole project; a decomposed parent's handoff/progress reports "Project NOT complete: N/M required children DONE" until the parent itself reaches `DONE`.
- **GAP-UX-003 addressed**: `resume`/`handoff` surface an informational note (branch, dirty/clean, changed/untracked counts already existed; now also a recommendation) when a `DONE` work item's Git tree is dirty — never an enforcement, never an automatic commit.
- **GAP-UX-001, GAP-ROUTE-001, GAP-QUESTION-001 addressed via guidance**, not new mechanisms: `AGENT.md`'s generated contract, `resources/skills/requirement-clarification.md`, and `resources/skills/design-exploration.md` were updated to (a) not re-ask for confirmation once a review gate is already approved, (b) make routing/scope guidance risk-aware (financial, security/privacy, authorization, data-model, cross-module, integration-contract, and irreversibility considerations — the Agent still classifies; YallaFlow still only validates), and (c) sharpen the business-vs-architecture question distinction with concrete examples.

#### Doctor / integrity
- New checks: an approved baseline missing its promoted context/PROJECT.md content; malformed baseline facts; malformed `requestHistory` entries; a verification run with malformed execution metadata (unknown `executionMode`, missing `args`/`executable`); and a workspace-level check for `.yallaflow` being neither Git-tracked nor gitignored. Reports only; doctor never auto-repairs, consistent with existing checks.

#### Node runtime — engines contract corrected (pre-freeze hardening)
- A pilot's `EBADENGINE` warning during `npm install` was traced to a genuine mismatch, not merely an untested one: `pdfjs-dist@6.3.289` officially required Node `>=22.13.0`, while YallaFlow declared `>=20`. A compatibility polyfill and a passing Node-20 smoke test proved *observed* compatibility but did not make the dependency *officially* support Node 20 — the engines declaration itself was untruthful.
- Resolved by pinning `pdfjs-dist` to **`5.4.624`** (both the direct dependency and the `overrides` entry), the latest release that officially declares `engines.node: ">=20.16.0 || >=22.3.0"` **and** predates every known pdfjs-dist advisory affecting this dependency tree: [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j) (`>=5.6.83, <6.2.108`), [GHSA-wgrm-67xf-hhpq](https://github.com/advisories/GHSA-wgrm-67xf-hhpq) (`<=4.1.392`), and [GHSA-7jg2-jgv3-fmr4](https://github.com/advisories/GHSA-7jg2-jgv3-fmr4) (`<2.0.550`) — `5.4.624` falls in none of these ranges.
- **YallaFlow's own `engines.node` tightened from `>=20` to `>=20.16.0`.** The first pass of this fix left the declaration at the looser `>=20`; the general dependency-tree scan below then correctly caught that `pdfjs-dist@5.4.624` itself only supports `>=20.16.0`, a narrower floor than YallaFlow was claiming — someone on Node 20.0–20.15 would have satisfied YallaFlow's own contract while still failing pdfjs-dist's. `>=20.16.0` is now the exact, agreed floor across the whole runtime dependency tree, not merely a round number.
- `npm install` on a satisfying Node version now produces **no `EBADENGINE` warning at all** for any runtime dependency — verified by auditing every installed package's own `engines.node` field programmatically, not just pdfjs-dist's. The `Promise.withResolvers` shim in `src/intake/extractors/pdf.js` is kept only as harmless, no-op defense-in-depth (`5.4.624` doesn't need it) in case a future upgrade reintroduces the dependency.
- `test/node-compatibility.test.js` now scans the entire installed dependency tree for any `engines.node` that YallaFlow's own declared floor (read from `package.json`, not hard-coded) doesn't satisfy, asserts the exact pinned version/engines string, and still exercises real PDF extraction end to end. Universal-intake/PDF regressions re-verified against the new pinned version.

#### Compatibility — two distinct claims, not one
This release makes both a **workspace/schema** compatibility claim and a **CLI behavior** claim, and they are not the same thing:
- **Workspace/schema: backward compatible, no migration-on-read.** Greenfield projects, existing v0.1–v0.3.4 workspaces, PF IDs, intake/source records, the knowledge workflow, the verification ledger (schema v1/v2, now also read alongside the additive v0.3.5 execution-metadata fields), reopen, resume, decomposition, interaction modes/review gates, questions, readiness, and handoff's read-only behavior are all unaffected and read exactly as before.
- **CLI behavior: one intentional, safety-motivated exception.** `yallaflow verify`'s **documented** syntax (`yallaflow verify [work-id] -- <executable> [args...]`, plus the new explicit `--shell`/`--script` modes) continues to work exactly as before and is the form every test and doc has ever used. The **undocumented** legacy fallback — treating a bare `yallaflow verify <text with no `--`>` as an implicit shell command — was intentionally removed; it was never documented CLI surface, only ever an artifact of the old shell-based implementation, and keeping it would mean silently reinterpreting argv as shell syntax, exactly the class of bug this release fixes (GAP-VERIFY-001). This is called out explicitly rather than folded into "fully additive," since it is not additive.

#### Doctor severity
- The `.yallaflow`-tracking check introduced above is **informational (`WARN`)**, not a health failure: YallaFlow does not mandate a Git or team workflow, so this alone never makes an otherwise-healthy workspace report unhealthy or exit non-zero. Genuine structural corruption (a missing/malformed durable file, a lifecycle contradiction) remains a hard `FAIL`, unchanged.

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
