# Upgrading to v0.3.8 — Delivery Convergence & Agent Continuity

v0.3.8 reads v0.3.5–v0.3.7 workspaces as-is: **nothing is migrated on read**, no existing file changes schema, and work routed before v0.3.8 keeps exactly the behavior it was routed with.

> **Passing tests does not prove that the delivered implementation matches the approved intent.**

## 1. Install the new CLI

```bash
npm install -g /path/to/yallaflow-0.3.8-internal.1.tgz
yallaflow --version                  # 0.3.8-internal.1
yallaflow upgrade status             # read-only: what the workspace needs
```

## 2. Refresh the agent contract (v3 → v4)

Agent Contract v4 adds the delivery intent and convergence sequence: record requirement and acceptance-criterion identity before completing the intent checkpoint, assess convergence with evidence after verification, resolve unrequested behavior, and assess change impact when approved intent changes.

```bash
yallaflow agent refresh --dry-run
yallaflow agent refresh
```

## 3. Optional: set up your coding agent

```bash
yallaflow agent setup codex          # repository-root AGENTS.md
yallaflow agent setup claude         # repository-root CLAUDE.md (imports @.yallaflow/AGENT.md)
yallaflow agent status
```

Each adds one thin, versioned block that points a cold session at `.yallaflow/AGENT.md` and `yallaflow brief`. Existing content in those files is preserved byte-for-byte. If you had added a one-line pointer by hand (as v0.3.7 suggested), you can keep it or remove it; the managed block supersedes it.

## 4. What changes for new work

| Work (routed on v0.3.8) | Requirement identity | Convergence before DONE | Impact assessment |
|---|---|---|---|
| `feature` bounded / architectural | required at the intent checkpoint | required | when intent changes after it is fixed |
| `change` architectural | required | required | yes |
| `change` bounded, `bug`, `refactor`, `release`, `investigation` | — | — | — |
| anything routed before v0.3.8 | — | — | — |

The Behavior Contract pinned at routing is the only authority; there is no setting to change this per project. For feature work:

1. Before completing `specification` (or `requirement-clarification` when there is no specification): `yallaflow requirement record <work-id> --file requirements.json`.
2. After verification: `yallaflow convergence record <work-id> --file convergence.json`, resolve every gap, then complete the `delivery-convergence` checkpoint.
3. If a source is attached, or requirements change, after the intent is fixed: `yallaflow impact status <work-id>`, then `yallaflow impact assess <work-id> --file impact.json`.

See [workflows.md](workflows.md#bounded-feature-with-delivery-convergence) and [guide.md](guide.md#requirement-identity-and-delivery-convergence).

## 5. Existing work

- In-flight work routed on v0.3.7 or earlier keeps its registry ≤ v4 contract: no requirement, convergence, or impact gate applies to it, and `requirement`/`convergence`/`impact` commands report *not applicable* without writing anything. It is never re-pinned.
- Decompositions of such parents keep free-form requirement labels. Children created by `decompose execute` on v0.3.8 are newly routed work and pin Registry v5.
- `doctor` reports nothing new for such work.

## 6. Check and commit

```bash
yallaflow doctor
git add .yallaflow                   # plus AGENTS.md / CLAUDE.md if you ran agent setup
git commit -m "Upgrade YallaFlow workspace to v0.3.8"
```

## Version changes

| | v0.3.7 | v0.3.8 | Why |
|---|---|---|---|
| Package | 0.3.7-internal.1 | 0.3.8-internal.1 | |
| Agent contract | v3 | **v4** | new delivery intent and convergence sequence |
| Skill Registry | v4 | **v5** | new `delivery-convergence` skill (capability `converge`), pinned for feature and architectural change work; work pinned to v4 or earlier keeps its skills |
| `requirements.yaml`, `convergence.yaml`, `impact.yaml` | — | `schemaVersion: 1` | new work-scoped delivery ledgers, created only when written |
| Provider bootstrap block | — | v1 | new, only when `agent setup` runs |
| Knowledge policy, context ledger, other ledgers | unchanged | unchanged | |

## Mixed versions and downgrades

During this internal prerelease phase, every YallaFlow CLI operating on the same workspace should be upgraded together: a v0.3.7 CLI can operate on a workspace later used by v0.3.8 without understanding Registry v5 convergence requirements. Concretely, v0.3.7 reads a v0.3.8 workspace without errors, but it does not know the delivery gate: it would let Registry v5 work reach DONE without convergence (and cannot complete the `delivery-convergence` checkpoint, an unknown skill to it). v0.3.8's `doctor` then reports such work as a failure (`is DONE but the delivery-convergence checkpoint is pending`). Downgrading after v0.3.8 has routed work is not supported.
