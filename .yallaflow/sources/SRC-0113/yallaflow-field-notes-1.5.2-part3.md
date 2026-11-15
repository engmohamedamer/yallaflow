# YallaFlow 1.5.2 — field notes, part 3 (developer review of the recording, 2026-11-14)

The developer (channel owner) watched the recorded run and flagged two console UX points on the Run page.

### U1. Run page: the primary button does not follow the project state
- When the project is running («المشروع شغّال», 1/1 running), «▶ شغّل المشروع» keeps the filled primary style and «■ وقّف المشروع» is the plain secondary one. The developer expected the opposite: the action that makes sense now should be the highlighted one (Stop while running), and Start should look inactive/disabled when everything already runs.
- Evidence: frame from the recording at the moment the app was running (Project → Run).

### U2. Run page after Stop
- After «وقّف المشروع», the page shows «المشروع متوقف» with the green filled «▶ شغّل المشروع» and a disabled-looking «وقّف المشروع». The developer said this part needs a UX review: state, colour and wording of the two buttons and the per-service row (شغّل / إعادة تشغيل / وقّف) read as three competing controls.
- Suggestion: one stateful control (Start ↔ Stop) for the project, the per-service buttons folded or secondary, and the state chip carrying the colour instead of the Start button.
