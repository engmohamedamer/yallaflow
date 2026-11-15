# YallaFlow 1.5.2 — field notes, part 2 (queue, QA, close, second Codex limit)

Same run as part 1 (SRC-0111), later the same evening: phase 2 run as a Queue of three items, a QA item with AI QC, two fixes, a duplicate closed. Recordings with timeline marks exist.

## Bugs

### B3. Queue sheet: the chosen agent is not the one the queue starts with
- Steps: Workspace → List → «اختار لطابور» → select 3 items → «طابور من 3». In «الوكيل» click Codex (the radio shows Codex selected), tick «فاهم إن الوكيل هيشتغل عليهم بالترتيب ده», press «ابدأ الطابور» a few seconds later.
- Observed: the queue starts with Claude Code («في الطابور PF-0002 Claude Code … ابدأ PF-0002 في Claude Code واربطه من الشات»). «كمّل الباقي بـ Codex» moved it.
- Likely the same live-refresh form reset as B1 (Claude Code is the default in that sheet when it is enabled).

### B4. The board keeps a card «شغّال» after the agent stopped at its usage limit
- Codex stopped on PF-0003 at its ChatGPT usage limit (18:20, «try again at 10:49 PM»). For 35 minutes the Flow card still showed the item as running/active, no «مستنيك» count, no bell. Only the item chat said «Codex وقف بسبب خطأ». Docs say a usage limit pauses the queue and the Agents tab says when it can try again; that was not visible on the Workspace.

### B5. A finished item's still-connected Claude Code session blocks the queue's Codex start
- After PF-0001 was DONE, its Claude Code session stayed connected. The Codex queue did not start PF-0002; PF-0002's chat said Claude Code must be closed first and asked to type `/exit` in the Claude Code terminal. The console offers no way to end it (by design: no Stop for Claude Code), so an unattended queue stalls with no signal on the board.
- Suggestion: when a queue needs the checkout and the other agent's session is idle on a DONE item, say so on the queue row («waiting for Claude Code on PF-0001 to close») with the action to take.

## Gaps

### G4. «جاوب…» shows question IDs only
- The Answer dialog lists `Q-001`, `Q-002` in a select with no question text; the developer must read the questions elsewhere first.

### G5. QC results are not on the item page
- PF-0005 ran AI QC (6 scenarios, report.html with screenshots). The console item page shows the QC ids only inside the agent's checkpoint summaries; no QC section, no link to the report. It had to be opened as a local file.

### G6. First close: the minimum-version notice is raw CLI text
- «اقفلها من غير تسليم…» → the first close shows the English CLI message («Holding or closing work makes this project require YallaFlow >= 1.4.0 … run the same command again with --accept-minimum-version 1.4.0») inside the Arabic dialog, plus an Arabic tick. The tick is right; the CLI text («run the same command again») does not fit the console.

## Ideas

### I6. Agent-chosen titles replace the developer's words
- Items created in Arabic from «＋ شغل جديد» were retitled by the agents in English on routing («Feature work», «Monthly student and group attendance reports», «WhatsApp absence message draft for guardians»). «Feature work» says nothing. Keep the request's language for titles, or ask the agent to.

### I7. A finished item keeps «الوكيل شغّال عليها»
- PF-0003 was DONE (100%) while its card still said «الوكيل شغّال عليها» because the Claude Code session stayed linked.

## Worked well
- Queue: PF-0003 started by itself in a new session once PF-0002 was DONE; gates and questions paused it until answered in the console.
- «كمّل بـ Claude Code» after a Codex limit, twice; work resumed from YallaFlow state each time.
- AI QC by the agent: 6 scenarios with logs and screenshots, two real problems found and written down before any fix; the agent routed the fix as a new bug item by itself.
- «من آخر مرة كنت هنا» appeared after the queue finished items.
