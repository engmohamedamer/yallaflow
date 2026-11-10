# Owner scope revision — Review & Merge in v1.5.0 (2026-11-09)

Before approving the Specification Gate for PF-0112, I need one important scope revision.

I approve the overall Lane + Run architecture and the seven recorded decisions, but the specification is not approved yet.

We have decided that Review & Merge must be part of YallaFlow v1.5.0, alongside Run Now, Queue, and Parallel.

I don't want users to manually execute Git commands every time a parallel task finishes.

Please revise the existing PF-0112 specification, requirements, acceptance criteria, architecture, and implementation plan to include:
1. A complete Review & Merge workflow in the Web Console.
2. Automated pre-merge checks: task completion, tests, Git changes, conflicts, and Shared Project integrity.
3. A clear review screen with changed files, verification evidence, and merge readiness.
4. An explicit user approval step before any commit or merge.
5. Safe, controlled Git commit and merge execution after approval.
6. Post-merge verification and Shared Project knowledge integration.
7. Safe handling of concurrent merge requests, conflicts, failures, and recovery.
8. Clear separation between Task DONE and Changes MERGED & VERIFIED.
9. Worktree cleanup only after successful integration and all safety checks.

Investigate the safest approach to Git commit and merge permissions, including how to handle existing uncommitted changes and avoid accidentally committing unrelated files.

Update the Git safety threat model and prepare the exact proposed command allowlist for Checkpoint C.

Do not automatically commit, merge, resolve conflicts, reset, rebase, push, or delete anything during this research.

Keep the existing YallaFlow specification workflow intact:
- Record this as a new user decision/source in PF-0112.
- Revise the existing specification and acceptance criteria.
- Preserve the previous decisions and history.
- Request the Specification Gate again after revision.
- Do not approve the gate on my behalf.
- Do not proceed to implementation.

The goal is a complete, safe execution lifecycle: Start → Execute → Review → Approve → Merge → Verify, with minimal manual Git operations.
