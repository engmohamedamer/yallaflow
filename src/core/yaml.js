import { readText, writeTextAtomic } from '../utils/fs.js';
import { redactDeep } from '../security/redact.js';

// JSON is valid YAML 1.2. v0.1 deliberately writes JSON-compatible YAML so the
// foundation remains zero-dependency while keeping the public *.yaml contract.
export async function readYaml(file) {
  return JSON.parse(await readText(file));
}

// Every structured YallaFlow state file is written here, so this is where secret
// values are kept out of durable state (v0.3.10-internal.4, src/security/redact.js).
// v1.2.0: atomic (temp file + rename), so a concurrent reader — another agent's CLI or
// the Console — never parses a half-written state file.
export async function writeYaml(file, value) {
  await writeTextAtomic(file, `${JSON.stringify(redactDeep(value), null, 2)}\n`);
}

// Kept for existing callers: since v1.2.0 every structured write is atomic.
export const writeYamlAtomic = writeYaml;
