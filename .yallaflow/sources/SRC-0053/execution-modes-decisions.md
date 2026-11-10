# Owner decisions — Checkpoint B (2026-11-09)

I approve the proposed Lane + Run architecture and the overall v1.5.0 direction, covering Run Now, Queue, and Parallel in one release.

Decisions:
- D1: Approved. Shared Project Mode is required for Parallel, with explicit confirmation and migration safety checks.
- D2: Conditionally approved. Allow the three proposed Git operations only through a restricted, validated execution layer. No force operations, automatic merge, commit, push, or destructive cleanup. Verify hook isolation and safe worktree deletion.
- D3: Approved. Use the sibling <repo>.lanes/<slug> directory structure, with strict path validation.
- D4: Conditional. Do not hardcode 30 minutes until Codex ACP timeout behavior is verified. Never auto-approve.
- D5: Approved. Default 2 agents, maximum 4. Treat concurrency beyond 2 as experimental until tested.
- D6: Approved. Target v1.5.0.
- D7: Approved. Queue advances automatically only after verified DONE and a fully stopped session. Any required review, question, approval, failure, or usage limit must block progression.

Additional requirements:
1. Preserve v1.4.2 behavior for existing projects.
2. Do not lose existing tasks, knowledge, uncommitted changes, or historical evidence.
3. Make the Agents view interactive, with centralized approvals and session controls.
4. Ensure queue persistence and recovery never cause duplicate task execution.
5. Prevent worktree deletion while an agent is active or work is uncommitted, unmerged, or otherwise not safely preserved.
6. Keep Claude Team limitations explicit rather than promising unsupported automation.
7. Include negative tests for Git safety, concurrency, and crash recovery.

Record these decisions in PF-0112 and proceed with the final specifications and implementation plan.
Do not start coding yet. Present the specification and plan approval gates before implementation.
