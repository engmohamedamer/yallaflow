# PF-0154 — Console chat: do not prefill the 'work on <id> to the end' draft when the work item is waiting for the developer's answer to a question (or a review). Seen on lalaff PF-0003 waiting on Q-001: the chat box was prefilled with the start message next to the 'Answer the question' button. Cause: goText() in resources/console/app.js (~line 1303) returns '' only for waitingFor.kind === 'baseline'; the draft is seeded at ~line 1530. Check the other goText callers (~2260, 4677, 4785) before changing it.

## Raw Request

Console chat: do not prefill the 'work on <id> to the end' draft when the work item is waiting for the developer's answer to a question (or a review). Seen on lalaff PF-0003 waiting on Q-001: the chat box was prefilled with the start message next to the 'Answer the question' button. Cause: goText() in resources/console/app.js (~line 1303) returns '' only for waitingFor.kind === 'baseline'; the draft is seeded at ~line 1530. Check the other goText callers (~2260, 4677, 4785) before changing it.

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** bug
**Scope:** bounded
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow bug --scope bounded`.
**Timestamp:** 2026-11-15T20:17:06.715Z
**Workflow:** bug
**Required capabilities:** discover, systematic-debugging, implement, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, systematic-debugging, implementation, verification
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Reproduction

## Evidence

## Hypothesis

## Root Cause

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0117
**Type:** file
**Name:** Screenshot from 2026-11-15 22-10-40.png

Raw source preserved in: `.yallaflow/sources/SRC-0117/Screenshot from 2026-11-15 22-10-40.png`. Read it directly; it is not duplicated here.
