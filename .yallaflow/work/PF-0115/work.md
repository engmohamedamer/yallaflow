# PF-0115 — Console page re-renders every second: a Run Now task whose item is DONE while its session stays open rewrites runs.json on every snapshot (item-done not idempotent), and the write triggers the next change event

## Raw Request

Console page re-renders every second: a Run Now task whose item is DONE while its session stays open rewrites runs.json on every snapshot (item-done not idempotent), and the write triggers the next change event

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** bug
**Scope:** bounded
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow bug --scope bounded`.
**Timestamp:** 2026-11-10T13:17:46.977Z
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
