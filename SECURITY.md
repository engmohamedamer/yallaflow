# Security Policy

Please do not open public issues for vulnerabilities that expose credentials, enable destructive actions, or bypass execution safety gates. Use the repository's private security reporting channel once a public repository is established.

YallaFlow should never store provider or tracker secrets in committed workspace files. Credential integration is intentionally deferred until a dedicated secrets model is implemented.

For what YallaFlow does and does not protect — local-only operation, untrusted-file handling, what `.yallaflow/` stores, and what is not enforced — see the [security and trust model](docs/security.md).
