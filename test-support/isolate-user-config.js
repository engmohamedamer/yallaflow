// Preloaded into every test process by `npm test` (node --import). Tests must never read or
// write the developer's real user-level YallaFlow configuration, above all the console's saved
// project list: a console started by a test would otherwise open those real projects. Each
// test process gets its own temporary config home.
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(os.tmpdir(), 'yf-test-config-'));
process.env.XDG_CONFIG_HOME = dir;
if (process.platform === 'win32') process.env.APPDATA = dir;
process.env.YALLAFLOW_TEST_USER_CONFIG = dir;

// PF-0062: test processes start the CLI more than a thousand times. Node's compile cache
// (Node >= 22.1; ignored on older versions) lets those child processes reuse compiled code.
if (!process.env.NODE_COMPILE_CACHE) process.env.NODE_COMPILE_CACHE = path.join(dir, 'compile-cache');
