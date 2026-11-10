# PF-0112 — Checkpoint D decision (owner, 2026-11-10)

Checkpoint D decision: **v1.5.0 is not yet approved for public release.**

The reported 1094/1094 passing tests and completed implementation are encouraging, but two release blockers remain:

1. Independent code and security review.
2. Real end-to-end validation with two subscription-based Codex agents.

### Phase 1 — Independent review

Perform an independent, adversarial review of the entire execution feature, prioritizing:

- `src/execution/git-ops.js`
- `src/execution/merge.js`
- `src/execution/review.js`
- Execution Manager, queue persistence, and restart recovery
- Shared Project integration and integration records
- Git safety enforcement and command allowlist
- Agent approval and session lifecycle
- Backward compatibility with v1.4.2

Use a separate review context or independent reviewer where available. Do not treat the implementation author's own assertions as independent verification.

Review for data loss, TOCTOU races, unsafe Git behavior, incorrect commit contents, duplicated execution, security bypasses, and false VERIFIED states.

Report findings by severity, with file/line references, reproduction steps, and recommended fixes.

Fix confirmed issues and rerun all relevant tests.

### Phase 2 — UX and release preparation

- Resolve remaining mixed-language server messages in the Arabic UI.
- Update README for v1.5.0, including Run Now, Queue, Parallel, Review & Merge, and the upgrade path.
- Confirm existing CLI and project workflows remain backward compatible.
- Verify the installed npm package behaves correctly with agents enabled and disabled.
- Run the complete test suite after final changes.

### Phase 3 — Real E2E

When Codex subscription access becomes available, run the approved real-agent scenario in disposable repositories only.

Verify:

- Run Now.
- A sequential three-task Queue.
- Two concurrent Codex agents.
- A deliberate merge conflict.
- Conflict resolution by the agent.
- Fresh review and explicit merge approval.
- Final integrated code containing both agents' intended changes.
- No loss of uncommitted files or project knowledge.
- Recovery without duplicate sessions or commits.

Do not bypass subscription limits, use API keys, or incur separate API charges.

### Release boundaries

You may prepare and validate changes on `feature/execution-modes`.

Do not merge into main, tag, create a GitHub Release, or publish to npm.

Before any commit or push, present the final review findings, fixes, and test results for approval.

After both release blockers are cleared, return to Checkpoint D with an evidence-based release recommendation.

Do not treat this message as public release authorization.
