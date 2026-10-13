# Using YallaFlow

This is the practical guide for developers who want to use YallaFlow without learning its internals first.

> **You describe the intent. YallaFlow supplies the project.**

YallaFlow is designed so that normal use stays small:

1. install the CLI,
2. run `yallaflow init` once in the repository,
3. open Claude Code or Codex and describe what you want.

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

```bash
npm install -g yallaflow
```

Verify:

```bash
yallaflow --version
```

Expected:

```text
1.0.0
```

### Install a specific Git tag

Every release is also a Git tag:

```bash
npm install -g git+https://github.com/engmohamedamer/yallaflow.git#v1.0.0
```

### Install from a checkout

Useful when developing YallaFlow itself:

```bash
git clone https://github.com/engmohamedamer/yallaflow.git
cd yallaflow
npm ci
npm link
```

More installation and update details: [installation.md](installation.md).

---

## 3. First use

Go to the root of your project and initialize it once:

```bash
cd /path/to/your-project
yallaflow init
```

That is the whole setup. `init` creates `.yallaflow/` (durable project state, meant to be committed). It also connects both Claude Code and Codex by adding a short pointer to `CLAUDE.md` and `AGENTS.md`; anything already in those files is kept.

Now open **Claude Code or Codex in the same project directory** and describe what you want.

> Prompts shown below are written inside the coding-agent session — **not in the terminal**.
>
> The agent must be able to access the repository and run the YallaFlow CLI.

Every session starts with YallaFlow automatically. You do not need to say "Use YallaFlow" — just describe the task. Saying it still works, for example with an agent other than Claude Code or Codex.

---

# Case A — Existing project

Do not explain the whole system to the agent. Just ask for the work:

```text
Fix invoice totals.
```

A question works the same way:

```text
How does subscription renewal work?
```

The first time, the agent notices that YallaFlow does not understand this project yet. Before any engineering work starts — a fix, a feature, or even a read-only investigation — it builds an evidence-backed understanding of the repository, going deeper where your request points:

- application structure,
- frameworks and versions,
- architecture,
- database facts,
- integrations,
- authentication, roles and permissions,
- routes, APIs and important workflows,
- engineering conventions,
- business rules,
- important project documents,
- known unknowns and limitations.

It does not change application code while doing this, and it never copies secret values (for example from `.env`) into YallaFlow's records.

Then the agent shows you what it found — and what it inspected, only sampled, or could not inspect — and asks you to review it. If it is right, reply:

```text
Approve
```

If something is wrong or missing, say so in your own words. The agent corrects it and asks again.

When you approve, the agent records your approval and continues with your original request — you do not repeat it. **Until you approve, YallaFlow does not start engineering work on the project.** That is how YallaFlow makes sure the agent understands a codebase before it works on it.

Quick operational help is the exception and never waits for this: starting Docker or a dev server, opening the app, showing logs, or checking `git status`.

This happens once per project. From then on, future sessions — and teammates — reuse that understanding instead of rediscovering the repository.

### Deeper understanding for a bigger goal

If you are planning something larger, say what the understanding is for. The agent goes deeper where that goal needs it, for example screens, forms and workflows for a UI redesign:

```text
Understand this project. We are going to redesign the whole UI
without changing business behavior.
```

What you want preserved ("without changing business behavior") is kept as the goal of that work, never as a fact about the project.

> Prefer to inspect the raw draft yourself? `yallaflow baseline show` prints it. The approval and feedback commands are listed in the [CLI reference](cli.md#brownfield-baseline).

---

# Case B — New project

Initialize exactly the same way:

```bash
yallaflow init
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

Hand the files to the agent:

```text
Build this from docs/Product_SRS.docx, docs/architecture.pdf and docs/payment-rules.xlsx.
```

The agent preserves each original as a source linked to the work. You can also capture files yourself with `yallaflow intake <file> [<file> ...]` and then tell the agent to continue from the supplied requirements.

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

You do not need the previous chat. Open your agent and say:

```text
Continue the current work.
```

The agent orients itself from the project state. To look yourself, `yallaflow brief` prints the same orientation.

---

## 6. Switching between Claude and Codex

Nothing to set up: `yallaflow init` already connected both. Open the other agent in the same directory and say:

```text
Continue the current work.
```

The project state lives in `.yallaflow/`, not in either provider's chat.

If a pointer file was deleted or damaged, re-create it with `yallaflow agent setup claude` or `yallaflow agent setup codex`.

---

## 7. Working as a team

YallaFlow can share one project understanding with your whole team through ordinary Git. There is no server, no accounts, and no join command.

```text
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
```

The maintainer's commands:

```bash
yallaflow init
# … open the agent, ask for work, approve the project understanding when asked …
yallaflow shared enable --dry-run     # explains what it will do
yallaflow shared enable
git add .yallaflow CLAUDE.md AGENTS.md
git commit -m "Share YallaFlow project memory"
git push
```

Developers do not run `yallaflow init`, agent setup, or any join command. They only need a compatible YallaFlow CLI installed.

What happens underneath:

- IDs created on parallel branches never collide.
- Knowledge your work learned travels with your branch and joins the shared project memory after merge.
- If a teammate changed the same project knowledge in parallel, the agent tells you instead of overwriting it.

Add `yallaflow shared check` to CI; it works with any CI provider. Everyone on the team needs the same compatible YallaFlow version.

Details: [Shared Projects](shared-projects.md).

---

## 8. Who runs what

**Developers** describe the work to the coding agent, review the result, and use Git as usual (`git pull`, `git push`). No YallaFlow commands are needed.

**Project maintainers** run:

```bash
yallaflow init            # once per project
yallaflow shared enable   # once, when the team should share project memory
```

**Manual / advanced** — the agent normally runs these; use them to look under the hood or to recover:

```bash
yallaflow brief                  # project + current-work orientation
yallaflow status                 # workflow state
yallaflow resume                 # current work in detail
yallaflow finish                 # is the current work ready to push?
yallaflow doctor                 # workspace integrity
yallaflow inspect                # read-only repository inventory
yallaflow agent setup claude     # re-create the Claude pointer (CLAUDE.md)
yallaflow agent setup codex      # re-create the Codex pointer (AGENTS.md)
yallaflow baseline show          # the project-understanding draft
yallaflow shared status          # what this checkout knows about shared work
yallaflow intake <file>          # capture a requirements file yourself
```

Every command and flag: [CLI reference](cli.md).

---

## 9. Human review boundaries

YallaFlow intentionally keeps some decisions human-controlled. These are the moments when the agent asks you for something.

Examples include:

- approving the initial project understanding (you reply "Approve" when the agent asks),
- review gates configured by the project's interaction mode,
- business or architecture questions that need a real decision.

YallaFlow tries to remove mechanical ceremony, not remove meaningful human judgment.

---

## 10. Commit YallaFlow state

The `.yallaflow/` directory and the two agent pointer files are project-owned state. Commit them with your code:

```bash
git add .yallaflow CLAUDE.md AGENTS.md
git commit -m "Update YallaFlow project state"
```

YallaFlow never commits or pushes for you.

---

## 11. Updating YallaFlow

YallaFlow does not silently update itself.

Install the target version, then inspect compatibility:

```bash
npm install -g yallaflow@latest
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

Full update procedure: [installation.md#updating-yallaflow](installation.md#updating-yallaflow). Upgrading from a 0.3.x prerelease: [upgrading-to-v1.0.md](upgrading-to-v1.0.md).

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
