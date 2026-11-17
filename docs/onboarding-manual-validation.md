# Manual validation on real Windows and macOS (Phase 1 onboarding)

The automated tests run on Linux. Every Windows and macOS case in them uses **simulated** platform values. They show that the rules are written as intended; they do not show that Windows or macOS behave that way.

**Do not describe Windows or macOS as supported until this checklist has been run on a real machine and its results recorded below.**

Run it once on Windows 11 and once on a current macOS. Use a normal user account, not an administrator shell.

## Before you start

1. Install Node.js 20.16 or later.
2. Install this build: in the repository run `npm pack`, then `npm install -g ./yallaflow-<version>.tgz` on the test machine.
3. Start from a clean state: no `%APPDATA%\yallaflow` (Windows) or `~/.config/yallaflow` (macOS).
4. Keep a terminal open to restart the console after you install a tool. A running console keeps its old `PATH`.

Write down for each step: **pass**, **fail** (with the exact message and a screenshot), or **not run** (with the reason).

## A. Start and first screen

| # | Step | Expected |
|---|---|---|
| A1 | Run `yallaflow console` in an empty folder. | The browser opens. The Projects page shows **Create**, **Manage** and **Monitor**. |
| A2 | Switch language and theme, then stop and restart the console. | Language and theme are remembered. |
| A3 | Open `preferences.json` beside `console.json`. | It holds only language, theme, usual agent, last folder and the first-run choice. No token, key or password. |

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
| C3 | Follow the Codex install and sign-in steps (your ChatGPT subscription). | Each step waits for your approval. No API key is asked for. |
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

## Result

| System and version | Date | Who | A | B | C | D | E | F | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Windows 11 | | | | | | | | | |
| macOS | | | | | | | | | |
