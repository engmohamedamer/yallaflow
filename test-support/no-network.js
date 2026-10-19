// Preloaded with `node --import` by tests that assert a command performs no network
// access (v1.1.0). Any fetch or http(s) request records a marker and fails loudly.
import http from 'node:http';
import https from 'node:https';
import { appendFileSync } from 'node:fs';

const marker = process.env.YALLAFLOW_TEST_NETWORK_MARKER;
function refuse(kind) {
  return () => {
    if (marker) appendFileSync(marker, `${kind}\n`);
    throw new Error(`network access attempted (${kind})`);
  };
}
globalThis.fetch = refuse('fetch');
http.request = refuse('http.request');
http.get = refuse('http.get');
https.request = refuse('https.request');
https.get = refuse('https.get');
