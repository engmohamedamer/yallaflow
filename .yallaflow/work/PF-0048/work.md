# PF-0048 — New Project Wizard: project name, location and stack selection using pinned official generators or an agent-recommended setup, a reviewable plan before anything is created, staged and auditable creation, YallaFlow init and a first setup work item, from the CLI and the Console

## Raw Request

New Project Wizard: project name, location and stack selection using pinned official generators or an agent-recommended setup, a reviewable plan before anything is created, staged and auditable creation, YallaFlow init and a first setup work item, from the CLI and the Console

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-07T02:34:32.673Z
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

Chosen: generation in a fresh staging directory under the chosen parent, then a same-filesystem rename only if the destination is still absent; recommendations come from the developer's own agent through `yallaflow new plan --rationale`. Rejected: generating directly into the destination; YallaFlow calling a model.

## Specification

### Scope
New Project Wizard: name, location, stack selection, official generators or an agent-recommended setup, a reviewable plan, staged creation, YallaFlow `init` and a first setup work item. Sources: SRC-0039 (Wizard) and SRC-0038 (owner decisions 2026-11-07). Linux and macOS. Windows refused with a clear message.

### Steps (CLI and Console)
1. **Identity.** Project name (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) and a parent folder. The destination `<parent>/<name>` must not exist, the parent must exist, be a directory, and be writable, and paths are canonicalized with realpath. A parent inside an existing `.yallaflow` workspace or a Git working tree is refused unless `--allow-nested` is given.
2. **Stack.** A fixed catalog of official generators, each pinned to an exact version:
   - Laravel: `composer create-project laravel/laravel@<ver> <dir>`
   - React + Vite: `npm create vite@<ver> <dir> -- --template react-ts`
   - Vue + Vite: `npm create vite@<ver> <dir> -- --template vue-ts`
   - Next.js: `npx --yes create-next-app@<ver> <dir> --ts --eslint --app --use-npm --no-src-dir --import-alias @/*`
   - NestJS: `npx --yes @nestjs/cli@<ver> new <dir> --package-manager npm --skip-git`
   - Empty: no generator.

   Versions and arguments are verified against official documentation when implemented, and the catalog records the documentation URL for each entry. Prerequisites (php+composer, node+npm) are checked with `--version` only, and missing tools are reported, never installed.
3. **Recommendation (optional).** The wizard never calls a model itself. "Recommend for me" gives the developer a copyable request for their own coding agent. The agent answers by running `yallaflow new plan ... --rationale "<why>"`, which writes a plan like any other. The rationale is shown, and nothing is preselected silently.
4. **Plan.** `yallaflow new plan --name N --parent DIR --stack S [--option k=v]... [--rationale TEXT] [--json]` writes an immutable plan to the user-level config folder (`$XDG_CONFIG_HOME/yallaflow/new-projects/<plan-id>.json`, mode 0600, never inside a repository). The plan contains:
   - destination, generator id, pinned version, the exact argv, working directory and environment names
   - network and download notice, prerequisites with the detected versions
   - post-steps (`yallaflow init --name N --type greenfield`, the first work item)
   - its content hash
5. **Review → create.** `yallaflow new create <plan-id> --confirm <hash-prefix>` executes only a plan whose hash matches.
   - **Staging.** The generator runs in a fresh staging directory `<parent>/.yallaflow-new-<random>/`. Its argv targets a fixed child of staging, with `shell: false` and a scrubbed environment (PATH, HOME, LANG, TERM, USER, TMPDIR, npm/composer cache variables).
   - **Promotion.** If the generator succeeds and its expected output exists (for example `artisan` or `package.json`), the output is renamed (same filesystem) to the destination, only if the destination is still absent.
   - **Init.** `yallaflow init` and the first work item then run inside the new project.
   - **Failure.** Staging is kept with its log, nothing is promoted, and existing paths are never touched. Retry creates a new staging directory and never reruns completed post-steps; the plan records step completion. Cleaning up staging is an explicit `yallaflow new discard <plan-id>`.
   - **Hooks.** Generated hooks and post-install scripts are never run beyond what the official generator itself runs.
6. **First work item.** `yallaflow start --keep-active -- "Set up <name> (<stack>): confirm local setup, runtime profile and first requirements"`. It is left for the developer and their agent, with no routing on their behalf.
7. **Console.** The wizard's form shows every plan field and the network notice. Create needs the plan hash prefix typed or clicked as confirmation, and progress, log and failure-recovery states are shown. On success it offers "Add to console" (the existing `console add`). It is served by fixed POST routes `/api/new/(plan|create|discard)` with the console guards (token, Origin, JSON, size), is disabled on a read-only console, and never accepts a free-form command.

### Security
- Only catalog generators run, by argv. No user-supplied command, template URL or arbitrary package name.
- Option values come from enumerations.
- The destination is checked before and after generation.
- Symlinks in the parent path are resolved, and staging under a symlinked parent that resolves elsewhere is refused.
- No credentials are requested or stored. Generator logs are redacted on display.

### Owner decisions (SRC-0041, 2026-11-07) — binding constraints
- **Greenfield by provenance.** Projects created from an explicitly selected catalog generator through `yallaflow new create` are Greenfield. `new create` writes `project.origin = { createdBy: "yallaflow new", generator, generatorVersion, template, stack, planHash, createdAt }` into the new project's `config.yaml` through Core init. `assessProjectUnderstanding` treats a recorded wizard origin as Greenfield intent. Nothing else changes: an existing repository, or a folder without wizard provenance, follows today's discovery and baseline rules.
- **Genuinely new location.** The destination must be absent before planning and again before promotion. An existing repository is never overwritten or re-labelled.
- **Not understood or approved.** The project's state reads "created from <generator>; generated code not reviewed". No project-memory facts are created from generated code, and its architecture is never marked approved.
- **Review before execution.** The plan shows the selected stack, the expected generated structure (the catalog's documented top-level entries), and every command with its network and dependency-install effects. `create` requires confirmation (the hash prefix) for any plan that executes an external command or installs dependencies.
- **Failure.** Failures and partial creation keep staging and full diagnostics: generator log, exit code, step reached. Nothing is promoted.
- **Init.** It always goes through the canonical Core init. The first work item is created through Core for the developer to continue with Claude Code or Codex in the normal workflow, using their subscription.

### Unresolved Items — decision needing owner approval (compatibility / Core semantics)
Decided by the owner on 2026-11-07 (see Owner decisions above): wizard provenance is treated as Greenfield.
- **Generated projects and the understanding gate.** Core today treats any project whose repository contains manifests and source code as Brownfield, so it requires an approved baseline even when `init --type greenfield` was recorded. A freshly generated project (for example Laravel) would therefore be refused new work until a baseline is approved.
  - **Recommended: record wizard provenance.** `init` records `project.origin = { createdBy: "yallaflow new", generator, version, planHash, createdAt }` in `config.yaml`. Core treats such a project as Greenfield intent, with no baseline required for generator boilerplate. The provenance is visible in `brief` and `overview`.
  - **Alternative:** keep the current gate, and the wizard's last step asks the agent to establish project understanding of the generated code.
  - The recommended option changes Core's understanding gate (additive, only for wizard-created projects), so it is an explicit owner decision.

### Acceptance Criteria

AC-001..AC-006 in requirements.yaml (`work show PF-0048`).

## Implementation Plan

**Catalog** (`src/newproject/catalog.js`). Versions were pinned from the registries on 2026-11-07. Each entry carries id, label, stack (for overview/provenance), prerequisites with their `--version` probes, the argv template (the destination is the last fixed child of staging), whether it touches the network, whether it installs dependencies, the expected top-level structure, a success marker file and the docs URL.
- `laravel`: `composer create-project laravel/laravel:13.11.0 app` (PHP 8.3+, Composer; network; installs vendor dependencies). Marker `artisan`. Docs: https://laravel.com/docs/13.x/installation
- `react-vite`: `npm create vite@9.3.4 app -- --template react-ts --no-interactive` (Node; network; does not install dependencies). Marker `package.json`. The exact non-interactive flag is verified against `create-vite@9.3.4 --help` during implementation, and the catalog is corrected if it differs. Docs: https://vite.dev/guide/
- `vue-vite`: the same, with `--template vue-ts`.
- `nextjs`: `npx --yes create-next-app@16.4.5 app --ts --app --eslint --use-npm --no-src-dir --import-alias "@/*" --skip-install --disable-git`. Flags are checked with `--help` of 16.4.5 during implementation. Docs: https://nextjs.org/docs/app/api-reference/cli/create-next-app
- `nestjs`: `npx --yes @nestjs/cli@12.0.12 new app --package-manager npm --skip-git --skip-install` (flags checked with `--help`). Docs: https://docs.nestjs.com/cli/overview
- `empty`: no command; creates only the folder.

Dependency install is a separate, optional plan step (`npm install` or `composer install`), shown and confirmed explicitly. Laravel installs dependencies as part of `create-project`, and the plan says so.

**Core change** (`src/baseline/understanding.js`): when `config.project.origin.createdBy === 'yallaflow new'` and `kind === 'greenfield'`, `assessProjectUnderstanding` returns `GREENFIELD_UNDERSTANDING_FROM_INTENT` with `origin` and the label "created from <generator>; generated code not reviewed". All other paths are unchanged.
- `initWorkspace` gains an optional `origin` argument, used only by the wizard. It is validated (fixed keys, catalog generator id, hash format). `init --type` is unchanged for every other caller.
- `brief` and `overview` show the provenance. Overview adds an optional additive `project.origin`.

**Module** `src/newproject/` (plan.js, create.js, store.js):
- **Plans** live in `$XDG_CONFIG_HOME/yallaflow/new-projects/<plan-id>.json` (mode 0600) and contain the canonical plan, its hash, and step records (generated, promoted, initialized, workCreated).
- **Plan validation:**
  - name regex, parent realpath, destination absent
  - not inside a `.yallaflow` workspace or Git tree unless `--allow-nested`
  - parent writable (access check)
  - prerequisites probed with argv `--version` and a 5 s timeout
- **Create:**
  - verify the hash prefix
  - re-validate the destination absence
  - create staging with `mkdtemp` in the parent, run the argv (no shell; scrubbed environment: PATH, HOME, LANG, TERM, USER, TMPDIR, plus npm_config_cache/COMPOSER_HOME when set), log to `staging/.yallaflow-new.log`, 15 min timeout, own process group, killed on timeout
  - check the marker
  - `rename(staging/app, destination)` only if the destination is still absent (EEXIST → stop and keep staging)
  - run Core `init` with the origin through `initWorkspace` (in-process, the canonical Core)
  - create the first work item with `start --keep-active` in the new project
  - record each step; a retry skips completed steps
  - remove staging after success
- **Discard** removes only `staging` paths recorded in that plan, after checking they are under the plan's parent and carry the `.yallaflow-new-` prefix.

**CLI:** `yallaflow new catalog [--json]`, `new plan --name N --parent DIR --stack ID [--install] [--allow-nested] [--rationale TEXT] [--json]`, `new show <plan-id> [--json]`, `new create <plan-id> --confirm <hash-prefix>`, `new discard <plan-id>`, and `new recommend` (prints the request to give your agent). Schema `resources/schemas/new-project-plan-1.schema.json`.

**Console:**
- **Routes:** GET `/api/new/catalog`; POST `/api/new/plan`, `/api/new/create` (`{ planId, confirm }`) and `/api/new/discard`, all with the guards and 405 on read-only. Create runs asynchronously, and GET `/api/new/plans/<id>` returns step progress and the log tail.
- **"New project" dialog:** name, parent folder (typed path), stack cards with the network/install badges, the "Recommend for me" copy-request, and a review screen with the stack, structure, commands, network and install notices and the hash. Confirmation is required. The dialog shows progress, failure with the log and the staging path plus Discard/Retry, and on success "Add to console" (the existing registry) plus next steps for Claude Code or Codex.

**Tests** (`test/new-project.test.js`):
- plan validation: existing destination, nested, bad name, symlinked parent
- hash mismatch refusal
- the `empty` stack end to end
- a fake generator injected through a test-only catalog override (an environment variable recognized only under `NODE_ENV=test`, or a dependency-injected catalog in the module API) that succeeds, fails and times out
- destination created concurrently between plan and create → nothing promoted, staging kept
- retry skips completed steps
- discard scope
- provenance → Greenfield and start allowed; brownfield without provenance still refused
- the console routes and guards
- one real generator smoke test (react-vite through npm), run only when `YF_NETWORK_TESTS=1`, and documented

**Browser:** the wizard dialog with the `empty` stack and a fake failure, in three engines.

**Docs:** `docs/new-project.md`, cli.md, console.md, CHANGELOG.

**Review:** an independent security review on an isolated copy.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0038
**Type:** file
**Name:** owner-1.4-complete-scope.md

Raw source preserved in: `.yallaflow/sources/SRC-0038/owner-1.4-complete-scope.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0039
**Type:** file
**Name:** owner-1.4-continue.md

Raw source preserved in: `.yallaflow/sources/SRC-0039/owner-1.4-continue.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0041
**Type:** file
**Name:** owner-1.4-spec-decisions.md

Raw source preserved in: `.yallaflow/sources/SRC-0041/owner-1.4-spec-decisions.md`. Read it directly; it is not duplicated here.
