import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target) {
  await mkdir(target, { recursive: true });
}

export async function writeText(target, content) {
  await ensureDir(path.dirname(target));
  await writeFile(target, content, 'utf8');
}

export async function readText(target) {
  return readFile(target, 'utf8');
}
