// Usage text for `yallaflow runtime`, kept apart so the CLI can show it without loading the command (PF-0062).
export const RUNTIME_USAGE = [
  'yallaflow runtime list|status [--json]',
  'yallaflow runtime suggest [--json]',
  'yallaflow runtime add <id> --name NAME --kind process|docker-compose --cwd DIR [--port N]... [--env NAME]... [--ready-port N | --ready-log TEXT] [--stop-signal SIGTERM|SIGINT] [--depends-on ID]... [--local] -- <executable> [args...]',
  'yallaflow runtime add --from-suggestion <n|id> [--local]',
  'yallaflow runtime remove <id> [--local]',
  'yallaflow runtime trust <id> [--expect <definition-hash>]',
  'yallaflow runtime start|restart <id> [--json]',
  'yallaflow runtime stop <id>|--all [--json]',
  'yallaflow runtime logs <id> [--lines N] [--json]'
].join('\n  ');
