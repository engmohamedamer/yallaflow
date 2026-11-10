# Owner decisions D8–D13 and Git transaction validation request (2026-11-09)

I have reviewed D8–D13. Please record the following decisions in PF-0112.

D8 — Conditional approval. If main moves after my approval, revalidate everything. If the reviewed diff, resulting tree, merge commit, verification scope, or integration outcome changes, require a fresh explicit approval. Never silently extend an earlier approval to materially different content.

D9 — Conditional approval. Git hooks may be disabled for controlled YallaFlow operations, but required equivalent checks must be identified and executed. Do not assume task tests replace all hooks or CI checks. Block merging when mandatory verification cannot be satisfied.

D10 — Approved. Use a durable, team-visible integration record, with atomic/recoverable updates and safe Shared Project handling. Ensure the integration record accurately reflects the final verified state.

D11 — Approved. Review & Merge applies to parallel worktrees in v1.5.0. Preserve existing Run Now and Queue Git behavior.

D12 — Modified. Do not automatically delete worktrees. Retain them by default. Offer a separate explicit Cleanup action after MERGED & VERIFIED, subject to all safety checks. Never delete uncommitted or otherwise unpreserved data.

D13 — Approved with conditions. Use one merge commit per lane as the default strategy, preserving existing task history. No squash, rebase, or history rewriting.

Before requesting Specification Gate approval, also validate the complete Git transaction design:
- How temporary indexes, commit-tree, and merge-tree interact.
- How commit --only behaves with staged and unstaged changes.
- Whether fast-forwarding main can preserve unrelated local changes safely.
- How shared integrate and integration.yaml are incorporated without changing already-approved content.
- What happens if the console crashes after updating main but before recording verification.
- Whether the implementation can truthfully guarantee that no unrelated file is committed.

Treat any unverified safety guarantee as an open risk, not as proven behavior.

Record the decisions, update requirements and acceptance criteria, and request the Specification Gate again.

Do not implement code or approve the gate on my behalf.
