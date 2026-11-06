# PF-0025 — Core read contract: Flow stations and completion %, snapshot and work show --json

**Type:** feature
**Status:** INTAKE
**Scope:** bounded
**Parent:** PF-0024
**Read-only:** no

## Requirements

REQ-001, REQ-002, REQ-003

## Acceptance Criteria

AC-001, AC-002, AC-003

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Implementation

- **`src/flow/stations.js`** (new) is pure. It holds the stage → station map and the item state: `new`, `active`, `you`, `fail`, `paused` or `done`. It builds the five stations with their real stages and checkpoints as steps, and computes completion as 20% per station, where the current station counts finished steps plus half of the step in progress.
- **`src/flow/snapshot.js`** (new) collects `yallaflow.snapshot/1` and `yallaflow.work/1` using only existing readers, with `evaluateAdvance(..., {mutate:false})`.
- **`src/commands/snapshot.js`** (new) adds `yallaflow snapshot [--json]` and `yallaflow work show <id> [--json]`. With `--json` the command prints one JSON document; an error is printed as `{error:{code,message}}` with exit code 1.
- **`src/core/transitions.js`**: the blocker is additive. A review-gate blocker now carries `human: true` and its `gate`, and `evaluateAdvance` passes them through. No text changed.
- **`src/cli.js`**: wires both commands, adds them to usage and help, and marks them read-only for the compatibility check.
- **`resources/schemas/snapshot-1.schema.json` and `work-1.schema.json`** (new).
- **`test-support/schema.js`** (new) is a small, dependency-free schema checker.
- **Tests (new):** `test/flow-stations.test.js` (8 tests) and `test/snapshot-contract.test.js` (6 tests: schema validation, waiting-for-you on a gate and on a question, the work-show sections, the JSON error, and a no-mutation hash test over the tree and `.git/index`).

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
