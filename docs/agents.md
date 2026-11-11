# Agent Workspace (1.3.0, opt-in)

The Agent Workspace lets you work with a coding agent from the YallaFlow console, next to the work item and its Flow.

You can:
- message the agent and see its replies;
- follow its activity;
- answer its tool-permission requests;
- watch YallaFlow's own state change as the agent records progress.

**It always uses the subscriptions you already have.** YallaFlow never asks for, stores, or uses API keys, and never touches your provider credentials. Each provider's own tool does the login.

| Agent | How YallaFlow connects | Status |
|---|---|---|
| **Codex** | YallaFlow starts and manages the session through the Codex ACP adapter, using your own Codex installation and **ChatGPT** login. | Supported |
| **Claude Code** | Experimental in 1.4.0, off by default: the console joins a Claude Code session you start yourself (development-channel flag and warning, no Stop, whole-message replies), on your own Claude subscription. Turned on per console run only by your explicit choice; Anthropic's written confirmation is still pending. See [`agents-claude-experimental.md`](agents-claude-experimental.md). | **Experimental** |

## Turn it on

```bash
yallaflow agents detect                          # what is installed and ready (read-only)
yallaflow console --agents                       # Agent Workspace with Codex
```

- **Read-only consoles.** `--agents` can't be combined with `--read-only`; a read-only console stays read-only.
- **The panel.** Open a work item. The **Agent** panel appears under the next-step card.

## Codex

**Requirements:**
- the Codex CLI (`codex`), logged in with your ChatGPT account (`codex login`);
- the Codex ACP adapter, version 2.x from 2.5.0.
  - YallaFlow finds it on `PATH`, or through `YALLAFLOW_CODEX_ACP`.
  - `YALLAFLOW_CODEX_BIN` selects a specific `codex`.

The console can install both for you: **Setup & run → Agents → On this machine**. It shows the exact command and waits for your approval, and it never uses sudo.

### Tested Codex versions

The console installs exact versions, never a range or "latest": the ones this YallaFlow release was tested with.

| Package | Version |
|---|---|
| `@openai/codex` | 0.167.0 |
| `@agentclientprotocol/codex-acp` | 2.5.0 |

The pins are `TESTED_CODEX` in `src/agents/detect.js`.
- **Before an install is offered,** the console checks that the pinned adapter is inside the supported range (`REQUIREMENTS.codexAcp`) and that your Node.js is supported. It also shows when the installed versions differ from the tested ones. Different versions are not blocked if they are in the supported range; they just aren't the tested pair.

**Updating the pins** (maintainers, before a release):
1. Install the candidate versions in a disposable environment: `npm install -g --prefix <tmp> @openai/codex@<v> @agentclientprotocol/codex-acp@<v>`.
2. Run the agent tests (`node --test test/agent-*.test.js test/console-machine.test.js`).
3. Run a real connection test with those binaries, using your own ChatGPT login: the console's **Test the connection** (handshake only, no session). If the release changes agent behaviour, also run a short real session.
4. Update `TESTED_CODEX` (versions and `testedAt`). If the adapter's major version changes, update `REQUIREMENTS.codexAcp` and the bridge first.
5. The test `tested Codex versions: exact pins …` fails if a pin is a range or falls outside `REQUIREMENTS`.

**In the panel:**
1. **Choose permissions and start.** Codex runs in the project folder. The options:
   - **Read-only:** every change asks first;
   - **Edits project files without asking:** Codex's workspace-write mode.
2. **Start Codex session.** YallaFlow checks that Codex reports a ChatGPT account login and refuses to start otherwise. API-key variables (`OPENAI_API_KEY`, `CODEX_API_KEY`) are removed from the adapter's environment, so nothing can fall back to API billing.
3. **Write a message.** Replies stream in, and tool activity shows as compact lines.
4. **Permission requests** show what Codex wants to run, with **Allow once**, **Allow for session** or **Deny**. Unanswered requests are **denied automatically** after 5 minutes (`YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS`), including when the browser is closed. A denial ends Codex's current turn.
   - **Allow for session** picks only the option Codex scopes to the running session, such as "don't ask again for this command in this session". It is offered only when Codex offers such an option.
   - Codex's persistent options are never chosen: rules for a command prefix, rules for a host in the future, or MCP "Always allow". **Deny** is always a one-time refusal, never a rule for the future.
   - YallaFlow stores no permission decision for reuse. A new or resumed session asks again.
5. **Session controls:**
   - **Stop** interrupts the current turn;
   - **End session** closes it;
   - **Earlier sessions** resume a session by its ID, also after the console restarts or after Codex crashes.
6. **Ending stops what Codex started.** The adapter runs in its own process group (macOS, Linux). Ending a session, a crash, and stopping the console end that group. On Linux, every process the adapter started is tracked as well, including ones outside the group. The console then checks what is still alive:
   - when everything is gone, the panel says **Session ended**;
   - when something could not be stopped, the panel and the console's terminal list the process IDs instead of reporting a clean stop.

YallaFlow never selects Codex's full-access mode.

## YallaFlow stays in charge of the work
- **Nothing activates work by itself.** **Make it active** in the panel is an explicit action that runs `yallaflow activate`.
- **Agents record progress through `yallaflow` commands**, as in the terminal, and the Flow updates live.
- **Agent chat is not verification evidence**, and an agent tool permission is not a YallaFlow review or approval gate. No console action approves a YallaFlow gate.
- **One managed agent session runs per checkout**, whatever the provider or work item. This also holds across consoles:
  - the first agent-enabled console on a checkout owns its agent sessions (`.yallaflow/local/agent-console.lock`);
  - a second console there shows that and starts nothing;
  - the checkout frees up when the first console stops, or when its process is gone.
- **Gates stay human decisions, by command.** An agent that may run shell commands could also run `yallaflow approve`. The Agent Contract forbids that, but the Agent Workspace does not add a technical lock against it, just as the terminal doesn't. Check the approval notes and the progress ledger.

## Queues, lanes and the approval wait (1.5.0)
- **Queue and Parallel** start sessions for you, one per task, with the same whole-job message as **Start**. Nothing else is automatic: a tool approval, a review gate, a question or a stop pauses that task until you act. See [`execution-modes.md`](execution-modes.md).
- **Usage limits** pause every queued task on that agent. The Agents tab shows when it can try again; you resume, or move the rest to the other agent.
- **Approval wait.** A tool request waits 5 minutes for your answer by default, then it is **denied**. **Setup → Agents** offers 5, 15, 30 or 60 minutes for this project, saved in `.yallaflow/local/approval.json` (git-ignored). A timeout never approves anything.
- **Lane sessions** work only inside their lane folder. Tool requests show paths relative to the lane.

## Choose the agents for a project
Open **Setup → Agents** in the console:
- **Detection:** it shows Codex and Claude Code on this machine (version, subscription login, problems), with **Rescan this machine**.
- **Saved choice:** what you tick (**Agents for this project**, **Also Claude Code (experimental)**) is saved for this project in `.yallaflow/local/agents.json` (git-ignored). It is applied whenever the console opens, with no flags and no restarts. It is never applied in `--read-only`.
- **Checklist:** with Claude Code on, it shows each connection step and how to fix it.
- **Chat picker:** when an agent is off or not ready for the project, the picker links here.

## When an agent stops in the middle of a work item
The work lives in the work item, not in the chat, so another agent can pick it up.
- **The chat says why the agent stopped:** it reached its subscription usage limit (with the time to try again when the provider gives one), stopped on an error, stopped unexpectedly, had its session ended, or Claude Code disconnected.
- **You choose how to continue:**
  - **Continue with Codex / Continue with Claude Code** ends or unlinks the old session first, then starts or connects the one you chose on the same work item. Only agents that are ready are offered, and the one that just hit its limit is not.
  - **Copy the continue message** to use in a terminal agent in the project folder.
  - Or wait and keep using the same agent once its limit resets.
- **Nothing happens on its own.** Switching needs your click, and the continue message (`Continue PF-…`, with the previous agent and why it stopped) is only prepared in the message box; you send it.
- **The item lists its agent sessions:** which agent worked on it, when, and how each session stopped. The stop reason is kept in the git-ignored session record, so it survives a console restart.

## What is stored
- **Kept locally:**
  - session link records (including how each session stopped) and your permission decisions, in `.yallaflow/local/agent-sessions/` (git-ignored);
  - the checkout lock `.yallaflow/local/agent-console.lock` (process identity only), present only while the console runs.
- **Never kept by YallaFlow:**
  - messages and transcripts, which stay with each provider's own history;
  - credentials of any kind.

## Security
- **Same guards as the console.** Loopback only, the per-run token, Host and Origin checks; every agent action also requires the console's Origin and JSON.
- **Local files.** Files under `.yallaflow/local/` are never written through a symbolic link.
  - **The threat:** a process that can write inside the checkout, such as an agent in workspace-write mode, plants a link to redirect a console write outside the checkout.
  - **Linux:** every write resolves its folders through opened handles that refuse links, so swapping a link in after the check doesn't work.
  - **macOS and Windows:** the folders are checked just before each write, which leaves a very short window.
  - **This is not isolation.** It doesn't protect against a process running as you outside the agent's sandbox, which can change these files directly.
- **Codex modes.** Codex sessions use only the modes the panel offers. If Codex switches itself to a full-access mode, YallaFlow ends the session.
- **Provider limits apply.** What an agent may do without asking is decided by the provider's own permission mode, which the console shows; YallaFlow cannot enforce more than the provider allows.
