# PF-0069 — Agents in the project Setup page: scan the machine (Codex, Claude Code: installed, version, subscription login), choose the agents per project (Codex, Claude Code experimental) saved locally and git-ignored so the console applies it without flags or restarts, a connection checklist (channel connected, hooks reporting, permission mode known and allowed, launch files) with diagnostics and fixes; and no silent wait for Claude's permission mode at session start (SessionStart does not report it)

## Raw Request

Agents in the project Setup page: scan the machine (Codex, Claude Code: installed, version, subscription login), choose the agents per project (Codex, Claude Code experimental) saved locally and git-ignored so the console applies it without flags or restarts, a connection checklist (channel connected, hooks reporting, permission mode known and allowed, launch files) with diagnostics and fixes; and no silent wait for Claude's permission mode at session start (SessionStart does not report it)

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-08T00:21:34.898Z
**Workflow:** feature
**Required capabilities:** discover, clarify, brainstorm, specify, plan, implement, verify, converge, review
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, design-exploration, specification, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

Structured material questions are authoritative in `questions.yaml`.

## Confirmed Decisions

## Discovery

## Architecture / Technical Decisions

Classify only relevant decisions as confirmed, proposed, unresolved, or not applicable.

## Design

Chosen: one **Agents** section on each project's Setup page, backed by a per-project local file, and a per-project Claude connection in the bridge.
- **Saved choice:** `.yallaflow/local/agents.json` = `{ "schemaVersion": 1, "agents": true, "claude": false, "updatedAt": "…" }`. Git-ignored like the rest of `local/`, so it belongs to this checkout and this developer.
- **Bridge:** Claude moves from a console-wide flag to per project. A project gets a ClaudeLink, a bridge token and `agent-bridge.json` only when Claude is on for it (saved choice, the Enable dialog, or `--experimental-claude` for every project as today).
- **Mode at start:** the launch command ends with a quoted first prompt, so `UserPromptSubmit` reports the permission mode at once.

Rejected:
- one console-wide setting in the user config, because projects differ;
- writing the project's own `.mcp.json` or `.claude/`, because YallaFlow never changes repository files;
- sending messages before the mode is known, because bypass mode must never be served.

## Specification

### Goal and Scope
Make Setup the place to get a project running.
- **The stack:** scan it.
- **The app:** start the whole project and open its apps.
- **The agents:** a project setting instead of a console flag, with every connection step visible.

Revised after the owner's spec feedback (2026-11-08): "Add extra feature to scan the project stack and the ability to start the project and open the apps".
- **In scope:**
  - the Stack section on Setup: scan, rescan, and suggested services;
  - Start project, Stop project and Open app;
  - the Agents section on Setup: scan, choice, checklist and fixes;
  - the per-project saved choice applied at console start;
  - turning Claude on or off for a project while the console runs;
  - the first-prompt launch command;
  - picker links to Setup;
  - docs.
- **Out of scope:**
  - YallaFlow starting `claude` itself;
  - any API-key path;
  - changing Codex session behavior.

### Actors and Permissions
- **Developer:** chooses the agents for a project and runs the launch command. Choosing is a local preference, not a YallaFlow approval.
- **Console:** reads and writes only `.yallaflow/local/agents.json` and the existing local connection files. It does this through the server, never in `--read-only`.

### Functional Requirements and Business Rules
1. **Setup → Agents.**
   - For each provider it shows installed (path not shown), version, login method and plan, and problems.
   - **Rescan** clears the detection cache.
   - Claude detection runs only on this page, on Rescan, or when Claude is chosen.
2. **Choice.**
   - Toggles: **Agents for this project** (Codex), and **Also Claude Code (experimental)**, which requires agents on. Turning agents off turns Claude off.
   - Saving writes `agents.json` through a new server write route, POST `/api/p/<id>/agents/settings`. It has the same token and Origin checks as other writes and is refused in read-only.
3. **At console start** (no flags), for each project:
   - If `agents` is true, agents are enabled for the run.
   - If `claude` is true and the Claude files are included, Claude is on for that project.
   - Flags keep working (`--agents` for all projects, `--experimental-claude` for all projects).
4. **While the console runs:**
   - Turning Claude on for a project creates its link and bridge file immediately, even if agents were already on. This replaces the old "restart the console" limit.
   - Turning it off unlinks a linked Claude session, denies open requests, removes that project's `agent-bridge.json`, and refuses the channel from then on.
5. **Checklist** for a project with Claude on. Each step is ✓ or ✗ with a fix:
   - Claude Code ready (installed, version ≥ 2.1.234, claude.ai login);
   - launch files written;
   - channel connected;
   - hooks reporting (last hook time);
   - permission mode known — allowed, auto-approves (warning), or bypass (refused).

   Codex shows ready or not ready with its problems.
6. **Launch command:** the current command plus a quoted first prompt: `"Run yallaflow brief, then wait for messages from the YallaFlow console."`
7. **Picker:** when Claude is not on for this project, or Codex is not ready, the picker says so with **Open Setup → Agents**.
8. **Setup → Stack.**
   - It shows the project's stack from repository evidence: frameworks, runtimes, package managers, Docker files, and modules. It uses the same read-only Overview detection (`yallaflow.overview/1`, each entry with its file and basis), so `.env` files are never read.
   - **Rescan** re-reads it.
   - The runtime suggestions derived from the stack are listed beside it. **Add this service** adds one to the reviewed profile, as today. Suggestions never run.
9. **Start project / Stop project.**
   - **Start project** starts every trusted service of the profile in `dependsOn` order, one at a time, waiting for each one's readiness.
   - Services that are not trusted, or whose trust is stale, are not started. They are listed with **Review and trust**.
   - One service failing stops the sequence and reports it. Services already running are left as they are.
   - **Stop project** stops, in reverse order, only the services YallaFlow started (same rules as the per-service Stop).
   - Both go through the existing runtime commands and checks: trust, port ownership, and the per-service lock.
11. **First-time setup** (owner addition, 2026-11-08: "This should affect adding existing project for first time a way to scan and save these data is important").
    - **When it opens:** right after **Add an existing project**, or for any project without `.yallaflow/local/setup.json`. Setup opens in a three-step guided mode: **Stack** (the scan, shown), then **Services** (tick suggested services), then **Agents** (the choice above).
    - **Services:** ticked services are added to the reviewed runtime profile through `runtime add --from-suggestion`. They stay untrusted, and nothing runs.
    - **Agents:** the choice is saved to `agents.json`.
    - **Saved state:** `.yallaflow/local/setup.json` (`schemaVersion` 1, git-ignored) records:
      - `scannedAt`;
      - the scanned stack summary (component, version, kind, basis and file for each entry);
      - the services added;
      - the completed steps.

      Setup shows the last scan from it without rescanning. **Rescan** refreshes it and says what changed since the last scan.
    - **Optional:** the guided mode can be skipped, and it can be run again from Setup with **Run project setup again**. It is never forced on later visits.
10. **Open app.**
    - Every running service with a declared port shows **Open**, which opens `http://127.0.0.1:<port>/` in a new tab.
    - The profile may name the page to open with an optional `open` path per service (for example `/admin`). It is validated as a relative path, never a full URL.
    - Nothing is opened automatically.

### Workflows and Lifecycle
- **First time:** the developer opens Setup → Agents, turns agents on and ticks Claude, then sees the checklist. They press **Write launch files**, copy the command, and run it in the project folder. The checklist turns green step by step.
- **Every later console start:** the choice applies automatically.

### Data and Integrations
- New file: `.yallaflow/local/agents.json`, git-ignored and per checkout, with `schemaVersion` 1. It is not project memory and never committed.
- The session records and the bridge file are unchanged in format.

### Validation and Error Behavior
- An unreadable or invalid `agents.json` counts as "nothing chosen". Setup says so, and saving replaces the file.
- Claude chosen in a build without the Claude files shows "not included in this release" and opens nothing.
- A second console on the same checkout keeps the existing checkout lock behavior.

### Security and Privacy
- **Opt-in stays explicit,** but becomes persistent per checkout instead of per run. It is shown on Setup, and on the chat when on.
- **Never in `--read-only`.**
- **Unchanged protections:**
  - the bridge token never reaches the browser;
  - HMAC proof before the token is sent;
  - one channel per project;
  - bypass mode is refused.
- **Turning Claude off fully closes that project's bridge surface.**
- **The first prompt is fixed text from YallaFlow.** It contains no project data.
- **Independent security review** on an isolated copy before DONE.

### UI / Screens
- **Setup**, in this order:
  - **Stack** (scan, suggestions);
  - **Run** (Start project, Stop project, Open per running service, then the existing runtime service list);
  - **Agents** (scan, choice, checklist).
- **Chat picker:** Setup links.
- Arabic and English, light and dark, 1440 and 390 px.

### Acceptance Criteria
AC-001 … AC-010 as recorded in requirements.yaml (AC-007 … AC-009 added for the stack scan, Start/Stop project and Open app).

### Unresolved Items
- **The "no MCP server configured with that name" message.** Claude Code prints it with `--mcp-config`, yet the channel works in this repository's session. The real-session check will confirm on another project. If messages do not arrive, it is recorded as a limitation and a `/feedback` report, not worked around by editing the project's `.mcp.json`.

## Implementation Plan

1. `src/agents/settings.js`: read and write `agents.json` (safe local files, validation).
2. Bridge per-project Claude:
   - `claudeEnabled` becomes per project, with `enableClaude(projectId)` and `disableClaude(projectId)`;
   - the bridge file is written and removed per project;
   - `handleBridge` resolves the project from the token, so disabled projects are refused.
3. Server:
   - `GET /api/p/<id>/agents/settings` (choice, detection, checklist state);
   - `POST /api/p/<id>/agents/settings` (save and apply live);
   - on start, apply saved choices;
   - the launch command gets the first prompt.
4. UI: the Setup Agents panel (scan, toggles, checklist, launch files, copy command) and the picker links.
4c. First-time setup: `src/console/setup.js` reads and writes `.yallaflow/local/setup.json` (scan summary, steps). There is a guided mode on Setup, entered after Add an existing project or when the file is absent. Services are added through `runtime add --from-suggestion`, and the stack diff is shown on Rescan.
4b. Stack and Run:
   - the Setup Stack panel reuses the overview read;
   - `yallaflow runtime start-all|stop-all` (Core, dependsOn order, trusted only) with matching console write routes;
   - an optional `open` path in the runtime profile (validated);
   - **Open** links for running services with ports.
5. Tests:
   - settings read/write;
   - start-up apply;
   - live on/off;
   - read-only refusal;
   - checklist states with the simulated channel and hooks;
   - the launch command;
   - UI harness.
6. Docs: `agents.md`, `agents-claude-experimental.md`, `console.md`, CHANGELOG.
7. Verification:
   - full suite;
   - browser check;
   - independent security review on an isolated copy;
   - a real session on ~/YaSchools/portal with the owner (connected without typing first; chat both ways).

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
