# AI QC

## Purpose

Run AI-assisted functional and exploratory testing of the delivered behavior with Playwright, and record honest, reproducible results. This is an on-demand skill. Use it only when the developer asks for QC.

The developer does not need to know any command. Requests such as "test this", "run QC", "check the booking flow in the browser", "make sure cancelling works", or "try to break the checkout" mean QC. A request to fix, build, or change something does not, and neither does finishing a task. Never start it because work was initialized, implemented, or completed, and never start a browser, a test server, or an install without that request. You can use it on any routed work item at any stage, DONE included. Using it never reroutes, reopens, or advances the work.

## Behavior

1. **Scope from intent.** Read the work's acceptance criteria: `yallaflow requirement list <work-id>`, or the parent's criteria for a decomposed child. Plan one functional scenario per criterion that has user-facing behavior. Add a few exploratory charters (three at most by default) aimed at the riskiest areas: edge cases, error paths, permissions, and data the change touches. Work without recorded criteria needs a rationale for each scenario. Mark scenarios `required` when they must pass under the strict policy. Functional scenarios are required by default.
2. **Record the plan before running anything:**

   ```bash
   yallaflow qc plan <work-id> --file plan.json
   ```

   ```json
   {
     "target": { "baseUrl": "http://localhost:3000" },
     "scenarios": [
       { "id": "S-01", "kind": "functional", "title": "Export downloads an ICS file", "criteria": ["AC-001"], "steps": ["Open /calendar", "Click Export"] },
       { "id": "S-02", "kind": "exploratory", "title": "Export with an empty term", "charter": "Probe empty and very large terms for errors." }
     ]
   }
   ```

   Add `"policy": "strict"` only when the developer asked for strict QC. `quality.qc.policy` in `.yallaflow/config.yaml` sets a project default. The default policy is advisory.
3. **Prepare the environment the developer agreed to.** Use a local or test environment with test or seeded data, never production data. Start the app only if the developer asked you to, or confirmed it. Authenticate with a Playwright storage-state file kept outside `.yallaflow` (`playwright-cli state-load <file>`). Never type real credentials into a recorded session.
4. **Execute with Playwright, not around it.**
   - Prefer the Playwright CLI (`playwright-cli`). It is cheaper in tokens than MCP page snapshots. Use the Playwright MCP server if that is what you have.
   - Capture evidence while you act: `playwright-cli screenshot`, `tracing-start` / `tracing-stop`, `console`, and `requests` for failures. Save the files to a temporary directory.
   - If the project already has Playwright tests that cover a scenario, run them through YallaFlow: `yallaflow verify <work-id> -- npx playwright test <spec>`. Then report that scenario with origin `yallaflow-verified` and its `verificationRun`.
   - Do not write a new test framework, and do not add dependencies unless the developer asks.
5. **Record what actually happened:**

   ```bash
   yallaflow qc record <work-id> --file result.json
   ```

   ```json
   {
     "tool": "playwright-cli",
     "origin": "agent-driven",
     "scenarios": [
       { "id": "S-01", "status": "passed", "steps": ["Opened /calendar", "Clicked Export", "Saw calendar.ics downloaded"], "expected": "An ICS file downloads", "artifacts": ["/tmp/qc/export.png"] },
       { "id": "S-02", "status": "failed", "steps": ["Selected an empty term", "Clicked Export"], "expected": "A clear message", "actual": "HTTP 500 and a blank page", "artifacts": ["/tmp/qc/trace.zip"] }
     ],
     "limitations": ["Safari was not tested."]
   }
   ```

   YallaFlow copies each artifact into `work/<id>/quality/media/` with its hash. That media stays local by default. It also regenerates `quality/report.md` and `quality/report.html`. A non-local `baseUrl` needs `--allow-remote`.
6. **Report honestly to the developer:**
   - what ran and against which environment;
   - each failure, with reproducible steps and the evidence file;
   - which criteria no scenario covered, and what you could not test (limitations).

   Under the advisory policy, failures are reported and never block completion. Under the strict policy, `yallaflow qc status <work-id>` shows whether quality approval is granted. Quality approval is separate from the task being done.

## Browser dialogs (confirm, alert, prompt)

A step can open a native dialog, such as "Cancel booking #7?". With `playwright-cli`, the click returns while the dialog is still open, and its output contains a `### Modal state` block naming the dialog. Until you answer it, every other command fails with `does not handle the modal state`. That includes snapshot, screenshot and eval.

- After every action that can open a dialog, read the output for `### Modal state`.
- Answer the dialog deliberately:
  - `playwright-cli dialog-accept` confirms (for a prompt, `dialog-accept "<text>"`).
  - `playwright-cli dialog-dismiss` takes the cancel path.
- Record the answer as a step, for example "Confirm dialog 'Cancel booking #7?' → dismissed".
- Then check the outcome on the page. Dismissing must leave the booking unchanged, and accepting must cancel it.
- To test both branches of a confirmation, run them as separate steps or scenarios.
- Never leave a dialog pending. Never treat a command that failed on the modal state as a test result.
- With Playwright MCP, use its dialog tool the same way.

## Honesty rules

- **passed:** only for a scenario you actually executed and observed. It needs the executed steps, plus an artifact or a passed YallaFlow verification run. A scenario you did not run is `not-run`, with a reason. One that could not run (environment down, missing data) is `blocked`, with a reason.
- **failed:** needs the observed actual behavior and steps that reproduce it.
- **Never cite a failed, blocked, or not-run scenario** as acceptance evidence. A convergence finding may cite `qc:QC-001#S-01` only to show that a passed scenario supports its criterion.
- **Do not overstate coverage.** QC covers the scenarios it ran, nothing more. Traces and screenshots can contain personal data or tokens. Keep them local, and say so if they might.

## Guard

QC observes and records. It does not authorize code changes. Fixing a failure is engineering work: route it, or continue the work item whose guidance authorizes it.
