# 1.4.0 — main integration and work-ID reconciliation

Status: 2026-11-07. This document covers how `feature/workspace-1.4` takes the published v1.3.0 fixes from `main`, and what blocks an eventual merge back into `main`. It does not authorize a merge.

## Branch situation

| | `main` | `feature/workspace-1.4` |
|---|---|---|
| Base | `534cdbb`, tag `v1.3.0` (published) | Forked at `b700b2c` (1.3.0 before its release fix) |
| Work IDs created after the fork | PF-0041, PF-0042, PF-0043 | PF-0041 … PF-0045 and later |

Both branches allocated the same numbers for **different** work:

| ID | On `main` | On `feature/workspace-1.4` |
|---|---|---|
| PF-0041 | Recover workspace UX proposal and release review artifacts (DONE, committed in `534cdbb`) | Work lifecycle: hold, resume, close, reopen closed work (DONE) |
| PF-0042 | Publish v1.2.0 and v1.3.0 (DONE, **not committed**, main checkout only) | Regression test: a closed child never satisfies its parent (DONE) |
| PF-0043 | Activation and onboarding console slice (IMPLEMENTATION, **not committed**, main checkout only; duplicates part of 1.4's PF-0043) | Console Work Management and gate decisions (DONE) |

No source-ID collision was found: `main` has SRC-0027 and earlier, while 1.4 continues from SRC-0028. Main's uncommitted PF-0042 and PF-0043 may have attached their own sources, so check before any merge.

## Code integration (done)

PF-0044 brought the product code and tests from `534cdbb` into 1.4 in commit `17e3e34`:

- `resources/console/app.js`: four hunks. The agent panel re-renders only the stream while chunks arrive, the activation callback is awaited, and the agent panel loads after creation and on item navigation.
- `test/workspace-lock.test.js`: the lock holder is released over IPC instead of by a 1.5-second timer.
- `test-support/agent-fixtures.js`: whitespace.
- `CHANGELOG.md`: the two 1.3.0 "Fixed" lines.

The other files in `534cdbb` were deliberately not copied: `.yallaflow` records, `research/release-review` artifacts, and the design proposal (the latter two belong to main's PF-0041). Use a content check, not a patch check, to confirm the fix is present. A reverse-apply of the patch fails only because surrounding lines changed on 1.4.

## Why a merge into `main` is blocked

A Git merge would combine two different `PF-0041` directories, file by file. Results: conflicting `meta.yaml`, `progress.yaml` and `work.md` files, plus evidence logs (`V-001-verification.log`) from different work sitting under one ID. That silently corrupts history, so it is never acceptable. Renumbering by hand is also forbidden, because evidence logs, ledgers, commit messages and checkpoint summaries cite these IDs.

Before PF-0052, YallaFlow had **no supported history-import command**:

- Shared Project mode (`yallaflow shared enable`) gives every new item a clone-tagged ID (`PF-<tag>-####`). That prevents **future** collisions, but it does not repair existing ones.
- `yallaflow doctor` detects damaged records, but it does not reconcile them.

The mechanism below preserves history; an actual merge into `main` still requires the owner’s final authorization. This blocks nothing in 1.4 development: the feature branch is internally consistent.

## Reconciliation mechanism (implemented, PF-0052)

The owner approved the **preserved lineage** approach instead of `work adopt` with new IDs (decisions recorded in PF-0052, SRC-0043). The mechanism is `yallaflow history`; see [`history.md`](history.md).
- **Preserved records.** Main's colliding records are kept byte-identical under their original IDs in `.yallaflow/lineages/main-v1.3.0/`, along with 1.4's pre-merge PF-0039.
- **Memory.** Main's diverging memory enters the canonical ledger through the normal knowledge commands under a new ID. The relation is verified and recorded as a mapping.
- **Nothing is renumbered, rewritten or overwritten.**

### Read-only dry-run against the real main checkout (2026-11-07)

`history plan --label main-v1.3.0 --from-ref main --from-dir ~/Amasi/YallaFlow`, run from the 1.4 worktree. The main checkout, uncommitted files included, was hash-identical before and after.

| Identity | Classification | Action |
|---|---|---|
| PF-0039 | diverged-other (DONE on main, unchanged on 1.4) | Git takes main's DONE (owner decision 3); 1.4's pre-merge copy preserved |
| PF-0041 | colliding (committed on main) | Keep 1.4's; preserve main's |
| PF-0042 | colliding (**uncommitted** on main) | Keep 1.4's; preserve main's |
| PF-0043 | colliding (**uncommitted** on main) | Keep 1.4's; preserve main's |
| CTX-0102 | diverged-other (superseded on main) | Knowledge decision |
| CTX-0105 | colliding (main: v1.3.0 Codex/Claude-exclusion fact; 1.4: lifecycle fact) | Knowledge decision |

- **Files to preserve:** 41 (36 from main, 26 of them uncommitted; 5 from 1.4).
- **No source or ADR collisions.**

**Semantic verification (owner decision 1).** On the 1.4 tree:
- `src/agents/claude.js` is absent and excluded in `package.json`, `CLAUDE_NOT_INCLUDED` exists, and Codex runs as a managed session. So main's CTX-0105 statement holds.
- CTX-0102's bundled-channel Claude claim no longer describes the code.

The verified relation is: main's CTX-0105 becomes a new fact that **supersedes CTX-0102**.

### Merge rehearsals on disposable clones

- **Setup.** A `git clone --no-local` of the repository, with main's uncommitted files copied read-only into a worktree of the clone. The real repository was only read.

**Rehearsal 1 found a defect.** Resolving with `git checkout --ours -- .yallaflow/work/PF-0041` resolves only *conflicting* files. Main's `PF-0041/discovery.yaml`, which exists only on main, merged silently into 1.4's PF-0041. Neither `doctor` nor the full suite noticed it; the independent review found it. Fixes:
- The plan now emits exact restore commands.
- A new `history verify-merge` checks each kept or taken record set against its source commit, including index objects and modes, unresolved stages and unsafe filesystem entries. It binds the plan to the imported lineage hash and derives its resolution targets again.

**Rehearsal 2 passed** on a fresh clone, using the plan's commands:
1. **Plan and import.** `history plan` (41 files) and `history import` (hashes verified), then commit.
2. **Merge.** The plan's `mergeCommands`: `git merge --no-ff --no-commit 534cdbb…`, then `git restore --source=534cdbb… --staged --worktree -- .yallaflow/work/PF-0039` and `git restore --source=HEAD --staged --worktree -- .yallaflow/work/PF-0041 PF-0042 PF-0043 .yallaflow/context/index.yaml .yallaflow/state/current.yaml`. Plus `git restore --source=HEAD --staged --worktree -- resources/console/app.js` (1.4 already contains the v1.3.0 fix, PF-0044).
3. **Result.** 0 unresolved conflicts. **`history verify-merge` passed (5 record sets).** PF-0041 is identical to 1.4's, product code is unchanged, and PF-0039 is main's DONE. Committed.
4. **Memory.** A reconciliation work item verified the claims and promoted main's statement as **CTX-0113 superseding CTX-0102**. The mappings `main-v1.3.0:CTX-0105 → CTX-0113 (canonical-continuation)` and `main-v1.3.0:CTX-0102 → CTX-0113 (supersedes)` were recorded. `doctor` reports 0 failures and the lineage passes with 2 mappings. `work show PF-0039` resolves K-001's CTX-0105 → CTX-0113.
5. **Full suite on the merged tree:** see the PF-0052 verification record.
6. **Main fast-forward and rollback,** rehearsed in the clone's main worktree:
   - `git stash push -u`, then `git merge --ff-only integration/1.4`.
   - The stashed PF-0042/43 files are byte-identical to the lineage copies.
   - `git reset --hard 534cdbb` + `git stash pop` restored main exactly (hash-verified, uncommitted files included).

### Final integration procedure (to run only after the owner's final authorization)

```bash
cd ~/Amasi/YallaFlow-1.4
git switch -c integration/1.4 feature/workspace-1.4
PLAN=$(mktemp -d)/plan.json                     # private path, not a shared /tmp name
node src/cli.js history plan --label main-v1.3.0 --from-ref main --from-dir ~/Amasi/YallaFlow --out "$PLAN"   # owner reviews
node src/cli.js history import --plan "$PLAN" --confirm <hash prefix> --from-dir ~/Amasi/YallaFlow
git add .yallaflow/lineages && git commit -m "chore(history): preserve main v1.3.0 records as lineage main-v1.3.0"
# run the plan's mergeCommands exactly as printed (git merge --no-ff --no-commit <commit>; git restore … for each record set), then:
git restore --source=HEAD --staged --worktree -- resources/console/app.js
node src/cli.js history verify-merge --plan "$PLAN"   # must pass before committing
git commit -m "merge: main (v1.3.0) into 1.4 integration"
# memory reconciliation (a bounded change work item): verify the claims, then
node src/cli.js knowledge propose <W> --kind architecture --source implementation-runtime --summary "<main's CTX-0105 text>" --supersedes CTX-0102 --evidence .yallaflow/lineages/main-v1.3.0/other/context/index.yaml#CTX-0105 --evidence package.json --evidence src/agents/experimental.js --evidence src/agents/codex.js --evidence src/agents/bridge.js --evidence docs/agents.md
node src/cli.js knowledge promote <W> --candidate K-001          # → new CTX id
node src/cli.js history map main-v1.3.0:CTX-0105 --to <new CTX> --relation canonical-continuation --work <W> --reason "…"
node src/cli.js history map main-v1.3.0:CTX-0102 --to <new CTX> --relation supersedes --work <W> --reason "…"
node src/cli.js finish <W> && node src/cli.js context render && node src/cli.js doctor && npm run check
git add -A && git commit -m "chore(memory): reconcile main v1.3.0 memory"
# main checkout (owner)
cd ~/Amasi/YallaFlow
git rev-parse HEAD                               # rollback point (534cdbb…)
git stash push -u -m "pre-1.4-integration backup"
git merge --ff-only integration/1.4
node src/cli.js doctor && npm run check
```

**Rollback.**
- **Before the main fast-forward:** delete the `integration/1.4` branch; main is untouched.
- **After it:** `git reset --hard <rollback point>` and `git stash pop` in the main checkout. The rehearsal verified this restores main exactly.
- **The lineage itself:** `history remove` refuses while the lineage is cited or holds records that exist nowhere else. Git revert is the outer rollback.
- **The stash:** keep it as a backup. Its PF-0042/43 are preserved byte-identically in the lineage, and its uncommitted product-code edits (the abandoned duplicate console slice) are superseded by 1.4.

### Preventing future collisions
Before any further parallel work on two branches, either enable Shared Project mode (clone-tagged IDs; an owner decision), or create work items on one branch only.
