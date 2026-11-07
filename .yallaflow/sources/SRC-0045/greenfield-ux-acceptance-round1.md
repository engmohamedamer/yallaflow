# YallaFlow v1.4.0 — Greenfield UX Acceptance Fixes

(Owner's request, pasted into the agent session on 2026-11-07. Captured verbatim in section titles and requirements; see the work item for the full conversation context.)

We have completed the first manual UX acceptance round for **creating a new project** in YallaFlow 1.4.0. Implement the improvements below as one coherent user journey, then rebuild and update the local 1.4.0 installation for a second test. This is an implementation task.

## 1. Working scope and release rules
Work in /home/engamer/Amasi/YallaFlow on main (local 1.4.0). No new branch or worktree. Inspect Git status, uncommitted changes, stash and project state first; preserve unrelated files and historical evidence. Local commits allowed when verified. Do not push, tag, create a GitHub Release, or publish to npm. Do not modify the owner's existing project repositories or records; test with isolated disposable projects.

## 2. Product goal
The new-project experience works from the Web Console: Create or describe a project → Choose/confirm stack → Choose environment → Review → Create → Open the new project → Start working with an agent → Track progress. No manual CLI commands for a normal onboarding journey. Preserve canonical Core operations, governance, evidence integrity, explicit approvals and subscription-based agent authentication.

## 3. Smart Project Stepper (replaces the current form)
Fast manual route and guided route.
- Step 1 Project Idea: name; description; optional requirements, business context, features; optional attachments (BRD, Word, PDF, Markdown, diagrams, screenshots); location with a safe folder browser. Preserve intent and attachment provenance into the first work item.
- Step 2 Stack: manual selection from supported generators; optional recommendation through an available authenticated coding agent; show recommended stack, rationale, dependencies, trade-offs; manual override; never silently call AI APIs or incur API billing; if no interactive agent session is available, say so honestly and provide a manual path without a raw prompt as the primary interaction; separate full-stack, frontend-only and backend-only starters.
- Step 3 Development Environment: Docker, local tools, or later; explain practical effect; check tools without installing; generate or propose runtime configuration for the stack; explicit review/trust before executing services, installs or Docker; do not promise a runnable Docker environment unless setup files are created and validated.
- Step 4 Review & Create: friendly summary (project, purpose, location, stack, environment, requirements, attachments); generated files and commands in collapsible technical details; what will and won't be created; confirmation bound to the exact immutable plan, stale/changed plans rejected; no typed hash prefix for ordinary safe creation (explicit confirmation action); stronger confirmation retained for higher-risk operations; never overwrite existing files or repositories.

## 4. Folder browsing and project location
Folder chooser for the local Console: choose a parent folder for a new project; choose an existing project folder through the existing-project intake route; manual path entry as advanced alternative; show Git repositories, YallaFlow projects and empty directories where safely detectable; spaces and non-ASCII paths; safe against traversal, symlink escape, sensitive-file exposure and unexpected writes; no arbitrary filesystem browsing from Agent Workspace routes. Normal usage needs no typed absolute paths.

## 5. Post-creation behavior (critical)
1. Create and initialize through canonical YallaFlow operations. 2. Register the new project in the Console automatically, without duplicates. 3. Switch the selected project to it. 4. Open its Overview/onboarding. 5. Show its first work item and real next valid step. 6. Contextual actions: define requirements, configure runtime, start with an agent. 7. If registration or navigation fails after creation, report partial success accurately with a safe retry that never creates a duplicate. Never ask the user to run `yallaflow console add`.

## 6. First work item and onboarding
Short human-readable title; preserve full intent and requirements separately; prefer the user's goal over generic setup language; no fabricated acceptance criteria or architecture; clear onboarding/setup status; activation stays explicit; never auto-start the agent or services. For an empty project, help define requirements before showing empty delivery/verification sections.

## 7. Agent Workspace integration
Clearly show when managed agents are disabled, unavailable or not configured; a clear path to enable supported local agent interaction respecting the explicit opt-in policy; once enabled, open the current work item in the unified Agent Workspace; Codex through the user's authenticated subscription and installed adapter; preserve Claude Code's supported/experimental boundaries (do not enable the excluded integration or invent controls); never require API keys or switch to API billing; never auto-activate work or start a session; do not expose broad agent execution just because the normal read-only Console was opened. The primary experience is not "copy this command and open a terminal" when a supported managed agent is available.

## 8. Project Overview for new projects
Setup checklist and next action; project goal and initial requirements; stack and environment as configured/planned/pending; first work item and status; what was created and what remains; distinguish new projects from existing repositories needing discovery; absence of code or memory is not a failure; progressively reveal architecture/modules/memory when grounded. Keep the evidence-based Overview for brownfield.

## 9. Flow and Work Item UX
Prominent next valid action; concise titles; explain empty workflow columns; Request/Next Step before an empty Delivery tab for unclassified work; discoverable Start/Connect with Agent; explain activation vs agent session; Core gates respected, drag-and-drop never bypasses them.

## 10. Runtime Setup screen
Guided UI instead of CLI commands: detect/propose commands with evidence and review; service name, working directory, command, ports, environment; integrate trust, Start, Stop, Restart, Status, Logs; respect the shared runtime-profile and local-override model; never run inferred commands without explicit confirmation; Docker and local handled; helpful empty state with Configure. Do not silently change runtime security guarantees.

## 11. Git initialization and Worktrees
Offer "Initialize Git repository" during creation (sensible default, choice always shown); explain init vs connecting a remote; guided safe Git Init for an existing new project without Git; never create remotes, commit, push or publish; useful Worktrees empty state without Git.

## 12. Insights empty states
Include New/unclassified work in the station breakdown or show it separately; "No verification runs yet" instead of 0% for 0/0; hide or replace empty charts with helpful descriptions; never invent metrics; stay consistent with canonical records.

## 13. Technical UX cleanup
Quote displayed commands for paths with spaces, quotes or Unicode; no generator wording ("rename generated folder") for an empty project; implementation commands in collapsed Technical details; keep Arabic/English, light/dark, desktop/mobile; accessible keyboard navigation and clear errors; no unrelated dashboards or duplicate workflow engines.

## 14. Implementation approach
First map findings to existing capabilities: confirmed bugs, missing UX wiring, genuine Core/API gaps, optional future improvements. Implement with the smallest maintainable changes. Do not change established security or governance decisions without explicit owner approval. Use the specification, change-control and verification workflow. This message authorizes the defined Greenfield UX remediation scope but not fabricated approvals of new specification or plan gates. If a new high-impact security or architecture decision needs approval, leave it pending and continue independent authorized work.

## 15. Verification
Using the installed local package: empty and generated project; path with spaces and Unicode; requirements and attachments; manual and agent-assisted stack; Docker, local and later; registration and automatic selection; Console and browser restart; Overview and first-work experience; Codex enabled vs disabled; runtime configuration without unauthorized execution; Git init; Insights without verification; failed and retried creation without duplicates; existing-project behavior and CLI backward compatibility; security, permission and path-boundary regression tests. Browser checks in Chromium, Firefox, WebKit; desktop/mobile; Arabic/English; light/dark. Full suite, plus an independent security/code review of every new write-capable endpoint.

## 16. Local delivery
Update and install the local 1.4.0 build (published npm untouched); report CLI version, source commit and package checksum; launch or document launching the Console; concise changelog of UX fixes; remaining blockers and deferred features. Local commits on main only. No push, tag, GitHub Release, npm publish or deployment. After owner approval of the Greenfield UX: Brownfield review, then publish 1.4.0 once.
