# Owner specification approval and plan requirements (2026-11-09)

I approve the revised Specification Gate for PF-0112.

The v1.5.0 scope is now confirmed:
- Run Now
- Queue
- Parallel Execution
- Review & Merge
- Unified Agents Dashboard and Approvals
- Safe recovery, Git isolation, and Shared Project integration

Please record my explicit specification approval through the normal YallaFlow workflow.

Next, finalize the Implementation Plan and present its separate approval gate.

Before requesting Plan approval, ensure the plan explicitly covers:
1. M3a Git transaction experiments in isolated disposable repositories, with permanent regression tests for every verified safety property.
2. Safe handling of Git filters, external helpers, signing, hooks, and repository configuration.
3. Correct ordering of merge, post-merge verification, Shared Project knowledge integration, and durable integration records.
4. Crash recovery and idempotency across every Git transaction boundary.
5. Clear stop conditions whenever a safety assumption fails.
6. Backward compatibility with v1.4.2.
7. A complete end-to-end acceptance test with two real subscription-based Codex agents, including a deliberate conflict.

M3a may propose commit and merge experiments in disposable repositories, but do not run them until the implementation plan is explicitly approved.

Do not implement application code, modify Git permissions, commit, push, or publish yet.

Present the final Implementation Plan Gate for my review.
