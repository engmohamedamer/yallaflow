// Usage text for `yallaflow new`, kept apart so the CLI can show it without loading the command (PF-0062).
export const NEW_USAGE = [
  'yallaflow new catalog [--json]',
  'yallaflow new recommend',
  'yallaflow new plan --name NAME --parent DIR --stack ID [--install] [--allow-nested] [--rationale TEXT] [--description TEXT] [--requirements TEXT] [--environment docker|local|later] [--git] [--custom-stack TEXT (with --stack empty)] [--attachment SHA256:SIZE:NAME]... [--json]',
  'yallaflow new show <plan-id> [--json] | yallaflow new list [--json]',
  'yallaflow new create <plan-id> --confirm <hash-prefix> [--json]',
  'yallaflow new discard <plan-id> [--json]'
].join('\n  ');
