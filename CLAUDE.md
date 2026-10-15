<!-- yallaflow-bootstrap:begin provider=claude version=3 sha256=13e07908a0e7edd5ec51a17c7452e2b6b3780968ec5b10102a01645a60ad5e2a — managed by YallaFlow; keep your own instructions outside this block; update with `yallaflow agent refresh` -->
## YallaFlow

This repository uses YallaFlow: engineering governance and durable project memory for coding agents. This block only points to the YallaFlow contract; it does not restate it.

The canonical YallaFlow agent contract is imported here:

@.yallaflow/AGENT.md

At the start of every session — automatically, before handling the first request; the developer does not need to say "use YallaFlow":

1. Confirm `.yallaflow/` exists. If it does not, ignore this section.
2. Follow `.yallaflow/AGENT.md` — it is the only YallaFlow behavioral contract.
3. Run `yallaflow brief` for a read-only orientation and the next command to run, then handle the request.
4. For active or resumable work, run `yallaflow resume <work-id>` (or `yallaflow handoff <work-id>`).
5. Run `yallaflow guide <work-id>` for the current objective, blocker, and next valid action.
6. Before the first edit to source, tests, migrations, configuration, or any engineering artifact, even a small one: continue the active work item that covers the request or route one (`yallaflow start`), and edit only once `yallaflow guide` authorizes it. Small changes route as bounded work: no spec or plan review by default. Operational help needs no work item.
7. Follow the pinned Behavior Contract (`yallaflow skill <skill-id>`); never edit engineering artifacts while guidance says it is not authorized.
8. Record progress, decisions, and evidence only through `yallaflow` commands — never edit `.yallaflow/` structured state by hand.
9. Before saying a task is done, run `yallaflow finish <work-id>`. Tracking is never optional and never offered after the fact. Recover untracked edits as AGENT.md describes.
<!-- yallaflow-bootstrap:end -->
