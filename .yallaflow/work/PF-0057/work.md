# PF-0057 — Greenfield UX journey in the console: smart new-project stepper (idea, stack, environment, review), safe folder chooser, auto-register and open the new project, agent workspace discovery, guided runtime setup, git init, new-project overview

## Raw Request

Greenfield UX journey in the console: smart new-project stepper (idea, stack, environment, review), safe folder chooser, auto-register and open the new project, agent workspace discovery, guided runtime setup, git init, new-project overview

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-07T17:37:18.559Z
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

- Q-001: agents are enabled from the console by an explicit, confirmed action, only in a non-read-only console, for that run only; enabling never starts a session or activates work. Codex only; the excluded experimental Claude integration stays excluded.
- Q-002: no agent stack recommendation in this phase; Step 2 is manual with grouped stacks and trade-offs, and says plainly that agent recommendation is not available yet.
- Q-003: folder chooser lists directories only, inside the user's home folder, hidden folders excluded, no symlink escape, never writes.
- Q-004: the Docker choice is recorded and Docker presence is checked; no Docker files are generated in this phase.
- Owner request (SRC-0045 §3): ordinary creation no longer needs a typed hash prefix; the explicit Create action binds to the exact reviewed plan hash; stronger confirmation stays for higher-risk plans.

## Discovery

Mapping of the owner's findings (SRC-0045) to the 1.4.0 code, 2026-11-07:

- **Confirmed bugs** (fixed separately in PF-0058, bounded): Insights hid New work and counted closed work, showed 0% for 0/0 runs; first work item had a long generic title; generator wording for the empty stack; unquoted paths in displayed commands.
- **Missing UX wiring** (capability exists, the console does not use it): runtime services can be added (`runtime add`, `runtime add --from-suggestion`) but Setup only prints CLI commands; Core `titleHint` existed but the board ignored it; Codex sessions exist but only behind the `--agents` start flag with no in-console path; Overview has data for Greenfield projects but renders Brownfield-oriented empty cards.
- **Genuine Core/API gaps**: the console's project list is fixed at server start (no way to add the created project); no folder listing API; plans carry no intent, environment, Git or attachment data; console creation requires a typed hash prefix; no Git init operation; no tool availability check outside generator prerequisites; Overview JSON lacks origin/environment/Git facts; the Greenfield understanding label says "generated code not reviewed" for an empty project.
- **Deferred by owner decision** (Q-002, Q-004): agent stack recommendation before a project exists; Docker file generation.

## Architecture / Technical Decisions

Classify only relevant decisions as confirmed, proposed, unresolved, or not applicable.

## Design

## Specification

### Goal and Scope

Make the whole new-project journey work from the console: describe → stack → environment → review → create → open the new project → start with an agent → track progress, without CLI commands for the normal path. In scope: the stepper, folder chooser, automatic registration and switch, first-work intent and attachments, Greenfield Overview checklist, Flow/Work first-run guidance, agent enablement, guided runtime setup, Git init, cleanup of empty-project wording. Out of scope: agent stack recommendation, Docker file generation, Brownfield onboarding from the folder chooser, Windows support for the wizard/runtime (unchanged).

### Actors and Permissions

- Developer at the local console (token-authenticated, loopback only). A `--read-only` console offers none of the writes below.
- Core CLI remains the only writer of `.yallaflow` state; the console runs it with argv only.
- Coding agent (Codex, user's ChatGPT subscription through the installed adapter) — only after the developer enables agents for the run and starts a session.

### Functional Requirements and Business Rules

1. **Stepper** (console New project page): Step 1 Idea (name, description, optional requirements text, optional attachments, location via folder chooser or advanced manual path); Step 2 Stack (grouped Full-stack / Frontend / Backend / Blank, each with technologies, what it creates and trade-offs; a plain "agent recommendation is not available yet" note; manual override always); Step 3 Environment (Docker / Local tools / Decide later, each with its practical effect and a live tool check; Initialize Git repository checkbox, default on, with an explanation that no remote, commit or push happens); Step 4 Review & Create (friendly summary; technical details collapsed; what will and won't be created; one explicit Create button).
2. **Plan**: `yallaflow new plan` accepts optional `--description`, `--requirements`, `--environment docker|local|later`, `--git`, and attachment descriptors (name, size, SHA-256); all are inside the hashed plan body. Existing plans and flags keep working.
3. **Confirmation**: the console sends the full plan hash with the Create action; the server and CLI accept it only if it equals the stored plan's hash (a changed or stale plan is refused). A plan with the dependency-install step (runs package scripts) also requires typing the project name. The CLI's `--confirm <prefix>` path is unchanged.
4. **Creation steps** (Core): generate/create folder → promote → optional install → Core init with origin (adds environment, git choice, intent summary) → optional `git init` (no remote, no commit) → first work item (short title `Set up <name>` or the user's own goal; request = description + requirements, no invented criteria) → attachments linked to the first work item through Core intake, each verified against its planned SHA-256.
5. **Registration and switch**: when creation finishes, the console registers the project in the saved list (deduplicated by real path) and adds it to the running console; the page switches to it and opens its Overview. If registration fails after creation, the page says the project exists, why registration failed, and offers Retry, which only registers (never creates again).
6. **Folder chooser**: lists subfolders of a folder inside the user's home (directories only, hidden excluded, symlinks followed only when the target stays inside home), marking Git repositories, YallaFlow projects and empty folders; supports spaces and Unicode; also used for "Add an existing YallaFlow project" (registers it; a folder without YallaFlow gets an honest explanation that Brownfield onboarding is a separate step).
7. **Greenfield Overview**: setup checklist from canonical data (project created; goal recorded; requirements/attachments; stack; environment planned/configured; Git initialized or not; runtime services; first work item and its next valid action; agents available or not) with contextual actions (define requirements → first work item; configure runtime → Setup; initialize Git; start with an agent). No empty Brownfield cards for a new project; Brownfield Overview unchanged.
8. **Flow/Work first run**: when only New work exists, the Flow explains the stations; an unclassified item opens on Request/Next step, not an empty Delivery tab; "Work with an agent" is discoverable and explains activation vs. agent session; drag-and-drop rules unchanged.
9. **Agents**: the console shows agents as off / unavailable (adapter missing or not signed in, with the reason) / on. "Enable Codex for this session" (confirm dialog) turns the Agent Workspace on for the run; a work item can then open directly in it. No session starts and no work is activated automatically.
10. **Runtime setup**: Setup's empty state offers Configure: add a service from a detected suggestion (with its evidence) or manually (name, id, kind process/docker-compose, working folder, executable + arguments, ports, environment variable names, ready check, shared or local override). It runs Core `runtime add`; nothing starts; trust, start, stop, restart, status and logs keep their current guarantees.
11. **Git init** for a registered project without Git (Overview and Worktrees empty state): explicit action, refused inside an existing repository, no remote, no commit.
12. **Wording**: empty projects never mention generated code (including Core's understanding label).

### Workflows and Lifecycle

Plan (immutable, hashed) → explicit Create → background creation with recorded progress → registration → switch → Overview checklist → developer defines requirements / configures runtime / enables agent → activates the first work item explicitly → agent session started explicitly. Retry after a failure resumes from recorded progress; a finished plan is idempotent.

### Data and Integrations

- Plan body (schema `yallaflow.new-project-plan/1`, additive optional fields): `intent {description, requirements}`, `environment`, `git`, `attachments [{name, size, sha256}]`.
- `config.yaml project.origin` gains optional `environment` and `git` (additive; older CLIs ignore them).
- `overview --json` gains `origin` and `git {initialized}` (additive).
- Console registry file unchanged in format.

### Validation and Error Behavior

Names, paths, environment and attachment descriptors validated server-side and in Core; a hash mismatch, a missing or changed attachment, an existing destination, or a nested repository is refused with the reason and the next step. Partial success (created but not registered, created but an attachment failed) is reported as such, with a retry that never creates a second project.

### Security and Privacy

New or changed write-capable endpoints, all token + loopback + Origin checked, JSON-only, exact-field validation, disabled in `--read-only`: `POST /api/projects` (register a completed plan's project or an existing YallaFlow project inside home), `POST /api/agents/enable`, `POST /api/p/<id>/git/init`, `POST /api/p/<id>/runtime/services` (runtime add), `POST /api/new/create` (full-hash confirmation). New read endpoints: `GET /api/fs/dirs` (directories only, home-bounded, no files or contents), `GET /api/new/tools` (argv `--version` probes). Agent routes never gain filesystem browsing. Secrets never shown (environment variable names only). Independent security review of every new write endpoint on an isolated copy before DONE.

### UI / Screens

New project stepper (4 steps, progress indicator, back/next, keyboard accessible); folder chooser dialog; Greenfield Overview checklist; Flow first-run explanation; Work item Request/Next step first; agent state banner and enable dialog; Setup configure form; Git init action; Worktrees empty state. Arabic/English, light/dark, desktop/mobile.

### Acceptance Criteria

Recorded as AC-001 … in requirements.yaml (yallaflow requirement list PF-0057).

### Unresolved Items

None blocking. Deferred: agent stack recommendation (Q-002), Docker file generation (Q-004), Brownfield onboarding from the folder chooser.

## Implementation Plan

Slices, each with its tests, in this order (each keeps the suite green):

1. **Core plan & creation** (`src/newproject/project.js`, `catalog.js`, `src/commands/new.js`, `src/commands/init.js` origin): optional `intent`, `environment`, `git`, `attachments` in the plan body; catalog `category` + `tradeoffs`; full-hash confirmation accepted alongside the prefix; install plans need `confirmName`; `git-init` step (argv `git init`, refused if inside a repo); first work title from the user's goal; empty-template understanding label wording (`src/baseline/understanding.js`). Tests: new-project.test.js.
2. **Console server** (`src/console/server.js`, `newproject.js`, `registry.js`, new `src/console/folders.js`, `src/console/projects.js`): mutable project list with watcher attach; `GET /api/fs/dirs`, `GET /api/new/tools`; `POST /api/projects`; server-side registration at creation end with outcome in progress; `POST /api/p/<id>/git/init`; `POST /api/p/<id>/runtime/services` → `runtime add` argv; `POST /api/agents/enable` with lazy `AgentBridge`; WRITE_ROUTE extended; read-only refusals. Tests: new console-greenfield.test.js (routes, path boundaries, symlink escape, Unicode/spaces, duplicate registration, retry, read-only, origin/token).
3. **Overview data** (`src/overview/*`): additive `origin`, `git.initialized`. Tests: overview tests + snapshot/overview contract.
4. **Console UI** (`resources/console/app.js`, `app.css`): stepper with folder chooser dialog; attachments uploaded to the first work item after creation; auto switch to the new project; Greenfield Overview checklist + actions; Flow first-run note; Request/Next-step-first for unclassified items; agent state banner + enable dialog + "open in Agent Workspace"; Setup configure form; Git init action; Worktrees empty state.
5. **Docs & changelog** (`docs/new-project.md`, `docs/console.md`, `docs/cli.md`, `CHANGELOG.md`).
6. **Verification**: full suite; installed-package journey in an isolated config (empty + fake-generated project, spaces/Unicode path, attachments, environments, git, registration/switch, console and browser restart, agents on/off with a stub adapter, runtime configure without execution, failed + retried creation); browser matrix Chromium/Firefox/WebKit × EN/AR × light/dark × desktop/390 px; independent security review of every new endpoint on an isolated copy (real repo read-only); delivery convergence per AC; code review.

Rollback: all changes are additive behind the console and the optional plan fields; reverting the commits restores 1.4.0 behavior; no state migration.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0045
**Type:** file
**Name:** greenfield-ux-acceptance-round1.md

Raw source preserved in: `.yallaflow/sources/SRC-0045/greenfield-ux-acceptance-round1.md`. Read it directly; it is not duplicated here.
