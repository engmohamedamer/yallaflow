YallaFlow v1.1.0 final real-world acceptance (developer request, 2026-10-19):
1. Commit the implementation after reviewing the diff (no tag/push/release/publish).
2. Validate real video recording: check Playwright recording prerequisites, install missing development-only prerequisites if needed and safe (no mandatory YallaFlow dependency), run an actual Smart Demo with video against a safe local test application; verify the video physically exists, is playable, corresponds to the selected demo scenario, the local report links it correctly, and no credentials or sensitive data are exposed. A printed video path is not success.
3. Validate connected requirements with a real, publicly accessible GitHub Issue; test Azure DevOps or Jira only if authenticated access already exists; otherwise clearly distinguish simulated tests from live validation; do not request or expose credentials.
4. Review the documented QC/demo ID collision limitation: data loss or evidence overwrite? normal single-branch usage affected? safe backward-compatible fix feasible before release? Propose a fix if there is meaningful risk of losing evidence.
5. Final acceptance report: tests executed, evidence paths and results, remaining limitations, bugs discovered, READY / NOT READY recommendation.
Use YallaFlow governance for new fixes. Do not publish, push, or tag without explicit approval.
