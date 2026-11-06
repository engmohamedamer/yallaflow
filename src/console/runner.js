// The Console reads every project through this package's own CLI (`snapshot --json`,
// `work show <id> --json`) in a child process: the same version and the same rules an
// agent sees, and the server's event loop never runs Core's synchronous git calls.
// Results are cached per project until the watcher reports a change.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const TIMEOUT_MS = 30_000;
const CONCURRENCY = 2;
// Above the workspace lock's own 60 s wait, so a busy workspace reports WORKSPACE_BUSY itself.
const WRITE_TIMEOUT_MS = 120_000;

export function createRunner({ cli = CLI } = {}) {
  const caches = new Map(); // root -> Map(key -> Promise<result>)
  const writeChains = new Map(); // root -> Promise of the last write
  const queue = [];
  let running = 0;

  function pump() {
    while (running < CONCURRENCY && queue.length) {
      const job = queue.shift();
      running += 1;
      execute(job.root, job.args).then(job.resolve, job.reject).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  // A write (Create Work): the CLI's exit status and output, never cached. argv only —
  // user text is one element after `--`, never seen by a shell.
  // extraEnv: variables for this one child process only (1.4.0: the console's decision
  // provenance). Never set on the console process, so no other child inherits them.
  function executeRaw(root, args, timeoutMs = WRITE_TIMEOUT_MS, extraEnv = null) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, NO_COLOR: '1', ...(extraEnv ?? {}) }, shell: false });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    });
  }

  function execute(root, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, NO_COLOR: '1' } });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (status) => {
        clearTimeout(timer);
        let parsed = null;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          return reject(Object.assign(new Error(`yallaflow ${args.join(' ')} did not return JSON: ${(stderr || stdout).trim().slice(0, 300)}`), { code: 'CLI_FAILED', command: `yallaflow ${args.join(' ')}` }));
        }
        if (status !== 0 || parsed.error) {
          const error = new Error(parsed.error?.message ?? `yallaflow ${args.join(' ')} exited with ${status}`);
          error.code = parsed.error?.code ?? 'CLI_FAILED';
          error.command = `yallaflow ${args.join(' ')}`;
          return reject(error);
        }
        resolve(parsed);
      });
    });
  }

  function run(root, args) {
    return new Promise((resolve, reject) => {
      queue.push({ root, args, resolve, reject });
      pump();
    });
  }

  return {
    get(root, key, args) {
      if (!caches.has(root)) caches.set(root, new Map());
      const cache = caches.get(root);
      if (!cache.has(key)) {
        const pending = run(root, args);
        cache.set(key, pending);
        pending.catch(() => cache.delete(key)); // a failure is retried on the next request
      }
      return cache.get(key);
    },
    invalidate(root) {
      caches.get(root)?.clear();
    },
    // Writes for one project run one at a time, then every cached read is dropped.
    write(root, args, { env = null } = {}) {
      return this.exclusive(root, (exec) => exec(args, { env }));
    },
    // One step of the project's write queue: fn(exec) may read and then run CLI writes
    // with nothing else from this console in between.
    exclusive(root, fn) {
      const previous = writeChains.get(root) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(() => fn((args, { env = null } = {}) => executeRaw(root, args, WRITE_TIMEOUT_MS, env))).finally(() => caches.get(root)?.clear());
      writeChains.set(root, next);
      return next;
    }
  };
}
