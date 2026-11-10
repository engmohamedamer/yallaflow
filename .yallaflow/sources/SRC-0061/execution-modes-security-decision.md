# PF-0112 — Security decision after Checkpoint D (owner, 2026-11-10)

Decision: proceed with a minimal-change approach for v1.5.0. Option A with a restricted version of Option C.
Keep the existing architecture and implemented protections. Do not build Option B or redesign the execution system for this release.

1. Keep Run Now, Queue, Parallel, Review, and manual merge available.
2. Verify Codex sandbox restrictions on shared Git metadata during the approved real-agent E2E.
3. Do not allow YallaFlow to execute agent-controlled scripts, ignored executables, or dependencies with my console privileges.
4. If required merge verification cannot be performed safely, disable Automated Merge for that task and show a clear explanation with a manual fallback.
5. Automated Merge must remain fail-closed and only become available when all required security checks are satisfied.
6. Add Agent Contract rules against modifying shared Git metadata, Git configuration, or performing commits/merges in managed lanes. Treat these as behavioral guidance only.
7. Preserve the current UX wherever possible.
8. Do not silently weaken required checks or mark an unverified task as MERGED & VERIFIED.

Make only targeted changes, with focused regression tests. After these changes, perform one final focused independent review of the previously identified high-risk boundaries. No broad multi-agent review. If the final review finds a critical or high-severity issue, stop the affected functionality and report it. Do not enter another open-ended review cycle. Keep the release blocked until the real Codex E2E and security checks pass. Do not commit, push, tag, or publish.
