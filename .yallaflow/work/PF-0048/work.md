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

### Unresolved Items — decision needing owner approval (compatibility / Core semantics)
- **Generated projects and the understanding gate.** Core today treats any project whose repository contains manifests and source code as Brownfield, so it requires an approved baseline even when `init --type greenfield` was recorded. A freshly generated project (for example Laravel) would therefore be refused new work until a baseline is approved.
  - **Recommended: record wizard provenance.** `init` records `project.origin = { createdBy: "yallaflow new", generator, version, planHash, createdAt }` in `config.yaml`. Core treats such a project as Greenfield intent, with no baseline required for generator boilerplate. The provenance is visible in `brief` and `overview`.
  - **Alternative:** keep the current gate, and the wizard's last step asks the agent to establish project understanding of the generated code.
  - The recommended option changes Core's understanding gate (additive, only for wizard-created projects), so it is an explicit owner decision.

### Acceptance Criteria

AC-001..AC-006 in requirements.yaml (`work show PF-0048`).

## Implementation Plan

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
