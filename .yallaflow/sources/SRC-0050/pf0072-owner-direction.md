# Owner direction for PF-0072 (2026-11-08, agent session)

I choose Option 3: Both.

I want YallaFlow to understand how an existing project actually runs, not merely find Docker Compose files.

Start with safe, read-only discovery of the project and relevant parent workspace configuration. Then let the selected agent analyze the full development setup, including services, dependencies, ports, domains, startup order, and existing Docker or local runtime configuration.

Present a proposed runtime plan with evidence and confidence levels. Require my explicit review and trust confirmation before saving executable commands or starting any services.

Never execute discovered commands automatically, read secrets, or stop services not owned by YallaFlow.

The experience should be simple: **Analyze Project → Review Runtime Setup → Start Project**.

Also decided: a service that runs from outside the project folder (like ~/YaSchools/docker-compose.yml) is allowed only in the personal, git-ignored .yallaflow/local/runtime.yaml, never in the shared profile.
