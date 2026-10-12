# Using YallaFlow

This is the practical guide for developers who want to use YallaFlow without learning its internals first.

> **You describe the intent. YallaFlow supplies the project.**

YallaFlow is designed so that normal use stays small:

1. install the CLI,
2. initialize it once in the repository,
3. connect your coding agent,
4. describe what you want.

The deeper workflow, project memory, evidence, review gates, and delivery checks stay behind that simple interaction.

---

## 1. Requirements

YallaFlow itself requires:

- **Node.js >= 20.16.0**
- Git is recommended
- a coding agent such as Claude or Codex

Your application can use any language or framework. YallaFlow is installed as a separate CLI; do not add it to a legacy application's dependencies.

---

## 2. Install

### Fastest install from the current Git tag

```bash
npm install -g git+https://github.com/engmohamedamer/yallaflow.git#v0.3.10-internal.2
```

Verify:

```bash
yallaflow --version
```

Expected:

```text
0.3.10-internal.2
```

### Install from a release tarball

If you already have `yallaflow-<version>.tgz`:

```bash
npm install -g /path/to/yallaflow-<version>.tgz
```

### Install from a checkout

Useful when developing YallaFlow itself:

```bash
git clone https://github.com/engmohamedamer/yallaflow.git
cd yallaflow
git checkout v0.3.10-internal.2
npm ci
npm link
```

More installation and update details: [installation.md](installation.md).

---

## 3. First use

Go to the root of your project:

```bash
cd /path/to/your-project
```

Initialize YallaFlow and connect your agent.

### Claude

```bash
yallaflow init && yallaflow agent setup claude
```

### Codex

```bash
yallaflow init && yallaflow agent setup codex
```

That is the normal setup.

YallaFlow creates `.yallaflow/`, which is durable project state and is intended to be committed with the repository.

Now open **Claude Code, Codex, or another supported coding-agent session from the same project directory**.

> Prompts shown below are written inside the coding-agent session — **not in the terminal**.
>
> The agent must be able to access the repository and run the YallaFlow CLI.

Because you ran `yallaflow agent setup`, every session starts with YallaFlow automatically. You do not need to say "Use YallaFlow" — just describe the task. Saying it still works, for example with an agent you have not set up.

---

# Case A — Existing project

For an existing repository, do not explain the whole system to the agent.

Inside the coding-agent session, say:

```text
Understand this project.
```

If you already know what the understanding is for, say so. The agent then goes deeper where it matters, for example screens, forms and workflows for a UI redesign:

```text
Understand this project. We are going to redesign the whole UI
without changing business behavior.
```

YallaFlow can give the agent a bounded repository inventory and guide it through a Brownfield baseline.

The baseline can include:

- application structure,
- frameworks and versions,
- architecture,
- database facts,
- integrations,
- engineering conventions,
- authentication, roles and permissions,
- routes, APIs and important workflows,
- business rules,
- important project documents,
- known unknowns and limitations.

The agent may prepare all of that without changing application code.

Before baseline facts become permanent project memory, YallaFlow stops at a human review boundary.

When the agent asks you to review the baseline:

```bash
yallaflow baseline show PF-0001
```

If it is correct:

```bash
yallaflow baseline approve PF-0001
```

From then on, future sessions can reuse that project knowledge instead of rediscovering the repository.

You do not have to start with "Understand this project". If your first request is real work ("Fix invoice totals."), the agent builds the baseline itself, asks you to approve it, and then continues with your request. Until a baseline is approved on an existing project, YallaFlow does not authorize application code changes. That is how it makes sure the agent understands a codebase before changing it.

Check the project orientation at any time:

```bash
yallaflow brief
```

---

# Case B — New project

Initialize exactly the same way:

```bash
yallaflow init && yallaflow agent setup claude
```

Then describe the product you want.

Example:

```text
I want to build an anonymous employee survey platform.

Admins create surveys and employees answer using a public link.
```

You do not need to tell the agent to:

- use SDD,
- create a specification,
- write acceptance criteria,
- create an implementation plan,
- decide whether the task is a feature or change.

YallaFlow guides the agent through the amount of engineering process appropriate for the work.

---

# Case C — Start from an SRS, PDF, DOCX, XLSX or PPTX

Preserve the original requirement source:

```bash
yallaflow intake Product_SRS.docx
```

Multiple sources can start one work item:

```bash
yallaflow intake requirements.docx architecture.pdf payment-rules.xlsx
```

Then tell the agent:

```text
Continue from the supplied requirements.
```

YallaFlow keeps the original source distinct from:

```text
Original source
      !=
Extracted representation
      !=
Specification
      !=
Implementation
```

This keeps the original intent traceable later.

---

# Case D — A normal feature, bug or investigation

Once the project is initialized, describe the work naturally.

### Feature

```text
Add password reset by email.
```

### Bug

```text
Users can register twice with the same mobile number.
Fix it.
```

### Investigation

```text
Investigate why checkout sometimes creates duplicate payments.
Do not change application code yet.
```

The agent performs the semantic reasoning. YallaFlow records and governs the workflow around it.

When the work is done, the agent checks it with `yallaflow finish` and tells you plainly, for example:

```text
Implemented and verified. The project knowledge is up to date.
Ready to push.
```

YallaFlow never commits or pushes for you. Committing and pushing stay your decision.

---

## 4. What YallaFlow is doing for you

### Project memory

A new AI session does not need the previous chat to know what the project already established.

### Adaptive workflow

A bug, a small change, an investigation, and a new architectural feature do not need the same process.

YallaFlow keeps the workflow proportional to the work.

### Evidence-backed delivery

YallaFlow distinguishes:

- implementation,
- verification,
- code review,
- delivery convergence,
- durable project knowledge.

Passing tests is useful evidence, but it is not automatically the same as satisfying the requested intent.

### Freshness

Repository-backed project facts can carry evidence hashes.

If supporting files change, YallaFlow can surface that the knowledge may need revalidation instead of silently trusting stale context.

### Source traceability

Requirements and supporting files can remain preserved and linked to the work that used them.

### Session and agent continuity

You can close the chat, open a fresh session, or switch between supported coding agents while the durable engineering state stays with the repository.

---

## 5. Coming back later

You do not need the previous chat.

Start with:

```bash
yallaflow brief
```

Then tell your agent:

```text
Continue the current work.
```

For more detail:

```bash
yallaflow status
yallaflow resume
```

---

## 6. Switching between Claude and Codex

YallaFlow state is independent of the provider.

Set up Claude:

```bash
yallaflow agent setup claude
```

Or Codex:

```bash
yallaflow agent setup codex
```

Then open the new agent and say:

```text
Continue the current work.
```

The project state remains in `.yallaflow/`.

---

## 7. Working as a team

YallaFlow can share one project understanding with your whole team through ordinary Git. There is no server, no accounts, and no join command.

**Once, by a maintainer** (after the baseline is approved):

```bash
yallaflow shared enable --dry-run     # explains what it will do
yallaflow shared enable
git add .yallaflow CLAUDE.md             # and/or AGENTS.md — whichever exist
git commit -m "Share YallaFlow project memory"
git push
```

**Every developer, every day:**

```text
git pull → open your coding agent → describe the task → review → git push
```

What happens underneath:

- IDs created on parallel branches never collide.
- Knowledge your work learned travels with your branch and joins the shared project memory after merge.
- If a teammate changed the same project knowledge in parallel, the agent tells you instead of overwriting it.

Add `yallaflow shared check` to CI; it works with any CI provider. Everyone on the team needs the same compatible YallaFlow version.

Details: [Shared Projects](shared-projects.md).

---

## 8. The commands most users need

You do not need to memorize the entire CLI.

```bash
# Initialize once
yallaflow init

# Connect Claude or Codex
yallaflow agent setup claude
yallaflow agent setup codex

# Understand a repository without writing anything
yallaflow inspect

# Quick project + current-work orientation
yallaflow brief

# Current workflow state
yallaflow status

# Continue current work
yallaflow resume

# Is the current work ready to push?
yallaflow finish

# Workspace integrity
yallaflow doctor

# Team: share once, then see what this checkout knows
yallaflow shared enable
yallaflow shared status

# Start work manually if you want to
yallaflow start "Add password reset"

# Start from files
yallaflow intake requirements.docx architecture.pdf
```

The coding agent normally drives the lower-level lifecycle commands for you.

---

## 9. Human review boundaries

YallaFlow intentionally keeps some decisions human-controlled. These are the moments when the agent asks you for something.

Examples include:

- approving a Brownfield baseline,
- review gates configured by the project's interaction mode,
- business or architecture questions that need a real decision.

YallaFlow tries to remove mechanical ceremony, not remove meaningful human judgment.

---

## 10. Commit YallaFlow state

The `.yallaflow/` directory is project-owned state.

After initialization or meaningful workflow changes:

```bash
git add .yallaflow
git commit -m "Update YallaFlow project state"
```

If you installed a provider bootstrap, also commit the relevant file when appropriate:

- `CLAUDE.md`
- `AGENTS.md`

---

## 11. Updating YallaFlow

YallaFlow does not silently update itself.

Install the target version, then inspect compatibility:

```bash
yallaflow upgrade status
yallaflow upgrade plan
```

Refresh the managed agent contract only when you choose to:

```bash
yallaflow agent refresh --dry-run
yallaflow agent refresh
```

Then:

```bash
yallaflow doctor
```

In a Shared Project, upgrade every teammate and CI job together. An older YallaFlow stops before changing project state and tells you which version the project requires.

Full update procedure: [installation.md#updating-yallaflow](installation.md#updating-yallaflow). What changed in this release: [upgrading-to-v0.3.10.md](upgrading-to-v0.3.10.md).

---

# Go deeper

The workflow above is enough for normal use.

If you want to understand or control more of YallaFlow, continue here:

| Guide | What it explains |
| --- | --- |
| [Installation](installation.md) | installation, legacy repositories, upgrades |
| [Shared Projects](shared-projects.md) | one project understanding for the whole team, through Git |
| [Canonical workflows](workflows.md) | Greenfield, Brownfield, bugs, investigations, features and changes |
| [Feature guide](guide.md) | capabilities and lifecycle behavior |
| [Project memory](project-memory.md) | CTX facts, freshness, sources and durable knowledge |
| [CLI reference](cli.md) | every command and flag |
| [Architecture](architecture.md) | internal model and terminology |
| [Security](security.md) | source capture and sensitive-data considerations |
| [Limitations](limitations.md) | current boundaries |
| [Roadmap](roadmap.md) | planned work |

---

## The idea to remember

Do not make your prompts carry the whole project.

Instead of:

```text
This project uses Spring Boot...
the frontend is Angular...
the database is SQL Server...
read these files...
follow this workflow...
remember these decisions...
```

prefer:

```text
Fix beneficiary registration.
```

> **The developer describes the intent. YallaFlow supplies the project.**
