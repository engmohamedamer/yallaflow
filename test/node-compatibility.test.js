// Deterministic check for the Node runtime contract, resolved in the v0.3.5 pre-freeze
// hardening pass (Freeze Blocker 1). A pilot saw an EBADENGINE warning during
// `npm install`: pdfjs-dist@6.3.289 officially required Node >=22.13.0, while
// YallaFlow declared Node >=20 — a real mismatch, not just an untested one. Resolved
// by pinning pdfjs-dist to 5.4.624, the latest release that (a) officially declares
// engines.node including Node 20 (`>=20.16.0 || >=22.3.0`) and (b) predates the
// version range affected by GHSA-hq66-cqwq-w95j (>=5.6.83, <6.2.108) and is well past
// GHSA-wgrm-67xf-hhpq (<=4.1.392) and GHSA-7jg2-jgv3-fmr4 (<2.0.550) — see
// docs/architecture.md "Parser decisions". A first pass at this fix left YallaFlow's
// own declaration at the looser `>=20`, which this test's general dependency-tree scan
// then correctly caught as still-inconsistent: pdfjs-dist actually needs >=20.16.0,
// a narrower floor than bare >=20. YallaFlow's own `engines.node` was tightened to
// `>=20.16.0` to match — the declared range must agree with every direct runtime
// dependency's own declaration, checked here by scanning node_modules against
// package.json's own value rather than hard-coding either side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFileIntake } from '../src/intake/file.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const fixture = fileURLToPath(new URL('fixtures/intake/sample.pdf', import.meta.url));
const nodeModules = fileURLToPath(new URL('../node_modules/', import.meta.url));

// Minimal, dependency-free semver-range satisfaction check for the plain forms this
// dependency tree actually uses (">=X", ">=X.Y.Z", "x"/"X" wildcard segments as in
// ">=0.8.x", and "||"-joined alternatives of those). Not a general semver engine —
// sufficient and exact for this deterministic contract check. `declaredMinimum` is the
// lowest Node version YallaFlow's own `>=` contract actually admits (its floor); a
// dependency clause is satisfied only if that exact floor also satisfies the clause —
// checking anything looser (e.g. YallaFlow's stated minimum trivially "satisfying"
// itself) would miss precisely the kind of too-loose-declaration gap this test exists
// to catch.
function toVersionTuple(text) {
  return text.split('.').map((segment) => (/^[xX*]$/.test(segment) ? 0 : Number(segment)));
}

function satisfiesDeclaredMinimum(range, declaredMinimum) {
  const declared = toVersionTuple(declaredMinimum);
  while (declared.length < 3) declared.push(0);
  return range.split('||').map((clause) => clause.trim()).some((clause) => {
    const match = /^>=\s*([\d]+(?:\.(?:\d+|[xX*]))*)$/.exec(clause);
    if (!match) return false; // an unrecognized clause form fails closed, not open
    const required = toVersionTuple(match[1]);
    while (required.length < 3) required.push(0);
    for (let i = 0; i < 3; i++) {
      if (declared[i] > required[i]) return true;
      if (declared[i] < required[i]) return false;
    }
    return true; // exactly equal
  });
}

async function installedPackagesWithEngines() {
  const results = [];
  const dirs = await readdir(nodeModules, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const scopedNames = dir.name.startsWith('@')
      ? (await readdir(path.join(nodeModules, dir.name), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
      : [null];
    for (const scoped of scopedNames) {
      const pkgPath = scoped ? path.join(nodeModules, dir.name, scoped, 'package.json') : path.join(nodeModules, dir.name, 'package.json');
      try {
        const installed = JSON.parse(await readFile(pkgPath, 'utf8'));
        if (installed.engines?.node) results.push(installed);
      } catch {
        // not a real package directory (e.g. a stray file) — ignore
      }
    }
  }
  return results;
}

test('the running Node version satisfies the declared engines.node contract', () => {
  assert.equal(pkg.engines.node, '>=20.16.0');
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 20 || (major === 20 && minor >= 16), `Node ${process.versions.node} does not satisfy >=20.16.0`);
});

test('pdfjs-dist is pinned to a version that officially declares Node >=20 support', async () => {
  const pdfjsPkg = JSON.parse(await readFile(path.join(nodeModules, 'pdfjs-dist', 'package.json'), 'utf8'));
  assert.equal(pdfjsPkg.version, '5.4.624');
  assert.equal(pdfjsPkg.engines.node, '>=20.16.0 || >=22.3.0');
});

test('every installed dependency officially supports YallaFlow\'s declared Node floor — no engines mismatch anywhere in the tree', async () => {
  const declaredFloor = pkg.engines.node.replace(/^>=\s*/, '');
  const withEngines = await installedPackagesWithEngines();
  assert.ok(withEngines.length > 0, 'expected at least one installed package to declare engines.node');
  const mismatches = withEngines.filter((p) => !satisfiesDeclaredMinimum(p.engines.node, declaredFloor));
  assert.deepEqual(
    mismatches.map((p) => `${p.name}@${p.version}: ${p.engines.node}`),
    [],
    'a dependency declares a Node requirement YallaFlow does not satisfy — the engines contract is not truthful'
  );
});

test('PDF extraction actually works on this Node runtime with the pinned pdfjs-dist version', async () => {
  const normalized = await prepareFileIntake(fixture);
  assert.equal(normalized.contentAvailability, 'extracted');
  assert.ok(normalized.rawText.length > 0);
});
