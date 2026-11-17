// The line of a service's log that explains why it stopped (PF-0166). A stack trace ends
// with frames and Node's own footer; the cause is usually stated earlier. This picks that
// line from already-redacted log lines, and says what kind of failure it is when it can.
// It reads text only: nothing here decides to run or change anything.
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const clean = (line) => String(line ?? '').replace(ANSI, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();

// Most specific first. `kind` is a stable key the console words in the reader's language.
const PATTERNS = Object.freeze([
  { kind: 'missing-module', test: /Cannot find (?:module|package) ['"]([^'"]+)['"]/i },
  { kind: 'missing-module', test: /Module not found: (?:Error: )?Can't resolve ['"]([^'"]+)['"]/i },
  { kind: 'port-in-use', test: /EADDRINUSE[^0-9]*(?:[\d.:]*?:)?(\d{2,5})\b/ },
  { kind: 'port-in-use', test: /[Pp]ort (\d{2,5}) is already in use/ },
  { kind: 'command-not-found', test: /(?:^|: )([A-Za-z0-9._/-]+): (?:command )?not found\b/ },
  { kind: 'command-not-found', test: /'([^']+)' is not recognized as an internal or external command/ },
  { kind: 'command-not-found', test: /spawn (\S+) ENOENT/ },
  { kind: 'missing-script', test: /Missing script: ["']?([^"'\s]+)["']?/i },
  { kind: 'missing-file', test: /ENOENT: no such file or directory,? (?:open|stat|scandir|lstat) ['"]([^'"]+)['"]/ },
  { kind: 'permission', test: /EACCES: permission denied,? ?\w* ?['"]?([^'"\s]*)['"]?/ },
  { kind: 'out-of-memory', test: /JavaScript heap out of memory|Killed process|\bOOM\b/ },
  { kind: 'syntax', test: /^(SyntaxError: .+)$/ },
  { kind: 'error', test: /^((?:[A-Z][A-Za-z]*)?Error(?: \[[A-Z_]+\])?: .+)$/ },
  { kind: 'error', test: /^(?:npm ERR!|error|ERROR|Error)[: ]\s*(.+)$/ },
  { kind: 'error', test: /^(Fatal error: .+|PHP (?:Fatal|Parse) error: .+)$/ }
]);

// A missing module that is a project file (a path) is a wrong path; a package name is a
// dependency that is not installed.
function moduleKind(name) {
  if (/^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(name)) return /[\\/]node_modules[\\/]/.test(name) ? 'dependency' : 'project-file';
  return name.startsWith('node:') ? 'project-file' : 'dependency';
}

// lines: the service's log lines since its last start (already redacted), oldest first.
// → { line, kind, detail?, module? } or null when nothing explains the failure.
export function diagnoseLog(lines) {
  const cleaned = lines.map(clean);
  for (const pattern of PATTERNS) {
    // The first line that states this cause: later lines are usually its trace or a repeat.
    const index = cleaned.findIndex((line) => line && pattern.test.test(line));
    if (index === -1) continue;
    const match = pattern.test.exec(cleaned[index]);
    const found = { line: cleaned[index].slice(0, 400), kind: pattern.kind, ...(match?.[1] ? { detail: match[1].slice(0, 300) } : {}) };
    if (pattern.kind === 'missing-module' && match?.[1]) found.module = moduleKind(match[1]);
    return found;
  }
  return null;
}

// The lines written since YallaFlow's last start marker for this service.
export function sinceLastStart(lines) {
  let from = 0;
  for (let index = lines.length - 1; index >= 0; index--) if (/^--- yallaflow runtime: starting /.test(lines[index])) { from = index + 1; break; }
  return lines.slice(from);
}
