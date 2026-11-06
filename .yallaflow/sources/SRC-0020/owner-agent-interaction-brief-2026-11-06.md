# YallaFlow — Agent Interaction Architecture Challenge (owner brief, 2026-11-06, agent session)

Act as an independent Principal Software Architect. Evaluate interactive AI agent sessions directly from the
Web Console. Hypothesis: Web Console -> Session Manager -> Provider Adapters (Claude Code / Codex) -> existing
YallaFlow Core. Challenge it; keep, improve, combine, or replace it.

1. Understand current YallaFlow (console, CLI JSON contracts, live updates, lifecycle/activation, agent
   contracts, memory/evidence, security/locking/audit, UX, dependencies); implemented vs planned; reuse.
2. Research Claude Code (Agent SDK, ACP, CLI, sessions/resume, streaming, permissions, auth/subscription) and
   OpenAI Codex (App Server, SDK, CLI, sessions/turns, streaming, approvals/sandbox, auth/billing); ACP, MCP,
   PTY, orchestration frameworks, managed-process bridge, hybrid. Verify what is supported today.
3. Options A native adapters, B ACP-first, C PTY, D orchestration framework, E hybrid/progressive (+ others),
   evaluated on coverage, compatibility, resume, streaming, permissions, auth, subscriptions, fidelity,
   complexity, deps, security, performance, maintainability, lock-in, UX, Core compatibility.
4. Real UX journey (10 steps) per architecture; attach/resume of external terminal sessions; no false claims.
5. Answer the challenge questions explicitly.
6. Small, isolated, non-destructive feasibility checks; no real project state; no significant usage without approval.
7. Recommended architecture (component + sequence diagrams, boundaries, lifecycle, events, security, data
   ownership, recovery, upgrade, console integration) preserving agent independence, CLI workflows, canonical
   memory, evidence integrity, explicit activation, human gates, local-first, optional runtime.
8. Compare against SquadKit (learn, do not copy).
9. Deliverables: CURRENT_STATE.md, PROTOCOL_RESEARCH.md, ALTERNATIVE_ARCHITECTURES.md, FEASIBILITY_RESULTS.md,
   SECURITY_AND_AUTH.md, RECOMMENDED_ARCHITECTURE.md, UX_FLOW.md, DECISION_SUMMARY.md, with links, paths,
   versions, and claim labels (verified in source / by experiment / documented not tested / assumed / unsupported).
10. Final decision: keep / modify into hybrid / replace; gains, losses, what not to build, smallest first
    release, postponements, uncertainties.
Mandatory stop: research only; no implementation; no change to Console/Core/CLI/release candidate; no commit,
tag, push, publish, deploy; no new implementation workflow without approval.
