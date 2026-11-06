import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
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
// v1.2.0: the temp name is unique per process and call (pid + random), and a rename
// briefly refused on Windows (EPERM/EBUSY while another process reads the file) is
// retried, so concurrent writers and readers never collide on the temp file.
export async function writeTextAtomic(target, content) {
  await ensureDir(path.dirname(target));
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, content, 'utf8');
  // Keep the replaced file's permissions (rename would otherwise reset them to the umask).
  try {
    await chmod(temporary, (await stat(target)).mode & 0o7777);
  } catch {
    // new file, or permissions not applicable
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, target);
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 8) {
        await rm(temporary, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}
