# Verification

## Purpose

Require fresh evidence before completion or success claims.

## Behavior

1. Identify the proof required by the expected behavior and risk profile.
2. Run the relevant test, check, build, or inspection command against the current work.
3. Read the actual result rather than relying on command invocation alone.
4. Compare the result with the expected behavior and acceptance criteria.
5. Record the command, outcome, and evidence through the existing YallaFlow verification mechanism.
6. Allow a completion claim only after the required proof succeeds.

Use `yallaflow verify -- <command>` when recording command-based verification for an active work item.

## Guard

This skill verifies behavior. It does not authorize unrelated implementation changes or replace the existing DONE transition gate.

## Result

Produce fresh, inspectable evidence supporting the final claim.
