# YallaFlow

> **Give AI your project, not just your prompt.**

Your coding agent is already smart.

**YallaFlow gives it durable project memory, the right engineering workflow, and evidence that the work is actually done — without making you carry all of that in every prompt.**

> **You describe the intent. YallaFlow supplies the project.**
>
> **Understand once. Share automatically. Revalidate precisely.**

---

## Start in under a minute

### 1. Install

YallaFlow requires **Node.js >= 20.16.0**.

~~~bash
npm install -g git+https://github.com/engmohamedamer/yallaflow.git#v0.3.10-internal.4
~~~

Check it:

~~~bash
yallaflow --version
~~~

### 2. Initialize your project — once

In the project root:

~~~bash
yallaflow init
~~~

That one command sets up YallaFlow and connects both Claude Code and Codex. It adds a small pointer to `CLAUDE.md` and `AGENTS.md`, and keeps anything already in those files.

### 3. Open your AI coding session and describe the work

Open **Claude Code or Codex in the project directory**.

> The next lines are prompts for your AI coding agent — **not terminal commands**.

**Existing project**

~~~text
Fix invoice totals.
~~~

**New project**

~~~text
Build an anonymous employee survey platform.
~~~

**That's it. YallaFlow and your coding agent handle the engineering workflow from here.**

You do not need to explain the architecture, repeat old decisions, choose a workflow, or tell the agent to create specifications and verification evidence by hand. You also do not need to say "Use YallaFlow": every session starts with it automatically.

---

## What happens behind that simple prompt?

~~~mermaid
flowchart LR
    U["You<br/><b>Describe the intent</b>"]
    A["Coding Agent<br/>Claude / Codex"]
    Y["YallaFlow"]

    M["Project Memory<br/>architecture · rules · decisions"]
    W["Adaptive Workflow<br/>bug · feature · investigation"]
    E["Evidence<br/>verification · review · convergence"]

    D["Delivered Change"]
    N["Next Session<br/>starts with project context"]

    U --> A
    A --> Y
    Y --> M
    Y --> W
    Y --> E

    M --> A
    W --> A
    E --> D
    D --> N
    N --> A
~~~

> **The complexity stays inside YallaFlow — not inside your prompt.**

---

## New project or existing project? Same start.

~~~mermaid
flowchart TD
    I["yallaflow init"]
    Q{"What is already here?"}

    B["Existing repository<br/><b>Brownfield</b>"]
    G["New repository<br/><b>Greenfield</b>"]

    BM["Understand existing code,<br/>docs and architecture"]
    GI["Build from product intent"]

    P["Durable project state"]
    R["Describe the next change"]

    I --> Q
    Q --> B
    Q --> G
    B --> BM
    G --> GI
    BM --> P
    GI --> P
    P --> R
~~~

YallaFlow performs bounded repository inspection and classifies the project automatically. You can override the classification when needed.

---

## Why use YallaFlow?

### 🧠 Project memory

A new AI session does not have to start from zero.

YallaFlow keeps reviewed project knowledge with evidence, provenance, and freshness information so future work can reuse what the project already knows.

### 🧭 The right workflow for the work

A bug is not a feature. An investigation is not an implementation task.

YallaFlow lets the coding agent reason about the request, then governs the appropriate lifecycle around it.

### ✅ "Done" needs evidence

YallaFlow separates:

~~~text
Implementation
      ↓
Verification
      ↓
Delivery Convergence
      ↓
Code Review
      ↓
Durable Project Knowledge
~~~

Passing tests matters. Matching the approved intent matters too.

### 🔄 Session and agent continuity

Close the chat. Open a fresh session. Switch between supported coding agents.

The durable engineering state stays with the project.

### 📎 Original requirements stay traceable

SRS files, PDFs, spreadsheets, presentations, and other inputs can be preserved as sources instead of disappearing into chat history.

### 🌱 Brownfield is first-class

Existing systems are not treated like blank projects.

YallaFlow establishes a reviewed baseline before the agent is allowed to change a codebase it does not yet understand.

### 👥 Shared with your team through Git

Your whole team reuses one reviewed understanding of the project. Nobody re-explains the architecture, and nobody needs to learn YallaFlow.

> **Developers work with Git. Agents work with YallaFlow.**

---

## Existing project: what happens the first time

Just ask for the work you need:

~~~text
Fix invoice totals.
~~~

Or ask a question about it:

~~~text
How does subscription renewal work?
~~~

The first time, the agent notices that YallaFlow does not understand this project yet. Before any engineering work starts — a fix, a feature, or even a read-only investigation — it builds an evidence-backed understanding of the repository, using your request as its focus:

- repository structure,
- frameworks and versions,
- architecture,
- database and integrations,
- authentication and permissions,
- routes, APIs and important workflows,
- project conventions,
- important documents,
- business rules,
- unresolved facts and discovery limitations.

It does not change application code while doing this, and it never copies secret values (from `.env` files, for example) into YallaFlow's records. Then it shows you what it found — and what it did *not* inspect — and asks you to review it.

If it looks right, reply:

~~~text
Approve
~~~

If something is wrong, say what, and the agent corrects it. Once you approve, the agent records your approval and continues with your original request — you do not have to repeat it. **Until you approve, YallaFlow does not start engineering work on the project.**

Quick operational help is the exception: starting Docker or a dev server, opening the app, showing logs, or checking `git status` just happens — no project understanding needed.

This happens once per project. After that, every session and every teammate starts from the same approved understanding:

~~~text
What should I know before changing beneficiary registration?
~~~

### Want deeper understanding for a bigger goal?

If you are planning something larger, you can ask for understanding with a purpose. The agent then goes deeper where that goal needs it:

~~~text
Understand this project. We are going to redesign the whole UI
without changing business behavior.
~~~

---

## New project: just describe the product

After setup:

~~~text
I want to build a contract management system.

Admins create contracts, clients review and sign them, and payments are tracked.
~~~

You do **not** need to tell the agent:

- "use SDD",
- "create acceptance criteria",
- "make an implementation plan",
- "decide whether this is architectural",
- "create verification evidence".

YallaFlow keeps that engineering process proportional to the work.

---

## Already have an SRS or project files?

Hand them to the agent:

~~~text
Build this from docs/Product_SRS.docx and docs/payment-rules.xlsx.
~~~

The agent preserves the originals as sources linked to the work, so they do not disappear into chat history. You can also capture files yourself with `yallaflow intake <file> [<file> ...]`.

YallaFlow deliberately keeps these distinct:

~~~text
Original Source
      !=
Extracted Representation
      !=
Specification
      !=
Implementation
~~~

So later you can still answer: **What were we originally given, and did we actually deliver it?**

---

## Coming back tomorrow

You do not need yesterday's chat. Open your coding agent and say:

~~~text
Continue the current work.
~~~

The agent orients itself with `yallaflow brief`. You can run it yourself too.

That is one of the main ideas behind YallaFlow:

> **The project — not the chat session — is the durable unit of AI-assisted software development.**

---

## Working as a team

~~~text
Maintainer — once
  install YallaFlow
  → yallaflow init
  → approve the initial project understanding (the agent asks)
  → yallaflow shared enable
  → commit and push the project state

Developer — every day
  git pull
  → open your coding agent
  → describe the task
  → review
  → git push
~~~

The maintainer commits the project state:

~~~bash
git add .yallaflow CLAUDE.md AGENTS.md
git commit -m "Share YallaFlow project memory"
git push
~~~

Developers need nothing else: no `yallaflow init`, no agent setup, no join command — just a compatible `yallaflow` CLI.

When the work is done, the agent tells you in plain language:

~~~text
Implemented and verified. New project knowledge from this task will join the shared project memory after it is merged.
Ready to push.
~~~

Underneath:

- Work and source IDs are safe across parallel branches.
- Knowledge learned on a branch travels with that branch's work.
- Project memory is updated in one place, on the integration branch.
- A parallel change is never silently overwritten.
- `yallaflow shared check` is a read-only CI gate for any CI provider.
- YallaFlow never commits, pushes, pulls, or merges for you.

👉 [Shared Projects](docs/shared-projects.md)

---

## Who runs what

**Developers**: describe the work to your coding agent, review the result, and use Git as usual (`git pull`, `git push`). No YallaFlow commands.

**Project maintainer**:

~~~bash
yallaflow init            # once per project
yallaflow shared enable   # once, when the team should share project memory
~~~

**Manual / advanced** (for looking under the hood or recovering; the agent normally runs these):

~~~bash
yallaflow brief                  # project + current-work orientation
yallaflow status                 # workflow state
yallaflow doctor                 # integrity check
yallaflow inspect                # read-only repository inventory
yallaflow agent setup claude     # re-create the Claude pointer (CLAUDE.md)
yallaflow agent setup codex      # re-create the Codex pointer (AGENTS.md)
yallaflow baseline show          # inspect the project-understanding draft
~~~

Everything else is in the [CLI reference](docs/cli.md).

---

## Before YallaFlow / with YallaFlow

Without durable project state:

~~~text
"This project uses Spring Boot 2.7..."
"The frontend is Angular 16..."
"The payment rules are in this document..."
"Read these six files first..."
"Last time we decided..."
"Please follow SDD..."
~~~

With YallaFlow:

~~~text
Add partial payments.
~~~

That difference is the product.

---

## Want the details?

The README is intentionally the shortest path into YallaFlow.

If you want the practical end-to-end guide, start here:

### 👉 [Using YallaFlow](docs/using-yallaflow.md)

Then go deeper only where you need to:

| Documentation | Purpose |
| --- | --- |
| [Installation](docs/installation.md) | installation, legacy projects, upgrades |
| [Shared Projects](docs/shared-projects.md) | one project understanding for the whole team, through Git |
| [Canonical workflows](docs/workflows.md) | Greenfield, Brownfield, bugs, investigations, features, teams |
| [Feature guide](docs/guide.md) | detailed YallaFlow behavior |
| [Project memory](docs/project-memory.md) | durable context, evidence and freshness |
| [CLI reference](docs/cli.md) | every command and flag |
| [Architecture](docs/architecture.md) | internal concepts and design |
| [Security](docs/security.md) | handling project sources safely |
| [Limitations](docs/limitations.md) | current boundaries |
| [Roadmap](docs/roadmap.md) | what comes next |
| [Upgrading to v0.3.10](docs/upgrading-to-v0.3.10.md) | what changes when you upgrade |
| [Changelog](CHANGELOG.md) | release history |

---

## Current status

Current version: **v0.3.10-internal.4 — Shared Project Intelligence (pilot hardening)**

YallaFlow is currently:

- local-first, and single-user by default,
- shareable with a team through ordinary Git, once a maintainer enables a Shared Project,
- AI-agent agnostic,
- pre-1.0 and under active development.

It does not call an LLM itself. The coding agent does the semantic reasoning; YallaFlow provides deterministic governance and durable engineering state around that reasoning.

It is not a cloud service, a real-time collaboration server, a project-management tool, or a bot that commits or pushes for you.

---

## The idea

**Agent reasons. YallaFlow governs. Project memory persists.**

~~~text
Understand → Decide → Change → Verify → Remember → Revalidate
~~~

> **Give AI your project, not just your prompt.**
