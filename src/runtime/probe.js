// The Runtime Manager's only network code (1.4.0, owner decision 1): is something
// listening on a configured service port of this machine? It connects to the loopback
// address 127.0.0.1 only, for an integer port, with a strict timeout, and sends nothing.
// No other host is ever contacted; test/shared-project.test.js keeps that guarded.
import net from 'node:net';

const LOOPBACK = '127.0.0.1';
export const PROBE_TIMEOUT_MS = 300;

export function portListening(port, timeoutMs = PROBE_TIMEOUT_MS) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host: LOOPBACK, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
