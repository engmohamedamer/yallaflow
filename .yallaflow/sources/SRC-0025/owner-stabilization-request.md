# Owner request: Agent Workspace final stabilization and delivery-readiness pass (2026-11-06)

Great progress. The Agent Workspace implementation is provisionally accepted for final user testing, but it is not yet approved for release.

Please perform one final stabilization and delivery-readiness pass.

1. Review Codex process lifecycle and the risk of orphaned subprocesses. Fix it where possible without breaking provider behavior. If a process cannot be safely terminated, the UI must not misleadingly report it as fully stopped.
2. Reassess the symbolic-link race against the actual local threat model. Implement a portable mitigation where feasible, and document any residual limitation without overstating workspace isolation.
3. Verify that the one-session-per-checkout restriction remains effective across separate Console processes, not only within a single server instance.
4. Preserve all existing v1.2.0 changes and the isolated v1.3.0 implementation. Document the exact release dependency and safe integration path. Do not merge or overwrite the original working tree.
5. Confirm that Allow for Session permissions cannot silently extend to unrelated sessions or override YallaFlow approval gates.
6. Prepare the final local trial instructions for the actual packaged build, including how to test Codex and how to enable the experimental Claude connection only when explicitly authorized.
7. Keep Claude experimental and disabled by default. Do not claim the shipped Claude integration is fully verified until the real-session acceptance test passes.
8. Document the outstanding Anthropic compliance decision separately.
9. Run the appropriate regressions and produce a concise final risk assessment.

Do not add new features, commit, tag, push, publish, or change the v1.2.0 release candidate.

Stop after this stabilization report. I will perform the final hands-on Agent Workspace review.
