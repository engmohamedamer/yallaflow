Developer decision (2026-10-20): approve the proposed Git hygiene fix.
- Keep qc.json and demo.json version-controlled as lightweight, durable project records.
- Exclude all generated QC/Demo runtime artifacts from Git by default, including media, screenshots, traces, report.md and report.html.
- Use the proposed quality/.gitignore approach, preserving the existing explicit opt-in to commit media.
- Existing tracked files must not be automatically deleted or untracked.
- Missing local media in another clone must be reported clearly, without making false claims about evidence availability.
- Preserve the integrity checks and backward compatibility; keep normal YallaFlow operations lightweight.
- Performance benchmarks accepted; keep doctor's full media integrity verification as implemented.
- Govern as a small bug fix, add regression tests, perform final release checks and independent review, create a local commit if everything passes. Do not tag, push or publish.
