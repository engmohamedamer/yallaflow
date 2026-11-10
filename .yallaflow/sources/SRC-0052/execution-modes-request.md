# Owner request — Checkpoint B (2026-11-09)

Approved. Proceed with Checkpoint B — Architecture & Implementation Planning on feature/execution-modes.

We are building one unified execution experience supporting:
1. Run Now: Simple, immediate task execution, preserving existing behavior.
2. Queue: Multiple tasks executed sequentially with durable state, approvals, recovery, and cancellation.
3. Parallel: Multiple agents working simultaneously in isolated Git worktrees, using our existing subscription-based integrations.

Prepare a complete, code-grounded architecture and implementation plan covering:
- Unified Execution Manager and task/session lifecycle.
- Reuse of existing AgentBridge, Shared Project Mode, checkout locks, and session recovery.
- Queue persistence, scheduling, and restart recovery.
- Worktree creation, identity, task ownership, setup, and safe cleanup.
- Unified Agents Dashboard and approvals inbox.
- Task completion detection, error handling, and usage limits.
- Git review, conflict detection, and knowledge integration.
- Backward compatibility with v1.4.2.
- UI/UX flows for both small and large projects.
- Security boundaries, permission handling, and testing strategy.

Design requirements:
- Keep the default workflow simple for small projects.
- The three modes must share one coherent architecture and user experience.
- Do not duplicate existing YallaFlow functionality.
- Do not introduce API keys, new paid services, or unnecessary infrastructure.
- Preserve the existing Git safety guarantees.
- Explicitly identify any Git command permissions requiring my approval.
- Use the successful two-Codex-session PoC as evidence, while acknowledging its untested limitations.
- Include UI mockups or clear screen flows showing how users will actually interact with the system.
- Provide a phased development plan, but target all three modes in the same feature release.
- Define measurable acceptance criteria for each mode and the overall release.

You may inspect the repository and prepare planning documents on the feature branch, following existing YallaFlow conventions.
Do not implement features, change Git safety rules, commit, or push yet.
Present the architecture, UI proposal, affected files, risks, and implementation milestones for my approval before coding.
