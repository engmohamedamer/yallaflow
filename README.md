# YallaFlow

> **Give AI your project, not just your prompt.**

**YallaFlow is an AI-agnostic engineering governance and project-memory layer for coding agents.**

It gives tools like Claude, Codex, and other coding agents durable project context, adaptive engineering workflows, and evidence-backed delivery — so a new session can continue from what the project knows, not from what the previous chat remembered.

```text
Agent reasons.   YallaFlow governs.   Project memory persists.

Understand → Decide → Change → Verify → Remember → Revalidate
```

YallaFlow is built around one idea:

> **The project — not the chat session — should be the durable unit of AI-assisted software development.**

---

## Why YallaFlow exists

AI coding agents are already very good at individual tasks.

The hard part begins after the first task:

- requirements arrive through prompts, SRS files, screenshots, and tickets
- project knowledge gets scattered across chats, code, documents, and people's memory
- a new session repeats discovery because the previous conversation is gone
- one agent makes a decision that the next agent cannot explain
- a bug gets fixed before its root cause is established
- tests pass, but nobody proves that every requested requirement was actually delivered
- old project knowledge stays around after the code that supported it has changed

YallaFlow turns those problems into durable project state.

```text
                     PROJECT
                        │
          ┌─────────────┼─────────────┐
          │             │             │
       Sources         Work        Context
        SRC-*          PF-*         CTX-*
          │             │             │
   original intent   history     current truth
                        │
                     evidence
```

Instead of asking the AI to remember the project, YallaFlow makes the project remember itself.

---

## What makes YallaFlow different

### 1. Project memory, not chat memory

YallaFlow keeps a durable, evidence-backed model of what is currently believed to be true about the project.

A project fact is not just prose. It can carry:

- a stable `CTX-####` identity
- current / superseded / disputed state
- confirmed / inferred / unresolved confidence
- provenance and originating work
- repository evidence
- content hashes and Git verification points
- freshness status when supporting evidence changes

```text
Work records preserve history.
Project memory preserves current understanding.
```

If a file supporting a project fact changes, YallaFlow can surface that the knowledge may now be stale instead of silently trusting it forever.

### 2. Agent intelligence + deterministic governance

YallaFlow does **not** try to replace the reasoning capability of modern coding agents.

The agent decides semantic questions such as:

- Is this a bug, feature, investigation, refactor, or release?
- Is the change bounded or architectural?
- What does the evidence mean?
- Which project fact supersedes another?

YallaFlow owns the deterministic part:

- workflow selection
- state transitions
- write-authorization guidance
- checkpoints
- review gates
- verification evidence
- lifecycle integrity
- durable history

```text
AI reasons.
YallaFlow validates, records, and governs.
```

### 3. Adaptive Spec-Driven Development

YallaFlow uses specifications when the work needs them — not as ceremony for every task.

| Work type | Typical path |
| --- | --- |
| Bounded feature | discover → clarify → implement → verify |
| Architectural feature | discover → clarify → design → specify → plan → implement → verify → review |
| Bug | discover → root cause → implement → verify |
| Investigation | discover → evidence → conclusion → verify — read-only |
| Change / refactor / release | discover → plan → implement → verify |
| Brownfield | baseline → reviewed project memory → incremental work |

A specification is one engineering artifact inside the lifecycle. It is not the lifecycle itself.

### 4. Evidence-backed completion

In a normal AI session, `Done ✅` is just a statement.

In YallaFlow, completion is a state that must be supported by the workflow:

- required checkpoints must be complete
- unresolved material questions can block readiness
- verification runs are recorded as append-only evidence
- review gates remain auditable
- downstream verification/review can be invalidated when earlier work is revised
- `doctor` checks for impossible or contradictory lifecycle states

YallaFlow distinguishes:

- `SPEC_READY` — specification is reviewable
- `PLAN_READY` — specification and implementation plan are reviewable
- `DONE` — the requested lifecycle has actually completed

### 5. Original intent stays traceable

YallaFlow keeps original requirement sources separate from their extracted or interpreted forms.

```text
Original Source
      ≠
Extracted Representation
      ≠
Specification
      ≠
Implementation
```

`yallaflow intake` can preserve local files such as DOCX, XLSX, PPTX, PDF, text files, and images as immutable `SRC-####` sources, with checksums and work-item linkage.

That means a future session can answer not only **what did we build?**, but also **what were we originally given?**

### 6. Brownfield is a first-class workflow

Most real software work does not begin in an empty repository.

YallaFlow can establish a reviewed Brownfield Baseline with:

- confirmed facts
- inferred facts
- unresolved facts
- evidence
- explicit discovery limitations

Approved baseline knowledge becomes durable project memory that future work can reuse instead of rediscovering the repository from scratch.

### 7. Agent and session continuity

YallaFlow work state is independent of the previous chat.

A new session or a different coding agent can use durable state, Git, project context, and recorded evidence to understand:

- what was requested
- what was decided
- what stage the work reached
- what is still blocked
- what evidence exists
- what project knowledge is relevant
- what the next valid action is

`yallaflow handoff` and `yallaflow resume` are designed around this recovery model.

---

## How it works

```text
Raw request / files
        │
        ▼
     Intake ───────────────► SRC-#### sources
        │
        ▼
 Pending work
        │
        ▼
 Route by type + scope
        │
        ▼
 Pinned Behavior Contract
        │
        ▼
 Discover / Clarify / Design / Specify / Plan
        │
        ▼
     Implement
        │
        ▼
 Verify + Review
        │
        ▼
 Knowledge review
        │
        ▼
 CTX-#### project memory
        │
        └──────────────► future sessions
```

YallaFlow never needs the previous chat to reconstruct the engineering state.

---

## Quick start

YallaFlow currently requires **Node.js ≥ 20.16.0** for the CLI itself.

It is an internal prerelease and is not yet published to npm.

```bash
# From a release tarball
npm install -g /path/to/yallaflow-<version>.tgz

yallaflow --version

cd your-project
yallaflow init

# Start from text
yallaflow start "Production upload returns 500"

# Or start from one or more files
yallaflow intake requirements.docx architecture.pdf

# Ask YallaFlow what the current work requires
yallaflow guide PF-0001
```

For legacy repositories, install YallaFlow as an isolated CLI rather than adding it to the application's dependency tree.

See [`docs/installation.md`](docs/installation.md) for the supported installation model.

---

## Example: a bug

```bash
yallaflow start "Production uploads return HTTP 500"
```

The agent classifies the request and routes it. YallaFlow pins the required behavior contract.

```text
Discover
   ↓
Establish root cause with evidence
   ↓
Authorize implementation
   ↓
Implement fix
   ↓
Record verification
   ↓
Review durable knowledge
   ↓
DONE
```

An investigation follows a different contract and never authorizes application-code changes.

---

## Example: a new project from an SRS

```bash
yallaflow intake Product_SRS.docx
```

YallaFlow preserves the original file, extracts supported content, creates a traceable source, and opens a pending work item.

An architectural feature can then move through:

```text
Discovery
→ Clarification
→ Design
→ Specification
→ Planning
→ Implementation
→ Verification
→ Review
→ Knowledge
```

Large plans can be decomposed into dependency-aware child work items while keeping requirements and acceptance-criteria traceability.

---

## Project memory

YallaFlow separates different kinds of memory deliberately.

| Memory | Question | Location |
| --- | --- | --- |
| Work memory | What happened during this work item? | `.yallaflow/work/PF-####/` |
| Project memory | What is currently believed true? | `.yallaflow/context/index.yaml` |
| Human-readable context | What should a person or agent quickly read? | `.yallaflow/PROJECT.md`, `.yallaflow/context/*.md` |
| Historical knowledge | What was previously believed? | superseded/disputed `CTX-####` facts |
| Source memory | What original input did the work come from? | `.yallaflow/sources/SRC-####/` |
| Decisions | What architectural decisions were accepted? | `.yallaflow/decisions/` |

Project facts evolve by explicit relationships such as reconfirm, supersede, and dispute. Work history remains immutable.

---

## The `.yallaflow/` workspace

```text
.yallaflow/
├── config.yaml
├── PROJECT.md
├── AGENT.md
├── context/
│   ├── index.yaml
│   └── architecture.md …
├── work/
│   └── PF-0001/
│       ├── meta.yaml
│       ├── work.md
│       ├── progress.md
│       ├── questions.yaml
│       ├── discovery.yaml
│       ├── knowledge.yaml
│       ├── reviews.yaml
│       └── evidence/
├── sources/
│   └── SRC-0001/
├── decisions/
├── releases/
└── state/
    └── current.yaml
```

The workspace is project-owned and intended to be versioned with the repository.

Optional directories are created lazily only when they are needed.

---

## Core commands

```text
yallaflow init
yallaflow start
yallaflow intake
yallaflow route
yallaflow guide
yallaflow status
yallaflow resume
yallaflow handoff
yallaflow checkpoint
yallaflow question
yallaflow ready
yallaflow advance
yallaflow verify
yallaflow reopen
yallaflow decompose
yallaflow progress
yallaflow next
yallaflow baseline
yallaflow context
yallaflow knowledge
yallaflow limitation
yallaflow doctor
```

See [`docs/cli.md`](docs/cli.md) for the complete command reference.

---

## What YallaFlow is not

YallaFlow is deliberately **not**:

- a coding agent or model provider
- a replacement for Claude, Codex, or other coding agents
- a prompt pack
- a fixed specification template
- a project-management system
- an automatic semantic truth engine
- a knowledge graph or vector database
- a multi-user collaboration platform — yet

YallaFlow does not call an LLM to decide what your project means. The coding agent does the semantic reasoning; YallaFlow governs the durable engineering state around that reasoning.

---

## Current scope

YallaFlow is currently:

- **single-user**
- **local-first**
- **agent-agnostic**
- **Git-friendly**
- an **internal prerelease**

Team mode, locking, multi-user ownership, and collaborative execution are intentionally deferred until the single-developer model is stable.

See [`docs/limitations.md`](docs/limitations.md) for explicit current boundaries.

---

## What's next

The next product direction strengthens the gap between **"tests passed"** and **"the requested intent was actually delivered"**.

Planned focus includes:

- first-party Codex and Claude bootstrap/adapters
- stable requirement and acceptance-criteria identity
- requirement-to-implementation traceability
- delivery convergence analysis
- explicit source/change impact assessment
- stronger cross-session continuity

The target model is:

```text
Original Intent
      ↓
Specification
      ↓
Implementation
      ↓
Verification
      ↓
Convergence
      ↓
Durable Project Knowledge
      ↓
Next Agent Session
```

Longer-term execution policies and multi-agent orchestration remain separate future work.

See [`docs/roadmap.md`](docs/roadmap.md).

---

## Design principles

1. **Discover before asking.**
2. **Understand before changing.**
3. **Prove before claiming.**
4. **Remember after finishing.**
5. **Revalidate before trusting stale knowledge.**

Those rules are intentionally simple. The value is that YallaFlow makes them durable and enforceable across sessions.

---

## Status

Current public baseline: **`0.3.6-internal.1` — Living Project Memory & Context Integrity**.

YallaFlow is under active development and its workspace/package contracts have not reached 1.0 stability yet.

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/installation.md`](docs/installation.md) | Safe installation, including legacy repositories |
| [`docs/workflows.md`](docs/workflows.md) | Canonical end-to-end workflows |
| [`docs/cli.md`](docs/cli.md) | Complete CLI reference |
| [`docs/guide.md`](docs/guide.md) | Feature and behavior guide |
| [`docs/project-memory.md`](docs/project-memory.md) | Living project memory and artifact model |
| [`docs/architecture.md`](docs/architecture.md) | Internal architecture and invariants |
| [`docs/security.md`](docs/security.md) | Security and trust model |
| [`docs/limitations.md`](docs/limitations.md) | Known boundaries |
| [`docs/roadmap.md`](docs/roadmap.md) | Product roadmap |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

---

## License

MIT.
