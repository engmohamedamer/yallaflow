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
- **Idle work** (routed, not active, not waiting on anyone) is shown in a neutral style. Only a review gate, an open question, or failing verification is shown as needing attention.

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

## Agent Workspace (1.3.0, opt-in)

With `yallaflow console --agents`, a work item gets an **Agent** panel for working with Codex (managed sessions on your ChatGPT login). See [`agents.md`](agents.md).

## Security

- **Listening and requests.** The server listens on `127.0.0.1` only and requires the per-run token (401). It refuses a foreign `Host` (421) and a foreign `Origin` (403). Reads are `GET`/`HEAD`.
- **The only write: Create Work.** It accepts `POST` on exactly two routes: create a work item, and attach a file to the item that same request created. A write also needs:
  - the console's own `Origin` (a missing one is refused);
  - the exact content type (415);
  - a size limit: 64 KB of JSON, and 50 MB per file (413).
  `--read-only` answers every `POST` with 405.
- **No cross-site writes.** The token travels in an `Authorization` header, never a cookie, so another website can't send a request as you.
- **No shell.** Your text reaches YallaFlow as a single argument, never through a shell.
- **Uploaded files.** They are written to a private temporary folder (mode 0700), handed to `intake add`, and the folder is removed afterwards, even on failure.
- Data is addressed by ID only. No request path is resolved into the file system, and a source's preserved original is served only from inside its own source folder.
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

The console uses two machine-readable commands you can use too:

- `yallaflow snapshot --json` returns every work item with its stations, steps, state, completion, blocker, and next action. Schema: `yallaflow.snapshot/1`.
- `yallaflow work show <id> --json` returns one item's request, sources, checkpoints, history, questions, requirements, criteria with convergence, verification runs, knowledge review, and children. Schema: `yallaflow.work/1`.

Both print exactly one JSON document. A failure is `{"error":{"code","message"}}` with exit code 1. The JSON Schemas ship in `resources/schemas/`. Within a schema version, fields are only ever added.
