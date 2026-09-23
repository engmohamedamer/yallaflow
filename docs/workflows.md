# Canonical Workflows

Command-accurate, end-to-end workflows for YallaFlow v0.3.6. In practice your coding agent runs these commands (guided by `.yallaflow/AGENT.md`); you review, answer business questions, and approve gates. At any point:

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
- [Task with a user-provided screenshot or file](#task-with-a-user-provided-screenshot-or-file)
- [Cross-agent handoff](#cross-agent-handoff)
- [Context freshness and revalidation](#context-freshness-and-revalidation)

## Greenfield

A new system, starting from a requirements document.

```bash
yallaflow init --type greenfield
yallaflow intake SRS.docx --title "Contract Hub"      # or: yallaflow start "<plain-text request>"
yallaflow source show SRC-0001 --content              # what text YallaFlow could extract
yallaflow route PF-0001 --type feature --scope architectural --confidence high \
  --reason "New multi-actor system with payments and signing."
yallaflow guide PF-0001                               # pinned contract: discovery → clarification → design → specification → planning → implementation → verification → code review
```

For each skill in order: read `yallaflow skill <id>`, do the work, record it, and advance:

```bash
yallaflow checkpoint PF-0001 --skill context-discovery --complete --summary "Stack and constraints established."
yallaflow advance PF-0001
yallaflow question add PF-0001 --category business --text "Can a contract receive multiple payments?"
yallaflow question answer PF-0001 --id Q-001 --answer "Yes, up to three partial payments."
yallaflow question resolve PF-0001 --id Q-001
# … requirement-clarification, design-exploration, specification …
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

Each child then follows the [bounded change](#bounded-change) or [bug](#bug) path.

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

A bounded feature is the same, minus the planning checkpoint (`yallaflow feature "…" --scope bounded`).

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
