# PF-0040 — Manual acceptance UX findings: work management, project onboarding and overview, dev runtime, new project wizard (design and release impact)

## Raw Request

Manual acceptance UX findings: work management, project onboarding and overview, dev runtime, new project wizard (design and release impact)

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** investigation
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow investigate --scope architectural`.
**Timestamp:** 2026-11-06T20:56:42.551Z
**Workflow:** investigation
**Required capabilities:** discover, systematic-debugging, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, systematic-debugging, verification
**Read-only:** yes

## Intake

## Known Facts

## Open Questions

## Investigation Question

## Evidence

## Findings

## Conclusion

## Discovery

Manual acceptance feedback (SRC-0027), investigated read-only against the 1.2.0/1.3.0 candidates.
- **Console today.** It can create work with attachments, browse, and run the Agent Workspace. Make it active exists only in the Agent panel. No other Core write operation is exposed.
- **Core has:** advance, reopen --to, request revise, requirement record, impact assess, activate, question answer, approve/feedback, baseline start/draft/approve, finish, inspect (deterministic framework hints for npm, composer and Maven only).
- **Core lacks:** an explicit hold or close (paused is derived; there is no terminal non-delivered state), a development-service runner, and project scaffolding.

## Specification / Expected Behavior

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

**Design:** `research/workspace-evolution/DESIGN.md` (gap analysis, capability inventory, journeys, work management, overview and stack detection, runner safety, wizard, roadmap), with the prototype in `prototype.html` (the research folder is untracked).

**Recommendation:**
- release 1.2.0 and 1.3.0 as tested;
- optional 1.3.1: Make it active on every item page, plus a read-only onboarding status;
- 1.4.0: work management over existing Core operations, plus new hold/close operations, Project Overview, onboarding review;
- 1.5.0: development runtime profile and runner, plus the New Project Wizard reusing official generators.

**Owner decisions pending:**
1. gate approvals in the console;
2. hold and close semantics;
3. runtime.yaml committed or local;
4. how the wizard executes.

## Source Added

**Source ID:** SRC-0027
**Type:** file
**Name:** owner-manual-acceptance-ux-findings.md

Raw source preserved in: `.yallaflow/sources/SRC-0027/owner-manual-acceptance-ux-findings.md`. Read it directly; it is not duplicated here.
