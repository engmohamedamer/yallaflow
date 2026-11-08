# Owner feedback on the PF-0072 specification (2026-11-08, agent session)

PF-0072 looks aligned with my goal: YallaFlow should understand how an existing project actually runs and help configure it from the Web Console.

I agree with the proposed architecture, but request three clarifications in the specification before final approval.

1. Separate Review/Save, Trust, and Start. Saving a discovered runtime plan must never implicitly authorize execution. Require explicit trust for the effective commands before starting services.

2. Protect shared infrastructure. Detect and clearly display shared dependencies such as MySQL and shared Docker Compose services. Never automatically stop or restart a service that may be used by another project. Show the affected service scope and require explicit confirmation when necessary.

3. Bind runtime trust to the effective configuration, including relevant Compose files and referenced project scripts where feasible. Material changes must invalidate previous trust. Avoid trusting a command name alone.

Also ensure scan limitations are visible: services, vhosts or dependencies outside the allowed discovery scope should remain unresolved rather than being reported as absent.

Preserve read-only discovery, explicit agent proposals, evidence and confidence levels, personal configuration for external paths, and the existing process-ownership protections.

Please revise PF-0072's specification, then present the updated specification gate for approval. Do not begin implementation before that approval.

Keep all changes local. No push, tag, release or npm publish.
