// Usage text for `yallaflow history`, kept apart so the CLI can show it without loading the command (PF-0062).
export const HISTORY_USAGE = [
  'yallaflow history plan --label LABEL --from-ref REF [--from-dir CHECKOUT] [--out FILE] [--json]   (dry-run)',
  'yallaflow history import --plan FILE --confirm HASH-PREFIX [--from-dir CHECKOUT] [--allow-secrets]',
  'yallaflow history verify-merge --plan FILE   (after git merge --no-commit and the plan\'s restore commands)',
  'yallaflow history list [--json] | yallaflow history show LABEL[:ID] [--json]',
  'yallaflow history map LABEL:ID --to ID --relation reconfirms|supersedes|disputes|distinct|canonical-continuation --work WORK-ID --reason TEXT',
  'yallaflow history remove LABEL --confirm HASH-PREFIX [--force]   (rollback; only an intact, unreferenced lineage)'
].join('\n  ');
