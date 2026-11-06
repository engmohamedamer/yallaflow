# Owner clarification: subscription-based authentication is mandatory (2026-11-06, agent session)

Subscription-based authentication is a mandatory product requirement, not an optional feature. No API keys,
no separate API billing, no new AI provider account. Use existing, locally authenticated Claude Code and Codex
installations with their normal subscriptions.
1. Codex: verify interactive ACP/App Server integration using the existing ChatGPT subscription login.
2. Claude Code: investigate the compliant ways to interact with the official, unmodified Claude Code binary
   using the existing Claude subscription; evaluate Anthropic's current restrictions on third-party Agent SDK
   integrations; do not assume an ACP adapter is permitted merely because authentication succeeds.
3. Evaluate whether ACP still meets this requirement, or whether a native CLI-based, hybrid or other supported
   integration is better.
4. YallaFlow must never extract, copy, store or proxy subscription OAuth credentials to bypass provider
   restrictions; authentication stays owned by each provider's official tools.
5. Distinguish reusing the authenticated subscription from resuming/attaching to an existing conversation.
6. No silent fallback to API keys or API billing; if a path cannot work with a subscription in a supported,
   compliant way, mark it unsupported and propose alternatives.
7. Preserve the normal Claude Code and Codex experience: tools, permissions, skills, MCP, sessions, limits.
Update the research and recommendation. No production implementation, no paid experiments, no release changes.
Priority: genuine interactive agent sessions using the subscriptions developers already pay for.
