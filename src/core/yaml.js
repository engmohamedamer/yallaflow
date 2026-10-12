import { readText, writeText, writeTextAtomic } from '../utils/fs.js';
import { redactDeep } from '../security/redact.js';

// JSON is valid YAML 1.2. v0.1 deliberately writes JSON-compatible YAML so the
// foundation remains zero-dependency while keeping the public *.yaml contract.
export async function readYaml(file) {
  return JSON.parse(await readText(file));
}

// Every structured YallaFlow state file is written here, so this is where secret
// values are kept out of durable state (v0.3.10-internal.4, src/security/redact.js).
export async function writeYaml(file, value) {
  await writeText(file, `${JSON.stringify(redactDeep(value), null, 2)}\n`);
}

export async function writeYamlAtomic(file, value) {
  await writeTextAtomic(file, `${JSON.stringify(redactDeep(value), null, 2)}\n`);
}
