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

Record command-based verification with argv mode by default — each argument is passed exactly, with no shell quoting to get wrong:

```bash
yallaflow verify PF-0004 -- php artisan test
yallaflow verify PF-0004 -- npm test -- --runInBand
```

Use `--shell "<command>"` only when shell syntax is genuinely required (pipes, redirection, `&&`), and `--script <path>` for a checked-in script. Every attempt — including a failed or mis-quoted one — stays in the append-only evidence ledger; re-run correctly rather than trying to hide a failed attempt. A successful run can back durable knowledge as `--evidence verification:V-###`.

## Guard

This skill verifies behavior. It does not authorize unrelated implementation changes or replace the existing DONE transition gate.

## Result

Produce fresh, inspectable evidence supporting the final claim.
