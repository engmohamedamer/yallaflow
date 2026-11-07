// Personal runtime state under .yallaflow/local/ (git-ignored), written only through the
// symlink-safe helpers of src/agents/local-files.js.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { safeLocalDir, safeWriteFile } from '../agents/local-files.js';

export async function localRuntimeDir(root, ...segments) {
  const local = await safeLocalDir(root, '.yallaflow', 'local');
  try {
    await readFile(path.join(local, '.gitignore'), 'utf8');
  } catch {
    await safeWriteFile(local, '.gitignore', '*\n', 0o644);
  }
  return segments.length ? safeLocalDir(root, '.yallaflow', 'local', ...segments) : local;
}
