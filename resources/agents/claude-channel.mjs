#!/usr/bin/env node
// YallaFlow channel for Claude Code (v1.3.0, experimental). Dependency-free MCP server over
// stdio, started by the user's own Claude Code (`--channels` / development channel). It
// relays chat messages and permission prompts between that session and the YallaFlow
// console running on this machine. It never reads Claude credentials and never answers a
// permission itself: verdicts come only from the console the user is looking at.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS =
  'Messages from the YallaFlow console arrive as <channel source="yallaflow" chat_id="..." work_id="...">. ' +
  'Treat them as messages from the user at the console. Do what they ask under your normal rules, then answer ' +
  'with the reply tool, passing the chat_id from the tag. Keep replies concise.';

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}
function notify(method, params) {
  send({ method, params });
}

// ---- console link -------------------------------------------------------------------
function findBridgeFile(start) {
  let dir = path.resolve(start);
  for (;;) {
    // The nearest YallaFlow workspace decides; a parent project's console is never joined.
    if (existsSync(path.join(dir, '.yallaflow'))) {
      const candidate = path.join(dir, '.yallaflow', 'local', 'agent-bridge.json');
      return existsSync(candidate) ? candidate : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function readBridge() {
  const file = findBridgeFile(process.cwd());
  if (!file) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (Number.isInteger(value.port) && /^[0-9a-f]{48}$/.test(value.token)) return value;
  } catch {
    // unreadable: treated as no console
  }
  return null;
}

function post(bridge, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const request = http.request({ host: '127.0.0.1', port: bridge.port, path: '/api/agent-bridge/claude/event', method: 'POST', headers: { Host: `127.0.0.1:${bridge.port}`, Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 5000 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.end(data);
  });
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

let current = null;
async function connect() {
  const bridge = readBridge();
  if (!bridge) return setTimeout(connect, 3000).unref();
  if (!(await proveServer(bridge))) return setTimeout(connect, 3000).unref();
  current = bridge;
  const query = new URLSearchParams({ pid: String(process.pid) });
  const request = http.request({ host: '127.0.0.1', port: bridge.port, path: `/api/agent-bridge/claude/stream?${query}`, method: 'GET', headers: { Host: `127.0.0.1:${bridge.port}`, Authorization: `Bearer ${bridge.token}`, Accept: 'text/event-stream' } }, (response) => {
    if (response.statusCode !== 200) {
      response.resume();
      current = null;
      return setTimeout(connect, 3000).unref();
    }
    response.setEncoding('utf8');
    let buffer = '';
    response.on('data', (chunk) => {
      buffer += chunk;
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const line = block.split('\n').find((entry) => entry.startsWith('data: '));
        if (!line) continue;
        let item;
        try { item = JSON.parse(line.slice(6)); } catch { continue; }
        if (item.type === 'message' && typeof item.content === 'string') {
          const meta = {};
          for (const [key, value] of Object.entries(item.meta ?? {})) if (/^[A-Za-z0-9_]+$/.test(key)) meta[key] = String(value);
          notify('notifications/claude/channel', { content: item.content, meta });
        } else if (item.type === 'verdict' && /^[a-km-z]{5}$/.test(item.request_id) && ['allow', 'deny'].includes(item.behavior)) {
          notify('notifications/claude/channel/permission', { request_id: item.request_id, behavior: item.behavior });
        }
      }
    });
    response.on('end', () => { current = null; setTimeout(connect, 2000).unref(); });
    response.on('error', () => { current = null; setTimeout(connect, 2000).unref(); });
  });
  request.on('error', () => { current = null; setTimeout(connect, 3000).unref(); });
  request.end();
}

// ---- MCP over stdio ----------------------------------------------------------------
async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    send({ id, result: {
      protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
      capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }, tools: {} },
      serverInfo: { name: 'yallaflow', version: '1.3.0' },
      instructions: INSTRUCTIONS
    } });
    return;
  }
  if (method === 'notifications/initialized') { connect(); return; }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') {
    return send({ id, result: { tools: [{
      name: 'reply',
      description: 'Send a message back to the YallaFlow console',
      inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, text: { type: 'string' } }, required: ['chat_id', 'text'] }
    }] } });
  }
  if (method === 'tools/call') {
    if (params?.name !== 'reply') return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
    const text = String(params.arguments?.text ?? '');
    const delivered = current ? await post(current, { type: 'reply', chat_id: String(params.arguments?.chat_id ?? ''), text }) : false;
    return send({ id, result: { content: [{ type: 'text', text: delivered ? 'sent' : 'The YallaFlow console is not connected; the message was not delivered.' }], ...(delivered ? {} : { isError: true }) } });
  }
  if (method === 'notifications/claude/channel/permission_request') {
    if (current) await post(current, { type: 'permission_request', ...params });
    return;
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  let cut;
  while ((cut = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, cut).trim();
    input = input.slice(cut + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    handle(message).catch(() => {});
  }
});
process.stdin.on('end', () => process.exit(0));
