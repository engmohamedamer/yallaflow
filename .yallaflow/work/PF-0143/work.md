# PF-0143 — Console fixes from the 1.5.2 field notes: bugs B1–B5 and gaps G1–G6

## Raw Request

Field notes from a real zero-to-delivery run of 1.5.2 (console + Codex + Claude Code, Arabic UI): 2 bugs (Claude Code tick reverts on live refresh before Save; wizard advanced path rejects ~), 3 gaps (Laravel PHP extension readiness, Run page agent request feedback, a permission request that vanished), 5 ideas. Details and steps in the attached notes.

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Source Added

**Source ID:** SRC-0111
**Type:** file
**Name:** yallaflow-field-notes-1.5.2.md

Raw source preserved in: `.yallaflow/sources/SRC-0111/yallaflow-field-notes-1.5.2.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0112
**Type:** file
**Name:** yallaflow-field-notes-1.5.2-part2.md

Raw source preserved in: `.yallaflow/sources/SRC-0112/yallaflow-field-notes-1.5.2-part2.md`. Read it directly; it is not duplicated here.

## Routing Decision

**Status:** routed
**Work type:** change
**Scope:** bounded
**Confidence:** high
**Reason:** The request ('solve the recent problems') asks to fix the bugs and gaps in the 1.5.2 field notes (SRC-0111, SRC-0112). They are local console UI, readiness and status-display fixes. None touches security, data model, public CLI contract or financial invariants. Ideas I1–I7 are out of scope.
**Timestamp:** 2026-11-13T22:03:59.275Z
**Workflow:** change
**Required capabilities:** discover, clarify, plan, implement, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, implementation-planning, implementation, verification
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
