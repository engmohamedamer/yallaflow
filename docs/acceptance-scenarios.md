# Acceptance Scenarios

These scenarios exercise YallaFlow's project-knowledge boundary. They are examples for tests and acceptance review, not runtime classifiers.

## Scenario A — OSS CORS Bug

Durable candidate:

```text
Kind: integration
Aliyun OSS CORS configuration is required for browser-fetched FilePond image previews.
```

Useful evidence may reference the filesystem configuration and the observed missing response header. Inspected files, failed commands, temporary hypotheses, and raw debug logs remain in work history and are not promoted.

## Scenario B — Contract Management System

Potential durable candidates:

```text
business-rule: Contracts support Gold and Silver packages.
business-rule: Payment logs may transition a contract to Paid.
architecture: Contracts expose QR-based authenticity verification.
```

The agent must propose each candidate explicitly with evidence. YallaFlow validates and routes the candidate to project memory; it does not infer these statements from request text.
