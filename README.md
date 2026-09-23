# YallaFlow

> **Give AI your project, not just your prompt.**

**YallaFlow is an AI-agnostic engineering governance layer for coding agents, providing durable project memory, adaptive workflows, and evidence-backed delivery.**

*Adaptive Spec-Driven Development when the work needs it — not ceremony for every task.*

Coding agents are good at a task. Software projects live much longer than a task. Important context ends up scattered across chats, tickets, code, and people's memory, so a new AI session repeats discovery, asks questions the repository could answer, fixes before proving the root cause, or declares work done without fresh evidence.

YallaFlow makes the **project** — not the chat session — the durable unit of engineering work. It is a local CLI plus a project-owned `.yallaflow/` workspace that any coding agent (Claude, Codex, or another) drives:

```text
Agent orchestrates.   YallaFlow governs.   Project memory persists.

Understand → Decide → Change → Verify → Remember → Revalidate when evidence changes
```

- **Durable project memory** — an evidence-backed ledger of what is currently believed true about the project, with history, freshness, and a readable Markdown projection.
- **Adaptive workflows** — work is routed by type and scope; each routed work item pins a Behavior Contract (the skills it must follow), and process depth matches the work.
- **Evidence-backed delivery** — checkpoints, review gates, recorded verification runs, and knowledge review decide when work is DONE, not the conversation.
- **Recovery and handoff** — any agent or session can resume from durable state, the Git tree, and evidence, without the previous chat.

## Five rules

1. **Discover before asking.** Technical facts come from the repository; questions are for business ambiguity.
2. **Understand before changing.** Route the work and establish expected behavior or root cause before editing code.
3. **Prove before claiming.** No DONE without fresh, recorded verification evidence.
4. **Remember after finishing.** Promote stable knowledge into project memory; keep execution noise with the work item.
5. **Revalidate before trusting stale knowledge.** When the evidence behind a fact changes, reconfirm, supersede, or dispute it before relying on it.

## Install

Requires **Node.js ≥ 20.16.0** for the YallaFlow CLI itself (independent of your application's Node version). YallaFlow is not yet published to the npm registry; install from a release tarball or a checkout.

```bash
npm install -g /path/to/yallaflow-<version>.tgz     # recommended: isolated, global CLI
yallaflow --version
```

**Legacy / Brownfield repositories:** do **not** add YallaFlow as a devDependency of the application. Installing it into the app's `package.json` makes npm resolve the application's whole dependency tree and can rewrite a legacy `package-lock.json`. Install the CLI globally, or into a separate tools prefix, so the application's dependencies are never touched. See [`docs/installation.md`](docs/installation.md).

## Quick start

```bash
cd your-project
yallaflow init                                  # greenfield or brownfield is detected
yallaflow start "Production upload returns 500" # or: yallaflow intake SRS.docx
yallaflow guide PF-0001                         # what to do next, and whether code changes are authorized
```

Then open your coding agent in the repository. The generated `.yallaflow/AGENT.md` tells it how to work: classify the request (`yallaflow route`), follow the pinned skills (`yallaflow guide`, `yallaflow skill`), record progress (`yallaflow checkpoint`), prove results (`yallaflow verify`), and promote durable knowledge (`yallaflow knowledge`). Commit `.yallaflow/` with the project.

Already classified the work yourself? Use a direct command with an explicit scope:

```bash
yallaflow bug "Upload returns 500" --scope bounded
```

## How it works

```text
Raw request / file ──► pending work item ──► route (type + scope) ──► pinned Behavior Contract
        │                                                                       │
   SRC-#### sources                                     checkpoints · review gates · verify
                                                                               │
                         project memory (CTX-#### facts) ◄── knowledge review ◄─┘ DONE
```

| Work | Adaptive path (Behavior Contract) |
|---|---|
| Bounded feature | discover → clarify → implement → verify |
| Architectural feature | discover → clarify → design → specify → plan → implement → verify → review |
| Bug | discover → systematic debugging (root cause with evidence) → implement → verify |
| Investigation / spike | discover → evidence → conclusion → verify — read-only |
| Change / refactor / release | discover → (clarify) → plan → implement → verify (→ review) |
| Brownfield | baseline → reviewed durable memory → incremental work → continuous memory maintenance |

Workflow stages, checkpoints, and gates are enforced by the CLI. Investigations never authorize application-code changes. Not every work item must reach implementation — a work item can stop at `SPEC_READY` or `PLAN_READY`.

## Canonical workflows

Step-by-step, command-accurate guides live in [`docs/workflows.md`](docs/workflows.md):

- [Greenfield](docs/workflows.md#greenfield) · [Brownfield](docs/workflows.md#brownfield)
- [Bug](docs/workflows.md#bug) · [Investigation](docs/workflows.md#investigation) · [Bounded change](docs/workflows.md#bounded-change)
- [Task with a user-provided screenshot or file](docs/workflows.md#task-with-a-user-provided-screenshot-or-file)
- [Cross-agent handoff](docs/workflows.md#cross-agent-handoff)
- [Context freshness and revalidation](docs/workflows.md#context-freshness-and-revalidation)

## Project memory

> **Work records preserve history. Project memory preserves current understanding.**

| Memory | Question it answers | Where it lives |
|---|---|---|
| Work memory | What happened during PF-####? | `work/PF-####/` — never rewritten |
| Project memory | What is currently believed true? | `context/index.yaml` (canonical `CTX-####` facts) → `PROJECT.md`, `context/*.md` |
| Historical knowledge | What used to be believed, and what replaced it? | superseded facts (`yallaflow context history`) |
| Discovery limitations | What could an investigation not inspect? | the work item — never project facts |

Facts carry a state (`current` / `superseded` / `disputed`), a confidence (`confirmed` / `inferred` / `unresolved`), provenance, evidence, and a verification point. `yallaflow context status` shows which facts may be stale because their evidence changed. Details: [`docs/project-memory.md`](docs/project-memory.md).

**Sources vs evidence:** original user/project inputs (requirement files, screenshots) are immutable `SRC-####` sources; verification output is evidence in the work item; outputs of the work are generated artifacts; what could not be inspected is a discovery limitation. See [the artifact model](docs/project-memory.md#sources-evidence-generated-artifacts-and-discovery-limitations).

## Workspace

```text
.yallaflow/
├── config.yaml                 # project name/kind, interaction mode (autonomous | adaptive | gated)
├── PROJECT.md                  # project overview (+ managed block of current project facts)
├── AGENT.md                    # agent contract (versioned managed block; `yallaflow agent status`)
├── context/
│   ├── index.yaml              # canonical project-memory ledger (created on first approval/promotion)
│   └── architecture.md …       # tech-stack, database, integrations, environments, conventions, business-rules
├── work/
│   └── PF-0001/
│       ├── meta.yaml           # type, scope, workflow, pinned Behavior Contract, sources
│       ├── work.md
│       └── progress.md         # other files appear only when first written:
│                               #   progress.yaml, questions.yaml, knowledge.yaml, reviews.yaml,
│                               #   discovery.yaml, decomposition.yaml, baseline.yaml, evidence/
├── sources/                    # created by the first file intake
│   └── SRC-0001/               # source.json, the original file (byte-for-byte), extracted.txt when available
├── decisions/                  # ADRs
├── releases/
└── state/current.yaml          # active work pointer
```

No directory is created until something is written to it.

## Documentation

| Document | For |
|---|---|
| [`docs/installation.md`](docs/installation.md) | Installing safely, including in legacy repositories |
| [`docs/workflows.md`](docs/workflows.md) | Canonical end-to-end workflows |
| [`docs/cli.md`](docs/cli.md) | Complete CLI reference |
| [`docs/guide.md`](docs/guide.md) | Feature guide: intake, routing, skills, checkpoints, readiness, reviews, decomposition, handoff, baseline, knowledge |
| [`docs/project-memory.md`](docs/project-memory.md) | Living project memory, freshness, and the artifact model |
| [`docs/upgrading-to-v0.3.6.md`](docs/upgrading-to-v0.3.6.md) | Upgrading an existing v0.3.5 workspace |
| [`docs/security.md`](docs/security.md) | Security and trust model |
| [`docs/limitations.md`](docs/limitations.md) | Current limitations |
| [`docs/architecture.md`](docs/architecture.md) | Internals, invariants, and canonical terminology |
| [`docs/roadmap.md`](docs/roadmap.md) · [`CHANGELOG.md`](CHANGELOG.md) | What shipped and what is next |
| [`docs/internal-pilot.md`](docs/internal-pilot.md) | Piloting YallaFlow on real work |

## What YallaFlow is not

- **Not a coding agent or model provider.** It never calls an AI model; your agent does the reasoning and YallaFlow governs state.
- **Not tied to one agent or vendor.** Any agent that can run a CLI and read files can use it.
- **Not a project-management tool.** Jira, Azure Boards, or GitHub Issues remain the planning source of truth.
- **Not a prompt pack.** Behavior is versioned, validated, and covered by tests.
- **Not a fixed spec template.** Specification depth adapts to work type and scope; small work stays small.
- **Not a sandbox or security boundary.** Write authorization is guidance the agent follows; `verify` runs commands with your privileges.
- **Not a knowledge graph or semantic search engine.** Project memory is a small local ledger; YallaFlow never judges whether prose is true.

## Status

**`0.3.6-internal.1` — Living Project Memory & Context Integrity** (internal prerelease; `package.json` is `private`, nothing is published to npm). Upgrading from v0.3.5: [`docs/upgrading-to-v0.3.6.md`](docs/upgrading-to-v0.3.6.md). Known gaps: [`docs/limitations.md`](docs/limitations.md).

YallaFlow is an independent implementation informed by ideas from projects such as Squad-Kit and Superpowers — see [`docs/inspiration.md`](docs/inspiration.md).

## License

MIT.
