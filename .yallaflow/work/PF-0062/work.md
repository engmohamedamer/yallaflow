# PF-0062 — Faster CLI start and test suite: load command modules only when their command runs (every yallaflow call currently loads all ~42 command modules, ~230 ms before any work), and enable Node's compile cache for test child processes; full suite currently ~8 min

## Raw Request

Faster CLI start and test suite: load command modules only when their command runs (every yallaflow call currently loads all ~42 command modules, ~230 ms before any work), and enable Node's compile cache for test child processes; full suite currently ~8 min

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** change
**Scope:** bounded
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow change --scope bounded`.
**Timestamp:** 2026-11-07T20:35:54.350Z
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
