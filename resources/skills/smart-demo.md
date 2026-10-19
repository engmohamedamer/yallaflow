# Smart Demo

## Purpose

Show what was delivered, through the few scenarios that matter, to the audience that needs to see them. Recording is optional. This is an on-demand skill: use it only when the developer asks for a demo, on any routed work item at any stage (DONE included). It is independent of QC: a demo needs no QC records, and QC needs no demo.

The developer does not need to know any command. Requests such as "prepare a demo", "record a video of the new booking flow", "show the client how cancelling works", or "make a walkthrough for the team" mean Smart Demo. Never start one because work was finished or a QC run passed. A demo is not testing. It shows selected scenarios working once, as recorded, and proves neither correctness nor coverage.

## Behavior

1. **Understand what changed:** the diff or the work's implementation notes, and its acceptance criteria (`yallaflow requirement list <work-id>`, or the parent's for a decomposed child).
2. **Select and prioritize.** Choose the user-facing scenarios worth showing: the main workflow, the business rules the change enforces, and important states such as validation, permissions, and empty or error states. Do not record every screen. Give each scenario an audience: `business` for the outcome and the rule, in plain language; `developer` for the flow, edge cases, and where it lives. Give it a priority (1 = most important) and a rationale. List what you deliberately left out under `excluded`, with reasons. Use separate scenarios, or separate demo runs, for separate features.
3. **Propose the scope:**

   ```bash
   yallaflow demo propose <work-id> --file scope.json
   ```

   ```json
   {
     "target": { "baseUrl": "http://localhost:3000" },
     "scenarios": [
       { "id": "D-01", "title": "Manager approves a large refund", "audience": "business", "priority": 1, "criteria": ["AC-002"], "rationale": "The new approval rule is the business change.", "steps": ["Sign in as the test manager", "Open refund #1001", "Approve"], "record": true, "data": "Seeded refund #1001 (test data)" }
     ],
     "excluded": [{ "title": "Settings page", "reason": "Unchanged by this work." }]
   }
   ```

4. **Ask the developer to approve or change it.** Present the scenarios in priority order: what each shows, for whom, and whether it will be recorded. If they change it, propose again. Record their approval only after they explicitly approve, in their own words: `yallaflow demo approve <work-id> --note "Approved by <who> in the agent session: <their words>"`. Add `--only D-01,D-03` when they approve only some scenarios. Never approve on their behalf, and never infer approval from silence or a general "ok". Recording against an unapproved or changed proposal is refused.
5. **Run it with Playwright.** Use a local or test environment and test or seeded data only. Authenticate from a storage-state file kept outside `.yallaflow` (`playwright-cli state-load <file>`), so no credential is typed on camera. Hide or avoid personal data, tokens, and production records. Record only when the developer wants a video:
   - `playwright-cli video-start /tmp/demo/demo.webm`
   - optionally `playwright-cli video-show-actions`
   - `playwright-cli video-chapter "D-01 Manager approves a large refund"` before each scenario
   - perform the steps
   - `playwright-cli video-stop`

   Screenshots are optional (`playwright-cli screenshot`).

   Playwright needs its ffmpeg to record video (`npx playwright install ffmpeg`). Install it only with the developer's agreement. Before you record a video, confirm that the file actually exists: a recorder can print a video link even when recording failed. If there is no video, record the demo without one and say so in `limitations`.
6. **Record what was actually shown:**

   ```bash
   yallaflow demo record <work-id> --file result.json
   ```

   ```json
   {
     "tool": "playwright-cli",
     "audience": "business",
     "video": "/tmp/demo/demo.webm",
     "scenarios": [{ "id": "D-01", "status": "shown", "artifacts": ["/tmp/demo/approved.png"] }],
     "limitations": ["Email notification not shown: no mail server in the test environment."]
   }
   ```

   Use `skipped` or `failed`, with notes, for anything that did not go as proposed. A non-local `baseUrl` needs `--allow-remote`. YallaFlow stores the media locally with hashes (it stays out of Git by default) and regenerates `quality/report.md` and `quality/report.html` with links to the recordings.
7. **Give the developer the demo summary:** each scenario shown, links to the recording and screenshots, what was skipped or failed and why, and the reminder that a demo is not test evidence.

## Browser dialogs (confirm, alert, prompt)

A step can open a native dialog, such as "Cancel booking #7?". With `playwright-cli`, the click returns while the dialog is still open, and its output contains a `### Modal state` block naming the dialog. Until you answer it, every other command fails with `does not handle the modal state`. That includes snapshot, screenshot and eval.

- After every action that can open a dialog, read the output for `### Modal state`.
- Answer the dialog deliberately:
  - `playwright-cli dialog-accept` confirms (for a prompt, `dialog-accept "<text>"`).
  - `playwright-cli dialog-dismiss` takes the cancel path.
- Record the answer as a step, for example "Confirm dialog 'Cancel booking #7?' → dismissed".
- Then check the outcome on the page. Dismissing must leave the booking unchanged, and accepting must cancel it.
- In a demo, show the path the approved scenario describes. Add a `video-chapter` before the dialog step, so the recording explains what was chosen.
- Never leave a dialog pending. Never treat a command that failed on the modal state as a test result.
- With Playwright MCP, use its dialog tool the same way.

## Guard

A demo never stands in for verification or QC, and demo records cannot be cited as acceptance evidence. Demonstrating does not authorize code changes. If the demo reveals a defect, report it and route the fix.
