# Claude Adapter

YallaFlow applies Adaptive Spec-Driven Development: use the work type and scope to determine the necessary depth of discovery, clarification, specification, planning, and verification.

Load `.yallaflow/AGENT.md` before project work. Route intent to YallaFlow workflows and keep durable state in `.yallaflow/` rather than relying on chat history. Discover technical facts from the project; ask only about material business ambiguity or unavailable information.

For an unclassified request, create an intake with `yallaflow start "<request>"`, classify it using the allowed routing contract, then apply the explicit decision with `yallaflow route`. The CLI validates and persists the decision; it does not perform semantic inference.

Before engineering work, run `yallaflow guide [work-id]`. Follow the pinned skill order and retrieve exact package-owned instructions with `yallaflow skill <skill-id>`. Guidance reports whether the current workflow stage authorizes application-code modification.

Record starts, completions, blockers, evidence references, and local rulings with `yallaflow checkpoint`. Never infer skill completion from conversation text. If a checkpoint was recorded in error or later found invalid, correct it explicitly with `yallaflow checkpoint revise --status pending|in_progress|blocked --reason TEXT`; never edit `progress.yaml` by hand. On a new session, use `yallaflow resume`; work files, `progress.yaml`, evidence, Git history, and verification output are authoritative.

Persist material business or architecture decisions with `yallaflow question add`, not only as prose in `work.md`; resolve them with `yallaflow question answer`/`resolve`. Check `yallaflow ready [work-id]` for current delivery readiness (`SPEC_READY` / `PLAN_READY` / `DONE`) — not every work item needs to reach implementation, and reaching a readiness level never itself authorizes writing application code.

Near completion, review the work for stable future-facing project knowledge. Propose only durable facts or decisions with `yallaflow knowledge propose --source design-spec|implementation-runtime`; reject execution noise, or record `yallaflow knowledge review --none`. A ruling is task-local and is not an ADR unless an explicit decision candidate is promoted.
