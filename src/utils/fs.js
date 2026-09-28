import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

// Replaces a file via temp file + rename, so a reader never sees a partial write and
// a failure leaves the previous content intact.
export async function writeTextAtomic(target, content) {
  await ensureDir(path.dirname(target));
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}
