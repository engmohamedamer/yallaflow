# Contributing

Thanks for helping improve YallaFlow.

## Principles
- Solve one real problem per change.
- Preserve YallaFlow's Adaptive Spec-Driven Development model: ceremony should match work type and scope.
- Discover technical facts before asking; reserve questions for material business ambiguity.
- Add or update tests for behavior changes.
- Do not weaken workflow gates without evidence.
- Keep project-specific policy out of the core package.
- Prefer deterministic validation where an LLM is unnecessary.
- Treat Skill Registry changes as behavior-contract changes: update metadata, instructions, validation, and behavioral tests together.
- Bump the registry version when a released skill contract changes semantics; do not tie it automatically to the npm version.
- Treat checkpoint state as work-scoped durable evidence; never duplicate it into `state/current.yaml` or infer it from chat text.
- Keep local execution rulings in work progress and long-lived architectural decisions in ADRs.
- Keep work progress separate from project knowledge: propose only stable future-facing facts or decisions.
- Never add semantic keyword classifiers or provider calls for knowledge selection; the agent supplies that judgment.
- Preserve source-work and candidate traceability when changing promotion formats.
- Keep design/specification/planning as three distinct skills (design-exploration, specification, implementation-planning); do not collapse or reorder them.
- Never let a workflow stage advance past a checkpoint it requires without that checkpoint being `completed`; stage and checkpoint state must not silently contradict each other.
- Checkpoint corrections must go through `checkpoint revise` and append to history; never mutate or delete a prior checkpoint status in place.
- Keep material business/architecture decisions in the structured `questions.yaml` ledger, not only as prose in `work.md`.
- Keep delivery readiness (`SPEC_READY` / `PLAN_READY` / `DONE`) and workflow stage conceptually and implementationally separate; reaching a readiness level must never itself authorize or start implementation.
- Use the canonical domain terminology defined in [`docs/architecture.md`](docs/architecture.md#core-domain-terminology) consistently across code, docs, and commit/PR text.

## Local checks
```bash
npm install
npm run check
```

## Documentation and CHANGELOG

Update `README.md`, `docs/architecture.md`, and/or `docs/roadmap.md` alongside any behavior change they describe. Add a corresponding entry to [`CHANGELOG.md`](CHANGELOG.md) under `[Unreleased]`. See [`docs/releasing.md`](docs/releasing.md) for how package, Skill Registry, knowledge-policy, and workspace-schema versions relate, and for the maintainer release checklist.

## Pull requests
Describe the requirement, work type/scope, behavior before/after, tests/evidence, and any compatibility implications. Keep task-local execution details out of durable project knowledge unless they establish a stable fact or decision.
