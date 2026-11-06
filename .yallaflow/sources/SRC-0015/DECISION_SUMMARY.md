# Decision Summary: YallaFlow Next Generation

> **For:** the owner.
> **Date:** 2026-11-05.
> **Status:** awaiting approval. No production code has been written.
> **Revision:** 2. An independent architecture review changed the integration approach (see `TARGET_ARCHITECTURE.md` §11).

## Recommendation

**Make the CLI the API, then build a read-only Console on top of it.** Do not build an agent runtime. YallaFlow's edge is governance and evidence-backed memory. What it lacks is visibility, not capability.

1. **Core 1.2.0** (additive, useful without any Console):
   - versioned `--json` output on the read commands, plus `work show` and `snapshot`;
   - read-path performance fixes (today `brief` takes 2.5 s at 200 work items and 15 s at 1,000).
2. **Console 0.1–0.2**, an optional package `@yallaflow/console`:
   - a zero-dependency loopback server;
   - it runs the user's own `yallaflow … --json` and refreshes only what a file watcher invalidates;
   - a prebuilt React UI with Home, a workflow-aware Board, Work Inspector, Memory Explorer, and an Evidence & Quality Center;
   - a static HTML export.
3. **Core 1.2.x concurrency track** (lock, atomic writes, safe IDs, Windows CI), as a prerequisite for any Console write.
4. **Core 1.3 and Console 0.3:**
   - humans answer questions and approve gates from the Console, through the same CLI commands;
   - each such action is recorded as an **unverified attestation** of how it was made, not as a proven identity.
5. **Later, only after a separate decision:** an optional agent adapter (ACP first), as a study.

## Why

### What we already have (keep unchanged)

- Adaptive workflows (6 types, scope-aware) with pinned, hash-verified skills.
- Evidence-backed project memory:
  - 90 facts in this repository;
  - SHA-256 freshness computed by Core;
  - supersede/dispute lineage;
  - baseline approval.
- REQ → AC → convergence findings → V-### evidence, plus impact analysis.
- An append-only, committed verification ledger (149 runs here; failed runs are kept).
- Shared Project memory through ordinary Git.
- Real Claude Code and Codex support through instruction files.
- 4 runtime dependencies, no network, no daemon.

### What Squad-Kit does better (verified in code at v1.2.1)

- **A polished multi-project web console:**
  - kanban board;
  - "Waiting for you" notifications;
  - chat with the running agent;
  - spec and plan approval screens;
  - a requirement breakdown tree;
  - a decision timeline;
  - screenshot proof.
- **It runs agents itself:**
  - ACP;
  - a worktree per ticket;
  - sandboxed project commands;
  - budgets and caps;
  - interruption recovery.
- **Verification hygiene:** "not checked ≠ passed", and detection of weakened tests.

### What YallaFlow can do better (backed by evidence)

- **Truly agent-agnostic.** Squad-Kit's Codex module is a stub (`canRun: false`).
- **Auditable memory.** Squad-Kit keeps knowledge as Markdown lessons; YallaFlow has facts with provenance, freshness and lineage.
- **Committed, shareable evidence.** Squad-Kit's proof and chats stay local in `~/.squad-kit`.
- **Adaptive lifecycles.** Squad-Kit uses 7 fixed columns.
- **Governance-safe.** YallaFlow never commits, merges or releases for the developer, and never auto-approves.
- **Small.** 4 runtime dependencies against Squad-Kit's 22 direct ones.
- **The data already exists.** The prototype renders this repository's real `.yallaflow/` with no schema change. Its freshness numbers come from Core's own functions and match `yallaflow brief`: 47 fresh, 4 to revalidate.
  - The review also found that the prototype's own UI-side derivations (gate statuses, the knowledge-review stage) had drifted from Core. That is the reason the production Console must take every rule-based result from the CLI.

## Decisions for the owner

| # | Decision | Recommendation | Alternatives | Trade-off |
|---|---|---|---|---|
| D1 | Where the Console lives | **A separate, optional package** | inside `yallaflow`; an IDE extension | Core stays small and audited; the cost is two release trains |
| D2 | How the Console reaches Core | **Spawn the user's CLI with `--json`** (async), with watcher invalidation | import Core in-process; read files directly | The same version and rules as the agent, with no JS API locked by SemVer. The cost is about 150 ms per spawn. In-process stays as a measured fallback. |
| D3 | Server stack | **node:http, 0 dependencies, fetch-streamed events** | Hono; Express | Hono would be nicer past about 40 routes |
| D4 | UI stack | **React + TS + Vite, prebuilt** | Preact; vanilla | Ecosystem and hiring against bundle size |
| D5 | Concurrency foundation | **A separate Core 1.2.x track that must finish before Console writes** | bundle it with Cycle 1; skip it | It touches every mutating command, but it also fixes races the CLI already has |
| D6 | Recording who acted | **An additive `attestation {recordedVia, claimedBy?, verified:false}`.** No default identity. No AGENT.md rule giving Console approvals extra weight. | a free-text note only (today); default to `git user.name` (rejected: it would record the developer's name on approvals an agent relayed) | An honest audit signal, not proof. **Irreversible once committed to ledgers.** |
| D7 | Structured stage history | **Keep `progress.md` as the source; Core parses it into `work show --json`** | add `progress.yaml stages[]` | No duplicate source of truth, but a text format becomes a contract |
| D8 | Agent control (chat, monitor, run) | **Not now.** A Cycle 4 study, delivered as an optional adapter. | build it now, Squad-Kit style | Competitor-level experience against lock-in and a much larger security surface |
| D9 | Default design direction | **A · Workbench**, borrowing B's "Needs you first" for Home | B · Briefing | Information density against approachability |
| D10 | Fix the doc/code contradictions found in the audit (§6) | **Yes, as separate small governed items** | leave them | Low cost; removes confusion for new users |

## Build, delay, keep out

| Build (after approval) | Delay | Keep out of YallaFlow |
|---|---|---|
| `--json` contract, `work show`, `snapshot` | Console answers and approvals (C3) | Committing, merging, pushing or releasing for the developer |
| Read-path performance fixes P1–P7 | The agent adapter study (C4) | Auto-approval, or any way to skip a gate |
| Read-only Console and static export | Worktree lanes, budgets, roles (concept) | A cloud account, telemetry, a hosted console |
| Memory Explorer and Evidence Center | Cost display (reported by an adapter only) | A Console database as the source of truth |
| Lock, atomic writes, safe IDs (separate track) | CI result import | AI calls for dashboard reads |
| Local security baseline | Verify timeout and streaming; zero-test signals | Any vendor's agent SDK inside Core; a lock-bypass environment variable |

## Open questions

1. Is labelling Console and CLI approvals as **unverified attestation** acceptable, given that local authentication cannot be proven?
2. Should `--json` schemas be covered by SemVer as a **public contract** from Core 1.2.0?
3. Should `brief` stop running the full doctor? This is the single largest performance gain (97% of its in-process time). The cost is that brief shows fewer integrity checks; `doctor` still has all of them.
4. **Node version:** keep ≥ 20.16 for the Console, as Core does?
5. **Repository layout:** keep the Console in this repository (a monorepo) or in a separate one? And which license?

## Cost and benefit

- **Effort:** 16–24 engineer-weeks for Cycles 0–3, with one engineer working sequentially. Cycle 4 is a 3–4 week study.
- **Benefits:**
  - "What is blocked and why" in under 10 s, with zero agent tokens.
  - Faster agent-facing reads from the Core fixes. Target at 200 items: `brief` ≤ 0.8 s, down from 2.5 s.
  - Onboarding through navigable memory with provenance.
  - Traceability from requirement to proof.
  - Human decisions without a terminal, with an honest attestation.
- **Limits:**
  - The Console itself does not make agents faster.
  - Only the Core read-path fixes and CLI startup (P7) change agent-side cost.

## Stop point

**Done:**
- investigation;
- competitive analysis;
- gap analysis;
- architecture, revised after an independent review;
- UX specification;
- performance and security analysis;
- roadmap;
- a working prototype.

**Not done:**
- no production code;
- no Core refactor;
- no data migration;
- no CLI change;
- no agent execution.

**Next step:** the owner decides D1–D10.
