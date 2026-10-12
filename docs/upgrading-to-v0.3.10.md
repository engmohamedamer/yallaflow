# Upgrading to v0.3.10 — Shared Project Intelligence

v0.3.10 reads v0.3.5–v0.3.9 workspaces as-is: **nothing is migrated on read**. A single-user workspace keeps config schema v1, sequential `PF-####`/`SRC-####` IDs, direct knowledge promotion, and the tracked `state/current.yaml`. Read commands write nothing. Shared Project Mode is opt-in and deliberate.

> **Understand once. Share automatically. Revalidate precisely.** Developers work with Git; agents work with YallaFlow.

## 1. Install the new CLI

```bash
npm install -g git+https://github.com/engmohamedamer/yallaflow.git#v0.3.10-internal.3   # or a release tarball
yallaflow --version                  # 0.3.10-internal.3
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
| Package | `0.3.10-internal.3` (internal.2: docs-only re-release of internal.1; internal.3: `init` installs both agent bootstraps, conversational baseline approval) |
| Agent Contract | v5 → **v6** (internal.1) → **v7** (internal.3: the Agent records the developer's explicit baseline approval) |
| Provider bootstrap block | v1 → **v2** |
| Config schema | v1 unchanged; **v2 only for Shared Projects** |
| Context ledger schema | unchanged (v1/v2) |
| Knowledge ledger | v1 unchanged; **v2** only for ledgers holding Shared Project shapes (`staged`, `stagedAt`, `relation.factFingerprint`) — the frozen v0.3.9 reader refuses v2 instead of misreading it |
| Source schema | v2 unchanged |
| Skill Registry | v5 → **v6**: immutable, hash-pinned instruction versions; work pinned to v1–v5 keeps the v0.3.9 instruction bytes → **v7** (internal.3): `repository-baseline` instruction v3 (conversational approval); v6 work keeps v2 |
| Checkout tag | 10 Crockford-base32 characters (50 bits) |

Downgrades are not supported once a v0.3.10 CLI has enabled sharing or written shared state.
