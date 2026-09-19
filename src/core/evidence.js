import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from './yaml.js';
import { workspacePath } from './workspace.js';

export async function recordVerification(root, workId, record) {
  const dir = path.join(workspacePath(root), 'work', workId, 'evidence');
  const file = path.join(dir, 'verification.json');
  await writeYaml(file, record);
  return file;
}

export async function latestVerification(root, workId) {
  const file = path.join(workspacePath(root), 'work', workId, 'evidence', 'verification.json');
  if (!await exists(file)) return null;
  return readYaml(file);
}

export async function hasAnyEvidence(root, workId) {
  const dir = path.join(workspacePath(root), 'work', workId, 'evidence');
  const entries = await readdir(dir);
  return entries.length > 0;
}
