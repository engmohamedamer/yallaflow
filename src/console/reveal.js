// PF-0128: open a registered project's folder in the operating system's file manager.
// Only ever called with the root of a project the console already serves (never a path from the
// request), with no shell, detached so the file manager outlives nothing in the console.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

export function fileManagerCommand(platform = process.platform) {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'explorer.exe';
  return 'xdg-open';
}

export async function openInFileManager(root, { platform = process.platform, spawnFn = spawn } = {}) {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    const error = new Error('The project folder is no longer there.');
    error.code = 'FOLDER_MISSING';
    error.status = 404;
    throw error;
  }
  const command = fileManagerCommand(platform);
  await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(command, [root], { detached: true, stdio: 'ignore', shell: false });
    } catch (cause) {
      reject(cause);
      return;
    }
    child.once('error', (cause) => {
      const error = new Error(`Could not open the file manager (${command} is not available on this machine).`);
      error.code = 'FILE_MANAGER_UNAVAILABLE';
      error.status = 501;
      error.cause = cause;
      reject(error);
    });
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return { opened: true, root };
}
