# Upgrading to v0.3.9 — Frictionless Project Onboarding & Context UX

v0.3.9 reads v0.3.5–v0.3.8 workspaces as-is: **nothing is migrated on read**, no workspace schema changes, and read commands (`brief`, `inspect`, `status`, `doctor`, `guide`, `resume`, `handoff`, `context status`, `upgrade status|plan`, `agent status`) mutate zero bytes of an existing workspace.

> **Give the agent the project first.** `yallaflow brief` now explains what the project is from reviewed project memory before it reports YallaFlow's own state, and `yallaflow inspect` makes a repository with nested applications visible before any baseline exists.

## 1. Install the new CLI

```bash
npm install -g /path/to/yallaflow-0.3.9-internal.1.tgz
yallaflow --version                  # 0.3.9-internal.1
yallaflow upgrade status             # read-only: what the workspace needs
```

See [installation.md](installation.md#updating-yallaflow) for the general update procedure. YallaFlow never checks for or downloads updates itself.

## 2. Refresh the agent contract (v4 → v5)

Agent Contract v5 replaces the Brownfield baseline sequence with a **Brownfield onboarding sequence**:

- **Inspect first.** Start with `yallaflow inspect`, then the existing baseline lifecycle.
- **Application code vs. read-only.** "Do not change application code" and "read-only / do not write anything" are different instructions:
  - Under the first, the onboarding writes to `.yallaflow` are authorized: `baseline start`, `intake add` for material documents, the `repository-baseline` checkpoint, and `baseline draft`.
  - Under the second, nothing is written.
- **Human approval.** A human always approves the baseline.
- **Material documentation.** Register a material document with `intake add`, then read it with `source show --content`. A document is evidence of what it says, not of what the code does.
- **NEEDS CARE.** It lists only unresolved, disputed, MAY_BE_STALE, and STALE_EVIDENCE facts, and is not a risk list.
- **Freshness without Git.** Freshness uses SHA-256 content hashes and works without Git. UNKNOWN is not stale.
- **Durable vs. transient.** Transient runtime state is not durable project memory.

```bash
yallaflow agent refresh --dry-run
yallaflow agent refresh
```

A v4 `AGENT.md` is reported as outdated (`brief`, `upgrade status`, `doctor` warning) and is never rewritten by any read command. The provider bootstrap block stays v1; `agent refresh` leaves a current one unchanged.

## 3. What changes

| Area | v0.3.8 | v0.3.9 |
|---|---|---|
| Project-kind detection at `init` | Brownfield when the root contains `.git`, `package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, or `pom.xml` | Classified from a bounded inventory of the whole tree. Brownfield when there is a recognized manifest **and** at least one recognized source file, **or** at least 10 recognized source files, **or** meaningful container/CI configuration. Otherwise Greenfield. |
| A bare `.git` / an `npm init`-only `package.json` | Brownfield | **Greenfield** (intentional correction) |
| Nested applications with no root manifest (e.g. `app/frontend-*/package.json`, `app/backend/*/pom.xml`) | Greenfield | **Brownfield** |
| `tech-stack.md` at a new Brownfield `init` | root manifests only | unchanged root lines, plus a labelled *init-time deterministic bootstrap snapshot* of nested manifest framework hints (not approved project memory) |
| `brief` | YallaFlow status first; memory as counts | Project-first, at most 45 lines: current-fact text per area with fixed caps, NEEDS CARE (up to 5), then work, then YallaFlow status. With no memory, it shows the inventory headline and the Brownfield baseline step. |
| `context status` without a Git commit | counts only | adds a short explanation of hash-based freshness; the Git-backed output is unchanged |
| `baseline start` / `draft` / `status` | minimal next steps | name `inspect`, source registration, and human approval; `status` names the next step |
| New command | — | `yallaflow inspect` (read-only, text only) |

`--type greenfield|brownfield` still overrides detection.

## 4. Existing workspaces

- **The recorded project kind is never rewritten.** A workspace that v0.3.8 initialized as `greenfield` keeps that kind in `config.yaml`. `inspect` and `brief` show when the inventory now classifies the repository differently, and `brief` proposes a baseline when the repository is Brownfield and has no project memory.
- **`tech-stack.md` is not regenerated.** Only a new `init` writes the snapshot.
- **In-flight work is unaffected.** Work routed on earlier versions keeps its pinned Behavior Contract. The Skill Registry is still v5; only the `repository-baseline` skill's instruction text was refined.

## 5. Portability after `git clone`

A committed workspace with no work items, ADRs, or releases yet has empty `work/`, `decisions/`, and `releases/` directories, which Git does not store. v0.3.9 treats their absence as healthy (`doctor` reports them as "absent — created when first needed"), and the first work item recreates `work/`. Earlier versions reported such a clone as failing `doctor`. You do not need `.gitkeep` files.

Verification logs (`work/<id>/evidence/V-###-verification.log`) are part of the durable evidence. If your repository's `.gitignore` ignores `*.log`, add an exception so they are committed:

```gitignore
!.yallaflow/**/*.log
```

## 6. Check and commit

```bash
yallaflow doctor
git add .yallaflow
git commit -m "Upgrade YallaFlow workspace to v0.3.9"
```

## Version changes

| | v0.3.8 | v0.3.9 | Why |
|---|---|---|---|
| Package | 0.3.8-internal.1 | 0.3.9-internal.1 | |
| Agent contract | v4 | **v5** | Brownfield onboarding sequence and the related guidance |
| Skill Registry | v5 | v5 | unchanged: no skill added, removed, or re-pinned |
| Provider bootstrap block | v1 | v1 | unchanged |
| Context ledger, baseline, sources, reviews, delivery ledgers, config, state | unchanged | unchanged | no workspace schema change; the inventory is never persisted |

## Mixed versions and downgrades

v0.3.8 can still operate on a workspace touched by v0.3.9, because no schema changed. The one exception is `AGENT.md` after `agent refresh`: v0.3.8 reports the v5 block as *newer* and refuses to downgrade it. Upgrade every CLI that operates on the workspace together.
