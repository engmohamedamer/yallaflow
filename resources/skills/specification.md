# Specification

## Purpose

Turn clarified requirements and approved design decisions into a precise, reviewable statement of what the system must do. Design explains how the solution is shaped; specification defines required behavior; planning explains how engineers will implement the approved specification.

## Behavior

Cover only the areas relevant to the work:

- goal, scope, and explicit exclusions
- actors and permissions
- functional requirements and business rules
- workflows, lifecycle states, and transitions
- data and integration requirements
- validation, error, and failure behavior
- security and privacy constraints
- UI or screen expectations
- acceptance criteria
- confirmed assumptions and unresolved questions

Use the canonical `work.md` specification section. Do not create empty ceremony and do not invent missing business decisions. Persist material unresolved decisions with `yallaflow question`; prose alone is not the authoritative blocker record.

## Readiness

A draft specification is a valid deliverable, but it is not implementation-ready while material questions remain open. Mark the checkpoint `blocked` with a concise summary when owner decisions prevent readiness. Complete the checkpoint only when the behavior is sufficiently precise and testable for its intended delivery endpoint.

## Guard

This skill is read-only. Specification does not authorize application-code changes or silently approve proposed architecture.

## Result

Produce a scope-appropriate specification that stakeholders can review and engineers can plan without guessing product behavior.
