# Owner Checkpoint C decision (2026-11-09)

Checkpoint C decision for PF-0112 / YallaFlow v1.5.0:

I approve design corrections C1–C10 and conditionally approve the proposed Git command allowlist (G1–G10 plus read-only git log), subject to the restrictions below.

Risk decisions:
- A1 — Accepted with safeguards. If fast-forward is interrupted or repository state becomes inconsistent, stop immediately. Do not automatically reset, repair, remove lock files, or retry mutation. Provide clear manual recovery guidance.
- A2 — Conditionally accepted. Automated Git mutation is supported initially only on the verified Linux/Git configuration. On unverified platforms or Git versions, use a fail-closed approach and offer manual operations.
- A3 — Accepted as residual risk. Serialize YallaFlow operations and validate repository state before and after mutations. Detect unexpected concurrent changes and stop safely. Do not claim external Git processes can be prevented.
- A4 — Not accepted for v1.5.0. Do not execute project-defined external Git filters or custom merge drivers during automated merge, even if the user trusts them. Block automated merge for repositories requiring these tools and offer a manual alternative.
- A5 — Conditional. Add permanent GPG signing coverage before enabling automated GPG-signed commits. Otherwise block that signing path.
- A6 — Accepted with safeguards. Cleanup must never delete ignored files unless they are positively identified as reproducible dependencies. Show the exact deletion scope and require explicit confirmation.

Additional requirements:
1. The Git execution layer must use strict command-and-argument validation, not merely a list of executable names.
2. Preserve existing staged, unstaged, ignored, and untracked user data.
3. Do not weaken safety checks to make an acceptance test pass.
4. Keep approval tied to the exact reviewed merge content.
5. Ensure a failed or interrupted integration never appears as MERGED & VERIFIED.
6. Treat all detected inconsistent Git states as stop conditions.
7. Preserve the existing Checkpoint D release approval.

Please record these decisions and update the specification, risk register, implementation plan, and acceptance criteria accordingly.

You may proceed with M0 and M1, followed by M2 and M3 under the approved Git safety boundaries.

Do not commit, push, tag, or publish without a separate explicit approval.

Before enabling automated merge on a real project, demonstrate the complete implementation and its safety tests in disposable repositories.

Report any newly discovered safety issue before proceeding with the affected operation.
