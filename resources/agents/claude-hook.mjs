#!/usr/bin/env node
// YallaFlow hook forwarder for Claude Code (v1.3.0, experimental). Claude Code runs it as a
// command hook; it forwards a minimal summary of the event to the local YallaFlow console
// and always exits 0 without output, so it never decides a permission or blocks anything.
// It forwards no file contents, no tool output and nothing from the transcript, except the
// final assistant message on Stop (what the user would read in the terminal).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const short = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function findBridge(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    // The nearest YallaFlow workspace decides; a parent project's console is never joined.
    const file = path.join(dir, '.yallaflow', 'local', 'agent-bridge.json');
    if (existsSync(path.join(dir, '.yallaflow')) && !existsSync(file)) return null;
    if (existsSync(file)) {
      try {
        const value = JSON.parse(readFileSync(file, 'utf8'));
        if (Number.isInteger(value.port) && /^[0-9a-f]{48}$/.test(value.token)) return value;
      } catch {
        return null;
      }
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function summary(input) {
  const tool = input.tool_input ?? {};
  if (typeof tool.command === 'string') return short(tool.command, 160);
  if (typeof tool.file_path === 'string') return short(tool.file_path, 160);
  if (typeof tool.pattern === 'string') return short(tool.pattern, 120);
  return null;
}


// The console proves it knows the bridge token before anything is sent (security review,
// PF-0060): a stale bridge file's port may now belong to another program or user. The
// recorded console pid must be alive and ours, and /hello must return HMAC(token, nonce).
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function proveServer(bridge) {
  return new Promise((resolve) => {
    if (!pidAlive(bridge.pid)) return resolve(false);
    const nonce = randomBytes(16).toString('hex');
    const id = createHash('sha256').update(bridge.token).digest('hex').slice(0, 16);
    const request = http.request({ host: '127.0.0.1', port: bridge.port, path: `/api/agent-bridge/claude/hello?nonce=${nonce}&id=${id}`, method: 'GET', timeout: 2000, headers: { Host: `127.0.0.1:${bridge.port}` } }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; if (data.length > 1000) request.destroy(); });
      response.on('end', () => {
        try {
          const proof = Buffer.from(String(JSON.parse(data).proof ?? ''), 'hex');
          const want = createHmac('sha256', bridge.token).update(`yallaflow-bridge:${nonce}`).digest();
          resolve(response.statusCode === 200 && proof.length === want.length && timingSafeEqual(proof, want));
        } catch { resolve(false); }
      });
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.end();
  });
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; if (raw.length > 4_000_000) process.exit(0); });
process.stdin.on('end', async () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const bridge = findBridge(input.cwd);
  if (!bridge) process.exit(0);
  if (!(await proveServer(bridge))) process.exit(0);
  const body = JSON.stringify({
    hook_event_name: short(input.hook_event_name, 40),
    session_id: short(input.session_id, 80),
    permission_mode: short(input.permission_mode, 30) || null,
    tool_name: short(input.tool_name, 80) || null,
    tool_use_id: short(input.tool_use_id, 80) || null,
    summary: summary(input),
    notification_type: short(input.notification_type, 40) || null,
    message: short(input.message, 200) || null,
    last_assistant_message: input.hook_event_name === 'Stop' && typeof input.last_assistant_message === 'string' ? input.last_assistant_message.slice(0, 20_000) : null
  });
  const request = http.request({ host: '127.0.0.1', port: bridge.port, path: '/api/agent-bridge/claude/hook', method: 'POST', timeout: 2000, headers: { Host: `127.0.0.1:${bridge.port}`, Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (response) => { response.resume(); response.on('end', () => process.exit(0)); });
  request.on('error', () => process.exit(0));
  request.on('timeout', () => { request.destroy(); process.exit(0); });
  request.end(body);
});
