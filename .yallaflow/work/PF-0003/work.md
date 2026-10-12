# PF-0003 — v0.3.10-internal.4 Pilot Hardening

## Raw Request

v0.3.10-internal.4 pilot hardening (from a real Brownfield pilot; focused, no unrelated features or redesign): A) pre-baseline Brownfield engineering gate — while a Brownfield project has no approved understanding, refuse creation/routing of normal feature/bug/investigation/change/refactor/release and unclassified start with PROJECT_UNDERSTANDING_REQUIRED, naming the baseline as next action; read-only orientation, baseline lifecycle, intake for baseline discovery and transient operational assistance stay allowed; Greenfield unchanged; Agent Contract distinguishes transient operational assistance vs project-semantic engineering work. B) the original request survives the baseline as a discovery lens and continues automatically after approval without a second bootstrap. C) centralized durable secret/credential redaction in every YallaFlow-owned persistence path (never modifying developer files or source originals). D) PROJECT.md projection must be real — no starter placeholders after approved onboarding. E) baseline coverage transparency (inspected / sampled / not inspected / unavailable / unresolved). F) optional Git working-tree provenance for evidence (HEAD / modified / untracked), content hash stays authoritative; stop if disruptive. Bump Agent Contract / Skill Registry with archived immutable instruction bytes where semantics change; keep internal.1–.3 immutable; regression pilot, docs, package 0.3.10-internal.4; no commit/tag/push.

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** change
**Scope:** architectural
**Confidence:** high
**Reason:** Changes existing released behavior rather than adding a new capability: it hardens the work-creation entry points (start/route/direct commands) into a deterministic pre-baseline gate, changes baseline continuation, the context projection, and evidence persistence (security/privacy: secret redaction across every durable path), and changes the versioned Agent Contract and Skill Registry that pinned workspaces depend on. Public CLI behavior, security boundaries and cross-version compatibility make it architectural, needing design, planning, convergence and review gates.
**Timestamp:** 2026-10-12T20:06:34.622Z
**Workflow:** change
**Required capabilities:** discover, clarify, brainstorm, plan, implement, verify, converge, review
**Behavior contract:** registry v7
**Skills:** context-discovery, requirement-clarification, design-exploration, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

Intent discovery on the approved self-baseline (PF-0002, 46 current facts); no repository-wide rescan.
Reproduced with the frozen v0.3.10-internal.3 CLI in a synthetic Brownfield repository:

- A: `yallaflow start "How does subscription renewal work?"` and `yallaflow investigate ... --scope bounded` both create PF items before any baseline. The internal.3 gate (`projectUnderstandingGate`) only blocks application-writing stages; start/route/direct commands print a notice.
- C: a `.env`-style `DB_PASSWORD=<value>` placed in a baseline fact, its evidence and a checkpoint summary persists verbatim in baseline.yaml, progress.yaml, context/index.yaml and context/environments.md.
- D: this repository's own PROJECT.md kept the init placeholders after PF-0002 was approved (projection preserves everything outside its managed block).
- E: `baseline show/status` report only fact counts.

Compatibility constraints found: internal.3 ignores unknown top-level fields in baseline.yaml and unknown fields in evidence entries, but strictly validates limitation types, purpose.yaml fields and ledger fact fields; `formatEvidence` output feeds the projection drift check and must not change.

## Specification / Expected Behavior

- **A — pre-baseline engineering gate.** One deterministic check (`assertEngineeringWorkAllowed`, src/baseline/understanding.js), evaluated before any write in the canonical creation path (`createPendingIntake`, therefore start, direct commands and file intake) and in `routeWorkItem`; file intake checks before persisting a source. In a project whose recorded kind is brownfield and whose understanding is not ESTABLISHED (required, in progress, or awaiting review) it throws `PROJECT_UNDERSTANDING_REQUIRED` and prints the NEXT VALID ACTION: `yallaflow baseline start --objective "<the request>"`, or the current baseline step when one exists. Nothing else is gated: read-only orientation, the baseline lifecycle, `intake add` to existing work, source reads, and transient operational help (which never creates work) are unaffected. Greenfield is unchanged, and so is approved Brownfield.
- **B — continuity.** The request becomes the baseline objective (existing purpose.yaml; no new field). After approval, `baseline approve` prints the original objective and `yallaflow start "<objective>"` as the next step, and `brief` names it as the primary next concern until a later work item exists (derived; nothing stored). Baseline start after approval keeps refusing (no second bootstrap); later work uses intent/freshness discovery.
- **C — redaction.** A central sanitizer in src/security/redact.js (`redactSecrets`, `redactDeep`) is applied at the YallaFlow persistence boundary: `writeYaml`/`writeYamlAtomic`, the context-ledger writer, Markdown work records (work.md/progress.md writes and appends), generated ADRs, verification logs and extracted source text. It never touches developer files, AGENT.md/CLAUDE.md/AGENTS.md, human content outside managed blocks, or source originals. Patterns: secret-named assignments (suffix match: PASSWORD, SECRET, TOKEN, API_KEY, ACCESS_KEY, PRIVATE_KEY, CLIENT_SECRET, CREDENTIALS, SESSION_SECRET, COOKIE_SECRET, SIGNING/ENCRYPTION/MASTER_KEY, PASSPHRASE, DSN …), Authorization/Bearer/Basic values, Cookie/Set-Cookie values, PEM private keys, URL userinfo passwords, and well-known token formats. It skips references (`${VAR}`, `$VAR`, `<…>`, `process.env…`), function calls, and type annotations; `TOKEN_TTL=3600` and the path `.env` are unchanged. Redaction is idempotent.
- **D — PROJECT.md.** Once the ledger holds a current or disputed fact, the projection removes the exact, untouched init starter placeholders from PROJECT.md (Purpose / Success Criteria / Core Modules prompts). Unknown sections are omitted, human edits stay, and context/index.yaml stays canonical. Doctor warns when placeholders remain alongside project memory; `yallaflow context render` repairs it.
- **E — coverage.** The baseline draft may declare `coverage: { inspected: [...], sampled: [...] }` (an additive top-level baseline.yaml field; internal.3 ignores it). `baseline show/status/draft` print a coverage section: declared inspected and sampled entries, not-inspected/out-of-scope and unavailable/runtime-unavailable/insufficient-evidence limitations, unresolved facts, and distinct cited repository paths versus inventory totals, with an explicit not-a-completeness-claim line. A draft without declared coverage says so.
- **F — provenance.** In a Git work tree with a HEAD, repository file evidence gains `workingTree: head|modified|untracked` (an additive evidence field; internal.3 accepts unknown evidence fields). Content hashes stay authoritative. Projection/`formatEvidence` output is unchanged. It is shown in `context show` and live in `baseline show`.
- **Versions.** Agent Contract v8 (pre-baseline refusal, transient operational assistance vs engineering work, original request as baseline objective and automatic continuation, coverage declaration, never copy secret values). Skill Registry v8 adds repository-baseline instruction v4 (coverage declaration, original request as lens, no secret values); v3 bytes are archived. Bootstrap stays v2. No persisted schema bump. Package 0.3.10-internal.4.

## Implementation Plan

1. src/security/redact.js (new) + wire into src/core/yaml.js, src/context/ledger.js writer, Markdown/ADR/log/extracted writers (routing, baseline store, transitions, purpose, decomposition, reconciliation templates/progress, delivery impact/assess, shared memory, knowledge promotion, verify, sources).
2. src/baseline/understanding.js `assertEngineeringWorkAllowed`; call from src/behavior/routing.js (createPendingIntake, routeWorkItem) and src/commands/intake.js before persisting sources; CLI error printing keeps the message.
3. Continuity: src/commands/baseline.js approve output; src/commands/brief.js primary concern + line.
4. Projection: src/context/projection.js starter placeholder removal + doctor warning (src/commands/doctor.js or context integrity).
5. Coverage: src/baseline/store.js (validate/store coverage, coverage summary), src/commands/baseline.js output.
6. Provenance: src/core/git.js batch helper, src/context/evidence.js workingTree, src/commands/context.js show, baseline show.
7. Contract v8 (src/agent/contract.js), registry v8 + instruction v4 + archive v3 (src/skills/*, resources/skills/), version 0.3.10-internal.4.
8. Tests: new test/pilot-hardening.test.js (gate, operational/read-only allowed, Greenfield, approved Brownfield, continuity, redaction unit + persistence, projection, coverage, provenance, frozen internal.3 compatibility, end-to-end pilot); update version assertions in existing tests.
9. Docs after runtime proof: README, docs/using-yallaflow.md, cli.md, limitations.md, security.md, releasing.md version line, upgrading-to-v0.3.10.md, CHANGELOG.
10. Verification: syntax, full suite, packed-candidate E2E, self-dogfood doctor/brief/finish, npm pack --dry-run, link checks, git diff --check.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
