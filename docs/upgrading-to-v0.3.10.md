# Upgrading to v0.3.10 — Shared Project Intelligence

v0.3.10 reads v0.3.5–v0.3.9 workspaces as-is: **nothing is migrated on read**. A single-user workspace keeps config schema v1, sequential `PF-####`/`SRC-####` IDs, direct knowledge promotion, and the tracked `state/current.yaml`. Read commands write nothing. Shared Project Mode is opt-in and deliberate.

> **Understand once. Share automatically. Revalidate precisely.** Developers work with Git; agents work with YallaFlow.

## 1. Install the new CLI

```bash
npm install -g git+https://github.com/engmohamedamer/yallaflow.git#v0.3.10-internal.4   # or a release tarball
yallaflow --version                  # 0.3.10-internal.4
yallaflow upgrade status             # read-only: what the workspace needs
```

## 2. Refresh the agent contract (v5 → v6) and the bootstrap block (v1 → v2)

Agent Contract v6 teaches the agent to:

- **orient automatically**: run `yallaflow brief` before the first request; the developer never has to say "use YallaFlow";
- **understand the project first**: on `PROJECT_UNDERSTANDING_REQUIRED`, run the Brownfield baseline before substantial work, then continue the request, and never repeat a full scan once approved memory exists;
- **use purpose-aware discovery**: the canonical core plus a discovery lens (`baseline start --objective`, `purpose set`), across three discovery modes; purpose and preservation intent are never project facts;
- **follow the Shared Project sequence**: stage knowledge on feature branches, integrate only on the integration branch, and never overwrite shared knowledge silently;
- **run the finish protocol**: `yallaflow finish` before saying "done", with developer-facing outcome language and internal IDs kept out of the normal path.

The provider bootstrap block (v2) adds "automatically, before the first request" and the finish step.

```bash
yallaflow agent refresh --dry-run
yallaflow agent refresh               # updates AGENT.md and installed, unmodified CLAUDE.md / AGENTS.md blocks
```

## 3. What changes for a single-user workspace

| Area | v0.3.9 | v0.3.10 |
|---|---|---|
| `brief` | project memory first | adds `Project understanding: …`, and in a Shared Project a shared line; same 45-line cap |
| `start` / `route` / `guide` | — | print `PROJECT_UNDERSTANDING_REQUIRED` for a Brownfield project without approved understanding |
| Application writes on an un-understood Brownfield project | allowed | **gated**: no work item enters or continues an application-writing stage, and no reopen into implementation, until the baseline is approved. In-flight implementation in such a project pauses until then — approve a baseline first. |
| `yallaflow skill <id>` | installed text | the exact instruction version the work item pinned (`--work`, default the active work); released instructions are immutable |
| `baseline start` | no options | optional `--objective`, `--preserve`, `--focus` (stored in `purpose.yaml`) |
| New commands | — | `purpose set\|show`, `finish`, `shared enable\|status\|check\|integrate` |
| Generated templates | `context/*.md` and `work.md` ended with a blank line | end with a single newline (`git diff --check` clean) |

Nothing else changes until you enable sharing.

## 3a. From internal.1/internal.2 to internal.3

- `yallaflow init` also installs the thin agent bootstrap in `CLAUDE.md` and `AGENTS.md` — one setup command. Existing content in those files is kept; an edited, newer, or malformed managed block makes `init` refuse with nothing written; a failure rolls back. Workspaces initialized earlier are unaffected: run `yallaflow agent setup claude` / `codex` once if a pointer file is missing.
- Baseline approval is conversational: the agent presents the project understanding, the developer replies (for example "Approve"), and the agent records that explicit approval with `yallaflow baseline approve --note "<their words>"`. It never approves on its own judgment. Run `yallaflow agent refresh` to install Agent Contract v7.

## 3b. From internal.3 to internal.4 (pilot hardening)

Found by a real Brownfield pilot. No persisted schema changes: every internal.1–.3 workspace reads as-is, and the frozen internal.3 CLI reads an internal.4 workspace.

- **Pre-baseline engineering gate.** In a Brownfield project without approved understanding — including while a baseline draft awaits approval — `start "<request>"`, `feature`/`bug`/`investigate`/`change`/`refactor`/`release`, `intake <file>` for new work, and `route` refuse with `PROJECT_UNDERSTANDING_REQUIRED`, create nothing, and name `yallaflow baseline start --objective "<the request>"` (or the current baseline step) as the next valid action. A read-only question is engineering work too. Read-only orientation, the baseline itself, `intake add <baseline-id>`, and transient operational help (start a dev server, show logs, `git status`) are unaffected. Greenfield and approved Brownfield projects are unchanged. Pending or in-flight work an earlier release created before the baseline stays readable but cannot be routed or write until the baseline is approved.
- **The original request survives the baseline.** It becomes the baseline objective; after approval, `baseline approve` and `brief` name it as the next work so the agent continues it without asking you to repeat it — and without another repository-wide discovery.
- **Secret values are never persisted.** Recognizable secret values are redacted (`DB_PASSWORD=<redacted>`) in every YallaFlow-owned durable record. Developer files and preserved source originals are never modified; `intake` warns when a captured original appears to contain secrets. Earlier state is not rewritten — review existing `.yallaflow/` history if a credential may have been recorded.
- **PROJECT.md is a real projection.** Once project memory holds a fact, the untouched init starter prompts are retired. A workspace approved by internal.3 still shows them: `doctor` warns, and `yallaflow context render` fixes it (human-written sections stay).
- **Baseline coverage is transparent.** `baseline draft` accepts an optional `coverage: { "inspected": [...], "sampled": [...] }`; `baseline status`/`show` report inspected, sampled, not inspected, unavailable, and unresolved coverage plus the repository paths the evidence cites.
- **Working-tree provenance.** In a Git work tree, newly recorded repository evidence notes whether the content was committed (`head`), uncommitted (`modified`), or `untracked`. Content hashes still decide freshness; outside Git nothing changes.
- **Versions.** Agent Contract **v8** and Skill Registry **v8** (`repository-baseline` instruction v4; v3 archived byte-for-byte, so work pinned to v7 keeps v3). Run `yallaflow agent refresh` to install the contract.

## 4. Turning a project into a Shared Project (optional)

A maintainer does this once. See [shared-projects.md](shared-projects.md).

```bash
yallaflow baseline status              # recommended: an approved baseline before sharing
yallaflow agent setup claude           # only for a workspace initialized before internal.3 (init now installs both)
yallaflow agent setup codex
yallaflow shared enable --dry-run      # inspect and explain; writes nothing
yallaflow shared enable                # [--integration-branch <branch>] when it cannot be determined locally
git add .yallaflow CLAUDE.md             # and/or AGENTS.md — whichever exist
git commit -m "Share YallaFlow project memory"
git push
```

What enabling changes:

- `config.yaml` → schema v2 with `shared` (integration branch, source policy) and `yallaflow.minimumVersion: 0.3.10-internal.1`;
- `.yallaflow/.gitignore` → `local/`;
- `state/current.yaml` → moves to `.yallaflow/local/state/current.yaml` (commit the deletion);
- from then on: branch-safe IDs for new work and sources, `memory.yaml` per new work item, staged knowledge on feature branches, canonical memory written only on the integration branch.

Existing work, sources, and facts are never renamed or rewritten.

## 5. Team rollout

- Every developer and CI job needs YallaFlow `>= 0.3.10-internal.1`. Older v0.3.10+ CLIs stop with `Installed … · Project requires … — INCOMPATIBLE`.
- **A v0.3.9 CLI cannot detect a Shared Project.** Its `doctor` fails on config schema v2, and `yallaflow shared check` in CI flags what it may produce: sequential IDs and ledger writes without integration records. Upgrade together.
- Add `yallaflow shared check` to CI ([examples](shared-projects.md#ci--pull-requests)).
- After merges, run `yallaflow shared integrate` on an up-to-date checkout of the integration branch and commit the result.
- Knowledge that a single-user workspace proposed with `--supersedes/--reconfirms/--disputes` before sharing carries no fact fingerprint. Reject it and propose it again after sharing.

## 6. Version decisions

| Item | Change |
|---|---|
| Package | `0.3.10-internal.4` (internal.2: docs-only re-release of internal.1; internal.3: `init` installs both agent bootstraps, conversational baseline approval; internal.4: pilot hardening — pre-baseline gate, original-request continuity, secret redaction, real PROJECT.md, coverage, provenance) |
| Agent Contract | v5 → **v6** (internal.1) → **v7** (internal.3: the Agent records the developer's explicit baseline approval) → **v8** (internal.4: pre-baseline refusal, original-request continuity, transient operational assistance vs engineering work, declared coverage, never copy secret values) |
| Provider bootstrap block | v1 → **v2** |
| Config schema | v1 unchanged; **v2 only for Shared Projects** |
| Context ledger schema | unchanged (v1/v2) |
| Knowledge ledger | v1 unchanged; **v2** only for ledgers holding Shared Project shapes (`staged`, `stagedAt`, `relation.factFingerprint`) — the frozen v0.3.9 reader refuses v2 instead of misreading it |
| Source schema | v2 unchanged |
| Skill Registry | v5 → **v6**: immutable, hash-pinned instruction versions; work pinned to v1–v5 keeps the v0.3.9 instruction bytes → **v7** (internal.3): `repository-baseline` instruction v3 (conversational approval); v6 work keeps v2 → **v8** (internal.4): `repository-baseline` instruction v4 (original request as objective, declared coverage, no secret values); v7 work keeps v3 |
| Checkout tag | 10 Crockford-base32 characters (50 bits) |

Downgrades are not supported once a v0.3.10 CLI has enabled sharing or written shared state.
