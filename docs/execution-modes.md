# Running work: Run Now, Queue, Parallel, Review & Merge

YallaFlow 1.5.0 runs work with your coding agents in three ways and brings parallel work back into your project. One rule holds throughout: **the agent works, you decide**. YallaFlow never approves a tool request, a review gate, a question or a merge for you.

| Mode | What happens | When to use it |
|---|---|---|
| **Run Now** | One work item, one agent, right now. | Most of the time. Same as **Start** on a work item. |
| **Queue** | Several work items, one agent, one after another. | A batch of small tasks you do not want to start by hand. |
| **Parallel** | Several work items, each with its own agent in its own folder and branch. | Independent tasks that can run at the same time. |
| **Review & Merge** | You review a finished parallel task: readiness, files, conflicts, secrets, and the steps to merge it by hand. (Automated Merge is off in 1.5.0.) | When a parallel task is DONE. |

Agents run on your own subscriptions (Codex through your ChatGPT login; Claude Code from its own terminal). YallaFlow never uses API keys.

## Run Now

Press **Start** on a work item (or **Run now** with one item selected). The agent gets the whole job: classify, understand, plan, implement, verify, and close with `yallaflow finish`. It stops only for a decision only you can make. This is the same as in 1.4.2.

## Queue

1. On the **Work** page, press **Select for a queue** and click the work items you want, in order.
2. Press **Queue N**. Reorder with ↑ ↓, choose the agent, and tick the confirmation.
3. The queue runs one item at a time, each in a **new agent session**.

The next item starts only when the current one is **DONE in YallaFlow and its session has fully ended**. Anything that needs you stops the queue until you act: a tool approval, a review gate, a question, an agent that stops before finishing, a failure, or a usage limit. Nothing is answered for you.

From the **Agents** tab you can pause after the current item, continue, cancel after the current item or right away, skip, retry, reorder, and move the remaining items to the other agent.

- **Pause after each task** (in the queue sheet) waits for your **Continue** between items.
- **Codex project settings:** Codex loads a project's `.codex/config.toml` (sandbox, MCP servers, hooks) for trusted folders. If `.codex/` changed since the queue began, for example because an agent edited it, the next task does not start. It waits for you to look and start it yourself.
- **Usage limit:** when an agent reaches its subscription limit, every queue on that agent pauses and the Agents tab says when it can try again. Resume later, or continue the rest with the other agent.
- **Claude Code is assisted:** the console cannot start Claude Code. A Claude Code item in a queue waits for you to start it in Claude Code and link it. On Claude Team and Enterprise logins, console messages to Claude Code are off unless your organization enables them.

## Parallel

> **In 1.5.0, Parallel is off.** It stays off until a real-agent test confirms that a lane's agent cannot change your repository's shared Git settings, or a Codex project configuration (`.codex/config.toml`: sandbox, MCP servers, hooks) that the console would load for the next session. Use a queue to run tasks one after another. The rest of this section describes Parallel as it works once it is turned on.

Parallel work needs:

- a Git repository with at least one commit;
- **Shared Project Mode**, committed. Parallel work needs branch-safe work ids so lanes never collide. The parallel sheet can enable it for you: it shows the `yallaflow shared enable --dry-run` preview, asks for your tick, and then you commit `.yallaflow/`;
- the main checkout on the integration branch (usually `main`);
- the work items committed on that branch;
- a verified platform. Automated Git operations run on Linux with a Git version YallaFlow has tested (2.43). Anywhere else, YallaFlow refuses and you can work with Git by hand;
- no repository-defined Git filters or merge drivers (for example Git LFS), and no submodules. YallaFlow 1.5.0 never runs them; such repositories integrate by hand.

Select items on the **Work** page and press **Parallel**. Each item gets a **lane**: a folder next to your project (`<project>.lanes/<name>`) on its own branch (`yf/<name>`), with its own agent. Two lanes at a time by default; up to four (three and four are experimental). Lanes appear in the Agents tab under their project, named "Project · lane".

Your files in the main project are not touched while lanes work.

## Review & Merge

When a lane's task is DONE, its card says **DONE · not merged** and offers **Review & merge**.

> **In 1.5.0, Automated Merge is off.** The final security review found that its checks cannot yet run on exactly the merged content apart from files the lane's agent controls. Review works as described below and shows **Merge by hand**: ordinary Git commands you run and check yourself. The parts below about approving, checks and MERGED & VERIFIED describe the merge engine, which stays off (fail closed) until a later release can run its checks safely.

The review shows:

- **Readiness**, checked without changing anything:
  - the task is DONE and verified, and no agent is working in the lane;
  - there are no conflicts with the main branch; the merge is computed in memory first;
  - your own uncommitted files in the main project stay untouched;
  - your Git setup is unchanged since the lane was created;
  - the checks that will run.
- **Changes**: the files the agent changed, each with a tick. YallaFlow's own records of the task are listed as one line.
  - **Files that look like secrets** (for example `.env`) are left out unless you tick them. That includes a file the agent already committed in the lane: it blocks the merge until you tick it, or until you remove it from the lane's commits yourself.
  - **A file you untick blocks the merge.** It would stay in the lane, where the checks run, so the checks would not see exactly what is merged. Tick it, move it out of the lane, or add it to `.gitignore`.
- **The plan**:
  1. commit in the lane;
  2. one merge commit made in memory;
  3. run the checks on that exact result;
  4. fast-forward the main branch;
  5. verify, integrate the project knowledge, record the integration, and commit YallaFlow's records.

Tick the confirmation and press **Approve & merge**. Your approval covers exactly what you reviewed. If anything changes before the merge (main moved, a file changed, the result or the checks differ), YallaFlow stops and asks you to review again.

**Checks.** The checks that run on the merged result are the project's declared merge checks:

```bash
yallaflow execution checks set --file checks.json   # [{ "name": "tests", "argv": ["npm", "test"] }]
```

Only the declared checks run. The review also lists the verification commands the lane's agent ran in its own session, in full, for your information. YallaFlow never runs them with your permissions.

**When Automated Merge is off.** YallaFlow never runs files the lane's agent controls with your permissions. Checks run in the lane on the merge commit, so the lane must hold exactly that commit: no uncommitted, untracked, hidden or ignored files. If the lane has ignored files, such as `node_modules/` or build output, Automated Merge is off for that task. The review says why and shows the steps to merge by hand: ordinary Git commands you run and check yourself. The same applies to a repository with filters, merge drivers or submodules, or on a platform that is not verified. Automated Merge stays fail-closed: it is available only when every required check can run safely, and a task is never shown MERGED & VERIFIED otherwise.

If your project has Git hooks or CI, declare the checks that must pass before a merge. YallaFlow does not assume the task's tests replace them, and blocks Review & Merge until checks are declared.

**Two separate states.** A task can be **DONE** while its changes are **not merged**. A lane shows **MERGED & VERIFIED** only after:

- the main branch moved to the tested merge commit;
- the post-merge checks passed;
- the project knowledge was integrated;
- the record `work/<id>/integration.yaml` was written.

That record travels with your project and states that CI was not run by YallaFlow. Its `approvedBy` is your Git `user.name`, as your commits show it: a label, not a verified identity.

**Conflicts.** YallaFlow never resolves a conflict. When a lane conflicts with the main branch (for example, another lane was merged first and changed the same lines), the review shows the files and offers **Send back to its agent**. The item is reopened, and the lane's agent is asked to bring the main branch into the lane, resolve the conflict keeping both changes, verify again and finish. Then you review and approve afresh.

**Failures and restarts.**
- A merge stops at the first problem and changes nothing more. It never resets, reverts or repairs anything. The card says what was done so far.
- If the console stops in the middle, the merge shows **interrupted** after a restart. **Continue merge** checks everything again and finishes without repeating a step.
- If the main branch already moved and a later step failed, the card shows **merged, not verified** and the command to undo the merge yourself.
- If Git itself was interrupted (for example the computer lost power during the fast-forward), YallaFlow stops and explains how to recover by hand. It never removes Git's lock files itself.
- Right before your main checkout moves, YallaFlow checks it again, including on Continue. It looks for staged changes, your edits to files the merge changes, hidden (skip-worktree) entries, and files at paths the merge adds, ignored ones included. Any of these stops the merge with your files untouched.
- If you edit one of YallaFlow's own files (`.yallaflow/…`) during a merge, the merge stops before it writes or commits anything of yours.

## Clean up

A merged lane stays on disk until you clean it up. **Clean up** appears after MERGED & VERIFIED. It is refused while:
- an agent works in the lane;
- the lane has uncommitted files;
- the lane's branch is not merged.

It shows exactly what will be deleted. Only reproducible dependency folders are allowed, such as `node_modules/` beside a `package.json` and a lockfile. Anything else ignored by Git, such as `.env`, blocks Clean up so it is never lost. So do files whose changes Git hides (skip-worktree or assume-unchanged). The lane is listed again immediately before it is removed: if anything appeared since you confirmed, nothing is deleted. The lane's YallaFlow records are copied into your project first. The branch stays.

## Approval wait

An agent's tool request waits for your answer for **5 minutes** by default, then it is **denied** (never approved on its own). In **Setup & run → Agents** you can choose 5, 15, 30 or 60 minutes for this project, for example for long queues. The setting lives in `.yallaflow/local/approval.json`, is personal to your checkout and is never committed.

## What YallaFlow never does

YallaFlow never pushes, pulls, fetches, rebases, resets, reverts, stashes, cleans, checks out, deletes branches, or force-updates anything. It commits and merges only after your explicit approval of the reviewed content. See [security](security.md#review--merge-and-git) for the exact Git operations.
