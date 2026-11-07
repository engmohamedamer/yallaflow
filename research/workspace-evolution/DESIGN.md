# Workspace evolution — review proposal

Recovered on 2026-11-07 from the preserved manual acceptance request (SRC-0027), PF-0040's findings, and current repository evidence. The earlier design/prototype bytes are unavailable; this is a new reconstruction, not a recovered original. **Proposed behavior below is not implemented or approved.**

Open [the offline visual prototype](prototype.html). The prototype uses sample data and makes no network requests or project changes. Release preparation is tracked separately in [the consolidated review](../release-review/REPORT.md).

## 1. Product direction and scope

Make the console a useful engineering workspace: Overview → Flow and work → Agent Workspace → Evidence, with Setup and Development available when needed. Keep the existing warm surface, teal actions, station colors, clear handoffs, and bilingual/RTL product direction. Show the next meaningful action and its reason; put raw commands and configuration behind details.

Preserve Core as the authority for workflow, evidence, review gates and memory. A browser action cannot create a proof, silently approve a gate, or make a station complete by moving a card. Preserve the opt-in Agent Workspace and existing CLI behavior.

## 2. Gap analysis and capability inventory

Evidence inspected: `src/cli.js`, `src/console/server.js`, `src/console/create.js`, `src/console/runner.js`, `src/commands/baseline.js`, `src/commands/reopen.js`, `src/flow/stations.js`, `src/inventory/frameworks.js`, `docs/console.md`, `docs/agents.md`.

| User need | Current capability | Proposed addition |
| --- | --- | --- |
| Create and browse work | Console creates/routes/attaches through Core; snapshots and details are read contracts | Retain current behavior |
| Switch active work | Core `activate`; exposed in the opt-in Agent panel | Always-visible item action, including consoles without agents |
| Edit request or requirements | `request revise`, `requirement record`, `impact assess` | Revision preview, affected checkpoints, explicit submit; immutable prior history |
| Advance work | Core `advance` and `guide` | Show only allowed next action; explain unmet checks; no arbitrary stage setter |
| Return delivered work for correction | Core `reopen --to` | Reason and destination review, using existing Core validation |
| Pause/resume/close | No explicit hold or terminal non-delivered close operation; inactive/paused display is derived | New Core lifecycle semantics first; UI second |
| Answer questions/review | Core question answer, approval/feedback and baseline review commands | Typed forms with explicit human submission and current-record validation |
| Existing project onboarding | Inspect and baseline start/draft/show/approve | Overview status and guided review of facts, evidence, omissions and uncertainty |
| Discover stack | Manifest hints for npm, Composer, Maven **and Gradle** | Evidence-backed module inventory; extend ecosystem detection incrementally |
| Development services | No application service manager; console runner executes bounded Core operations | Separate owned-process manager with reviewed profiles |
| New project | Core init; no scaffolding engine | Reviewable generator plan, isolated execution and init after success |

The original notes mentioned Maven but omitted current Gradle support. Manifest hints describe declarations, not proof of the framework in use or a live database. `resume <id>` inspects a handoff; it is not a future unhold operation.

## 3. Information architecture and journeys

**Existing project with approved understanding:** select project → Overview (purpose, modules, confirmed stack, memory freshness, work, integrity) → choose active item → next action → agent/evidence. Stale memory offers targeted revalidation, never a repeated project-wide baseline.

**Existing project without approved understanding:** choose folder → deterministic inventory preview → start discovery → see coverage and draft facts → human review → approve or request changes → resume the original task automatically. The original request stays visible throughout. A scan alone never makes inferred facts authoritative.

**New project:** name/location/purpose → stack preference or agent-assisted proposal → generator and file preview → explicit creation confirmation → progress/recovery → YallaFlow init → initial work. No recommended stack is silently selected. “Recommend for me” produces an explained proposal for review.

**Daily work:** Overview highlights the actual blocker → item shows requirements, Flow and evidence together → contextual action opens a narrow dialog → Core validates → result and updated next step appear. Agent activity is separate from delivery state.

**Development:** Setup lists a reviewed service profile → preview executable, arguments, working directory and environment names → start → show running/starting/failed and readiness → logs → stop owned services. Holding work has no implicit effect on services or agent sessions.

## 4. Work management interaction contract

Each item shows title, active marker, actual lifecycle stage, Flow station, proof status, next step and blocker. Primary action comes from Core guidance. Secondary menu: make active, revise request, answer question, review, reopen, proposed hold/close. Disabled actions have an adjacent explanation accessible without hovering.

Advance opens a preview showing current stage, permitted destination and unmet prerequisites. Submit must re-read state under the workspace lock; a stale preview returns a conflict and a refreshed next step. An idempotency key prevents double submission. Fixed typed routes call Core with argv, never a general command field. Existing token/Origin/Host/JSON/size guards and read-only restrictions apply to every mutation.

Drag-and-drop is a later convenience: only a valid Core transition target can accept a card, and dropping opens the same preview/confirmation as the keyboard action. Never drag to Done or fabricate proof. Disabled targets explain why. Keep a complete keyboard alternative; defer drag-and-drop from the first management slice.

Requirement revisions show the text diff, changed criteria and affected completed checkpoints. The impact assessment is explicit and auditable. Reopening invalidates evidence according to existing Core behavior. Attachments remain immutable sources.

### Proposed hold and close semantics (requires owner review)

| Operation | Proposed behavior | Preserved invariant |
| --- | --- | --- |
| Hold | Record reason and prior stage; prevent advance/finish and new agent starts until unheld | Stage, evidence and history remain intact; holding does not pretend to stop an already-running process |
| Unhold | Clear hold through an audited operation; recompute guidance and freshness | Does not auto-activate or resume an agent |
| Close without delivery | Terminal non-delivered outcome with reason; excluded from delivered throughput, shown separately | Never DONE or 100%; no fabricated convergence |
| Reopen closed | Explicit reason; restore appropriate stage through Core validation | Fresh verification before delivery; historical close remains visible |

Design a separate activity/disposition field rather than overloading workflow stages, but validate old-reader behavior before choosing the persisted schema. Test parent/child completion, shared branches, active-item replacement, close/reopen, metrics and migration/refusal behavior. A parent cannot silently count closed required children as delivered. Project-level activity hold is distinct from item hold and needs its own semantics before exposure.

## 5. Overview and stack detection

Overview groups purpose/description, repository modules, stack, understanding/memory, work and integrity, then development status. Unavailable, empty, all-delivered, stale and corrupt states each have their own text. Runtime status expires and is never promoted into durable memory.

Each detected entry carries component, declared version, path/locator, observation time and confidence: **confirmed declaration**, **inferred usage**, or **unknown**. A manifest can confirm a dependency declaration; proving application use needs code/config evidence. Distinguish declared, resolved and runtime versions. Multiple modules may use different stacks. Conflicting lockfiles or framework versions remain visible.

First use current manifest parsers and inventory. Later add Python, Go, Rust and .NET via bounded parsers, not arbitrary file execution. Inspect database declarations and environment variable *names* only; do not display credentials, connection strings or .env contents. Record coverage and inaccessible files. Revalidation targets changed evidence, and every proposed fact is reviewed through existing baseline/knowledge operations.

Baseline review presents changed facts, evidence links, confidence, coverage and limitations. Approve and Request changes are explicit human actions with a note and a version/hash precondition. An agent must not synthesize the approval. Keep CLI review available.

## 6. Development runner architecture

This is new infrastructure, not an extension of `src/console/runner.js` into a shell endpoint. Proposed service profiles specify executable and argument array, repository-relative cwd, environment names, readiness probe, dependencies, stop timeout and logging policy. Reuse official project commands; never run a command inferred from stack detection without confirmation.

Recommended storage: a shareable, secret-free project profile with local overrides and a local approval bound to its content hash. Changed commands or checkout path invalidate trust. This storage policy remains a review decision. Secrets come from the existing local environment and are neither stored in YallaFlow records nor printed in logs.

Preflight validates canonical cwd and executable, rejects traversal/symlink escapes, shows ports and collisions, and requires explicit approval for executable commands (including package scripts that can run arbitrary code). No automatic install, migrations, destructive cleanup, restart loop or privileged port takeover.

Supervisor records process identity and owned process group; launch, readiness, failure and stop are separate states. Stop sends graceful termination only to the owned group, then bounded forced termination if still positively identified. PID reuse, crash recovery and detached descendants need explicit tests. Unknown ownership is “needs attention,” never kill-by-port. Docker profiles use explicit project/container identities and must not stop unrelated containers. Windows needs its own verified job/process model before support is claimed.

Logs are bounded, escaped and redacted; secrets can be emitted by arbitrary programs, so offer safe retention controls and never promise perfect redaction. Keep local transient run records separate from engineering evidence. Restart requires a deliberate user action; leaving/restarting the console uses a documented ownership policy. Recommended first release: stop owned services on console shutdown and report any unverified cleanup.

## 7. New Project Wizard architecture

Steps: identity → desired stack → template/generator → options → review → create → next action. Show destination, generator identity and pinned version, exact arguments, network/download/install steps, planned files and expected resource needs. Database choice is project configuration, not permission to create a production database.

Run reviewed official generators in a new staging directory under an approved parent. Validate canonical destination, reject nonempty targets, and bind approval to the plan. Do not overwrite or delete existing user files. Validate output, then promote only into the still-absent destination. Partial failure retains an explicit recoverable directory and log; retry must not duplicate successful steps. Cleanup of generated output is explicit. Never run generated hooks merely to inspect a template.

After generation, run init using existing Core. Greenfield intent and initial requirements survive; existing/brownfield output follows the project-understanding gate. Framework commands and versions must be checked against official documentation at implementation time; this proposal does not choose unverified generator commands.

## 8. Implementation plan and release impact

| Slice | Scope / dependencies | Exit criteria |
| --- | --- | --- |
| Current 1.2.0 + 1.3.0 | Existing candidates only | Fresh automated/packaged/browser evidence, manual subscription acceptance, explicit release authorization; no UX expansion required by this proposal |
| Optional small follow-up | Make active outside Agent panel; read-only onboarding summary | Token/read-only guards, no implicit activation, accessible empty/error states; classify release version after API review |
| Management + Overview (proposed 1.4) | Core capability preview; typed routes; request/question/review UI; overview; baseline review | Stale-submit and duplicate-submit tests; same Core gates and history; user explicitly approves browser review policy |
| Hold/close (within or after 1.4) | Approved disposition/schema design first | Old workspace compatibility, parent/child outcomes and metrics, hold/close/reopen tests; no forged delivery |
| Runtime (proposed 1.5) | Reviewed profile + supervisor + local ownership model | Injection/path/secret/ownership/port/readiness/crash tests; local platform support stated |
| Wizard (within or after 1.5) | Generator plan and staging; depends on execution safety | Existing paths untouched, interrupted creation recoverable, reproducible setup, reviewed external commands |

These version labels are planning proposals, not commitments. First ship the smallest complete management journey; avoid combining runtime, scaffolding and lifecycle schema changes in one release.

Verification should cover Core unit/CLI parity, HTTP authorization and stale conflicts, shared-workspace concurrency, browser keyboard/mobile/RTL states, and failure recovery. New process/scaffolding capabilities require isolated security and lifecycle tests; a prototype is not evidence that they are safe to ship.

## 9. Review decisions and recommended defaults

1. **Browser approvals:** allow explicit human review with clear evidence and a required note; retain CLI. The loopback token authenticates the local console, not a named person or an unforgeable human identity.
2. **Hold/close:** adopt the separate activity/disposition model above, with closed work counted separately from delivery. Confirm how required children and project-level holds should behave before implementation.
3. **Runtime profiles:** share safe definitions, keep local overrides/secrets/trust local; reapprove on content changes.
4. **Wizard execution:** reviewed, versioned generator plan in an isolated staging directory; no silent command execution and no automatic overwrite.

The preserved request explicitly says to stop after presenting architecture, UX and release impact for review. Completion of this reconstruction means the proposal is ready to review, not that these decisions or future implementation are approved.
