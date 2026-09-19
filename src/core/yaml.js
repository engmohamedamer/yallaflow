import { readText, writeText } from '../utils/fs.js';

// JSON is valid YAML 1.2. v0.1 deliberately writes JSON-compatible YAML so the
// foundation remains zero-dependency while keeping the public *.yaml contract.
export async function readYaml(file) {
  return JSON.parse(await readText(file));
}

export async function writeYaml(file, value) {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}
