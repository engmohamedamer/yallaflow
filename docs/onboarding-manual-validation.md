# Manual validation on real Windows and macOS (Phase 1 onboarding and the Windows Run Manager)

The full automated suite runs on Linux. Most Windows and macOS cases in it use **simulated** platform values: they show that the rules are written as intended, not that Windows or macOS behave that way. Since 1.5.5 a smaller **platform suite** (`npm run test:platform`) also runs on real Windows, macOS and Linux runners in CI, including a lifecycle test with real processes (start, recovery from the record, stop of a process tree, restart). It still does not cover the console in a browser, agent installs, sign-in or real projects: that is what this checklist is for.

**Do not describe Windows or macOS as supported until this checklist has been run on a real machine and its results recorded below.**

Run it once on Windows 11 and once on a current macOS. Use a normal user account, not an administrator shell.

## Before you start

1. Install Node.js 20.16 or later.
2. Install this build: the release candidate with `npm install -g yallaflow@next` (or a local build: in the repository run `npm pack`, then `npm install -g ./yallaflow-<version>.tgz`). Check with `yallaflow --version`.
3. Start from a clean state: no `%APPDATA%\yallaflow` (Windows) or `~/.config/yallaflow` (macOS).
4. Windows: a tool installed while the console runs should be found by **Recheck** without a restart (the console reads the current `Path` from the registry). If it is not, write that down, then restart the console from a **new** terminal. macOS: restart the console from a new terminal after installing a tool.

Write down for each step: **pass**, **fail** (with the exact message and a screenshot), or **not run** (with the reason).

## A. Start and first screen

| # | Step | Expected |
|---|---|---|
| A1 | Run `yallaflow console` in an empty folder. | The browser opens. The Projects page shows **Create**, **Manage** and **Monitor**. |
| A2 | Switch language and theme, then stop and restart the console. | Language and theme are remembered. |
| A3 | Open `preferences.json` beside `console.json`. | It holds only language, theme, usual agent, last folder, recent folders, the chat-saving choice and the first-run choice. No token, key or password. |

## B. Tools the wizard needs (the case that failed in the Windows trial)

Run B1 to B3 **without** PHP, Composer and Git installed.

| # | Step | Expected |
|---|---|---|
| B1 | Create → name `shop` → open **Advanced** in the stack step → **Laravel** → continue to **Review**. | A panel says Laravel needs tools that are missing, lists `php`, `composer`, `pdo_sqlite`, and shows guidance for **this** system. **Create the project** is disabled. |
| B2 | Open **Advanced** in that panel. | It says no override is possible because the generator itself is missing. |
| B3 | Press **Create an empty project instead**, then create. | The project is created with no tool needed. If Git is missing and Git was ticked, the Git step stops with a clear message and **Retry** works after Git is installed or unticked. |
| B4 | Install PHP and Composer by the shown guidance. Restart the console. Repeat B1 and press **Recheck**. | `php` and `composer` read as found. Record the versions shown. |
| B5 | If `pdo_sqlite` is still missing: enable it as shown, **Recheck**. | All three read as found and **Create the project** is enabled. |
| B6 | Create the Laravel project. | All steps finish. `artisan` exists in the new folder. **This is the step simulation cannot prove: Composer starting through its Windows shim.** |
| B7 | Create a **React + Vite** project from Advanced. | `npx` is found and the generator runs. |
| B8 | Windows only: install tools into a folder with a space or a non-Latin name and repeat B4. | Tools are still found. |

If B4, B6 or B7 fail, copy the last lines of the log shown on the page, and the output of `where composer` / `where npx` (Windows) or `which composer` / `which npx` (macOS).

## C. Agents

| # | Step | Expected |
|---|---|---|
| C1 | With no agent installed, open the first screen. | It says the agent needs setup and that Monitor does not need it. |
| C2 | Press **Set up the agent**. | Codex shows program, adapter, sign-in and connection as separate rows. On Windows a line says agent setup is not verified on Windows. |
| C3 | Follow the Codex install and sign-in steps (your ChatGPT subscription). | Each step waits for your approval. No API key is asked for. On Windows the review shows npm's folder as `C:\Users\<you>\AppData\Roaming\npm` (never a path containing `${APPDATA}` or `system32`), and the install runs **inside the console** without an administrator terminal. |
| C4 | Press **Test the connection**. | It answers with your ChatGPT account, or a plain reason. |
| C5 | Look at the Claude Code card. | **Experimental**; on Windows **Experimental · not verified on Windows**. Three rows. The connection row says it is checked only when a session starts. |
| C6 | In the wizard, choose an agent that is not ready and press **Review**. | It does not continue, and the setup card is shown in place. Ticking **Advanced → Continue without a ready agent** lets it continue. |
| C7 | Choose an agent for one project. Create a second project. | The agent is preselected and marked **your usual agent**. It is on for the second project only after you confirm. |
| C8 | Optional, Claude Code: connect a session and send one message. | Record whether Send works or the chat switches to Terminal mode. |

## D. Monitor only

Use a copy of a real YallaFlow project.

| # | Step | Expected |
|---|---|---|
| D1 | First screen → **Monitor a project** → choose the project → **Monitor only**. | It opens with a **Monitor only** banner. No agent setup is shown. |
| D2 | Before and after D1, compare the project folder (for example `git status --ignored` and the file list of `.yallaflow/local`). | Nothing was created or changed in the project. |
| D3 | Look for Create work, gate decisions, Run and the agent chat. | None can be used. |
| D4 | Choose a folder that has code but no `.yallaflow`. | The chooser explains that there is nothing to monitor yet. |
| D5 | **Switch to Manage…**, confirm. Then **Settings → Project → Switch to Monitor only…**, confirm. | Each switch asks first, and takes effect at once. |
| D6 | Open a second project normally while the first is monitored. | The second can be managed; the first stays monitored. |

## E. Resume

| # | Step | Expected |
|---|---|---|
| E1 | Fill the wizard to the Environment step, then reload the page. | Your choices are back, with a note that they were restored. |
| E2 | Start a Laravel creation and close the browser tab during **Generate**. Open the console again and go to New project. | The running creation is shown again and finishes. |
| E3 | Start a creation and stop the console (Ctrl+C) during it. Start the console again. | The page says the creation did not finish and offers **Continue the creation**. Continuing makes one project, not two. |

## F. Existing users

| # | Step | Expected |
|---|---|---|
| F1 | On a machine that already has `console.json` from 1.5.3, start this build. | All saved projects open as before, managed. |
| F2 | Open a project that already has `.yallaflow/local/agents.json`. | Its agent choice is unchanged. |
| F3 | Start an older console (1.5.3) once, then this build again. | Preferences are still there; a monitored project opened by the older console is managed there, and monitored again here. |

F3 matters: an older console does not know Monitor only, so **it treats a monitored project as managed**. Do not rely on Monitor only on a machine where older consoles are still used.

## W. Windows 11 first hour, end to end (Phase 1 and 1.1)

The journey that failed in the first real Windows trial (1.5.4). Use a **normal user account** and a **normal (not administrator) PowerShell**. Start with no Git, Codex or Claude Code installed. Keep Task Manager or a second PowerShell open for the process checks.

| # | Step | Expected |
|---|---|---|
| W1 | `npm install -g yallaflow@next`, then `yallaflow --version` and `yallaflow console` in an empty folder. | The version is the release candidate. The browser opens on Create, Manage and Monitor. |
| W2 | Create → choose **Codex** → its setup card → **Install Codex**, tick **I reviewed this command**, **Install**. | The command is `npm install -g @openai/codex@0.167.0 @agentclientprotocol/codex-acp@2.5.0`; the folder shown is under `AppData\Roaming\npm`. Output lines appear while it runs. When it ends, the CLI and adapter rows turn ✓ without a restart. If it fails, the last output lines are shown. |
| W3 | **Sign in with ChatGPT** → open the link, enter the code with your existing subscription. | The sign-in row turns ✓ "ChatGPT subscription". No API key is asked for. |
| W4 | **Test the connection**. | "Codex answered on your subscription". |
| W5 | In the wizard keep **Initialize Git** on. At Review, Git reads as not found. In another window run `winget install --id Git.Git -e` (it may ask for Windows' own permission prompt). Back in the console press **Recheck** — do not restart the console. | Git reads as found with its version. If it does not: record it, then check `where.exe git` in a new PowerShell. |
| W6 | Create the project: name `notebook`, description `simple notebook no login`, stack: empty project, environment: local. | All steps finish; the project opens with its first work item. |
| W7 | Start the first work item with Codex (**Run now**). | The chat shows the agent working; the task reads **Working**. |
| W8 | When the agent asks a question (for example where notes are stored), the chat reads **Waiting for your input — PF-0001**. Press **Answer the question**, choose browser-only storage, submit. | The toast says the answer was **delivered** and the agent works again; the task leaves "Needs you". The item's Verification tab says why there is no run yet (never a blank). |
| W9 | Let the agent build a small runnable app (for example a Vite or plain Node notebook). | The work item reaches verification and DONE with its evidence; the project folder has a runnable app. |
| W10 | Run tab → **Find services** (Analyze) → review the plan → save. | The development service is listed with its command (for example `npm run dev`) and port. The page is the normal Run page, not an "unsupported" page. |
| W11 | **Review and trust** the service, then **Start**. | It reads **running**; the port shows ●. No console window pops up. The log shows the dev server's output. |
| W12 | Open the app from **Open quickly**. | The app loads in the browser. |
| W13 | Under the running service the note says Stop ends it at once. Press **Stop**, then **Start**, then **Restart**. | Each finishes with the right state. After Stop the port no longer answers. |
| W14 | After the last Stop, check for orphans: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" \| Select-Object ProcessId,ParentProcessId,CommandLine` and `netstat -ano \| findstr :<port>`. | No `node.exe` of the service (npm, the dev server or esbuild) is left, and nothing listens on its port. Other node processes (the console itself) are untouched. |
| W15 | Start the service again. Stop the console with Ctrl+C, close its window, open a **new** PowerShell, run `yallaflow console`, open the Run tab. | The service still runs (the app still loads), the Run tab shows it **running**, and Stop ends it (repeat W14). |

Extra checks for W:

- **Second console.** With one console running, start another in a second window. Its terminal says that another YallaFlow console is still running on port 4747 and that the new one uses 4748. Both pages work; preferences and the unfinished New Project form are the same on both.
- **Identity safety.** While the service runs, end its process yourself in Task Manager, start any other program, then press Stop in the console. The console reports it as not running or unmanaged and **never ends a process it did not start**.
- **Compose.** In a project with a `docker-compose.yml` service, the card says Docker Compose is not started from YallaFlow on Windows yet and offers no Start or Stop; the other services work.

## Result

| System and version | Date | Who | A | B | C | D | E | F | W | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Windows 11 | | | | | | | | | | |
| macOS | | | | | | | | | n/a | |
