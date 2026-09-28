# Upgrading to v0.3.7 — Context Reconciliation & Upgrade Intelligence

v0.3.7 reads v0.3.5 and v0.3.6 workspaces as-is: **nothing is migrated on read**, and nothing changes until you run a command that writes. Every upgrade step is an explicit command, and some steps need human decisions, so there is deliberately no "upgrade everything" command.

> **Old knowledge is reviewed before it becomes current truth.**

## 1. Install the new CLI

```bash
npm install -g /path/to/yallaflow-0.3.7-internal.1.tgz
yallaflow --version                  # 0.3.7-internal.1
```

In legacy repositories, keep YallaFlow out of the application's dependencies ([installation.md](installation.md#legacy-and-brownfield-repositories)).

## 2. See what the workspace needs

```bash
yallaflow upgrade status             # one read-only assessment
yallaflow upgrade plan               # the ordered steps, each a deliberate command
```

`upgrade status` aggregates what you previously had to piece together from `doctor`, `agent status`, `context status`, and `context adopt --dry-run`. It reports the installed version, legacy structures, the agent-contract state, canonical facts and pending legacy facts, sources, work history, integrity, and Git durability, then names the one next action. It never migrates, repairs, or infers anything.

A typical upgraded v0.3.6 workspace (the YaSchools shape):

```text
YallaFlow Workspace Upgrade Status

Installed package: 0.3.7-internal.1
Workspace: legacy structures present
  - agent contract v2 (installed v3)
  - v0.3.5 append-only project context (53 item(s) not yet reconciled)

Agent contract: outdated (v2 → v3); run `yallaflow agent refresh`

Project context:
  1 canonical current fact(s) · 0 disputed · 0 superseded
  53 legacy fact(s) pending reconciliation

Sources: 1 · healthy
Work history: 5 item(s) · healthy
Integrity: doctor healthy

Recommended next action:
  yallaflow agent refresh

Warnings:
  .yallaflow exists but is neither tracked by Git nor gitignored; …
```

## 3. Refresh the agent contract (v2 → v3)

Agent Contract v3 adds four rules: legacy context must be reconciled before it becomes current truth; relationships must rest on evidence, not wording; genuine ambiguity goes to a question for human review; and CLI-owned YallaFlow state is never edited by hand (see [State ownership](project-memory.md#state-ownership)). It also tells a fresh agent to run `yallaflow brief` first.

```bash
yallaflow agent refresh --dry-run
yallaflow agent refresh
```

An unmodified v2 block is updated in place, and content outside the managed block is kept. Customized guidance still needs `--preserve-existing` ([v0.3.6 notes](upgrading-to-v0.3.6.md#3-refresh-the-agent-contract)).

## 4. Reconcile legacy project context

v0.3.5 appended each promoted fact as its own Markdown section. After many work items, the same durable truth can appear several times in different words:

```text
PF-0001 BF-013  Root Codeception configuration enables only tests/api and tests/apps;
                other suites are commented out.
PF-0002 K-002   Root codeception.yml enables only tests/api and tests/apps;
                common/console/backend/frontend are commented out.
```

Importing both blindly would give two current facts for one truth. Deciding whether two statements are the same fact, a refinement, a supersession, or a contradiction takes engineering judgement. So in v0.3.7 the **agent reasons**, **YallaFlow validates and applies**, and **a human reviews** in between.

```text
legacy facts → RC candidates → agent decisions → preview → human review → atomic apply → CTX ledger
```

### 4.1 Start

```bash
yallaflow context reconcile start
```

This creates one read-only reconciliation work item (e.g. `PF-0006`) and its plan, `work/PF-0006/reconciliation.yaml`. Every legacy item gets a stable candidate ID, `RC-0001` … `RC-0053`, ordered by work item, then baseline facts, then knowledge candidates. Each candidate keeps the following:

- original work item and BF/K identifier
- area and exact wording
- confidence and provenance
- recorded evidence and time
- the legacy Markdown location

Historical work items (`PF-0001`, `PF-0002`, …) are never modified. The plan is also never stored in `context/index.yaml`.

Two deterministic flags help, and neither acts on its own:

- `exactDuplicateOf RC-####` means the same area, the same normalized text (NFC, whitespace-collapsed, case-folded, trailing periods removed), and the same evidence references.
- `sameStatementAs CTX-####` means the wording is identical to a current fact in the same area.

YallaFlow never compares meaning. There are no embeddings, similarity scores, or LLM calls.

### 4.2 The agent decides every relationship

```bash
yallaflow skill context-reconciliation
yallaflow context reconcile show PF-0006                 # all candidates
yallaflow context reconcile show PF-0006 --candidate RC-0053
yallaflow context list                                   # existing canonical facts
```

| Action | Target | Result |
|---|---|---|
| `new` | — | One new CTX fact. May set a clearer canonical `summary` and correct the `area`. |
| `merge-with` | `RC-####` only | Legacy candidates that are the same statement collapse into one canonical fact; every origin kept; history `merged`. |
| `reconfirms` | `CTX-####` or `RC-####` | One more historical observation of a truth already represented; same area required; provenance only; history `reconfirmed`. |
| `supersedes` | `RC-####` or `CTX-####` | Newer truth: the target becomes history, lineage is kept. |
| `disputes` | `RC-####` or `CTX-####` | Conflicting evidence that cannot be settled: the target is marked disputed. |
| `skip` | — | Not migrated (reason required). |
| `limitation` | — | Was a discovery limitation, not project truth. Recorded as a work-scoped limitation (`limitationType` + reason required). |

For the Codeception example:

```json
{
  "decisions": [
    { "candidate": "RC-0013", "action": "new",
      "summary": "Root codeception.yml enables only the api and apps suites; the other checked-in suites are commented out." },
    { "candidate": "RC-0053", "action": "merge-with", "target": "RC-0013",
      "reason": "Both describe the enabled root Codeception suites (same file, same suites)." }
  ]
}
```

```bash
yallaflow context reconcile plan PF-0006 --file decisions.json
```

The result is one canonical current fact with both origins, `PF-0001 BF-013` and `PF-0002 K-002`. If the workspace already has `CTX-0001` describing the same truth (a fact v0.3.6 work created), relate the legacy item to it with `{"candidate": "RC-0013", "action": "reconfirms", "target": "CTX-0001"}` and keep `RC-0053 merge-with RC-0013`: both origins land on `CTX-0001`, with history `reconfirmed` then `merged`. You don't have to delete the v0.3.6 ledger before adopting legacy history.

**`merge-with` or `reconfirms`?** Use `merge-with` when several legacy candidates *are the same statement* and should become one fact; its target is always another candidate. Use `reconfirms` when a legacy item *confirms a truth you can already point to* (an existing fact, or another candidate's fact) of the same kind; it adds provenance only. `merge-with CTX-####`, and a `reconfirms` across areas, are rejected.

The Azure example (`BF-044` "Azure pipeline does not execute automated tests." vs `K-001`, "the production pipeline has never executed Codeception tests …") is a judgement call. It is usually a refinement: `K-001` `reconfirms` `BF-044`, with the more precise wording as the canonical `summary`. Use `supersedes` if the earlier statement is no longer accurate, or `new` for both if they are really separate facts. The `reason` records which.

The plan file can be partial. Decisions are upserted per candidate, and `"action": "pending"` clears one. A file with any invalid relation is rejected whole, with nothing written. Invalid relations include an unknown RC or CTX, self-merges, cycles, two successors or two disputes for one fact, supersede plus dispute on one fact, and targets that are undecided or not fact-producing.

### 4.3 Unresolved ambiguity: ask, don't guess

If the agent cannot tell whether two candidates are duplicates, separate facts, a supersession, or a contradiction, it leaves them undecided and records a question for the human:

```bash
yallaflow question add PF-0006 --category architecture \
  --text "RC-0012 vs RC-0041: do both describe the same production queue behavior?"
```

Undecided candidates never block the rest. The approved subset applies, the pending ones keep their legacy sections, and they are decided, re-reviewed, and applied in a later round. A decision may not target an undecided candidate, so a merge group is never split across an unresolved member.

### 4.4 Preview the resulting memory (read-only)

```bash
yallaflow context reconcile preview PF-0006
```

```text
53 legacy candidate(s) · 0 already applied · 51 to apply · 2 pending

Result:
  45 canonical current fact(s) (1 before)
  45 new fact(s) · 2 merged (candidates collapsed into one fact) · 1 reconfirmation(s) (1 candidate(s) joining existing facts)
  1 supersession(s) · 0 dispute(s) · 1 limitation(s) · 2 skipped · 2 pending

Areas (current facts after apply):
  Architecture   8
  Database       7
  …

New canonical facts:
  RC-0013 + RC-0053 → CTX-0002 [convention] Root codeception.yml enables only the api and apps suites; …
    origins: PF-0001 BF-013, PF-0002 K-002
```

The preview runs the exact apply logic against an in-memory copy of the ledger. The CTX IDs it shows are the ones apply will assign.

### 4.5 Human review

```bash
yallaflow checkpoint PF-0006 --skill context-reconciliation --complete --summary "..."
yallaflow context reconcile approve PF-0006 [--note TEXT]
# or
yallaflow context reconcile feedback PF-0006 --changes-requested --note "..."
```

The approval is bound to a SHA-256 fingerprint of every candidate and decision. Any later change to the plan through `reconcile plan` puts it back to awaiting review. A hand edit makes `apply` refuse and `doctor` fail. The generic `yallaflow approve --stage reconciliation` is refused, so review always goes through the command that fingerprints the plan.

### 4.6 Apply

```bash
yallaflow context reconcile apply PF-0006
```

- The whole plan is validated against the live ledger before anything is written. One invalid relation means zero changes.
- Canonical memory is written in one atomic ledger write through the single ledger writer. A merge group is never half-applied.
- Reconciled facts carry `adopted: true` plus a `reconciliation` reference on every origin. They have no verification point, so their freshness is `UNKNOWN` until reconfirmed with fresh evidence.
- Joining an existing CTX fact adds provenance only. Its evidence, verification point, freshness, and history stay as they were.
- Each reconciled legacy section that is byte-for-byte what v0.3.5 generated is copied into `work/PF-0006/legacy-context.md`, then removed from the durable document. A hand-edited section (any change, even inside a bullet) is kept in place, reported, and flagged by `doctor` for review.
- If projection rendering fails after the ledger write, canonical memory is intact. `yallaflow context render` repairs the Markdown, and re-running `apply` finishes the bookkeeping without duplicating facts, origins, or history. A repeated `apply` on a finished plan changes nothing.
- When the last candidate is applied, the reconciliation work item becomes DONE. `yallaflow advance` cannot complete it around the plan.

### 4.7 `context adopt`

| Command | v0.3.6 | v0.3.7 |
|---|---|---|
| `context adopt --dry-run` | lists legacy items | unchanged, plus says whether direct adoption is allowed |
| `context adopt` | imports every legacy item as a separate fact | allowed only when provably duplicate-free (exactly one legacy item and no current facts); otherwise refused with no changes, pointing to `context reconcile start` |

There is no `--force`.

## 5. Check and commit

```bash
yallaflow doctor
yallaflow upgrade status             # "none — the workspace is current"
git add .yallaflow && git commit -m "Upgrade YallaFlow workspace to v0.3.7"
```

## Fresh agents

A repository that uses YallaFlow may not mention it outside `.yallaflow/`. `yallaflow brief` is the single read-only orientation command for a new session. It reports the agent-contract state, active and most recent work, project memory health, pending legacy reconciliation, and sources, then names the next command (`resume`, `handoff`, `context reconcile …`). Consider adding one line to your repository's agent file (e.g. `AGENTS.md`): *This repository uses YallaFlow — run `yallaflow brief` first.*

## Version changes

| | v0.3.6 | v0.3.7 | Why |
|---|---|---|---|
| Package | 0.3.6-internal.1 | 0.3.7-internal.1 | |
| Agent contract | v2 | **v3** | new behavior rules (reconciliation, state ownership, brief) |
| Skill Registry | v3 | **v4** | new `context-reconciliation` skill (capability `reconcile`); work pinned to v3 keeps its skills |
| Context ledger `schemaVersion` | 1 | **1 or 2** | v2 (`origins`, reconciliation references, `merged` history) cannot be read by v0.3.6; a ledger moves to v2 only when its content needs it — see below |
| Reconciliation plan | — | `schemaVersion: 1` | new file, per reconciliation work item |

## Context ledger storage contract (schema v1 → v2)

| | Schema v1 | Schema v2 |
|---|---|---|
| Provenance field | `origin` (one) | `origins` (one or more, introducing origin first); never both |
| Reconciliation references, `merged` history | not allowed | allowed |
| Readable by | v0.3.6 and later | v0.3.7 and later |

- **No migration on read.** v0.3.7 reads a v1 ledger as-is; every command sees the same provenance through one accessor.
- **Lowest sufficient schema.** A mutation writes v1 whenever the result is representable in v1. Ordinary knowledge promotion, baseline approval, and trivial `context adopt` on a v1 ledger keep it v1 and v0.3.6-readable, with untouched facts byte-for-byte identical. A ledger moves to v2 only when its content needs it: multi-origin facts, reconciliation references, or `merged` history. `context reconcile apply` is the deliberate path that does this. On conversion each `origin` becomes `origins[0]` in the same key position.
- **Never downgraded.** Once v2, a ledger stays v2.
- **Newer schemas are refused up front.** A ledger beyond v2 makes every v0.3.7 context command stop with *"uses context schema vN, written by a newer YallaFlow … Upgrade YallaFlow"*, and nothing is read or changed. `upgrade status` reports `context schema: vN — NEWER than this CLI supports`.
- `yallaflow upgrade status` always shows the workspace's context schema.

## Mixed versions and downgrades

Upgrade everyone on a repository together, and do it before reconciling. What v0.3.6 does with each schema:

- **v1 ledgers written by v0.3.7:** fully usable.
- **v2 ledgers:** `doctor` fails with `context ledger schemaVersion must be 1.`, and every v0.3.6 write refuses with *"The project context ledger is invalid; refusing to modify it"*, so v0.3.6 never writes to a v2 ledger. v0.3.6 predates any read-side version gate, though. Its read-only `context status/list/history` and `handoff` still print what they can, and `context show` fails with a JavaScript error. That behavior belongs to the released v0.3.6 reader and cannot be changed from v0.3.7.

Downgrading after a ledger is v2 is not supported.
