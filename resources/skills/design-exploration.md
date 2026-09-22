# Design Exploration

## Purpose

Explore viable approaches for architectural work before committing to an implementation plan.

## Behavior

1. Restate the intended outcome and the constraints already established.
2. Identify affected component boundaries, interfaces, data ownership, and operational concerns.
3. Compare credible approaches and their trade-offs.
4. Prefer established project architecture when it satisfies the requirement.
5. Reject design weight that does not earn a clear product or engineering benefit.
6. Record the selected direction and why it is preferred.

For greenfield work, identify only relevant technical decisions. Typical areas include application shape, runtime/backend, frontend approach, database, authentication, document generation, file storage, background jobs, environments, CI/CD, deployment, external integrations, and testing strategy.

Classify each considered decision clearly:

- **confirmed** — approved and safe to use as a constraint
- **proposed** — an option with rationale and trade-offs awaiting acceptance
- **unresolved** — a material choice still requiring evidence or authority
- **not applicable** — considered but irrelevant to this work

Business clarification asks what behavior the product needs. Architecture decisions define how the system should technically satisfy approved behavior. Do not silently choose technology. Use structured architecture questions and proposals when a material decision remains open; use a ruling only for an agent-owned local decision whose authority is clear.

A routine implementation choice the repository's own conventions already answer (e.g. which existing storage/service pattern to reuse, a naming convention, a validation approach already used elsewhere) is a design decision to make and record here, not a question for a developer. Reserve architecture questions/proposals for choices that are both material and genuinely unresolved by existing project conventions — for example, on a refund feature: a new mutable table versus an immutable signed ledger, the locking strategy, or the storage/event structure, once the business meaning of a refund (asked during requirement clarification) is already settled.

## Guard

This skill is read-only. A design decision precedes planning and implementation.

## Result

Produce explicit confirmed, proposed, unresolved, or not-applicable decisions with boundaries, trade-offs, and consequences suitable for specification.
