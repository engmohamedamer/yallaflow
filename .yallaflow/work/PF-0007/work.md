# PF-0007 — v1.1.0 Connected Requirements & Optional AI Quality Delivery

## Raw Request

YallaFlow v1.1.0 — Connected Requirements & Optional AI Quality Delivery: import requirements from GitHub Issues, Jira, Azure DevOps into the existing lifecycle; optional Playwright-based AI QC (functional + exploratory, disabled by default); optional Smart Demo with approved scenario scope and local video recording. Optional, modular, backward-compatible; no telemetry/uploads by default; no npm publish, release, or tag without explicit approval.

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** New capability release: external requirement-provider integrations (auth, provenance, untrusted content), new evidence kinds (QC runs, recordings), Agent Contract and Skill Registry changes, public CLI/schema surface, and backward-compatibility obligations — multi-milestone, decomposable into four children.
**Timestamp:** 2026-10-19T14:43:03.854Z
**Workflow:** feature
**Required capabilities:** discover, clarify, brainstorm, specify, plan, implement, verify, converge, review
**Behavior contract:** registry v8
**Skills:** context-discovery, requirement-clarification, design-exploration, specification, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

Structured material questions are authoritative in `questions.yaml`.

## Confirmed Decisions

## Discovery

Baseline at start: v1.0.1 tag on HEAD (032f32c), package = CLI = 1.0.1, tree clean, 680/680 tests pass. Full brief preserved as SRC-0001.

- None of the three capabilities exist; docs/roadmap.md:71 lists "Tracker intake" as future work.
- Source intake: Normalized Intake Contract (src/intake/normalize.js) → persistSource (src/core/sources.js). source.json v2 has free-form `metadata`, so origin data needs no schema bump. Every SRC is immutable; a re-import is a new SRC. `intake add` on intent-fixed work already raises a source impact.
- Requirements: provenance `{type:'source', source, locator?}` (src/delivery/requirements.js) already carries ticket traceability (`locator: "ac:2"`, `"comment:123"`).
- Verification: V-### runs (src/core/evidence.js) are YallaFlow-executed argv/shell/script commands, one log, no artifacts, no timeout or maxBuffer (1 MiB default). A failed run reopens the verification checkpoint.
- Evidence normalizer src/context/evidence.js is the single place where convergence, knowledge and integrity resolve citations.
- Skill Registry v8 has no optional skills: checkpoint and `skill --work` reject skills outside the pinned chain. Agent Contract v9, bootstrap v3.
- config.yaml v1: init writes no optional blocks; validation tolerates absent ones.
- CTX-0031: YallaFlow makes no network calls.
- Runtime: @playwright/cli 0.1.22 is installed with video-start/stop/chapter, tracing, screenshot and state-load. gh CLI is not installed. The Atlassian MCP is unauthenticated. Agent integrations vary in practice.

## Architecture / Technical Decisions

Classify only relevant decisions as confirmed, proposed, unresolved, or not applicable.

**Confirmed (developer approval 2026-10-19, SRC-0002; Q-001…Q-005 resolved):**
- Q-001: agent-acquired tickets by default. An explicit opt-in `--fetch` is read-only, takes credentials from env or existing secure auth only, never persists them, and has no implicit network access.
- Q-002: QC and demo records are separate from the V-### verification ledger, which is unchanged.
- Q-003: Skill Registry v9 adds on-demand skills. They are invocable on any routed work at any stage, including DONE, without rerouting or reopening. They are never in a required chain and never auto-activated.
- Q-004: artifacts are local and binaries are git-excluded by default. Manifests, hashes and summaries are committed. A Markdown report is required; a standalone dependency-free HTML report is included. Links are relative and resolve locally. No uploads.
- Q-005: QC policy is advisory (default) or strict (explicit opt-in). In strict mode, required scenarios must pass for quality approval. Quality approval is distinct from DONE, and DONE semantics are unchanged.
- QC and Smart Demo are fully independent, and both are off unless requested. Demo scenarios are prioritized and approved before recording, and recording stays optional.

**Agent-owned (low risk):**
- Import is read-only, with no tracker writeback.
- Jira Cloud and Azure DevOps Services come first, with a configurable base URL.
- Imported text is untrusted data.
- No new runtime dependency.
- New modules are lazy-imported, so the normal path pays nothing.
- New ledgers start at schemaVersion 1. Existing schemas are unchanged.
- Release is MINOR 1.1.0.

**Not applicable:**
- Bundling Playwright or browsers.
- Background services.
- Telemetry.
- Hosted storage.

## Design

### Connected Requirements
- **Ticket bundle.** A provider-neutral JSON shape for one ticket. It holds:
  - identity: provider, instance, key, url, revision/updatedAt, fetchedAt;
  - content: title, type, state, description, acceptanceCriteria[], comments[], attachments[], labels, links.
- **Adapters.** `src/intake/providers/{github,jira,azure-devops}.js`. Each exports `parseRef`, a pure `normalize(raw)` that maps raw API JSON to a bundle, and `fetch(ref,{env,config,fetchImpl})`.
- **Input paths.** Both paths run through the same normalizer:
  - The agent saves the raw output of its own tool (for example `gh issue view --json`, a Jira MCP result, or an ADO REST JSON) and runs `yallaflow intake ticket <file> --provider github|jira|azure-devops [--work ID]`. YallaFlow stays offline, and the agent doesn't spend tokens rewriting the payload.
  - With Q-001 approved, `yallaflow intake ticket github:o/r#12 | jira:KEY-1 | ado:org/proj#45 --fetch [--attachments]` fetches it directly. It uses read-only GET and env tokens (GITHUB_TOKEN, YALLAFLOW_JIRA_EMAIL+YALLAFLOW_JIRA_TOKEN, AZURE_DEVOPS_EXT_PAT). The host comes from optional `requirements.providers.<p>.baseUrl`. Tokens are never persisted.
- **Persistence.**
  - The ticket becomes one native-text SRC: rendered Markdown of the body, AC and selected comments (the 20 most recent non-bot comments by default), with `metadata.external` holding the identity fields plus acquiredBy.
  - Each attachment becomes its own SRC through the existing file pipeline and limits.
  - A re-import is a new SRC, and `source list` flags the newer revision.
- **Lifecycle.**
  - Without --work, the import creates a pending intake (like `intake <file>`), titled from the ticket.
  - With --work, it is `intake add`, so a source impact is raised when intent is already fixed.
  - The agent then records REQ/AC with `{type:'source', locator}`. YallaFlow never auto-extracts them. There is no parallel workflow.

### Optional AI QC
- Runs only when the developer asks. Nothing runs on init, finish or task completion. The optional `quality.qc` config holds defaults only (baseUrl, start hint).
- **Execution.**
  - An existing Playwright suite runs through `yallaflow verify -- npx playwright test …`. Two small fixes are needed: a larger maxBuffer and an optional timeout.
  - Functional and exploratory testing is agent-driven. playwright-cli is preferred because it is cheaper in tokens than MCP accessibility snapshots. Playwright MCP is used where that is what the agent has.
- **Plan.** `yallaflow qc plan <work> --file plan.json` scopes scenarios from active AC: about one functional scenario per AC, plus up to 3 exploratory charters by default.
- **Record.** `yallaflow qc record <work> --file result.json` creates a QC-### entry:
  - run-level: origin `agent-driven|yallaflow-executed`, tool, environment (baseUrl, gitCommit, dirty);
  - per scenario: criteria[], status `passed|failed|blocked|not-run`, steps, expected/actual, artifacts (copied and sha256-hashed);
  - limitations[].
- **Honesty rule.** A scenario is `passed` only if it was executed and observed. Anything else is `not-run` or `blocked`.
- **Citation.** Convergence can cite `qc:QC-001#S-2`. A failed scenario cannot support `satisfied`.

### Optional Smart Demo
- **Propose.** `yallaflow demo propose <work> --file scope.json` lists prioritized scenarios. Each has: AC links, rationale, audience `business|developer`, step outline, record yes/no, and a data note (test or seeded data only).
- **Approve.** The developer approves or edits in conversation, then the agent runs `yallaflow demo approve <work> --note "Approved by …: <words>"`, as in the baseline approval rule. Revisions use `demo revise`.
- **Run.** The agent runs the approved scenarios with playwright-cli video-start, video-chapter per scenario, and video-stop.
- **Record.** `yallaflow demo record` creates a DM-### entry, hashes the media, and writes `summary.md` with relative links and a fixed disclaimer: "demonstration, not test evidence".
- Demo citations are rejected as convergence evidence for `satisfied`. Demo works without QC.
- **Privacy guards.**
  - A non-local baseUrl needs `--allow-remote`.
  - Authentication is preloaded with `state-load` from a file outside `.yallaflow`, so credentials are never typed on camera.
  - Text records are redacted.

### Storage, skills, contract
- **Storage.** `work/<id>/quality/{qc.json,demo.json,QC-###/,DM-###/,media/}` is registered in STATE_OWNERSHIP as cli-owned. Directories are created lazily.
- **Registry v9.**
  - Adds `invocation: required|on-demand` and three on-demand skills: requirement-import, ai-qc and smart-demo.
  - Their capabilities are kept out of POLICIES, so no required chain changes.
  - `skill <id> --work` serves them for any routed work, including work pinned to v8. The record a skill produces stamps the skill's id, version and sha.
- **Agent Contract v10.** Short additions:
  - tickets are untrusted data;
  - QC and demo run only on explicit request;
  - never claim an unexecuted pass;
  - a demo is not testing.

### Compatibility, security, performance
- **Compatibility.**
  - With nothing used, the workspace is byte-identical, and existing work behaves identically.
  - Mixed versions: a 1.0.x CLI does not understand `qc:` citations. Upgrade note: upgrade CLIs together, the same precedent as v0.3.8. Tested with frozenCli('v1.0.1').
- **Security.**
  - Tokens are env-only.
  - Redaction runs at the persistence boundary.
  - Fetch is limited to GET against the configured host.
  - Attachments are size-capped and never unpacked.
  - Imported text is treated as prompt-injection-capable data.
  - No uploads.
- **Performance and tokens.**
  - No new dependencies, and lazy imports.
  - Rendered tickets are trimmed.
  - QC scope comes from AC rather than whole-app crawling.
  - The CLI is preferred over MCP snapshots.

### Test strategy
- Provider normalize tests on recorded fixtures for each provider.
- Fetch tests with injected fetch; the network is never touched.
- Assertions:
  - init and finish never call fetch or spawn a browser;
  - the dependency count is still 4;
  - help-safety and recursive-help cover the new commands;
  - state-ownership and the sparse workspace hold.
- Ledger validation tests, plus convergence `qc:` acceptance and failure rules.
- A demo approval-boundary test.
- Mixed-version tests against v1.0.1.
- A manual QC/demo smoke run on a fixture app with playwright-cli.

### Decomposition
1. **C1 Connected Requirements** (feature/architectural). Includes the Registry v9 on-demand mechanism and Contract v10.
2. **C2 Optional AI QC** (feature/architectural), depends on C1. Includes the shared quality artifact store.
3. **C3 Smart Demo & Recording** (feature/architectural), depends on C2's store only; it is functionally independent of QC.
4. **C4 Integration, docs, release verification** (release/architectural), depends on C1–C3. No publish, tag or push without approval.

## Specification

### Goal and Scope
v1.1.0 (MINOR) adds three optional capabilities. Each works on its own and is off unless requested: Connected Requirements, AI QC, and Smart Demo with recording.

**Excluded:**
- writeback to trackers;
- tracker webhooks and sync;
- bundling Playwright or browsers;
- background services;
- telemetry and uploads;
- auto-extraction of REQ/AC by YallaFlow.

### Actors and Permissions
- **Developer.** Requests imports, QC and demos, and approves demo scope.
- **Agent.** Acquires tickets, drives Playwright, and records results through the CLI.
- **YallaFlow.** Validates, persists, hashes, reports and governs. It performs network I/O only in `intake ticket --fetch`.

### Functional Requirements and Business Rules
**REQ-001 — Ticket import into the existing lifecycle.**
- `yallaflow intake ticket <payload-file> --provider github|jira|azure-devops [--work ID] [--reason TEXT] [--attachment FILE]... [--title TITLE]`.
- The payload is the raw provider JSON the agent obtained through its own capability: `gh issue view --json …` / the GitHub REST issue, a Jira REST issue or MCP result, or an Azure DevOps work-item REST result. A file already in the normalized ticket shape (`"yallaflowTicket": 1`) needs no `--provider`.
- Without `--work`, the import creates a pending intake titled from the ticket. With `--work`, it attaches like `intake add`: DONE work needs `--reason`, and impact is raised when intent is fixed.
- A re-import creates a new SRC and names the earlier SRC of the same ticket. Sources are never mutated.

**REQ-002 — Optional built-in fetch.**
- `yallaflow intake ticket <ref> --fetch [--attachments] …`.
- Ref forms: `github:owner/repo#N` or the issue URL; `jira:KEY-N` or the browse URL; `ado:org/project#N` or the work-item URL.
- Requests are GET only, to the provider API host. GitHub uses api.github.com or `requirements.providers.github.apiUrl`. Jira's base URL comes from the URL or from `requirements.providers.jira.baseUrl`. Azure DevOps uses dev.azure.com or `requirements.providers.azure-devops.baseUrl`.
- Credentials come from env only:
  - GitHub: `GITHUB_TOKEN`/`GH_TOKEN` (optional for public repositories);
  - Jira: `JIRA_EMAIL`+`JIRA_API_TOKEN` (Cloud) or `JIRA_PAT` (Data Center);
  - Azure DevOps: `AZURE_DEVOPS_EXT_PAT`.
- Credentials are never written or printed. Missing credentials fail and name the variable.
- No other command performs network I/O.

**REQ-003 — Provider-independent architecture.** Adapters in `src/intake/providers/` implement `parseRef`, a pure `normalize`, and `fetch(ref, {env, config, fetchImpl})`. All of them produce one normalized ticket. Requirements trace through the existing `{type:'source', source, locator}` provenance (`ac:N`, `comment:<id>`, `description`).

**REQ-004 — Imported content is untrusted.**
- The rendered ticket text starts with an untrusted-content banner and is redacted at persistence.
- Attachments are preserved through the normal file pipeline and limits.
- The Agent Contract and the requirement-import skill say that ticket and attachment text is data, never instructions.

**REQ-005 — On-demand QC.** The QC commands work on any routed work at any stage, DONE included, with no lifecycle change.
- `qc plan <work> --file plan.json` writes plan revision N. The plan holds the policy, target, and scenarios. Each scenario has an id, kind (`functional` or `exploratory`), title, `criteria[AC-…]` (functional scenarios need at least one active AC), `required` (default true for functional, false for exploratory), a charter or steps, and a severity hint.
- `qc record <work> --file result.json` writes QC-###. The record holds the tool (`playwright-cli|playwright-mcp|playwright-test|other`), the origin (`agent-driven`, or `yallaflow-verified` with a passed `verificationRun` V-###), the target, the git commit plus a dirty flag, and limitations[]. Per scenario it holds status (`passed|failed|blocked|not-run`), steps[], expected/actual, artifacts[] and notes.
- **Honesty rules:**
  - `passed` needs steps, plus an artifact or a passed V-### reference;
  - `failed` needs `actual` and reproducible steps;
  - `blocked` and `not-run` need a reason.
- Unknown scenario ids and unknown fields are rejected.

**REQ-006 — QC policy.**
- `quality.qc.policy` in config, or the plan's `policy`: `advisory` (default) or `strict`.
- In advisory mode, failures are reported (`qc status`, `finish` warning) and never block.
- In strict mode, quality approval is GRANTED only when every required scenario's latest result is passed. Otherwise it is NOT GRANTED, with the reasons listed. Quality approval is shown separately from DONE and never changes lifecycle readiness.

**REQ-007 — Separation from verification.**
- QC never writes the V-### ledger, progress or checkpoints.
- Convergence may cite `qc:QC-####S-…`. A passed scenario resolves as runtime evidence. A failed, blocked or not-run scenario cannot support `satisfied`.

**REQ-008 — On-demand Smart Demo, independent of QC.**
- `demo propose <work> --file scope.json`: prioritized scenarios. Each has an id, title, audience (`business|developer`), priority, `criteria[AC-…]`, rationale (business importance), steps, and `record` (bool). The proposal also lists excluded[] items with reasons.
- `demo approve <work> --note "Approved by …: <words>"` records the developer's explicit approval of that exact proposal revision.
- `demo record <work> --file result.json` writes DM-###. It is refused unless the latest proposal is approved, and every scenario must be in the approved set. Statuses are `shown|skipped|failed`. A video is optional.
- The summary always carries the disclaimer "A demonstration, not test evidence". `demo:` citations are rejected as convergence evidence.

**REQ-009 — Local artifacts and reports.**
- Artifacts are copied into `work/<id>/quality/media/<QC|DM-###>/` with their sha256 and size recorded. YallaFlow writes `media/.gitignore` (ignore everything but itself) unless `quality.media.commit: true`.
- `quality/report.md` and a dependency-free standalone `quality/report.html` are regenerated on every QC or demo write. They use relative links and flag missing local media.
- Nothing is uploaded.

**REQ-010 — On-demand skills.**
- Skill Registry v9 adds an `invocation` field (`required` default, `on-demand`), three skills (requirement-import, ai-qc, smart-demo) and capabilities `import|qc|demo`, none of them in any POLICY.
- `skill <on-demand> --work <any routed id>` serves the installed version for any pinned contract. QC and demo records stamp the skill id, version and sha256.
- Agent Contract v10 covers: untrusted tickets, QC and demo only on explicit request, no claimed pass without execution evidence, a demo is not testing, and demo approval is a human decision.

**REQ-011 — Compatibility and lightweight path.**
- Existing workspaces and work behave identically when the features are unused.
- No schema bump of existing files.
- Still four runtime dependencies. New modules are lazy-imported.
- A 1.0.1 CLI still reads a 1.1.0 workspace that hasn't used the features; the mixed-version caveat for `qc:` citations is documented.

### Workflows and Lifecycle
- An import enters as a source, followed by normal routing and requirement recording.
- QC and demo run beside the lifecycle. They never advance, reopen or block stages. The only lifecycle-visible output is the `finish` quality lines and convergence citations.

### Data and Integrations
- **Ticket source.** sourceType `file`, detectedFormat `ticket`. The original is `<provider>-<key>.json`, holding the raw payload. contentAvailability `extracted`, with extracted.txt holding the rendered Markdown. `metadata.ticket` holds provider, key, url, title, state, revision/updatedAt, acquiredBy, fetchedAt, comment and attachment summary, and previousSource.
- **New ledgers, schemaVersion 1:** `work/<id>/quality/qc.json` (plans[], runs[]) and `work/<id>/quality/demo.json` (proposals[], approvals[], runs[]).

### Validation and Error Behavior
- Validation runs before any write, and an invalid file mutates nothing.
- Artifact copy failure rolls back the run.
- Payload over 10 MB is rejected; attachments use the source limits.
- Network errors and non-2xx responses fail with the status and no partial source.

### Security and Privacy
- Tokens are env-only and never persisted or echoed. Fetch never follows redirects to another host.
- Redaction applies to all persisted text.
- A demo or QC target that is not local (anything but localhost, 127.0.0.1, ::1, *.local, *.test or *.localhost) requires `--allow-remote` on record.
- Skills require test or seeded data and an auth storage state kept outside `.yallaflow`.

### UI / Screens
- CLI output follows the existing outcome style.
- report.html is static, offline, has inline CSS and no scripts.

### Acceptance Criteria
- **REQ-001**
  - AC-001: A raw payload for each provider imports offline into one ticket source holding title, description, acceptance criteria where present, comments, attachment list and origin.
  - AC-002: Pending intake versus `--work` attach behave like `intake` / `intake add`, including the DONE `--reason` rule and impact.
  - AC-003: A re-import creates a new source that references the previous one, and the earlier source is unchanged.
- **REQ-002**
  - AC-004: `--fetch` issues only GET requests to the provider host, with env credentials that never appear in state or output. Missing credentials name the variable.
  - AC-005: init, brief, start, route, verify, finish, file intake and QC/demo commands never call fetch.
  - AC-006: Attachments become their own linked sources, downloaded only with `--attachments` or supplied with `--attachment`.
- **REQ-003**
  - AC-007: Each provider is a self-contained adapter with fixture-tested `normalize`.
  - AC-008: Requirements can cite a ticket source with a locator through existing provenance.
- **REQ-004**
  - AC-009: Ticket text is bannered and redacted, and the untrusted-content rule is in the contract and skill.
- **REQ-005**
  - AC-010: QC plan and record work on routed work at any stage, including DONE, without lifecycle change, and are refused for unrouted work.
  - AC-011: The honesty rules are enforced, and every scenario status carries its required evidence.
  - AC-012: No command starts a browser or server or runs QC implicitly.
- **REQ-006**
  - AC-013: Advisory failures are reported and never block finish.
  - AC-014: In strict mode, quality approval requires every required scenario to have passed. It is reported separately, and DONE is unchanged.
- **REQ-007**
  - AC-015: A `qc:` citation of a passed scenario resolves, while failed, blocked or not-run scenarios cannot support `satisfied`.
  - AC-016: QC never touches the V-### ledger or checkpoints.
- **REQ-008**
  - AC-017: A demo proposal works without any QC.
  - AC-018: Recording is refused without approval of the current proposal.
  - AC-019: A run without video is valid, and a video is stored hashed.
  - AC-020: The disclaimer is always present, and `demo:` citations are rejected.
  - AC-021: Remote targets require `--allow-remote`, and text is redacted.
- **REQ-009**
  - AC-022: Media is git-excluded by default with tracked manifests and hashes, and there is an opt-in to commit it.
  - AC-023: report.md and report.html are generated with relative links that resolve locally and flag missing media.
- **REQ-010**
  - AC-024: Registry v9 on-demand skills are served for any routed work and are in no policy. Existing pins are unchanged.
  - AC-025: Agent Contract v10 carries the new rules, and the bootstrap is unchanged.
- **REQ-011**
  - AC-026: The full existing suite passes, init output is unchanged apart from the contract version, there are still 4 dependencies, and a 1.0.1 CLI can read an unused-feature workspace.
  - AC-027: CHANGELOG, upgrade note and docs are updated, and there is no publish, tag or push without approval.

### Unresolved Items
None. Rulings recorded for agent-owned choices:
- QC and demo need no enable flag, because the request is the opt-in.
- Strict quality approval is computed, not a separate human sign-off.

## Implementation Plan

The parent decomposes into four children. Each child is bounded and inherits its criteria from this approved specification. Design and spec depth already live here, so the children carry no repeated spec or plan ceremony.

Governance commands use the installed, frozen `yallaflow` 1.0.1. That keeps lifecycle state independent of the in-development CLI under test. Tests exercise `node src/cli.js` in temporary workspaces only.

**C1 — Connected Requirements** (feature/bounded). Covers REQ-001…004 and the on-demand mechanism of REQ-010 (AC-001…009, AC-024).
- `src/intake/providers/{index,ticket,github,jira,azure-devops}.js`:
  - the normalized ticket shape and its validator;
  - `renderTicketMarkdown` with the untrusted banner;
  - per adapter: `parseRef`, `normalize`, and `fetch` with an injected `fetchImpl` (GET only, same-host redirects only, env credentials).
- `src/intake/ticket.js`: builds the Normalized Intake. The original is the raw JSON. The extracted text is the rendered Markdown. It also sets `metadata.ticket` and finds the previous source.
- `src/commands/intake.js`: `intakeTicketCommand`, reusing the `captureSources` / pending-intake / `addSourceToWork` paths. Attachments go through `prepareFileIntake`.
- `src/cli.js`: the `intake ticket` action, USAGE, NAMESPACE_ACTIONS and help. `source show` prints the ticket origin.
- Skills:
  - `src/skills/*`: the `invocation` field and REGISTRY_VERSION 9.
  - `src/behavior/constants.js`: capabilities `import|qc|demo`.
  - The requirement-import skill v1. The ai-qc and smart-demo skill files are added in C2 and C3, still under registry v9 because v9 is unreleased.
  - `skill --work` serves on-demand skills for any routed work.
- Tests: `test/ticket-intake.test.js` (fixtures for each provider, offline, re-import, DONE reason, impact, provenance locator, redaction, fetch stub and credentials), skills tests for on-demand behavior and v8 pins, and help-safety lists.

**C2 — Optional AI QC** (feature/bounded). Covers REQ-005…007 and the store part of REQ-009 (AC-010…016, AC-022, AC-023).
- `src/quality/{constants,store,artifacts,report,qc}.js`:
  - the ledger at `work/<id>/quality/qc.json`;
  - artifact copy with sha256 into `media/`, plus the `media/.gitignore`;
  - report.md and report.html;
  - the policy engine (advisory/strict) and the honesty validation.
- Commands: `qc plan|record|status`. A `qc:` citation in `src/context/evidence.js` maps to runtime evidence carrying `qcRunId` and `scenario`. Convergence refuses `satisfied` on a non-passed scenario.
- `finish` gains quality lines, shown only when quality records exist.
- STATE_OWNERSHIP gets `work/<id>/quality/`.
- verify gets a larger maxBuffer, so Playwright output is not truncated into a false failure.
- Skill `ai-qc` v1.
- Tests: `test/quality-qc.test.js`.

**C3 — Smart Demo & Recording** (feature/bounded). Covers REQ-008 and REQ-009 (AC-017…023).
- `src/quality/demo.js`: propose, approve (bound to the proposal sha256), record, and the summary with its disclaimer.
- `demo:` citations are rejected.
- The `--allow-remote` guard applies to QC and demo.
- Reports gain a demo section.
- Skill `smart-demo` v1.
- Tests: `test/quality-demo.test.js`, plus a smoke run with playwright-cli against a local static fixture page, outside the suite.

**C4 — Integration, docs, release verification** (release/bounded). Covers REQ-011, REQ-010 and the contract (AC-025…027).
- Agent Contract v10 and its tests.
- Version 1.1.0 in package.json and `src/version.js`.
- CHANGELOG, `docs/upgrading-to-v1.1.md`, and docs: cli, using-yallaflow, security, limitations, architecture, roadmap, README.
- A mixed-version test against frozen v1.0.1.
- A `agent refresh` of this repository.
- The release checklist from docs/releasing.md.
- Stop before commit, tag or publish, for approval.

**Verification per child:**
- `npm run check`: syntax plus the full suite.
- Targeted tests.
- Per C4: `npm pack --dry-run`, a provider/network scan, a secret scan and `git diff --check`.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0001
**Type:** file
**Name:** v1.1.0-product-brief.md

Raw source preserved in: `.yallaflow/sources/SRC-0001/v1.1.0-product-brief.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0002
**Type:** file
**Name:** v1.1.0-architecture-approval.md

Raw source preserved in: `.yallaflow/sources/SRC-0002/v1.1.0-architecture-approval.md`. Read it directly; it is not duplicated here.
