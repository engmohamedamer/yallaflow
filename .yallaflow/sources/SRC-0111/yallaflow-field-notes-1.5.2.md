# YallaFlow 1.5.2 — field notes from a real zero-to-delivery run (console + Codex + Claude Code)

Source: a recorded run on 2026-11-13 for a DemaghAI channel video. A new Laravel project was created from the console's New project wizard, built by Codex from the console, handed over to Claude Code from the console after Codex hit its usage limit, run from the Run page, stopped and resumed. YallaFlow 1.5.2 (npm global), Ubuntu 24.04 (Wayland desktop, Chrome 156 in app/kiosk mode), console in Arabic, light theme. Codex 0.167.0 + codex-acp 2.5.0 (ChatGPT Plus), Claude Code 2.1.323 (claude.ai Team login). Screen recordings with timeline marks exist for every item below.

Severity: **bug** = wrong behaviour, **gap** = missing check or feedback that cost real time, **idea** = improvement.

## Bugs

### B1. Settings → Agents: the «Also Claude Code (experimental)» tick reverts by itself before Save
- Steps: Project → Settings → Agents. Tick «كمان Claude Code (تجريبي)». Wait about 2 seconds, then press «احفظ للمشروع ده».
- Observed: the tick clears itself within ~2 s (a live refresh re-renders the form from saved state). Pressing Save afterwards saves `"claude": false` in `.yallaflow/local/agents.json`. Two attempts failed this way on camera; it only saved when Save was pressed immediately after ticking.
- Expected: unsaved form edits survive live updates (1.5.2 already fixed this class for clicks/typing elsewhere: «Clicks, typing and scrolling survive live updates»).
- Note: the «Agents for this project (Codex)» tick probably has the same issue.

### B2. New project wizard: the advanced path field rejects `~/demo`
- Steps: New project → Idea → «اكتب المسار بنفسك (متقدم)» → type `~/demo` → Next.
- Observed: the wizard stays on step 1 and shows «اختار الفولدر اللي هيتعمل جواه المشروع». The absolute path `/home/<user>/demo` works.
- Expected: `~/…` works here like it does in the folder picker's path field (docs/console.md: «a path field (`~/…` works)»), or a clear message that `~` is not expanded.

## Gaps

### G1. Laravel readiness does not check the PHP extensions the generated project needs
- The wizard's Environment step checks `php`, `composer` and the versions. Laravel 13's generated `.env` uses SQLite, but this machine's PHP had no `pdo_sqlite`/`sqlite3` (only `pdo_mysql`).
- Result: the first implementation step failed with `could not find driver`; Codex asked for `sudo -n apt-get install -y php8.4-sqlite3` through a tool permission (denied — a system install is the developer's call), then built a temporary copy of the extension in `/tmp` to keep going. About 20 minutes and two developer interruptions were lost.
- Suggestion: for the Laravel stack, check `php -m` for the drivers the generated `.env` needs (`pdo_sqlite` by default) and show it in the readiness lines with the install hint, before the project is created.

### G2. Run page «Ask the agent» while the agent session is bound to a work item
- Steps: an agent session (Claude Code) is open on PF-0001 (DONE). Project → Run → «اطلب من الوكيل تجهيز التشغيل».
- Observed: the page shows «الوكيل يجهّز الاقتراح…»; the project chat panel shows only «فيه جلسة Claude Code شغّالة على PF-0001. جلسة واحدة بس في كل نسخة من المشروع.» with no sign that the request was delivered. The proposal did arrive after ~80 s.
- Suggestion: say where the request went («sent to the running Claude Code session on PF-0001») and show progress there, so the developer does not cancel or wait blindly.

### G3. A Codex permission request left the chat before it could be answered
- During implementation Codex asked to run `npm install --save-dev @playwright/test --fetch-retries=0 --fetch-timeout=20000`. About one minute later the request was no longer shown and nothing in the chat said whether it was denied, withdrawn or timed out (the approval wait is 5 minutes). Needs investigation; a closing line («withdrawn by the agent» / «expired») would remove the doubt.

## Ideas

### I1. Presentation mode for demos and screen sharing
- `YALLAFLOW_CONSOLE_CONFIG=<empty file>` worked well to hide the saved personal project list on camera. The console still shows absolute home paths (`/home/<user>/…`) in the New project review, the project settings and the folder picker.
- Idea: a `--present` flag (or setting) that shows `~/…` paths, hides the saved project list and other machine details.

### I2. Agent guidance: ask before system installs
- After the plan approval, Codex's first action was a `sudo` package install through a tool permission. The Agent Contract could say that system-level installs are the developer's decision: stop and ask in the chat with the exact command, instead of a tool request.

### I3. Language of agent-written text in the console
- The Run proposal's explanation and the delivery timeline summaries are written by the agent in English while the console is in Arabic. The fixed requests the console sends could ask the agent to answer in the console's language.

### I4. Usage-limit message
- Codex's usage-limit stop shows the provider's raw English upsell text («Upgrade to Pro…») inside the Arabic chat. The console's own line below it is good; the raw text could be folded.

### I5. Accessible names for icon-only buttons
- The agent chat's ⤢ / ⤡ / — / ✕ buttons have no accessible name, so screen readers and test automation cannot address them by role/name.

## What worked well (worth keeping)
- New project wizard end to end: Laravel 13.11.0 created and the first work item opened with the requirements file attached (text readable) in 21–30 s.
- Specification and plan gates: the agent stopped by itself and quoted the contract; «راجع وقرّر» shows the full material and records provenance (console, identity not verified).
- Agent handoff from the web: Codex hit its limit → «كمّل بـ Claude Code» opened Claude Code in a terminal by itself, the continue message was ready, and Claude Code finished the item from `yallaflow handoff` (20/20 criteria). This worked on a Claude **Team** login, despite the warning that messages may not arrive.
- Run page: proposal → «وافق وشغّل التطبيق» → running with the link, in under a minute; port 8000 conflict detected and 8001 proposed.
- The Flow card turns amber while the agent waits for permission and reaches Done at 100% only with fresh verification.
