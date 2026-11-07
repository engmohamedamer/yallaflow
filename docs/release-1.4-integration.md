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

The source IDs also collide: `main` has SRC-0027 and earlier, while 1.4 continues from SRC-0028. Main's uncommitted PF-0042 and PF-0043 may have attached their own sources, so check before any merge.

## Code integration (done)

PF-0044 brought the product code and tests from `534cdbb` into 1.4 in commit `17e3e34`:

- `resources/console/app.js`: four hunks. The agent panel re-renders only the stream while chunks arrive, the activation callback is awaited, and the agent panel loads after creation and on item navigation.
- `test/workspace-lock.test.js`: the lock holder is released over IPC instead of by a 1.5-second timer.
- `test-support/agent-fixtures.js`: whitespace.
- `CHANGELOG.md`: the two 1.3.0 "Fixed" lines.

The other files in `534cdbb` were deliberately not copied: `.yallaflow` records, `research/release-review` artifacts, and the design proposal (the latter two belong to main's PF-0041). Use a content check, not a patch check, to confirm the fix is present. A reverse-apply of the patch fails only because surrounding lines changed on 1.4.

## Why a merge into `main` is blocked

A Git merge would combine two different `PF-0041` directories, file by file. Results: conflicting `meta.yaml`, `progress.yaml` and `work.md` files, plus evidence logs (`V-001-verification.log`) from different work sitting under one ID. That silently corrupts history, so it is never acceptable. Renumbering by hand is also forbidden, because evidence logs, ledgers, commit messages and checkpoint summaries cite these IDs.

YallaFlow has **no supported command** for importing or renumbering a work item:

- Shared Project mode (`yallaflow shared enable`) gives every new item a clone-tagged ID (`PF-<tag>-####`). That prevents **future** collisions, but it does not repair existing ones.
- `yallaflow doctor` detects damaged records, but it does not reconcile them.

So the merge into `main` stays blocked until the repair mechanism below exists and is verified. This blocks nothing in 1.4 development: the feature branch is internally consistent.

## Proposed repair mechanism (needs owner approval before implementation)

Add a Core operation, for example `yallaflow work adopt --from <git-ref> <work-id>`. It imports one work item from another branch under a new local ID and keeps the original intact:

1. Read the foreign directory with `git show <ref>:.yallaflow/work/<id>/…` (read-only) and copy it byte-for-byte to `.yallaflow/work/<new-id>/`. Evidence logs, checkpoint summaries, timestamps and `work.md` history are never edited.
2. Record the provenance in a new, CLI-owned `adoption.yaml`: source ref, commit, original ID, a SHA-256 for every copied file, the adoption time, and the actor.
3. Add a project-level alias index (`.yallaflow/work-aliases.yaml`) that maps `<ref>:<original-id>` to `<new-id>`, so references in adopted records still resolve. Readers show "PF-0047 (adopted from main:PF-0041)".
4. Have `doctor` check every adopted file against its recorded hash.
5. Adopt sources the same way, with the same alias rules (`SRC-*`), and rewrite work-to-source links only in the new alias index, never in the adopted files.

Merge procedure once the mechanism is approved and tested:

1. On `main`, commit or archive main's PF-0042 and PF-0043 as they are. The owner decides whether main's unfinished PF-0043 stays open.
2. On the 1.4 branch, adopt main's three items. They receive new 1.4 IDs, and the histories of both sides are preserved.
3. Merge `main` into the 1.4 branch, resolving `.yallaflow/work/PF-004[1-3]` in favour of the 1.4 side. That is safe because main's versions now exist under their adopted IDs, which the hashes prove.
4. Verify with `doctor`, check that every adopted hash matches the original ref, and run the full suite.

The alternative of enabling Shared Project mode on both branches avoids future collisions. It also changes how canonical memory is written on feature branches, so it is a separate owner decision.

## Interim rules until reconciliation

- Do not create YallaFlow work items in the main checkout. Main changes that 1.4 needs (hotfixes) are carried over narrowly, as PF-0044 did, and listed here.
- Never edit or close main's PF-0043 to hide the collision.
- The useful part of main's uncommitted PF-0043, the read-only project-understanding summary, is re-implemented on 1.4 within the Project Overview milestone. Main's working tree is left untouched.
