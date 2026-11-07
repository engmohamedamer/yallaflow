# PF-0052 — Work-history reconciliation for diverged branches: detect work, source, project-memory and ADR ID collisions between this workspace and another Git ref or checkout, dry-run, and import the other side's records byte-identically as an auditable lineage with an ID mapping, hash validation, idempotent apply and rollback, without rewriting or overwriting any record

## Raw Request

Work-history reconciliation for diverged branches: detect work, source, project-memory and ADR ID collisions between this workspace and another Git ref or checkout, dry-run, and import the other side's records byte-identically as an auditable lineage with an ID mapping, hash validation, idempotent apply and rollback, without rewriting or overwriting any record

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-07T10:56:31.762Z
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

## Specification

### Findings (repository evidence, 2026-11-07)
- The branches split at `b700b2c`. Main has one commit since (`534cdbb`, tag v1.3.0), and 1.4 has many.
- **Work IDs:**
  - **PF-0041 collides.** main: proposal recovery, committed. 1.4: lifecycle.
  - **PF-0042 and PF-0043 collide** and exist on main **only as uncommitted files** in the main checkout. main: PF-0042 = v1.2/1.3 publication (DONE); PF-0043 = duplicate console slice (IMPLEMENTATION).
- **Project memory:**
  - **CTX-0105 collides.** main: a 1.3.0 Codex fact, introduced by PF-0039 K-001, which superseded CTX-0102. 1.4: the lifecycle fact.
  - **CTX-0102** was changed (superseded) only on main.
- **PF-0039** existed at the fork. It was completed (DONE) only on main, and its main-side knowledge cites main's CTX-0105.
- **No collisions** for sources (main ≤ SRC-0027, 1.4 ≥ SRC-0028) or ADRs (none created).
- **Product code:** `resources/console/app.js` conflicts textually, although the v1.3.0 fix is present on 1.4 (PF-0044). CHANGELOG auto-merges.

### Options evaluated
1. **`work adopt` with new IDs.** Copy main's records under new numbers (PF-0052…).
   - The records' own IDs (`meta.id`, ledger lines, `work.md` headings, knowledge factIds, evidence logs) would no longer match their location.
   - That needs either rewriting them, which is forbidden, or alias resolution in every Core reader (high risk and wide change).
2. **Preserved lineage (recommended).** Keep the other side's colliding records byte-identical under their **original** IDs in a separate, read-only namespace (`.yallaflow/lineages/<label>/`), with a manifest.
   - Their internal references stay correct inside the lineage.
   - Canonical records keep their IDs.
   - Knowledge that must become current truth (main's CTX-0105) enters the canonical ledger through the existing, audited knowledge path, with an explicit relation. The manifest then records the mapping `label:CTX-0105 → CTX-0113`.
   - Nothing is renumbered, rewritten or overwritten.
3. **Git history only.** Resolve conflicts in favour of 1.4 and rely on Git history.
   - Loses main's uncommitted PF-0042/PF-0043.
   - Gives no in-workspace audit.
   - Breaks PF-0039's reference silently.

### Behaviour (option 2)
- **`history plan --label L --from-ref REF [--from-dir DIR] [--json]` (read-only dry-run).**
  - Reads the other side with `git show`/`ls-tree` (for REF), or reads a checkout directory read-only, with no links followed out of it and only `.yallaflow/` read. DIR covers uncommitted records.
  - Classifies every PF/SRC/CTX/ADR ID and every shared record as **identical**, **other-only**, **diverged-shared** (same record, changed on one side since the merge base) or **colliding** (same ID, different records).
  - Proposes an action for each:
    - colliding or diverged records → preserve in lineage;
    - other-only records → normal Git merge;
    - memory collisions → a knowledge-reconciliation step.
  - Prints the plan and its SHA-256, and writes the plan file only to a path the user gives.
- **`history import --plan FILE --confirm HASH-PREFIX`.**
  - Re-validates that the plan still matches the sources by recomputing hashes.
  - Copies the files into `.yallaflow/lineages/.L.staging-<random>`, verifies them, writes `manifest.yaml`, then renames to `.yallaflow/lineages/L`.
  - **Idempotent:** an identical existing lineage is a no-op.
  - **Never overwrites:** a different existing lineage is refused.
  - **Partial failure:** only the staging folder remains, and it is removed on the next run.
  - Writes nothing to `work/`, `sources/`, `context/` or the other checkout.
- **`manifest.yaml` (CLI-owned).** It records:
  - schema, label, source (ref + commit, or directory fingerprint + capture time), merge base, and import time;
  - per-file path + SHA-256 + size;
  - per-identity entries `{ id, kind, classification, canonicalId: null | ID, relation: null | 'reconfirms'|'supersedes'|'distinct', decidedBy: work id }`.
- **`history map L:ID --to CANONICAL-ID --relation R --work W`.** Records a mapping decision after the canonical record exists (for example after `knowledge promote` created CTX-0113 citing `lineage:L:CTX-0105`). It is validated: the canonical record must exist and cite the lineage in its evidence. It is append-only and audited.
- **`history show L[:ID]` and `history list`** are read-only.
- **`history remove L --confirm HASH-PREFIX` (rollback).** Allowed only if the files still match the manifest and no canonical record or mapping references the lineage. Git revert remains the outer rollback.
- **doctor.** Verifies lineage file hashes and that mappings point to existing canonical records. When it checks a lineage record's references (for example PF-0039's main-side knowledge), it resolves them inside the lineage.
- **Ownership.** `lineages/<label>/` is CLI-owned, written only by `history import|map|remove`. The agent contract does not change (no new agent-facing obligation). Lineages are read-only history and never active work.

### PF-0039 (diverged shared record) — owner decision 3 (SRC-0043)
- **Canonical version.** Main's DONE version (the published v1.3.0 history) stays canonical through the Git merge. It is never reopened or downgraded.
- **Workspace copy.** The workspace's own pre-merge copy (1.4, VERIFICATION) is **also preserved** in the lineage, under `workspace/`, for historical traceability.
- **The plan.** It marks every diverged shared record changed only on the other side as "take the other side, preserve the workspace copy".
- **Fact reference.** PF-0039's main-side knowledge cites main's CTX-0105. That reference is resolved only through an explicit mapping recorded after the memory step below.

### Owner constraints (SRC-0043)
- **The lineage is immutable and read-only, and never a second canonical ledger.** Lineage records are not listed as work, never become active, and never receive new records.
- **Imported knowledge follows existing Core rules.** It allocates a new CTX identity through `knowledge propose`/`promote`, and the source mapping is recorded with `history map`.
- **No relation without verifying semantics.** No supersession or equivalence is asserted automatically. The plan only reports what each side did. A person or agent verifies the meaning of main's CTX-0105 against the current ledger (including whether CTX-0102 is still true on the merged code) before choosing `--supersedes`, `--reconfirms`, `--disputes` or a new independent fact. `history map` records `relation: 'distinct'` when no semantic relation holds.

### Merge procedure (on a disposable clone first; real main only after owner review)
1. **On an integration branch from `feature/workspace-1.4`:** run `history plan --label main-v1.3.0 --from-ref main --from-dir <main checkout>` (dry-run, owner review), then `history import`.
2. **`git merge main`, resolving:**
   - `.yallaflow/work/PF-0041/**` → ours (main's copy is in the lineage, hash-verified);
   - `.yallaflow/context/index.yaml` → ours, then the knowledge reconciliation below;
   - `state/current.yaml` → ours;
   - `resources/console/app.js` → ours (it contains the v1.3.0 fix, verified by content);
   - PF-0039 → theirs;
   - everything else → Git's result.
3. **Memory:** a reconciliation work item proposes main's CTX-0105 statement with `--supersedes CTX-0102` (as main did) and evidence `lineage:main-v1.3.0:CTX-0105`. After promotion (for example as CTX-0113), run `history map main-v1.3.0:CTX-0105 --to CTX-0113 --relation supersedes`. Then `context render`, `doctor`, and the full suite.
4. **Main checkout (owner):** main's PF-0042/PF-0043 are uncommitted and now preserved in the lineage, hash-verified against the checkout. Before main can move to the merged commit, they must be moved out of the way with `git stash -u`, which is reversible; nothing is deleted. Fast-forward main only after review.
5. **Rollback:** before step 5, delete the integration branch; main is untouched. After step 5, `git reset` main to its previous commit (recorded in the procedure) and `git stash pop`.

### Non-goals
No renumbering, no rewriting of historical records, no automatic merge, no change to Shared Project mode, no alias resolution in general readers.

### Acceptance Criteria

AC-001..AC-006 in requirements.yaml.

## Implementation Plan

**Modules (new, `src/history/`):**
- `source.js` reads the other side read-only:
  - **GitSource:** `git ls-tree -r -z` / `git cat-file blob` by object id, argv only, read-only Git subcommands, so the no-network/no-mutation guard stays valid.
  - **DirSource:** a checkout folder, `.yallaflow/` only, `lstat` + `O_NOFOLLOW`, no links followed, regular files only.
  - Both return `{ path, sha256, size, bytes }` lazily.
- `plan.js` classifies IDs against this workspace and the merge base (`git merge-base` read-only):
  - PF, by work directory and `meta.json` identity;
  - SRC, by `source.json` checksum;
  - CTX, by ledger fact id and content;
  - ADR, by file.
  - It also flags diverged shared records and produces the canonical plan JSON with its SHA-256.
- `lineage.js`:
  - import: staging dir + per-file hash verification + manifest + atomic rename; idempotent; refuse a different existing lineage;
  - `map`: append-only mapping with validation;
  - `remove`: hash-checked and unreferenced only;
  - read helpers.
- `src/commands/history.js` + `cli.js`: `history plan|import|show|list|map|remove` with `--json`. `import`, `map` and `remove` take the workspace lock; `plan`, `show` and `list` are read-only.

**Owner constraints in the plan (SRC-0043):**
- The plan output includes, for each diverged shared record changed only on the other side, a workspace-side copy to preserve (PF-0039).
- `history map` requires a relation chosen and justified with `--reason`, and validates only facts (that the canonical record exists and cites the lineage), never meaning.
- The rehearsal records the semantic verification of CTX-0105 and CTX-0102 as a reviewed knowledge decision before mapping.

**Core integration:**
- `STATE_OWNERSHIP` gains `lineages/<label>/` (cli).
- `doctor` gains lineage hash and mapping checks.
- Lineage-scoped reference resolution for knowledge integrity: a canonical record listed in a manifest scope entry (PF-0039) resolves its factIds through the manifest mapping.
- Schema `resources/schemas/history-plan-1.schema.json`.

**Tests** (`test/history.test.js`), on disposable Git repositories built in the test, never the real ones:
- Divergent branches reproduce the real shape: a work-ID collision committed on one side, uncommitted ones in a second checkout, a CTX collision with a supersede, a diverged shared item, other-only and identical records.
- `plan` is read-only: tree hashes of both checkouts, including uncommitted files, are unchanged.
- Classification is correct.
- `import` is byte-identical and idempotent; a different existing lineage is refused; an injected failure mid-copy leaves no partial lineage.
- `map` validation; `remove` refusal while referenced.
- doctor detects a tampered lineage file and a dangling mapping.
- An end-to-end merge rehearsal on a clone: import, `git merge` with the documented resolution rules, knowledge reconciliation, mapping, doctor clean.

**Real dry-run.** `history plan --label main-v1.3.0 --from-ref main --from-dir /home/engamer/Amasi/YallaFlow`, run read-only from the 1.4 worktree. Its output goes to the owner. Nothing is applied to either real checkout.

**Merge rehearsal.** The full procedure from the specification runs on a disposable clone of both branches (with a copy of main's uncommitted records). The real main is not touched.

**Docs:** `docs/history.md` plus an update to `docs/release-1.4-integration.md` with exact merge steps and rollback.

**Review:** an independent review of the mechanism and the rehearsal.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0042
**Type:** file
**Name:** owner-1.4-final-integration.md

Raw source preserved in: `.yallaflow/sources/SRC-0042/owner-1.4-final-integration.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0043
**Type:** file
**Name:** owner-pf0052-decisions.md

Raw source preserved in: `.yallaflow/sources/SRC-0043/owner-pf0052-decisions.md`. Read it directly; it is not duplicated here.
