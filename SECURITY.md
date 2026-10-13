# Security Policy

## Reporting a vulnerability

Please do not open public issues for vulnerabilities that expose credentials, enable destructive actions, or bypass execution safety gates. Report them privately through GitHub's **Report a vulnerability** form on the repository's [Security tab](https://github.com/engmohamedamer/yallaflow/security).

## Supported versions

Security fixes are made on the latest 1.x release. Prerelease versions (`0.x-internal.N`) are not supported; upgrade to the latest 1.x from npm.

## Scope

YallaFlow should never store provider or tracker secrets in committed workspace files. Credential integration is intentionally deferred until a dedicated secrets model is implemented.

For what YallaFlow does and does not protect — local-only operation, untrusted-file handling, secret redaction, what `.yallaflow/` stores, and what is not enforced — see the [security and trust model](docs/security.md).
