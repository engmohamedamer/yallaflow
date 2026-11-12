# PF-0123 — v1.5.2 console refinement: Tailwind CSS on the existing console, connect existing projects from the console, guided agent setup, mandatory project readiness, Workspace navigation, real + Create Work, clearer Setup & Run, reliable clipboard, fewer redraws

## Raw Request

v1.5.2 console refinement: Tailwind CSS on the existing console, connect existing projects from the console, guided agent setup, mandatory project readiness, Workspace navigation, real + Create Work, clearer Setup & Run, reliable clipboard, fewer redraws

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-11T08:30:21.190Z
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

- Owner (SRC-0064): keep the existing console design; improve it with Tailwind; no React/Preact or other framework; Tailwind is built at development/publish time only; the package ships the generated CSS.
- Owner (SRC-0064): merge Flow and Work into one Workspace page; no sidebar or extra navigation layer.
- Owner (SRC-0064): installs only after showing the exact command and an explicit approval; never sudo; subscription sign-in only; Claude Code stays experimental.
- Assumption (clarification): baseline approval stays the developer's explicit decision to the agent; the console guides and links, it does not approve by itself.

## Discovery

- Rendering: `render()` (resources/console/app.js:3082) rebuilds `#app.innerHTML` on every SSE change, and Setup polls every 3 s (app.js:2219). Nothing compares old and new output, so identical data still rebuilds the DOM under the pointer: lost clicks, flicker, focus/value restore hacks (data-keep, rtFormBusy, setupOpen).
- Registration: `workspaceRoot()` refuses a folder without `.yallaflow` (src/console/greenfield.js:63-76, 422 NOT_A_YALLAFLOW_PROJECT); the folder chooser disables "Add" for it.
- Init: `initProject()` (src/commands/init.js:18) checks bootstrap installability read-only, creates the workspace, installs AGENTS.md/CLAUDE.md managed blocks, and rolls back byte-exact on failure. Preview data exists: `inventoryRepository`/`classifyProject` (src/inventory/inventory.js), `inspectAllBootstraps` (src/agent/bootstrap.js).
- Understanding: Core refuses start/route before baseline approval (PROJECT_UNDERSTANDING_REQUIRED, mapped in src/console/create.js:56); `overview --json` reports `understanding.state` and the ask text.
- Agents: `detectCodex` (src/agents/detect.js) checks binaries and adapter version only; the ChatGPT login is proven by `CodexSession.handshake()` (src/agents/codex.js:129). Codex CLI 0.167 has `codex login status` and `codex login --device-auth`. Claude detection code ships only in development builds (src/agents/experimental.js).
- Navigation: 7 tabs (app.js:211); hash routes #/map #/lines #/item/<id> #/agents #/setup #/overview #/insights #/team #/projects #/new.
- New column `+` is `<span class="st-ico" aria-hidden="true">` (app.js:297).
- Clipboard: `copy()` (app.js:1471) uses only `navigator.clipboard.writeText`; on failure it shows the raw text with no failure message.
- Tests: console-server.test.js fetches /app.js and /app.css; console-presentation.test.js reads app.js text.
- Tailwind 4.3.5 (npm). Trial build in scratch: `@import "tailwindcss/utilities.css" prefix(tw)` emits unlayered `tw:`-prefixed utilities only for classes used; `@theme inline` maps colours to the console's own CSS variables (themes keep working); no preflight.

## Architecture / Technical Decisions

- Proposed: Tailwind v4 CLI as pinned devDependencies; input `resources/console/tailwind.css.src` (not served), output `resources/console/tw.css` (minified, committed, shipped through `files: resources`), linked after app.css; prefix `tw:`; no preflight; colours, radius and fonts mapped to the existing tokens; `@source` app.js. `npm run build:css`; `prepublishOnly` builds; a test fails when tw.css is stale.
- Proposed: readiness is derived on each request, never stored; enforcement in the console server's write handlers; Core stays the final authority.
- Proposed: connect = server preview (read-only inventory + bootstrap plan + hash) and `yallaflow init` through the runner, then the existing `registerRoot`.
- Proposed: machine endpoints for agent setup; installs and sign-in run as background jobs with streamed status; argv only, scrubbed environment, no shell, no sudo.
- Proposed: render skips identical output and defers while a pointer is pressed or a control is being used.
- Not applicable: Core workflow semantics, CLI and JSON contracts (unchanged).

## Design

One idea per area, inside the existing screens:

1. **Tailwind on the current UI.** Same colours, fonts and layouts. Tailwind utilities are used for the new and touched components (header, readiness, connect, agent setup, Setup & Run, copy dialog, state messages) and to tidy spacing/typography of cards and station columns. app.css stays; nothing is rewritten wholesale.
2. **Header:** Workspace · Agents · Setup & Run · Project · More (Insights, Worktrees). Workspace has a Flow | List switcher in its page header; the last choice is remembered. Old routes keep working.
3. **Readiness card** (Workspace and Project pages, only when something is missing): one line per step with its single next action. A small readiness dot next to the project name.
4. **Connect a folder:** the existing folder chooser labels each folder (YallaFlow project / existing code / empty). Existing code → "Set up YallaFlow here" → a preview panel (detected stack, uncommitted changes untouched, exact files) → confirm → init → opens the project on its readiness, whose next step is "Start project understanding" (agent chat with the prepared message).
5. **Agent setup:** one compact "Agents" panel, shown as a strip on first open when something is missing and kept in Setup & Run: Codex (CLI, adapter, sign-in, Test connection), Claude Code (installed? experimental). Each missing part has one button: Install (shows the command + checkbox) · Sign in (device code) · Test.
6. **`+` on New:** a real button opening the existing Create Work form.
7. **Setup & Run:** top status (ready / N of M running / Start-Stop / links); failed service expanded with last log lines and Restart / Logs / Ask the agent; first-time steps ordered (Agents → Stack → Services, runtime optional); advanced sections collapsed.
8. **Copy:** async API → selection fallback → manual-copy dialog; accurate message per kind.
9. **Redraws:** skip identical renders; defer while interacting; keep scroll positions.
10. **Folder picker** (the existing dialog, redesigned, one component for both uses): a breadcrumb bar (home → … → current, each segment clickable) with Up; a filter field that narrows the list as you type; a "Recent" row (saved projects and recently chosen locations); one row per folder with an icon and a plain label (YallaFlow project · Laravel · Node.js · … · empty); the selected folder's full path in a footer with the one primary action, whose wording follows the folder kind (Open project / Set up YallaFlow here / Create the project here); a path field for typing or pasting a path (validated by the server); "New folder" in the new-project flow. Arrow keys move, Enter opens, Backspace goes up, typing filters.

## Specification

### Goal and Scope

Make the existing console easier for a first-time developer and more polished for existing users, without changing its identity, workflows or CLI. In scope: REQ-001..REQ-011 below. Out of scope: new frameworks, new navigation layers, Core workflow changes, Windows support, Claude Code release enablement, baseline approval inside the console.

### Actors and Permissions

- Developer using the console with the per-run token (unchanged).
- Read-only console: sees readiness and agent status; every new action is refused (405) and replaced by the CLI command.
- New write actions (connect/init, install, sign-in, verify) require the token, the console Origin, JSON, and an explicit confirmation; install additionally binds a plan hash.

### Functional Requirements and Business Rules

- REQ-001 Tailwind foundation on the existing console; built at development/publish time; the package ships the generated CSS. (SRC-0064 §1, §8)
- REQ-002 Polish of existing components (typography, spacing, buttons, status, cards, station columns, loading/error/success/empty states, keyboard) without new layouts. (§1)
- REQ-003 Connect an existing folder from the console using the canonical init. (§2A)
- REQ-004 Guided agent setup: detect, install with approval, subscription sign-in, verified connection; Claude Code stays experimental. (§2B)
- REQ-005 Mandatory readiness derived from Core state, enforced on the server, without blocking onboarding/recovery/read-only use. (§2C)
- REQ-006 Simplified navigation with a Workspace (Flow + List); deep links keep working. (§3)
- REQ-007 The New-column `+` is a real Create Work button. (§4)
- REQ-008 Clearer Setup & Run. (§5)
- REQ-009 Reliable, honest clipboard. (§6)
- REQ-010 Fewer redraws; no lost clicks, focus, values or scroll. (§7)
- REQ-011 Compatibility and safety: tests, contracts, read-only, old projects. (§8)
- REQ-012 A clearer, faster folder picker used everywhere the console asks for a project folder: breadcrumbs, up/back, filter, recent locations, folder kinds (YallaFlow project / existing code with framework hint / empty), full selected path, safe manual path entry, create a new folder when creating a project, keyboard/RTL/LTR; connected to the init preview for existing code and to the wizard's destination checks for new projects. (owner addendum, 2026-11-11)

Rules:
- Readiness steps: `initialized` (workspace present and readable), `understanding` (Greenfield: not applicable; Brownfield: required until `PROJECT_UNDERSTANDING_ESTABLISHED`), `agent` (required for agent sessions and queue runs only), `runtime` (optional; blocks only Start project).
- Work creation is refused before understanding is established. Queue runs are refused when the agent is not ready, or before understanding unless every work item in the run is the understanding (baseline) item. Agent sessions are always allowed when agents are on, so the agent can establish understanding.
- Always allowed: every GET, connect/init, agent setup, setup scan/steps, runtime actions, project removal, gate decisions, read-only use, the CLI.
- Greenfield projects are never gated on understanding: they can record their first requirements and create their first work item immediately (owner condition 2).
- Folder picker: browsing stays home-bounded, hidden folders stay excluded, symlinks only when their real target is a directory inside home; folder kinds come from `lstat` of marker names only (`.yallaflow`, `.git`, `composer.json`+`artisan` → Laravel, `package.json` → Node.js, `pyproject.toml`/`requirements.txt` → Python, `go.mod` → Go, `Gemfile` → Ruby, `pom.xml`/`build.gradle` → Java, `Cargo.toml` → Rust); no file content is read. Manual path entry is resolved by the same `resolveInsideHome` checks. Creating a folder: one new segment (no separators, not hidden, safe characters), created with a non-recursive mkdir inside a real home-bounded parent.

### Workflows and Lifecycle

1. First open → machine check (non-blocking) → strip if Codex is missing or signed out.
2. Projects → Add an existing folder → classify → (existing code) preview → confirm → `yallaflow init` → register → project opens on Workspace with the readiness card → "Start project understanding" → agent drafts baseline → developer approves to the agent → readiness becomes Ready → Create work (header or `+`).
3. Returning user with an approved project: no readiness card; everything as today.

### Data and Integrations

- New POST: `/api/fs/mkdir` `{ parent, name }` (new-project flow only; non-recursive; refused in read-only).
- New GET: `/api/fs/connect-preview?path=`, `/api/p/<id>/readiness`, `/api/machine`, `/api/machine/jobs/<job>`.
- New POST: `/api/projects/connect` `{ root, confirm:true, planHash }`; `/api/machine/codex/install` `{ confirm:true, planHash }`; `/api/machine/codex/login` `{ confirm:true }`; `/api/machine/codex/verify` `{}`.
- Commands run: `yallaflow init` (runner), `npm install -g <missing packages>`, `codex login --device-auth`, `codex login status`, `npm prefix -g`, the Codex ACP adapter handshake. No credential is read or stored by YallaFlow; the device link and code printed by Codex are shown to the user.

### Validation and Error Behavior

- Connect: path must be inside home, not hidden, a real folder, not inside another YallaFlow workspace or a lane; plan hash must match the fresh preview; unsafe bootstrap states (hand-edited, newer, broken) refuse with the reason and write nothing; init failure reports Core's message (rolled back).
- Install: refused when nothing is missing, when the npm global prefix is not writable (EACCES-safe message with the command to copy), in read-only, or on a stale plan hash; one job at a time; timeout 10 min; output kept as a short tail.
- Readiness refusals: HTTP 409 `PROJECT_NOT_READY` / `AGENT_NOT_READY` with `{ readiness }`.
- Copy: success only after a confirmed write.

### Security and Privacy

- No shell anywhere; argv with a scrubbed environment (PATH, HOME, LANG, USER, TMPDIR, npm config only); never sudo; API-key variables stripped as today; YallaFlow never reads Codex credentials.
- New routes follow the existing token + Origin + content-type + confirmation pattern; read-only refuses them.
- The repository preview reads manifests/inventory only inside the chosen home-bounded folder; secrets are never shown (inventory does not read .env values).
- CSP unchanged (`style-src 'self' 'unsafe-inline'`, `script-src 'self'`); tw.css is a static same-origin file.

### UI / Screens

Existing screens only: header, Workspace (Flow/List), Projects + folder chooser, Setup & Run, Project overview. Arabic RTL and English LTR, light and dark, mobile widths.

### Acceptance Criteria

AC-001..AC-021 are recorded in requirements.yaml (`yallaflow requirement list PF-0123`).

### Unresolved Items

- Whether `codex login --device-auth` behaves the same on macOS (verified on Linux only in this session) — recorded as a limitation if not testable.

## Implementation Plan

Phases (each ends with tests passing):

1. **Redraw + clipboard** (REQ-009, REQ-010): render skip/defer, scroll keep; honest copy with fallback dialog. Browser test: click during forced updates; copy granted/denied.
2. **Tailwind foundation** (REQ-001): devDependencies (tailwindcss, @tailwindcss/cli 4.3.5 pinned), input file, `build:css`, `prepublishOnly`, UI_FILES + index.html link, freshness test, `npm pack --dry-run` check.
3. **Navigation + `+`** (REQ-006, REQ-007): Workspace tab with Flow/List switcher, More menu, route compatibility, real `+` button.
4. **Readiness** (REQ-005): readiness endpoint, server guards, readiness card + header dot, start-understanding action. Server tests per fixture (approved Brownfield, Greenfield, unapproved Brownfield, read-only).
5. **Folder picker + connect existing project** (REQ-012, REQ-003): picker redesign inside the existing dialog (breadcrumbs, up/back, filter, recent locations from the saved project list and recent choices, kind labels from marker names, full path, manual path entry, keyboard, create folder in the new-project flow) used by both the existing-project and new-project paths; then `connect-preview` + `projects/connect`, folder chooser labels, preview panel. Tests with a Laravel-like fixture: preview, hash mismatch, hand-edited CLAUDE.md refusal (no writes), success registers and lands on readiness.
6. **Agent setup** (REQ-004): `/api/machine`, jobs, install/login/verify, compact Agents panel + first-open strip. Tests with fake `codex`/`codex-acp`/`npm` executables on PATH.
7. **Setup & Run** (REQ-008) and **polish pass** (REQ-002) with Tailwind.
8. **Verification**: full `npm test`, syntax check, browser regression (before/after screenshots ar/en × light/dark × desktop/390 px), package contents, convergence on AC-001..AC-021.

Owner conditions (approval 2026-11-11): preserve UI identity; readiness respects project type (Greenfield never gated); safe agent setup (explicit approval; connection test leaves no session or work running and changes no code); redraw fixes keep permissions, failures and live agent states prompt; never overwrite/reset/stage/discard unrelated changes (PF-0119 release records included); baseline recorded first; phase-by-phase tests and browser checks; no breaking changes; stop and return on significant architectural change, security risk or requirement conflict; no commit/push/tag/publish without approval.

Risks: scope size (mitigated by phases and tests per phase); Tailwind/app.css interplay (prefix + no preflight, verified in trial); device sign-in variance across Codex versions (status re-checked, copy fallback); npm global installs on macOS system Node (prefix check, never sudo).

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0064
**Type:** file
**Name:** v152-brief.md

Raw source preserved in: `.yallaflow/sources/SRC-0064/v152-brief.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0065
**Type:** file
**Name:** picker-addendum.md

Raw source preserved in: `.yallaflow/sources/SRC-0065/picker-addendum.md`. Read it directly; it is not duplicated here.
