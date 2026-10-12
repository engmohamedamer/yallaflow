# Shared Projects

> **Understand once. Share automatically. Revalidate precisely.**
>
> **Developers work with Git. Agents work with YallaFlow.**

A Shared Project lets a whole engineering team reuse — and keep evolving — one deep, evidence-backed understanding of the project through ordinary Git work. Nobody on the team needs to learn YallaFlow internals.

## For a team member

```text
git pull
→ open your coding agent (Claude, Codex, …)
→ describe the task            "Fix invoice totals."
→ review the result
→ git push
```

That is the whole daily flow. New to YallaFlow itself? Start with [Using YallaFlow](using-yallaflow.md). You do not run a join command, re-baseline the project, explain the architecture again, or type "use YallaFlow". You only need a compatible `yallaflow` CLI on your PATH (see [installation](installation.md)).

When the work is ready, the agent tells you in plain language:

```text
Implemented and verified. New project knowledge from this task will join the shared project memory after it is merged.
Ready to push.
```

Rarely, it tells you something genuinely needs you:

```text
Shared project knowledge changed while this task was in progress. Please update your branch, then ask me to continue.
```

YallaFlow never commits, pushes, pulls, rebases, or merges on your behalf. You stay in control of source control.

## For the maintainer (once per project)

```text
install YallaFlow
→ yallaflow init                     (inside the repository)
→ deep Brownfield baseline           (the agent does the discovery; you approve it)
→ yallaflow agent setup claude|codex (so every session orients automatically)
→ yallaflow shared enable            (explicit; previews with --dry-run)
→ git add .yallaflow plus CLAUDE.md and/or AGENTS.md (whichever exist) → git commit → git push
```

`yallaflow shared enable` inspects and explains before it writes anything:

- whether `.yallaflow/` is tracked by Git (Shared Mode refuses when it is gitignored),
- project understanding: is there an approved baseline? (recommended before sharing),
- project-memory health and context schema (an unhealthy workspace is refused),
- the **integration branch** — from `origin/HEAD` or `git config init.defaultBranch` when locally available, otherwise you name it: `--integration-branch <branch>`. YallaFlow never assumes `main` and never asks a remote,
- agent adapters (`CLAUDE.md` / `AGENTS.md`) — without them a teammate's agent has to be told about YallaFlow,
- the size of durable sources kept in Git,
- the minimum YallaFlow version every teammate needs.

It then writes `config.yaml` (schema v2: the shared policy), `.yallaflow/.gitignore` (ignores `local/`), and moves the personal active-work pointer into `.yallaflow/local/`. It does **not** commit or push.

## What is shared and what stays local

```text
.yallaflow/
  config.yaml          shared   project policy, integration branch, minimum YallaFlow version
  PROJECT.md           shared   projection of current project memory
  AGENT.md             shared   the agent contract
  context/             shared   canonical project memory (index.yaml) and its projection
  decisions/           shared   ADRs
  work/                shared   every work item, its evidence, and its memory delta
  sources/             shared   durable user-provided inputs (SRS, screenshots, …)
  releases/            shared
  .gitignore           shared   ignores local/
  local/               LOCAL    never committed
    identity.yaml               this checkout's clone tag and ID sequence
    state/current.yaml          this developer's active work
```

> Project truth is shared. Personal runtime state is local.

Canonical truth never moves into a server or a database. Git is the collaboration transport.

## What happens underneath

The coding agent runs this on the developer's behalf. Developers never need to see it.

### 1. Orientation

The agent adapter (`CLAUDE.md` / `AGENTS.md`) tells every session to run `yallaflow brief` before handling the first request. The brief reports:

- whether project understanding is established;
- whether this is a Shared Project, its integration branch, and the current branch;
- a fingerprint of project memory and any pending knowledge integrations;
- the installed and required YallaFlow versions.

### 2. Project understanding first

An existing repository without approved understanding reports `PROJECT_UNDERSTANDING_REQUIRED`. YallaFlow enforces it: no application change is authorized until project understanding is approved. The agent establishes the understanding once — one deep Brownfield baseline that a human approves — and then continues with the developer's request; the developer is asked only to approve. Every later session and every teammate reads the approved memory; nobody rescans the repository. See [Purpose-aware discovery](#purpose-aware-discovery).

### 3. Branch-safe identifiers

Two developers starting from the same Git base must never create the same work or source directory. In a Shared Project:

| Namespace | Form | Why it is safe |
| --- | --- | --- |
| Work | `PF-K7M2QX4N8P-0001` | `K7M2QX4N8P` is this checkout's random clone tag; the sequence is remembered in `local/identity.yaml`, so switching branches or stashing never reuses a number |
| Sources | `SRC-K7M2QX4N8P-0001` | same |
| Project facts | `CTX-0042` | allocated only at canonical integration, on the integration branch, by one writer |
| ADRs | `decisions/ADR-<work>-K-###.md` | scoped by the work ID |
| `K-`, `Q-`, `V-`, `CV-`, `IM-`, `REQ-`/`AC-`, `DL-`, `BF-`, `RC-` | per work item | unique within their work item |

Existing `PF-####`, `SRC-####`, and `CTX-####` IDs stay readable forever and are never rewritten. A single-user workspace keeps allocating `PF-####`.

### 4. Memory base

Each work item records the project-memory state it started from in `work/<id>/memory.yaml`:

```yaml
contextBase:
  ledgerFingerprint: <sha256 of the canonical ledger's content>
  facts: { CTX-0001: <fingerprint>, … }   # every non-superseded fact
  contextSchemaVersion: 2
  gitCommit: <HEAD, informational>
  branch: feature/refunds
  capturedAt: …
```

A content fingerprint is used instead of a global revision counter. It is deterministic across clones, needs no server, and works without Git. YallaFlow can then answer "has relevant shared memory changed since this work began?" without rescanning anything.

### 5. Work-local memory delta

On a feature branch, canonical project memory is read-only. When the agent promotes reviewed knowledge, the candidate becomes **staged**: it is recorded as this work's memory delta (`knowledge.yaml` + `memory.yaml`) and the shared ledger is not touched. A relation (`--supersedes|--reconfirms|--disputes CTX-####`) carries a fingerprint of the fact as the agent saw it.

A staged delta is a completed knowledge disposition, so the work can reach `DONE` without waiting for integration. It survives handoff: `yallaflow handoff`/`resume` show where it stands.

### 6. Canonical integration

```text
work-local memory delta
  → compare against what it related to
  → current shared memory
  → safe apply  OR  reconciliation required
  → canonical ledger (context/index.yaml)
```

`yallaflow shared integrate` is the one integration boundary. It runs **on the integration branch only**: the agent runs it there, and promoting knowledge on the integration branch integrates immediately.

| Case | Result |
| --- | --- |
| no relevant change since the work related to a fact | applied |
| independent new knowledge | new `CTX-####` |
| exact duplicate of a current fact (same area, same statement) | recorded as an extra origin of that fact — no new fact |
| referenced fact changed since (superseded, disputed, reconfirmed elsewhere) | **blocked** — the agent revalidates |
| two works supersede/dispute the same fact | **all blocked** — never resolved by order or by guessing |
| semantic duplicate that cannot be proven mechanically | applied as new knowledge; judging it is the agent's job |

Properties:

- One canonical ledger and one writer. A Shared-Project ledger write off the integration branch is refused (baseline approval and reconciliation included).
- All clean updates are written in a single atomic ledger write — never half-applied.
- Retry is idempotent: an interrupted integration finishes its bookkeeping without re-applying anything.
- Deterministic: the same merge integrated in two checkouts produces byte-identical files.
- Provenance is preserved: fact → originating work and candidate → `memory.yaml` (actor, memory base, integration record).

Reconciling a blocked update uses the existing primitives. The agent rejects the stale staged candidate with a reason and proposes again against the current fact. When the conflict is a real business decision, it records a question for a human.

### 7. Finish protocol

Before telling the developer anything is done, the agent runs `yallaflow finish <work-id>`. It checks the lifecycle, project integrity, and whether shared memory changed under the work's delta. It prints outcome language for the developer and exact steps for the agent; `--verbose` keeps the full audit.

## Purpose-aware discovery

A baseline always covers the **canonical core**:

- purpose and architecture
- modules, backend and frontend stacks
- database, authentication, authorization
- workflows and business rules
- integrations and routes/APIs
- environments and testing
- CI/CD, conventions, shared components
- risks, unresolved knowledge, and discovery limitations

Discovery gets better when the agent knows what the understanding is **for**:

```bash
yallaflow baseline start --objective "Complete UI/UX redesign" \
  --preserve "business behavior" --preserve "authorization semantics"
```

The objective becomes a **discovery lens**: the agent goes deeper where it points — routes to screens, forms, tables, UI states, and behavior that must not change. YallaFlow does no keyword matching. The agent reasons about the intent; YallaFlow persists the structured contract in `work/<id>/purpose.yaml`.

Purpose and preservation intent are **work intent, not project truth**. They are never written into the ledger, `PROJECT.md`, or `context/*.md`, and baseline approval never promotes them.

There are three discovery modes:

| Mode | When | Shape |
| --- | --- | --- |
| bootstrap | first understanding | repository → approved durable memory |
| intent | a new objective | existing memory + objective → targeted deep dive (`yallaflow purpose set`) |
| freshness | evidence changed | current fact → targeted revalidation → reconfirm / supersede / dispute |

One expensive, useful bootstrap — then small, targeted rediscovery.

## Greenfield

An empty project is never scanned. Its first understanding comes from product intent, supplied requirements and sources, and decisions as they are approved. The same shared-memory model applies from then on.

## CI / pull requests

`yallaflow shared check` is the provider-neutral CI gate. It is read-only, makes no network or LLM calls, and needs no hosted service. It exits with code 1 on failure.

It validates:

- workspace integrity (`doctor`)
- the version requirement
- branch-safe IDs
- local vs shared state placement
- memory-base validity
- integration provenance
- whether every pending memory delta integrates safely against the memory in the checked-out commit

Run it on the PR's merge result (most CI systems check that out by default).

GitHub Actions:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20 }
- run: npm install -g <your yallaflow tarball or registry package>
- run: yallaflow shared check
```

Azure Pipelines:

```yaml
- task: NodeTool@0
  inputs: { versionSpec: '20.x' }
- script: npm install -g <your yallaflow tarball or registry package>
- script: yallaflow shared check
```

GitLab CI:

```yaml
yallaflow:
  image: node:20
  script:
    - npm install -g <your yallaflow tarball or registry package>
    - yallaflow shared check
```

Any shell: `yallaflow shared check || exit 1`.

A failing check prints actionable output, for example:

```text
FAIL pending memory deltas integrate safely
  - PF-K7M2QX4N8P-0001 K-001: CTX-0004 changed after this work related to it — superseded by CTX-0007
Result: FAIL
Shared project knowledge changed while this work was in progress. Update the branch with main, then ask the coding agent to continue …
```

After merges land on the integration branch, someone with a checkout of it (typically the maintainer, or any developer's agent on that branch) runs `yallaflow shared integrate` and commits the result. If the integration branch is protected, run integrate on an up-to-date checkout of it, then commit the result on a short-lived branch and merge it like any other change. Integration is deterministic, so two people integrating the same merge produce identical files.

## Team visibility

`yallaflow shared status [--verbose]` is a short, read-only summary of what **this checkout** knows:

- integration and current branch
- the YallaFlow version requirement
- you (from `git config`)
- memory fingerprint
- open work
- pending integrations and integrity

It never claims to see branches that are not fetched or merged here. It is not a dashboard, a Kanban board, or a live server.

## Versions

A Shared Project records `yallaflow.minimumVersion` in `config.yaml`. An older CLI stops before any project-state change:

```text
Installed: 0.3.9-internal.1 · Project requires: >= 0.3.10-internal.1 — INCOMPATIBLE
```

Read-only orientation (`brief`, `doctor`, `status`, `shared status`, `shared check`) still runs and explains why. YallaFlow never self-updates or downloads anything. A v0.3.9 CLI predates the version check. Its `doctor` fails on config schema v2, and `shared check` in CI detects sequential IDs or ungoverned ledger writes it may have produced. Upgrade every teammate together.

## Sources and repository size

Durable sources are shared project inputs and stay in Git by default. Shared Mode never drops them, and checksums are verified as before. Large binaries grow every clone. `doctor` warns about sources above `shared.sources.largeFileBytes` (10 MB by default) so you can decide on Git LFS for `.yallaflow/sources/`. `shared.sources.storage: external` is reserved as a declared policy boundary; YallaFlow builds no storage service.

## Identity and privacy

There are no accounts, no registration, no roles, and no permissions. Actor metadata on shared work (`name`/`email`) is read from `git config` when the work is created — the same values your Git commits already publish. Developer roles (backend/frontend/QA) are never a permission system. `local/identity.yaml` holds a random clone tag, a one-way fingerprint of the checkout path (never the path itself), a creation time, and the last allocated sequence. It is gitignored and stays on your machine.

## Not in scope

YallaFlow is shared engineering intelligence, not team management. It deliberately excludes:

- a hosted or cloud service, accounts, RBAC, or invitations
- real-time locks, WebSockets, or a background daemon
- automatic commit, push, pull, rebase, or merge
- tracker integration, sprints, task assignment, workload balancing, chat, or dashboards
- LLM calls, embeddings, or semantic auto-resolution in the CLI
