# Requirement Clarification

## Purpose

Resolve business or behavioral ambiguity that repository discovery cannot settle.

## Behavior

1. Start from established repository facts and the raw request.
2. Separate confirmed facts, working assumptions, and unresolved decisions.
3. Ask only questions whose answers materially affect behavior, scope, interfaces, or acceptance criteria.
4. Prefer a small number of precise questions over a broad questionnaire.
5. Record the resulting decisions in the work artifact.

Business clarification asks what the product/policy needs, not how the system implements it. For example, on a refund feature: who may issue a refund, whether it can be partial, what it means for a contract's lifecycle, and what appears in revenue are business questions. Whether a refund is stored as its own table versus an immutable signed ledger entry, the locking strategy, or the storage/event structure are architecture/design decisions for design exploration, not something to ask a developer about routinely — design from repository conventions instead, and raise it as a question only when it is genuinely a material, unresolved architectural choice.

## Material artifacts

If the requirement arrives with a material artifact (screenshot, mockup, spreadsheet, document), preserve it before relying on it: `yallaflow intake add <work-id> <file>` when you can access the file; otherwise record `yallaflow limitation add <work-id> --type uncaptured-artifact --area requirement --summary "<what it showed>" --reason "<why it could not be captured>"`. Only material artifacts — not every request needs one.

## Guard

This skill is read-only. Clarification does not authorize implementation.

## Result

Produce an explicit, testable understanding of the requested outcome and remaining decisions.
