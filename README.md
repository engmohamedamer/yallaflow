# YallaFlow

> **Give AI your project, not just your prompt.**

Your coding agent is already smart.

**YallaFlow gives it durable project memory, the right engineering workflow, and evidence that the work is actually done — without making you carry all of that in every prompt.**

> **You describe the intent. YallaFlow supplies the project.**

---

## Start in under a minute

### 1. Install

YallaFlow requires **Node.js >= 20.16.0**.

~~~bash
npm install -g git+https://github.com/engmohamedamer/yallaflow.git#v0.3.9-internal.1
~~~

Check it:

~~~bash
yallaflow --version
~~~

### 2. Initialize your project

Open the project root and run one setup line.

**Claude**

~~~bash
yallaflow init && yallaflow agent setup claude
~~~

**Codex**

~~~bash
yallaflow init && yallaflow agent setup codex
~~~

### 3. Open your AI coding session

Open **Claude Code, Codex, or another supported coding agent from the same project directory**.

> The next lines are prompts for your AI coding agent — **not terminal commands**.
>
> YallaFlow works with coding agents that can access your project files and run the YallaFlow CLI.

Then simply tell the agent what you want.

**Existing project**

~~~text
Use YallaFlow.

Understand this project.
~~~

**Or go directly to real work**

~~~text
Use YallaFlow.

Fix beneficiary registration.
~~~

**New project**

~~~text
Use YallaFlow.

Build an anonymous employee survey platform.
~~~

**That's it. YallaFlow and your coding agent handle the engineering workflow from here.**

You do not need to explain the architecture, repeat old decisions, choose a workflow, or tell the agent to create specifications and verification evidence by hand.

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

YallaFlow can establish a reviewed baseline before the agent starts changing a codebase it does not yet understand.

---

## Existing project: the first useful interaction

After setup, tell the agent:

~~~text
Use YallaFlow.

Understand this project.
~~~

For an existing repository, YallaFlow can help the agent build an evidence-backed baseline from:

- repository structure,
- frameworks and versions,
- architecture,
- database and integrations,
- project conventions,
- important documents,
- business rules,
- unresolved facts and discovery limitations.

The agent can prepare the baseline without changing application code.

**A human approves the baseline before it becomes durable project memory.**

After that, a fresh session can start with:

~~~text
Use YallaFlow.

What should I know before changing beneficiary registration?
~~~

instead of rediscovering the whole repository.

---

## New project: just describe the product

After setup:

~~~text
Use YallaFlow.

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

Start from the original material:

~~~bash
yallaflow intake Product_SRS.docx
~~~

Or several sources:

~~~bash
yallaflow intake requirements.docx architecture.pdf payment-rules.xlsx
~~~

Then:

~~~text
Use YallaFlow and continue from the supplied requirements.
~~~

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

You do not need yesterday's chat.

~~~bash
yallaflow brief
~~~

Then open your coding agent:

~~~text
Use YallaFlow and continue the current work.
~~~

That is one of the main ideas behind YallaFlow:

> **The project — not the chat session — is the durable unit of AI-assisted software development.**

---

## The few commands worth remembering

Most lifecycle commands are for the coding agent. As a developer, these cover most day-to-day needs:

~~~bash
yallaflow init                    # initialize once
yallaflow inspect                 # read-only repository inventory
yallaflow brief                   # project + current-work orientation
yallaflow status                  # workflow state
yallaflow resume                  # continue current work
yallaflow doctor                  # integrity check

yallaflow agent setup claude      # connect Claude
yallaflow agent setup codex       # connect Codex

yallaflow intake requirements.pdf # start from a file
~~~

The rest of the CLI is there when you want explicit control.

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
Use YallaFlow.

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
| [Canonical workflows](docs/workflows.md) | Greenfield, Brownfield, bugs, investigations, features |
| [Feature guide](docs/guide.md) | detailed YallaFlow behavior |
| [Project memory](docs/project-memory.md) | durable context, evidence and freshness |
| [CLI reference](docs/cli.md) | every command and flag |
| [Architecture](docs/architecture.md) | internal concepts and design |
| [Security](docs/security.md) | handling project sources safely |
| [Limitations](docs/limitations.md) | current boundaries |
| [Roadmap](docs/roadmap.md) | what comes next |

---

## Current status

Current version: **v0.3.9-internal.1 — Frictionless Project Onboarding & Context UX**

YallaFlow is currently:

- single-user,
- local-first,
- AI-agent agnostic,
- Git-friendly,
- pre-1.0 and under active development.

It does not call an LLM itself. The coding agent does the semantic reasoning; YallaFlow provides deterministic governance and durable engineering state around that reasoning.

---

## The idea

**Agent reasons. YallaFlow governs. Project memory persists.**

~~~text
Understand → Decide → Change → Verify → Remember → Revalidate
~~~

> **Give AI your project, not just your prompt.**
