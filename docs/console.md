# The YallaFlow Console

`yallaflow console` opens a local web view of your projects. It shows where every work item stands in the flow, what waits for you, the evidence behind each delivery, and how the work is spread across your Git worktrees.

The console has **one action, Create Work**. Everything else is read-only: it never approves, answers, or runs commands for you, and never starts or controls an agent. You keep working through your coding agent and the CLI, and the console shows the result as soon as it is recorded. Start it with `--read-only` to turn Create Work off as well.

## Start it

```bash
cd your-project
yallaflow console
```

- The console serves `http://127.0.0.1:4747/` (or the next free port) and opens your browser.
- The printed link carries a private token for this run only. Without it, the console shows no project data.
- Press Ctrl-C to stop it. Nothing keeps running in the background.

| Option | Effect |
|---|---|
| `--port N` | Use port `N` (`0` picks a free one). |
| `--no-open` | Print the link without opening a browser. |
| `--project DIR` | Also show the workspace at `DIR`. Repeat it for more. |
| `--poll` | Check for changes every 2 s instead of watching files (for file systems where watching does not work). |
| `--read-only` | Turn Create Work off: the console only shows. |

## Your projects

The console always shows the project you start it from, plus any `--project` you pass. To keep a list of projects you always want to see:

```bash
yallaflow console add [DIR]     # the current directory if DIR is omitted
yallaflow console remove DIR
yallaflow console list
```

- **Where the list lives.** It is a user-level file, never inside a repository: `$XDG_CONFIG_HOME/yallaflow/console.json` (or `~/.config/…`; `%APPDATA%\yallaflow\…` on Windows), readable only by you (mode 0600). `YALLAFLOW_CONSOLE_CONFIG` points it elsewhere.
- **What it holds.** Folder paths only. Each project's state stays in its own `.yallaflow/`.
- **Missing folders.** A saved project whose folder is gone is listed as unavailable, never dropped silently.

## New project (1.4.0)

**All projects → New project** creates a new project in four steps: idea (name, description, requirements, attachments, location from a home-folder chooser), stack, environment (Docker, local tools or later; Git on by default) and review & create. **Create the project** is bound to the exact plan you reviewed; a plan that installs dependencies also asks for the project name. Progress, the log (collapsed) and failure recovery are shown on the page. When it finishes, the project is added to the console and its Overview opens. **All projects → Add an existing project** registers a folder that already has YallaFlow. The console starts without any saved project, so the first one can be created here. See [`new-project.md`](new-project.md).

## Setup: run your project (1.4.1)

**Setup** has two layouts. [Screens →](tour.md#part-3--set-the-project-up-once-then-just-press-start)

**Before any service is saved, it is a three-step guide.**
1. **Find how the project runs.** **Ask the agent** comes first and is recommended. It prepares a fixed, read-only request in the project chat, and nothing is sent until you press Send. The agent runs `yallaflow runtime analyze` itself, reads the real configuration (Compose files, vhosts, parent folders), and proposes the plan with `yallaflow runtime plan propose`. While you wait, the page shows *Waiting for the agent's proposal* and checks for it every few seconds. When it arrives, the page switches to it and preselects the new services that nothing blocks. **Quick scan** (`yallaflow runtime analyze`) is the fallback, and it becomes the main button when agents are off. A link then takes you to the Agents settings.
2. **Choose the services and save.** Each proposed service shows its command, folder, ports, dependencies, links, confidence, evidence and notes. Shared infrastructure, port conflicts and anything that blocks trust are shown too. Unresolved items are listed apart. **Save selected** writes untrusted definitions only.
3. **Review, trust, then start.**

**Once services are saved, Setup is the Run page.**
- **The run control is on top.** It shows one overall state (*running*, *partly running*, *stopped*, *a service failed*, or *not ready to start yet*), trusted and running counts, **▶ Start project**, **■ Stop project**, and **Open** links for the running apps.
- **One compact row per service.** Each row shows the state, the trust status, a Shared badge and its ports. An untrusted service offers **Review and trust**, and the review opens in the row. A trusted service offers Start, Restart and Stop. Every service has **Logs**. The exact definition is under *Definition* in each row.
- **Configuration is folded away below.** It holds finding and adding services, the other suggestions, adding a service yourself, the stack and the agents.
- Sections you open stay open while the page refreshes its state.

The safety rules do not change:
- A service runs only after you trust its exact command by typing its id.
- Opening the console starts nothing.
- Start project starts trusted services in dependency order.
- Stop project stops only what YallaFlow started and can still identify. It never stops shared infrastructure, which needs its own explicit confirmation (a ticked box).

See [`runtime.md`](runtime.md).

## Project Overview (1.4.0)

The **Overview** tab shows the project itself, read-only:

- **Project understanding.** Whether it is needed (an existing codebase without approved understanding), in progress, awaiting your review, established, or, for a new project, growing from your intent. It names the request to give your agent. Flow and Work show the same card until understanding is established. Viewing it never starts discovery, writes a draft or approves anything: approval stays your explicit decision through your agent or `yallaflow baseline approve`.
- **Purpose, architecture, stack, data and integrations** from approved project memory. Each fact shows its ID, confidence and freshness. "May be stale" means an evidence file changed, not that the fact is wrong.
- **Stack from repository evidence.** Frameworks, runtimes, package managers, lockfiles, Docker images and source languages. Each row shows the file it came from and its basis: *declared* (a file says so, which is not proof the code uses it), *detected* (a file is present) or *inferred* (counted, not read). `.env` files and compose `environment` values are never read.
- **Modules** by manifest folder. Several Node.js lockfiles in one module are flagged as a conflict.
- **Coverage.** How much of the repository the scan read, including whether it stopped at its limit, and which files could not be read.

For a new (Greenfield) project without approved memory, the Overview is a **setup checklist** instead: project created, goal, requirements, stack, development environment, Git, agent, and the first work item with its next step, each with the action that moves it on (open the first work item, configure runtime, initialize Git, enable Codex). Nothing missing there is an error; architecture, modules and memory appear once they are recorded with evidence.

Overview cards show three facts initially; **View more** expands the remaining facts returned for that area. Long facts have their own expandable preview. Paragraphs, lists and code are formatted, while confidence and freshness remain visible.

The same data is available as `yallaflow overview --json`.

## What you see

### The flow

YallaFlow groups every workflow's real stages into five stations: **Understand → Decide → Change → Verify → Remember**. Work enters through the **New** gate and leaves on the **Done** line.

- **Stations and %.** YallaFlow itself computes each item's station and completion %. The console never estimates them.
- **The formula.** Each station is 20%. The current station counts its finished steps, plus half of the step in progress.
- **Evidence counts, not checkpoint flags.** *Verify* (and therefore *Remember*) is finished only when:
  - there is a fresh successful verification run that is not older than the last reopen;
  - where convergence is required, the convergence assessment is still current.
- **Reopened work moves back.** A reopened or revised checkpoint brings its station back.
- **Nothing short of Done shows 100%.**
- **The overall percentage covers open recorded work only.** When all recorded work is done, the console says so ("All 12 recorded work items are done"). That is the work recorded in YallaFlow, not the whole software project. A project with no work yet shows a welcome instead of an empty board.
- **Work that is the agent's turn** (routed, not active, not waiting on anyone; in Arabic «دور الوكيل») is shown in a neutral style. Only a review gate, an open question, or failing verification is shown as needing attention.

Each station lists the real stage names inside it (for example `ROOT_CAUSE` inside *Decide*). The **bottleneck** marks the station where the most work waits on a person.

### The work-item page

- **The next step.** What happens next, from YallaFlow's own verdict, and whether it waits for you, for a fix, or for the agent.
- **The station chain.** Each finished station links to what it handed off (its checkpoint summaries and evidence).
- **Delivery.** The acceptance criteria with their convergence status and the verification runs cited as evidence, followed by the verification history.
- **Request, Attachments and Questions.**
  - Attachments open the preserved originals: images, PDF and text, plus the extracted text of other formats.
  - Previews are sandboxed.
- **For developers** (collapsed). The exact CLI commands for this item, in one place.

### Records YallaFlow cannot validate

If a work item's records fail YallaFlow's own validation, the project still opens. The item is listed in a collapsed **⚠ records YallaFlow cannot validate** panel with YallaFlow's exact message.

- **Not counted.** It is not counted as open, done or proven work, and the console never changes its records.
- **Diagnosis.** Run `yallaflow doctor` in the project folder. When the cause looks like a merge of two items that got the same ID on different branches, `doctor` says so and names the commits that added each side.
- **Three different errors.** The console tells apart:
  - **Offline:** the console itself is unreachable.
  - **Missing token:** the link lacks its token.
  - **Project data problem:** YallaFlow could not read a project's records.

### What needs you

The bell lists only the items YallaFlow reports as waiting for a person (a review gate or an open question) or failing verification. Each one links to its item. Browser notifications are optional; tick the box in the bell to enable them.

### Since you were away

When you come back to a project, a short summary lists what was recorded since your last visit: checkpoints, verification runs, rollbacks, and work reaching Done. Each line names the record it comes from. *Got it* marks the summary as read.

### Worktrees

The **Worktrees** page lists every Git worktree of the project. For each one it shows:

- its branch;
- the work item recorded as active there;
- its last recorded activity;
- its changed files.

It warns when the same file is changed in more than one worktree.

- **A worktree is a checkout, not an agent session.** The console cannot tell who, if anyone, is working in it, and does not claim to.
- **Git is read without writes.** The worktrees come from Git's own files, and changed files from `git --no-optional-locks status`. Reading them never touches `.git/index`.

To run several agents safely, give each one its own worktree and a different work item. See [Concurrency](#several-agents-and-the-workspace-lock).

### Insights

Only what YallaFlow records:

- work reaching Done per week;
- the median time from request to Done;
- the verification pass rate;
- open work by station.

YallaFlow does not record time per station or waiting time, so the console does not show them.

## Create work

**＋ Create work** in the top bar (or in the welcome of an empty project) opens one short form:

- **Project**, when the console shows more than one.
- **What do you need?** The requirement in your own words.
- **What kind of work?** *Let my agent decide* (the default) or feature, bug, change, investigation. When you pick a type, choose its size: *Small* (bounded), *Large* (architectural) or *Exploratory* (spike). Nothing is preselected, and YallaFlow itself says which combinations exist.
- **Files (optional).** A BRD or other requirement document: PDF, Word, Excel, PowerPoint, OpenDocument, RTF, Markdown or text, CSV/JSON/YAML, or an image (PNG, JPEG, GIF, WebP). Each file can be up to 50 MB, YallaFlow's own limit for a file it can still read as text.

You can also paste a screenshot with **Ctrl+V** inside the request form (or your platform's paste shortcut). Images appear as removable previews alongside selected files. Nothing uploads until you submit.

**Edit request** offers the same file picker and screenshot paste while the work is still editable: pending classification or untouched INTAKE. Existing sources and request history are preserved. If text saves but an attachment fails, the dialog says so and keeps the failed file for retry; a retry does not resave unchanged text or upload successful files again. Work that has started, is on hold, closed or done cannot receive attachments through this edit form. The server checks that condition again when it saves the file (`intake add --before-start`, under the workspace lock).

Agent replies support headings, lists, bold text, inline and fenced code, tables and HTTP(S) links. Raw HTML is shown as text, and embedded images are not loaded.

**What happens.**

- **Same commands as the CLI.** The console runs YallaFlow's own commands, exactly as an agent would: `start`, then `route` when you chose a type, then `intake add` for each file. The same validation, workspace lock and audit apply, and nothing else writes.
- **Unclassified requests.** If you left the type to your agent, the item waits in **New** until the agent classifies it.
- **After creating.** The item page opens with its real next step. Continue in Claude Code or Codex by asking your agent to *continue PF-0042*. No agent starts on its own.
- **Creating never activates.** A work item created in the console never becomes the checkout's active work item, even when nothing else is active. Creation and activation are separate actions (see [Active work](#active-work)).
- **Who created it.** The item records that it was created from the console by the local user, with the identity **not verified**. Attached files are recorded the same way.
- **What happened to each file.** After creating with files, the form lists every file with its result:
  - **text readable** (Markdown, text, CSV and similar);
  - **text extracted** (PDF and office documents);
  - **original kept, no text**: images and other preserve-only formats, or a document whose text could not be extracted, with the reason.
  The item's Attachments tab shows the same.
- **Safe to retry.**
  - The form sends one request ID. If the connection drops and you press Create again, you get the same item, not a second one.
  - If a file can't be attached, the item is still created and the form says which file failed and why. A busy workspace can be retried, and a file that is already attached is never added twice.
- **Brownfield projects.** In an existing codebase whose project understanding isn't approved yet, YallaFlow refuses new work and the form shows why. Your agent starts that understanding first.

Everything else still goes through the CLI or your agent. Approving a review, answering a question, or running a command never happens from the console. The next-step card names what is needed, and *For developers* holds the command.

## Active work

Each checkout has one **active work item**: the one `guide`, `status` and `brief` show when no ID is given. An agent can always work on any item by its ID.

- **Without `--keep-active`.** `yallaflow start` and the other create commands make the new item active, as before.
- **With `--keep-active -- <request>`** (what the console uses). The new item is never made active, whether or not another item is active. Its record says which item stayed active, if any.
- **Deferred items never take focus on their own.** Routing, advancing or checkpointing such an item leaves the active item unchanged.
- **Switching is explicit.** `yallaflow activate <id>` makes an item the active one and prints which item it replaced.

## Managing work (1.4.0)

Unless the console was started with `--read-only`, a work item's page has an action bar, and every card on the board has a **⋯** menu. Each action runs YallaFlow's own command, so every rule Core applies to the CLI applies here.

| Action | Same as |
|---|---|
| Make it active | `yallaflow activate <id>` |
| Advance | `yallaflow advance <id>` |
| Put on hold… / Resume | `yallaflow work hold <id> --reason …` / `yallaflow work resume <id>` |
| Close without delivery… | `yallaflow work close <id> --outcome … --reason … [--by …]` |
| Reopen… | `yallaflow reopen <id> [--to …] --reason …` (DONE work to a stage; closed work at its preserved stage) |
| Edit request… | `yallaflow request revise <id> --text … --reason …` (before work starts: unclassified or still in INTAKE with no checkpoint activity) |
| Answer… | `yallaflow question answer <id> --id Q-### --answer …` |

- **Blocked actions explain themselves.** When Core refuses, for example because a checkpoint is pending, the item is on hold, or a gate is waiting, the console shows Core's own reason and the next valid step. It never decides a move itself.
- **Edit request loads the full text.** Save the revised text with a reason, or cancel to leave it unchanged. Earlier versions and attachments are preserved; the classified title and workflow stay the same. If work starts while the editor is open, saving is refused.
- **The first hold or close** in a project shows Core's warning that the project will then require YallaFlow 1.4.0 or newer. It goes ahead only after you tick the confirmation.
- **Drag and drop on the Flow proposes a move.**
  - **On the next station:** the card runs **Move to the next stage**, one Core step, and Core may refuse with its reason. On the work item page this button is hidden while the current stage's work is not recorded yet; the line under the actions says why, in plain words (YallaFlow's blocker texts are shown in Arabic in the Arabic console). Moving the stage never makes the agent work: send the agent a message in the chat.
  - **On an earlier station (DONE work only):** Change, Verify or Remember offers **Reopen** to implementation, verification or review.
  - **Anywhere else:** the drop is not accepted. While you drag, the allowed stations are outlined and the others dimmed.

### Review-gate decisions (local user, identity not verified)

When a gate waits for review (for example the specification or the plan), the item page offers **Review and decide**.
- **What it shows first:**
  - the material the gate is about: the specification or plan text, design or discovery notes, and the requirements with their acceptance criteria;
  - the latest verification;
  - open questions and other warnings;
  - the gate's history.
- **Reading:** the material is shown as formatted text (headings, lists, criteria), with the template's headings in Arabic in the Arabic console, a contents row to jump between sections, and **Expand** for a full-screen view (remembered in this browser).
- **How you decide:** choose **Approve** or **Request changes** (or a quick note that fills the note and picks the decision), write a **mandatory note**, and tick **I reviewed the … and this is my decision**. The button stays disabled until both are done. The server still refuses a decision on material that changed after it was shown.
- **Recording:** YallaFlow's own `approve`/`feedback` command records it, with the provenance **`console, identity not verified`**: the console as the channel, the host, and your Git `user.name` as a *claimed* name.
- **CLI decisions are unchanged:** they are recorded exactly as before, without provenance. `yallaflow work show` prints the provenance of console decisions.
- **Refused, with nothing recorded,** when:
  - the gate was decided or re-requested since you opened the review;
  - its material changed since then;
  - you submit the same decision twice.
- **Not available here:** the project-understanding baseline and legacy reconciliation keep their own commands.

> **Limitation.** This is an explicit local-user decision, not a verified identity.
> - Anyone holding this console's per-run link on this machine can record a decision.
> - An agent that can run shell commands could still run `yallaflow approve` itself, as it always could. The Agent Contract forbids that.
> - The Agent Workspace and agents never reach console decisions.
> - YallaFlow never records a console decision as verified or authenticated.
> - **Changes outside the console.** The staleness check runs in the console's own write queue. A command run directly in a terminal at the same instant, or an edit to `work.md`, is not excluded in the moment between the check and the recording.
> - **What's stored.** A console decision stores the host name and your Git `user.name`. In a Shared Project, `reviews.yaml` is committed, so both reach Git history.

## Agent Workspace (1.3.0, opt-in)

With `yallaflow console --agents`, a work item gets an **Agent** panel for working with Codex (managed sessions on your ChatGPT login). The chat opens as a floating window from the corner button (its dot shows working, ready or waiting for your approval); each board card has a chat icon that opens the item with a "where is it" question in the box, and suggestions that fit the item's stage only fill the box. In a normal console started without the flag, the chat says the Agent Workspace is off and offers **Enable agents for this session** (with a confirmation): it lasts for this console run only, starts no session and activates no work item. The same dialog offers a separate, unchecked **Also allow Claude Code (experimental)**; see [`agents-claude-experimental.md`](agents-claude-experimental.md). A `--read-only` console never enables it. Activating a work item and starting a session stay two separate, explicit actions. See [`agents.md`](agents.md).

**Setup** is where a project gets running. It has three sections.
- **Stack:** what the project is built with, from repository files. Each entry has its file, `.env` files are never read, and **Rescan** says what changed since the last scan.
- **Run the project**, in four steps (PF-0072):
  1. **Analyze project.** A read-only scan of the project and up to 3 parent folders inside your home folder: the Docker stack that mounts the project, its services, ports and `*.localhost` domains, and what is running now. It never opens `.env` and runs nothing it finds. What was not scanned, and why, is listed, and what could not be inspected is **unresolved**. **Ask the agent to complete the plan** prepares a request in the project chat; you press Send, and the agent can only propose.
  2. **Review and save.** Each proposed service shows its command, folder, ports, links, confidence, evidence, conflicts and **Shared** scope. **Save selected** writes untrusted definitions; anything outside the project goes to your personal file only.
  3. **Trust each service.** **Review and trust** shows the effective configuration and the files the trust is bound to (and what it does not cover), then you tick «I reviewed the command and files above, and I trust this service». Anything blocking must be resolved first.
  4. **Start project / Stop project.**
     - Start project starts trusted services only.
     - A stack already running outside YallaFlow is left alone.
     - A busy port is reported with its owner.
     - **Stop project never stops shared services** (databases, a stack serving other projects); stopping one is a separate action with an explicit confirmation (a ticked box) that lists who else may be affected.
  - **Open** next to a running service opens its app (its `*.localhost` links, or its port) in a new tab. Other repository suggestions and **Add a service yourself** are folded below.
- **Agents:**
  - Codex and Claude Code on this machine (version, subscription login, problems), and the agents you choose for this project.
  - The choice is saved in `.yallaflow/local/agents.json` (git-ignored) and applied whenever the console opens. It is never applied in `--read-only`.
  - With Claude Code on, a checklist shows each connection step with its fix: launch files, channel, hooks, permission mode.

When you add an existing project for the first time, Setup opens as a short guide: scan the stack, choose services, choose agents. The scan and the steps you finished are kept in `.yallaflow/local/setup.json` (git-ignored). You can skip the guide, and it can be run again.

The corner chat button is on every project page (Overview, Flow, Work, Setup, Worktrees, Insights), and the page decides what the chat is about. On a work item page it is that item's chat. On the other pages it is the **project chat** ("Agent · Project"): its session is not tied to a work item, its suggestions are project questions (where the project stands, what is waiting for you, what is stuck), and the agent routes any change you ask for there to a work item first. There is still one agent session per checkout: a session running on a work item shows on project pages as a link to that item, and a project session shows on an item page labelled as the project chat. When an agent stops in the middle of a work item, the item's chat offers to continue with another agent (see [`agents.md`](agents.md#when-an-agent-stops-in-the-middle-of-a-work-item)).

**Letting the agent run.** The message the console prepares to start or continue a work item asks for the whole job: classify, understand, plan, implement, verify and finish, without stopping for status updates, and stop only for a decision only you can make. At the bottom of the chat there is one action for what is needed from you now: **Review and decide** when a review gate waits, **Answer the question** for an open question, **Continue** (it sends «Continue … to the end; stop only if you need a decision from me») when the agent stopped with nothing pending, and nothing while it works. Other suggestions are folded under **Other suggestions**, and consecutive agent steps show as one line that opens to the details. The console never sends Continue on its own.

**When the agent needs you on another page.** If the agent waits for your approval or your reply on a work item while you are on the Flow board or the work list, that item's card and line show it, and a call-out above the corner chat button (for example «PF-0004: the agent needs your approval») opens that item's chat. A new work item's card shows **Start**, which opens its chat with the whole-job message.

**Switching agents (one agent per project folder).** Only one agent session works in a checkout at a time. From the work item that needs the agent:
- an idle Codex session on another item shows **End the PF-x session and work here**: it ends that session (it stays under earlier sessions, to resume later) and shows the agent picker here; while Codex is working, the page says to wait;
- with Claude Code connected, **Use Codex for this item** explains that Claude Code must close first: type `/exit` in its terminal. As soon as it disconnects, the chat switches to Codex with a prepared first message. The console never just unlinks Claude Code for this, because Claude Code would keep running and could still edit files.

## Security

- **Listening and requests.** The server listens on `127.0.0.1` only and requires the per-run token (401). It refuses a foreign `Host` (421) and a foreign `Origin` (403). Reads are `GET`/`HEAD`.
- **Writes.** `POST` is accepted only on fixed routes: Create Work (and attaching a file to the item that request created), work-item actions and gate decisions, runtime trust/start/stop/restart and adding a service, the New Project Wizard (plan, create, attaching a planned file), registering a project, enabling agents for the run, and Git init. A write also needs:
  - the console's own `Origin` (a missing one is refused);
  - the exact content type (415);
  - a size limit: 64 KB of JSON, and 50 MB per file (413).
  `--read-only` answers every `POST` with 405.
- **No cross-site writes.** The token travels in an `Authorization` header, never a cookie, so another website can't send a request as you.
- **No shell.** Your text reaches YallaFlow as a single argument, never through a shell.
- **Uploaded files.** They are written to a private temporary folder (mode 0700), handed to `intake add`, and the folder is removed afterwards, even on failure.
- Data is addressed by ID only. No request path is resolved into the file system, and a source's preserved original is served only from inside its own source folder. The one exception is the folder chooser (`GET /api/fs/dirs`, not in `--read-only`): it lists directories inside your home folder only, never files, hidden folders or links that lead outside home.
- The page loads nothing from other origins. Scripts run under `script-src 'self'`, and previews are served with a sandbox policy and `nosniff`.
- The console reads through the same `yallaflow snapshot --json` and `work show --json` commands your agent uses, so it sees exactly what YallaFlow reports.

## Several agents and the workspace lock

From 1.2.0, every YallaFlow command that writes takes a short workspace lock (`.yallaflow/local/lock`). Two agents in the same checkout can therefore never interleave writes or get the same ID.

- **Who waits.** A command that finds the lock taken waits up to 60 s (`YALLAFLOW_LOCK_TIMEOUT_MS`), then stops without changing anything.
- **Who never waits.** Read commands, dry runs and the console never take the lock.
- **Exceptions.** `verify` takes it only to record a finished run. `intake ticket --fetch` takes it only after the network fetch.
- **Crashes.** A lock left by a process that is gone (it exited, crashed, or was replaced after a reboot or pid reuse) is removed by the next command. In a single-user workspace it never shows in `git status`.
- **Inspecting the lock.** `yallaflow doctor` reports it. `yallaflow doctor --clear-lock` removes a stale one, or an hour-old one whose holder cannot be identified. It never removes a lock held by a process positively identified as alive.

Still, the safest way to run several agents is one worktree per agent and one work item per agent. The **Worktrees** page then shows each checkout's recorded state, and warns when two of them change the same file.

## For scripts: the read contract

The console uses three machine-readable commands you can use too:

- `yallaflow snapshot --json` returns every work item with its stations, steps, state, completion, blocker, and next action. Schema: `yallaflow.snapshot/1`.
- `yallaflow overview --json` returns the project itself: understanding state, memory facts with freshness, the evidence-based stack, modules and coverage. Schema: `yallaflow.overview/1`.
- `yallaflow work show <id> --json` returns one item's request, sources, checkpoints, history, questions, requirements, criteria with convergence, verification runs, knowledge review, and children. Schema: `yallaflow.work/1`.

Both print exactly one JSON document. A failure is `{"error":{"code","message"}}` with exit code 1. The JSON Schemas ship in `resources/schemas/`. Within a schema version, fields are only ever added.
