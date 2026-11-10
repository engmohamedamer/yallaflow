# Owner decisions D14, D15 and M4 acceptance requirements (2026-11-10)

Approved. Please record these two decisions in PF-0112.

D14 — Agent Contract v12: Approved.
Update the agent contract to v12 to support the new tracked integration record. Do not weaken test 54 or introduce exceptions.
Ensure existing projects receive a clear `agent refresh` requirement, and preserve user-customized instructions or require explicit review before replacing them.

D15 — Approval Timeout: Approved.
Support project-level approval timeout settings of 5, 15, 30, and 60 minutes, with 5 minutes as the default.
Expired approvals must be rejected safely, never automatically approved. Preserve the current behavior for existing projects.

You may proceed with M4.

Additional M4 acceptance requirements:
1. Run the full test suite and resolve all failures, including test 54.
2. Verify the complete Web Console UX in English, Arabic, and mobile layouts.
3. Run the end-to-end scenario with two real Codex subscription-based agents in disposable repositories only.
4. Demonstrate Run Now, a three-task Queue, and two parallel agents.
5. Intentionally create a conflict between parallel tasks.
6. Merge the first task successfully, return the second to its agent for conflict resolution, then perform a fresh review and explicit approval.
7. Verify that both agents' intended changes exist in the final integrated result.
8. Confirm that no unrelated user files, uncommitted changes, or project knowledge are lost.
9. Test restart/recovery and confirm that interrupted operations cannot duplicate sessions or commits.
10. Review the UI from a nontechnical user's perspective. Keep the workflow simple and avoid exposing unnecessary Git complexity.

Use only my existing subscription-based Codex integration. No API keys, paid API calls, or new services.
Do not perform destructive operations in existing projects.
After M4, present a complete evidence-based release readiness report for v1.5.0, including test results, browser screenshots, limitations, known issues, and any remaining risks.
Stop at Checkpoint D. Do not commit, push, tag, or publish until I explicitly approve the release actions.
