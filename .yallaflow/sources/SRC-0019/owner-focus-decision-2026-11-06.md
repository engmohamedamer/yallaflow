# Owner decision on console focus and release preparation (2026-11-06, agent session)

"Console-created work items must never automatically become the active work item, even when no other
item is active. Creation and activation are separate actions. Activation must be explicit through
YallaFlow's existing Core rules. Preserve the original CLI behavior."

Before release:
1. Apply this focus decision and update the relevant regression tests.
2. Revise AC-012 through the approved YallaFlow change-control process to explicitly allow the authorized
   Create Work operation, while keeping all other Console mutations prohibited.
3. Verify that invalid Vult records remain visible as integrity warnings and do not distort completion metrics.
4. Ensure attachment content availability is reported accurately, including files that cannot be text-extracted.
5. Run the full test suite and browser regression checks.
6. Prepare a final acceptance walkthrough using an existing project and a new project: create work, attach
   requirements, inspect the Flow, verify active-work preservation, and continue through Claude or Codex.
Do not modify Vult's historical records or enable Shared Project mode. Do not commit, tag, push, or publish.
Stop after the final verification report.
