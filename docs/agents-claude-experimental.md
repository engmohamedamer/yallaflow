# Claude Code connection (EXPERIMENTAL, 1.4.0)

**Included in 1.4.0 as an experiment, off by default.** Anthropic has not yet confirmed in writing that a third-party tool may distribute a channel like this; the request is drafted (research/agent-interaction/ANTHROPIC_REQUEST_DRAFT.md). Until then the connection stays experimental and is never turned on without your explicit choice.

**Files:** `src/agents/claude.js`, `src/agents/claude-files.js`, `src/agents/claude-detect.js`, `resources/agents/claude-channel.mjs`, `resources/agents/claude-hook.mjs` (and `test/agent-claude-experimental.test.js`). A build without them refuses with "not included in this release".

**Turn it on for a project, saved:**
- On the console's **Project → Settings → Agents**, tick **Agents for this project** and **Also Claude Code (experimental)**, then **Save for this project**.
- The choice is kept in `.yallaflow/local/agents.json` (git-ignored, this checkout only) and applied every time the console opens. It is never applied in `--read-only`.
- Unticking it closes that project's connection at once: a linked session is unlinked, open requests are denied, and the bridge file is removed.
- The checklist there shows each connection step and its fix.

**Or turn it on for one console run**, either way:
- in the console: open a work item's chat, press **Enable agents for this session**, and tick **Also allow Claude Code (experimental)** (it is unchecked by default and lists the limits below);
- or from the terminal: `yallaflow console --agents --experimental-claude`.

```bash
yallaflow agents detect                          # also reports Claude Code's version and login type
yallaflow agents claude-files                    # write the connection files from the CLI
```

When it is on, the chat's agent picker offers **Codex** and **Claude Code (experimental)**. Enabling it writes a connection file in `.yallaflow/local/` (ignored by Git) of each project open in the console.

## How it works

**Status and boundaries:**
- **Experimental and off by default.** Anthropic has not yet confirmed that a third-party tool may distribute a channel like this, and the request for written clarification is prepared but not sent.
- **No other path is used.** YallaFlow does not use the Claude Agent SDK, `claude -p`, or third-party ACP adapters with your subscription.

**Requirements:**
- Claude Code 2.1.234 or later, logged in with your **Claude account** (claude.ai subscription);
- on **Team/Enterprise** plans, an organization Owner decides whether Channels are on (the managed setting `channelsEnabled`; off by default). Without it, Claude Code drops messages from the console without any error. YallaFlow cannot read that setting and never changes it. Instead it checks each connection once (see *Connection check and Terminal mode* below) and works in Terminal mode when the check is not answered.

**Connecting:**
1. Turn it on (above), open a work item's chat, choose **Claude Code**, and press **Connect Claude Code**.
2. The panel shows one command. Run it yourself in the project folder:
   ```bash
   claude 'Run yallaflow brief, then wait for messages from the YallaFlow console.' --mcp-config .yallaflow/local/agent/claude-mcp.json --settings .yallaflow/local/agent/claude-settings.json --dangerously-load-development-channels server:yallaflow
   ```
   - The two files are git-ignored. They point Claude Code at YallaFlow's channel server and an observe-only hook script.
   - While the YallaFlow channel is not on Anthropic's channel allowlist, Claude Code shows a **development-channel warning**; the decision is yours.
   - `yallaflow agents claude-files` writes the same files from the CLI.
3. When Claude Code starts, the panel shows **Connected**.

**In use:**
- **Messages** go into your running Claude Code session. Claude replies through the channel, as whole messages rather than word by word. The terminal remains a complete client.
- **Permission prompts** appear in the console and in the terminal at the same time, and **Claude Code applies the first answer it receives.** If you deny in the console but approve in the terminal, the panel says the tool ran because it was answered in Claude Code; it never claims YallaFlow denied it. Unanswered prompts are denied by the console after the timeout.
- **Auto mode.** Claude Code's default **auto mode** approves most actions itself, so few permission prompts reach the console. The panel shows the mode, with a warning.
- **Bypass mode is never served.** If Claude Code runs with `bypassPermissions`, the panel warns and the console sends no messages until you change the mode in Claude Code.
- **Answered in the terminal.** A request you answer in Claude Code closes in the console as *Answered in Claude Code*. YallaFlow ties a request to the tool call that raised it and claims nothing when it cannot.
- **One channel per project.** A second channel connection is refused while one is attached. When the channel drops, its open requests are denied in the console.
- **No Stop or End in the console.** Stop and end the session in Claude Code (Esc, `/exit`). **Unlink** only disconnects it from YallaFlow.


## Security and local files
- **Channel and hooks.** They authenticate with a separate per-run bridge token, which never reaches the browser. Requests with a browser Origin are refused.
- **Nearest workspace only.** The channel and the hooks join only the console of the nearest YallaFlow workspace.
- **Bridge file.** `.yallaflow/local/agent-bridge.json` (mode 0600) exists only while the console runs. Only the console that owns the checkout (`agent-console.lock`) writes it.

## Limitations
- **Research preview.** Claude Code Channels is a research-preview feature. It connects only to sessions you start.
- **Development flag.** It needs the development-channel flag, and Claude Code shows a warning, until the channel is allowlisted.
- **Team and Enterprise** organizations must enable Channels.
- **Replies** arrive as whole messages.
- **No Stop from the console.** Claude Code can't be stopped from the console.
- **Auto mode.** In Claude Code's default auto mode, Claude Code approves most actions itself, so they never reach the console.
- **The connection check waits for the mode.** The console sends nothing, not even its connection check, until a hook has reported Claude Code's permission mode. Claude Code's `SessionStart` hook does not carry it, so the launch command starts Claude Code with a short first prompt (`Run yallaflow brief…`). That prompt reports the mode at once and orients the agent. It uses one small turn of your subscription per launch.
- **Ambiguous prompts.** When several calls of the same tool are waiting, a console request can't be tied to one of them. The console then claims nothing about where it was answered.


## Connection check and Terminal mode

An open connection does not prove that messages arrive: Claude Code never acknowledges a channel message, and drops them silently when the organization has channels off.

- **One check per connection.** When Claude Code connects and its permission mode is known, the console sends one message with a unique code. It asks for nothing except the acknowledgment: no commands, no file reads, no changes. The launch settings let the channel's own two tools (`reply`, `received`) run without a prompt. The check uses one small turn of your subscription.
- **Send appears only after the acknowledgment.** A matching code turns on sending from the console. No answer within 60 s (`YALLAFLOW_CLAUDE_PROBE_TIMEOUT_MS`) means *unverified*, not that a message was dropped; a late answer on the same connection still turns sending on. A new connection is checked again.
- **Terminal mode.** Until the check is answered, and whenever it is not, the chat's button is **Copy for terminal**: write the message in the console, copy it, paste it in Claude Code. The copied text ends with a short marker (`[yallaflow 1a2b3c4d]`) that ties Claude Code's work to that message. The console keeps showing the work through hooks; Terminal mode needs no channel, no API key and no extra subscription.
- **Each message has its own state.** *Sending*, *Received*, *Answered*, or *Delivery unconfirmed* (after 60 s, `YALLAFLOW_CLAUDE_DELIVERY_TIMEOUT_MS`). A state changes only on evidence that names that message. The console never sends a message twice; an unconfirmed message offers **Copy for terminal**, and Claude Code is told never to act on the same message id twice.
- **One session.** Hooks are accepted from one Claude Code session. A new session takes over after the old one ends (`SessionEnd`), or when it names the connection check or one of the console's messages.
