# YallaFlow 1.5.2 — field notes, part 4 (2026-11-14)

### S1. A Claude Code session that no longer exists still blocks the checkout
- Yesterday's Claude Code process (linked to PF-0003) had exited. Today the console still showed «جلسة على PF-0003 · Claude Code · مستني Claude Code». On a new item, «استخدم Codex للشغلانة دي» waited for `/exit` in a terminal that no longer existed. Only «افصل من YallaFlow» cleared it.
- Suggestion: detect that the Claude Code side is gone (no hook heartbeat / channel closed) and release the checkout, or offer «Claude Code مش شغّال؟ افصله» right in that message.

### S2. A closed item sits on the New gate
- PF-0007 (closed without delivery, duplicate) is shown on the Flow board inside «جديد» with «مقفولة من غير تسليم». Closed work is neither new nor waiting; a separate collapsed «مقفولة» lane or a filter would keep the gate meaningful.

### S3. Permission requests are easy to miss from the board
- While following from the board, the only sign of a pending tool request was a small bubble at the bottom («الوكيل مستني إذنك»). The developer noticed it before the recorder did. The bell count stayed 0 (it counts review gates and questions only). Counting tool approvals in the bell, or a clearer banner, would help; browser notifications helped once turned on.
