# Work-history reconciliation (1.4.0)

When two branches allocate YallaFlow IDs independently, the same number can name two different work items or project-memory facts (for example `main` and `feature/workspace-1.4` both have a PF-0041). A Git merge would mix them file by file. `yallaflow history` reconciles such branches **without renumbering or rewriting any record**:

- The other branch's records that cannot live at their IDs are preserved **byte-identically, under their original IDs**, in a read-only **lineage**: `.yallaflow/lineages/<label>/`.
- Canonical records keep their IDs. A lineage is history: it is never listed as work, never becomes active, and never receives new records.
- Knowledge from the other branch enters the canonical ledger **only through the normal knowledge commands**, under a new ID, after someone has verified what it means. The relation is then recorded as an explicit mapping.

## Commands

```bash
# 1. Dry-run (read-only; writes only the --out file you name, outside .yallaflow)
yallaflow history plan --label main-v1.3.0 --from-ref main --from-dir ../main-checkout --out /tmp/plan.json

# 2. Import the reviewed plan (atomic, idempotent, never overwrites)
yallaflow history import --plan /tmp/plan.json --confirm <first 8+ hash characters> --from-dir ../main-checkout

# 3. After the knowledge decision, record the mapping (append-only)
yallaflow history map main-v1.3.0:CTX-0105 --to CTX-0113 --relation canonical-continuation --work PF-0052 --reason "…verified…"

# 4. After git merge --no-commit and the plan's printed restore commands
yallaflow history verify-merge --plan /tmp/plan.json   # fails if any kept/taken record set is mixed

yallaflow history list
yallaflow history show <label>
yallaflow history show <label>:<ID> --json   # preserved bytes (base64), or fact objects
yallaflow history remove <label> --confirm <hash>   # rollback: intact and unreferenced lineages only
```

## What the plan reports

The JSON plan inventory classifies every identity with hashes for both sides and the merge base, including identical and workspace-only identities. Human output summarizes these and details each work item, source, ADR and project-memory fact that differs between the two sides is reported, compared with their merge base:

| Classification | Meaning | Action |
|---|---|---|
| `colliding` | The same ID was created independently on both sides | Keep this side's record; preserve the other side's in the lineage |
| `diverged-other` | The record existed at the fork and changed only on the other side | The Git merge takes the other commit; this side’s pre-merge copy is preserved. Uncommitted other-side changes are also preserved and need a separate decision |
| `diverged-both` | Changed on both sides | Keep this side's record; preserve the other side's |
| `other-only` | Only on the other side | Normal Git merge, or preserve it if it is uncommitted (a merge cannot carry it) |
| facts | Any fact collision or divergence | A knowledge decision; no relation is ever assumed |

The plan also lists the files to preserve with their SHA-256 and origin (`git:<commit>` or `checkout:uncommitted`), the per-path merge resolution, and anything not read (symbolic links are reported, never followed).

## Guarantees

- **Read-only sources.** `plan` reads the other branch through read-only Git plumbing, plus, with `--from-dir`, its checkout: only `.yallaflow/`, only regular files, never following a link. Neither checkout is modified, including uncommitted and untracked files.
- **Re-checked on import.** `import` re-reads every file and refuses unless its bytes still match the plan. It refuses a plan whose hash does not match its content, and any path outside `.yallaflow/`.
- **Atomic.** Files are written to a staging folder and renamed into place, so a lineage appears complete or not at all. An interrupted import leaves only its staging folder, which the next run removes.
- **Idempotent and never overwriting.** Importing the same plan twice is a no-op. A different lineage under the same label is refused, never overwritten. Preserved files are read-only (0444).
- **Mappings.** Recorded only for a canonical record that exists and, for facts, cites the lineage in its evidence. A reason is required, and mappings are append-only. YallaFlow checks the facts; the meaning is the decision of whoever records it.
- **Referential integrity.** A record taken from the other side (for example PF-0039) keeps that side's fact IDs. `doctor` fails until every preserved fact it cites is mapped, and `work show` reports the resolution (`lineage: main-v1.3.0, CTX-0105 → CTX-0113`). The record itself is never rewritten.
- **Commit/checkout disagreements.** Planning refuses dirty workspace restore targets and checkout changes that mask a committed merge conflict. Commit or reconcile those changes before planning exact restores.
- **Deleted identities.** A whole historical identity missing on either side is refused during planning; restore or reconcile that deletion explicitly first.
- **Integrity.** `doctor` verifies every lineage file against its hash and reports added files and dangling mappings.
- **Merging.** `git checkout --ours` resolves only conflicting files; a file that exists only on the other side would merge in silently. The plan prints exact `git restore` commands per record set, and `verify-merge` compares each kept or taken record set against its source commit in both the working tree and Git index (object IDs, modes and unresolved stages). Extra symbolic links, hard links and non-regular entries fail verification. The plan must match the imported lineage planHash; resolution targets are derived again from the imported identities.
- **Refused sources.** Hard-linked files in the other checkout are not read. Secret-looking files stop the import unless you decide otherwise (`--allow-secrets`), because a byte-identical copy cannot be redacted. The plan is rebuilt from its inputs at import, including label, workspace commit, resolution targets and merge commands, so a recomputed hash cannot smuggle in identities, files or restore instructions.
- **Rollback.** `remove` deletes a lineage only if it is intact and nothing references it: no mappings, and no record under `.yallaflow/` citing it. It also refuses (unless `--force`) when the lineage holds files that exist nowhere else. Referenced history is never silently destroyed. Git revert remains the outer rollback.
