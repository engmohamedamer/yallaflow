# Canonical Workflows

Command-accurate, end-to-end workflows for YallaFlow v0.3.8. In practice your coding agent runs these commands (guided by `.yallaflow/AGENT.md`); you review, answer business questions, and approve gates. At any point:

```bash
yallaflow guide <work-id>     # CURRENT OBJECTIVE, BLOCKER, NEXT VALID ACTION
yallaflow skill <skill-id>    # the exact package-owned instructions for the current skill
```

Stage counts below are illustrative — `guide` and `advance` always name the next valid action. Replace `<command>` with your project's real proof (tests, a build, an inspection script).

- [Greenfield](#greenfield)
- [Brownfield](#brownfield)
- [Bug](#bug)
- [Investigation](#investigation)
- [Bounded change](#bounded-change)
- [Bounded feature with delivery convergence](#bounded-feature-with-delivery-convergence)
- [Intent changes after work has started](#intent-changes-after-work-has-started)
- [Task with a user-provided screenshot or file](#task-with-a-user-provided-screenshot-or-file)
- [Cross-agent handoff](#cross-agent-handoff)
- [Context freshness and revalidation](#context-freshness-and-revalidation)
- [Upgrading a legacy workspace (reconciliation)](#upgrading-a-legacy-workspace-reconciliation)
- [Setting up Codex or Claude](#setting-up-codex-or-claude)

## Greenfield

A new system, starting from a requirements document.

```bash
yallaflow init --type greenfield
yallaflow intake SRS.docx --title "Contract Hub"      # or: yallaflow start "<plain-text request>"
yallaflow source show SRC-0001 --content              # what text YallaFlow could extract
yallaflow route PF-0001 --type feature --scope architectural --confidence high \
  --reason "New multi-actor system with payments and signing."
yallaflow guide PF-0001                               # pinned contract: discovery → clarification → design → specification → planning → implementation → verification → delivery convergence → code review
```

For each skill in order: read `yallaflow skill <id>`, do the work, record it, and advance:

```bash
yallaflow checkpoint PF-0001 --skill context-discovery --complete --summary "Stack and constraints established."
yallaflow advance PF-0001
yallaflow question add PF-0001 --category business --text "Can a contract receive multiple payments?"
yallaflow question answer PF-0001 --id Q-001 --answer "Yes, up to three partial payments."
yallaflow question resolve PF-0001 --id Q-001
# … requirement-clarification, design-exploration, then the specification:
yallaflow requirement record PF-0001 --file requirements.json   # REQ-###/AC-### from the approved specification (agent-extracted)
yallaflow checkpoint PF-0001 --skill specification --complete --summary "Specification with REQ-001..REQ-008, AC-001..AC-019."
yallaflow ready PF-0001                               # SPEC_READY once the specification is complete
yallaflow approve PF-0001 --stage specification       # human review (adaptive mode reviews specification, plan, decomposition)
# … implementation-planning, then approve --stage plan → PLAN_READY
```

A project too large for one implementation session is decomposed into routed children once it is `PLAN_READY` (see [guide.md](guide.md#work-decomposition)):

```bash
yallaflow decompose propose PF-0001 --file decomposition.json
yallaflow decompose validate PF-0001
yallaflow approve PF-0001 --stage decomposition
yallaflow decompose execute PF-0001
yallaflow next PF-0001                                # dependency-unblocked children
```

Children reference the parent's requirement and criterion IDs (`"acceptanceCriteria": ["AC-004", "AC-005"]`); `decompose propose` refuses references the parent's ledger does not contain, and `decompose validate` reports unassigned criteria. Each child then follows the [bounded feature](#bounded-feature-with-delivery-convergence), [bounded change](#bounded-change), or [bug](#bug) path; a feature child answers for the criteria assigned to it. After every required child is DONE, the parent verifies, records project-level convergence (citing each child's assessment as `convergence:PF-0007/CV-002`, and assessing any criterion no child owned), completes code review, and becomes DONE.

## Brownfield

An existing repository with no durable project context yet. Install the CLI globally or in a tools prefix — not into the application's `package.json` ([installation.md](installation.md#legacy-and-brownfield-repositories)).

```bash
yallaflow init                                        # detects brownfield; records deterministic stack hints
yallaflow baseline start                              # read-only investigation work item, e.g. PF-0001
# agent: repository/runtime discovery (yallaflow skill repository-baseline)
yallaflow checkpoint PF-0001 --skill repository-baseline --complete --summary "Repository discovered."
yallaflow baseline draft PF-0001 --file baseline.json # facts + discovery limitations, every fact with evidence
yallaflow baseline show PF-0001                       # human review
yallaflow baseline feedback PF-0001 --changes-requested --note "Add database evidence."   # or:
yallaflow baseline approve PF-0001 --note "Reviewed."
yallaflow context status                              # CTX-#### facts now back PROJECT.md and context/*.md
git add .yallaflow && git commit -m "Add YallaFlow baseline"
```

From then on, each request is ordinary work that reads relevant current context first and keeps it current ([freshness](#context-freshness-and-revalidation)). There is no baseline refresh.

## Bug

Root cause first, then the smallest justified fix.

```bash
yallaflow start "Production upload returns 500"
yallaflow route PF-0002 --type bug --scope bounded --confidence high \
  --reason "Existing upload flow fails for large files." --title "Upload 500"
# or, if already classified:  yallaflow bug "Upload 500" --scope bounded
yallaflow checkpoint PF-0002 --skill context-discovery --complete --summary "Upload path: UploadController → StorageService."
yallaflow checkpoint PF-0002 --skill systematic-debugging --complete \
  --summary "Root cause: nginx client_max_body_size is 1m." --evidence deploy/nginx.conf
yallaflow advance PF-0002                             # repeat through REPRODUCE … FIX_PLAN → IMPLEMENTATION
# agent implements the fix (guide now reports AUTHORIZED)
yallaflow checkpoint PF-0002 --skill implementation --complete --summary "Raised limit; added regression test."
yallaflow advance PF-0002                             # → VERIFICATION
yallaflow verify PF-0002 -- npm test
yallaflow checkpoint PF-0002 --skill verification --complete --summary "Regression test passes."
yallaflow knowledge propose PF-0002 --kind environment --source implementation-runtime \
  --summary "Production nginx limits request bodies; uploads above it fail with 500." --evidence deploy/nginx.conf
yallaflow knowledge promote PF-0002 --candidate K-001   # or: yallaflow knowledge review PF-0002 --none
yallaflow advance PF-0002                             # → DONE
```

A bug routed as `--scope spike` is diagnosis only: it follows the read-only investigation workflow.

## Investigation

A read-only question. No application code is modified.

```bash
yallaflow investigate "Does reporting use the read replica?" --scope bounded
yallaflow checkpoint PF-0003 --skill context-discovery --complete --summary "Located DB configuration and reporting queries."
yallaflow checkpoint PF-0003 --skill systematic-debugging --complete \
  --summary "Reporting connection targets the replica host." --evidence config/db.php
yallaflow advance PF-0003                             # repeat through QUESTION … FINDINGS → CONCLUSION
yallaflow limitation add PF-0003 --type runtime-unavailable --area database \
  --summary "Replica lag in production was not measured." --reason "No production access."
yallaflow verify PF-0003 -- grep -q "reporting" config/db.php   # read-only proof of the conclusion
yallaflow checkpoint PF-0003 --skill verification --complete --summary "Configuration confirms the finding."
yallaflow knowledge propose PF-0003 --kind database --source implementation-runtime \
  --summary "Reporting reads from the read replica." --evidence config/db.php
yallaflow knowledge promote PF-0003 --candidate K-001
yallaflow advance PF-0003                             # CONCLUSION → DONE
```

DONE requires the completed `verification` checkpoint, which requires recorded, successful evidence — for investigations too. Limitations stay with the work item and never become project facts.

## Bounded change

A small, well-understood change to existing behavior.

```bash
yallaflow change "Final approval requires one approved well" --scope bounded
yallaflow guide PF-0004                               # contract: context-discovery, requirement-clarification, implementation-planning, implementation, verification
yallaflow checkpoint PF-0004 --skill context-discovery --complete --summary "Approval rules live in ApprovalPolicy."
yallaflow checkpoint PF-0004 --skill requirement-clarification --complete --summary "No open business questions."
yallaflow checkpoint PF-0004 --skill implementation-planning --complete --summary "Change ApprovalPolicy::canFinalize and its tests."
yallaflow advance PF-0004                             # repeat until IMPLEMENTATION
yallaflow checkpoint PF-0004 --skill implementation --complete --summary "Rule updated."
yallaflow advance PF-0004                             # → VERIFICATION
yallaflow verify PF-0004 -- php artisan test --filter=Approval
yallaflow checkpoint PF-0004 --skill verification --complete --summary "Approval tests pass."
yallaflow knowledge review PF-0004 --none
yallaflow advance PF-0004                             # → DONE
```

A bounded change has no delivery-convergence contract: YallaFlow does not ask it for requirement identity or convergence. An architectural change does (see below).

## Bounded feature with delivery convergence

Feature work — even a small one — carries an approved-intent contract: passing tests is not enough, the delivered implementation must match the accepted criteria. Keep it proportional: one requirement with one or two criteria is fine.

```bash
yallaflow feature "Staff can export the school calendar" --scope bounded
yallaflow checkpoint PF-0007 --skill context-discovery --complete --summary "Calendar lives in CalendarService."
yallaflow requirement record PF-0007 --file requirements.json
yallaflow checkpoint PF-0007 --skill requirement-clarification --complete --summary "Export format confirmed (Q-001)."
yallaflow advance PF-0007                             # repeat until IMPLEMENTATION
yallaflow checkpoint PF-0007 --skill implementation --complete --summary "ICS export added."
yallaflow advance PF-0007                             # → VERIFICATION
yallaflow verify PF-0007 -- php artisan test --filter=CalendarExport
yallaflow checkpoint PF-0007 --skill verification --complete --summary "Export tests pass."
yallaflow convergence record PF-0007 --file convergence.json
yallaflow convergence status PF-0007                  # satisfied / partial / missing / contradicts, blockers, next action
yallaflow checkpoint PF-0007 --skill delivery-convergence --complete --summary "Both criteria satisfied."
yallaflow knowledge review PF-0007 --none
yallaflow advance PF-0007                             # → DONE
```

`requirements.json` (the Agent extracts it; YallaFlow validates and records it):

```json
{
  "requirements": [{ "id": "REQ-001", "statement": "Staff can export the school calendar.", "provenance": [{ "type": "request" }] }],
  "acceptanceCriteria": [
    { "id": "AC-001", "requirement": "REQ-001", "statement": "The export downloads an ICS file.", "provenance": [{ "type": "question", "question": "Q-001" }] },
    { "id": "AC-002", "requirement": "REQ-001", "statement": "Only the selected term is exported.", "provenance": [{ "type": "request" }] }
  ]
}
```

`convergence.json` (the Agent judges each criterion against the implementation):

```json
{
  "findings": [
    { "criterion": "AC-001", "status": "satisfied", "reason": "Endpoint returns text/calendar.", "evidence": ["app/Http/Controllers/CalendarExportController.php#export", "verification:V-001"] },
    { "criterion": "AC-002", "status": "partial", "reason": "Term filter is ignored for archived terms.", "evidence": ["app/Services/CalendarService.php:40-62"] }
  ],
  "unrequested": [{ "summary": "Also added a CSV export.", "evidence": ["app/Http/Controllers/CalendarExportController.php#csv"] }]
}
```

With that assessment `advance` refuses DONE:

```text
DONE blocked:
- AC-002 → partial
- UR-001 → unrequested behavior is open (accept with a reason, or remove it)

Next valid action: resolve the convergence gaps and record a new convergence assessment.
```

Fix the gap, re-verify, and record a new assessment (only the changed criteria are needed; `UR-001` gets `"disposition": "accepted", "reason": "…"` or `"removed"`). If a cited file changes after an assessment, that finding is reported **stale** — never silently kept, never converted — and must be re-assessed before DONE.

## Intent changes after work has started

A new requirement source arrives while the work is already specified, planned, or being implemented.

```bash
yallaflow intake add PF-0001 refund-policy-v2.pdf
# Impact IM-001 pending: source SRC-0004 attached after PF-0001's approved intent was fixed.
yallaflow impact status PF-0001                       # the completed stages that need a verdict, with a JSON template
yallaflow impact assess PF-0001 --file impact.json
yallaflow guide PF-0001                               # stage corrected to the earliest affected stage; next valid action
```

```json
{
  "impact": "IM-001",
  "summary": "Refunds above 100 now need two approvals.",
  "stages": {
    "context-discovery":       { "verdict": "unaffected", "reason": "Same systems." },
    "requirement-clarification": { "verdict": "unaffected", "reason": "Owner decisions unchanged." },
    "design-exploration":      { "verdict": "unaffected", "reason": "Same architecture." },
    "specification":           { "verdict": "affected",   "reason": "Adds the two-approval rule." },
    "implementation-planning": { "verdict": "affected",   "reason": "Plan needs the approval step." },
    "implementation":          { "verdict": "affected",   "reason": "RefundService must enforce it." }
  }
}
```

Until the impact is assessed, `advance`, checkpoint completion, and `convergence record` are refused and `guide` reports that code changes are not authorized. YallaFlow does not decide what the source means; it enforces only the mechanical consequences (implementation affected ⇒ verification, convergence, and review affected; any affected stage or changed criterion ⇒ convergence affected) and revises the affected checkpoints through the audited revision path. Verification runs and convergence assessments are kept and reported stale. Changing requirements after the intent checkpoint (`yallaflow requirement record`) raises the same kind of impact. DONE work is not affected: attach a recovered source, or reopen the work.

## Task with a user-provided screenshot or file

Material inputs must not exist only in the conversation.

```bash
yallaflow start "Move the attendance filter above the table, as in the screenshot"
yallaflow intake add PF-0005 attendance-ui.png        # preserved as SRC-####, linked to PF-0005
yallaflow route PF-0005 --type change --scope bounded --confidence high --reason "Small UI change."
yallaflow handoff PF-0005                             # lists the source and .yallaflow/sources/SRC-0001/attendance-ui.png
```

If the agent cannot access the file (the image exists only in chat):

```bash
yallaflow limitation add PF-0005 --type uncaptured-artifact --area requirement \
  --summary "Pasted UI screenshot of the attendance screen could not be captured." \
  --reason "The image was only available in the conversation."
```

If the original surfaces after the work is DONE, attach it as a recovered source:

```bash
yallaflow intake add PF-0005 attendance-ui.png --reason "Original screenshot was not captured during the work."
```

Verification output stays evidence (`yallaflow verify`), never a source.

## Cross-agent handoff

When a session ends, runs out of context, or another agent (or provider) takes over.

Outgoing agent, at a safe boundary:

```bash
yallaflow checkpoint PF-0006 --skill implementation --start
yallaflow checkpoint PF-0006 --ruling "Keep UploadService as the boundary" \
  --ruling-reason "It is the established integration point." --cost-if-wrong "A later refactor."
yallaflow handoff PF-0006
```

Incoming agent, with no access to the previous chat:

```bash
yallaflow brief                                       # one read-only orientation: contract, active/recent work, delivery state, memory, next command
yallaflow agent status                                # is AGENT.md current?
yallaflow handoff PF-0006                             # PRIMARY UNRESOLVED OBJECTIVE, progress, gates, sources, stale context, next objective
yallaflow resume PF-0006
yallaflow guide PF-0006                               # exact NEXT VALID ACTION
git status && git diff                                # the working tree is authoritative
```

Durable YallaFlow state, the Git working tree, and verification evidence are authoritative; the previous conversation is not. YallaFlow never commits automatically.

## Context freshness and revalidation

Before relying on project memory in an area that may have changed:

```bash
yallaflow context status                              # which facts may be stale or are disputed
yallaflow context affected --since v1.4.0             # facts whose evidence changed since a ref
yallaflow context show CTX-0012                       # evidence, verification commit, freshness, lineage
```

Then do targeted rediscovery of only the affected facts, and record the outcome from a work item (an investigation, or the work that needs the fact):

```bash
# still true → same fact, fresh evidence
yallaflow knowledge propose PF-0007 --kind architecture --source implementation-runtime \
  --summary "Queue is still DB-backed." --evidence common/config/main.php --reconfirms CTX-0012
# no longer true → new current fact; CTX-0017 becomes history
yallaflow knowledge propose PF-0007 --kind database --source implementation-runtime \
  --summary "Read replica is active for reporting." --evidence common/config/db.php --supersedes CTX-0017
# conflicting evidence you cannot settle
yallaflow knowledge propose PF-0007 --kind environment --source implementation-runtime \
  --summary "Staging logs show a second queue worker host." --evidence "runtime:staging worker list" --disputes CTX-0021
yallaflow knowledge promote PF-0007 --candidate K-001
yallaflow context history CTX-0017
```

`MAY_BE_STALE` never means false, and nothing changes automatically. Do not rescan unrelated areas, and never edit old work items to reflect new truth.

## Upgrading a legacy workspace (reconciliation)

A workspace that ran v0.3.5 holds append-only context sections. Some of them may describe the same durable truth from different work items. They become canonical current truth only through a reviewed reconciliation, never a blind import (full walkthrough: [upgrading-to-v0.3.7.md](upgrading-to-v0.3.7.md)).

```bash
yallaflow upgrade status                              # what the workspace needs; read-only
yallaflow upgrade plan                                # ordered deliberate steps
yallaflow agent refresh                               # agent contract v2 → v3
yallaflow context reconcile start                     # PF-0006 + RC-0001 … RC-0053; history untouched
```

Agent:

```bash
yallaflow skill context-reconciliation
yallaflow context reconcile show PF-0006
yallaflow context list                                # existing canonical facts (e.g. CTX-0001)
yallaflow context reconcile plan PF-0006 --file decisions.json
yallaflow question add PF-0006 --category architecture --text "RC-0012 vs RC-0041: same production behavior?"   # never guess
yallaflow context reconcile preview PF-0006           # resulting current memory; nothing changes
yallaflow checkpoint PF-0006 --skill context-reconciliation --complete --summary "51 of 53 related; 2 escalated as Q-001."
```

`decisions.json` declares one relationship per candidate:

```json
{ "decisions": [
  { "candidate": "RC-0013", "action": "reconfirms", "target": "CTX-0001", "reason": "The baseline observed the truth CTX-0001 already records." },
  { "candidate": "RC-0053", "action": "merge-with", "target": "RC-0013", "reason": "Restates BF-013 in different words." },
  { "candidate": "RC-0044", "action": "new", "summary": "The Azure production pipeline has never executed Codeception tests." },
  { "candidate": "RC-0051", "action": "reconfirms", "target": "RC-0044", "reason": "Refinement with more detailed evidence." },
  { "candidate": "RC-0050", "action": "limitation", "limitationType": "not-inspected", "reason": "Describes the session, not the project." },
  { "candidate": "RC-0007", "action": "skip", "reason": "Transient execution observation." }
] }
```

Human, then Agent:

```bash
yallaflow context reconcile approve PF-0006           # or: feedback PF-0006 --changes-requested --note "..."
yallaflow context reconcile apply PF-0006             # atomic; the undecided pair stays pending
# later: answer Q-001, record the two remaining decisions, approve again, apply again → PF-0006 DONE
yallaflow doctor
```

The result is one canonical current fact per durable truth, with every origin traceable (`yallaflow context show CTX-0001`) and superseded knowledge kept as lineage. Retired legacy sections are archived verbatim in `work/PF-0006/legacy-context.md`, and hand-edited ones are kept for review. No historical work item is edited.

## Setting up Codex or Claude

So that a cold session finds YallaFlow without being told, give the provider's own session-start file a thin pointer to the canonical contract:

```bash
yallaflow agent setup codex                           # AGENTS.md: managed block → read .yallaflow/AGENT.md, run yallaflow brief
yallaflow agent setup claude                          # CLAUDE.md: managed block that imports @.yallaflow/AGENT.md
yallaflow agent status                                # AGENT.md and each provider block: current / outdated / modified / not set up
yallaflow agent refresh                               # after upgrading YallaFlow: AGENT.md and unmodified outdated blocks
```

Your existing `AGENTS.md`/`CLAUDE.md` content is kept byte-for-byte; the block is appended and only the block is ever updated. The block holds the session-start sequence and a pointer — never a copy of the YallaFlow rules. Commit it with the project.
