# Work Ledger — PF-0010

Created: 2026-10-19T15:15:08.265Z
Decomposed from: PF-0007

- 2026-10-19T16:05:14.488Z Stage: INTAKE → DISCOVERY
- 2026-10-19T16:05:14.817Z Stage: DISCOVERY → CLARIFICATION
- 2026-10-19T16:05:15.166Z Stage: CLARIFICATION → SPEC
- 2026-10-19T16:05:15.324Z Stage: SPEC → PLAN
- 2026-10-19T16:05:15.508Z Stage: PLAN → IMPLEMENTATION
- 2026-10-19T16:15:26.041Z Stage: IMPLEMENTATION → VERIFICATION
- 2026-10-19T16:21:18.285Z Stage: VERIFICATION → DONE
- 2026-10-19T16:43:11.731Z Reopened: DONE → IMPLEMENTATION (Release code review (PF-0011): the demo approval check compared stored hashes only and did not recompute the proposal hash, so a hand-edited proposal kept its approval; an unreadable demo ledger crashed finish.)
- 2026-10-19T16:46:49.122Z Stage: IMPLEMENTATION → VERIFICATION
- 2026-10-19T17:10:33.477Z Stage: VERIFICATION → DONE
- 2026-10-19T17:20:02.809Z Reopened: DONE → IMPLEMENTATION (Release re-review: proposalHash was computed over the unredacted proposal while demo.json is persisted redacted, so a secret-like step (e.g. PASSWORD=<redacted>) made the ledger fail its own hash check on reload.)
- 2026-10-19T17:22:29.040Z Stage: IMPLEMENTATION → VERIFICATION
- 2026-10-19T17:41:32.443Z Stage: VERIFICATION → DONE
