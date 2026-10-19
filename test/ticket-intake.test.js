// v1.1.0 Connected Requirements: tracker tickets (GitHub Issues, Jira, Azure DevOps)
// enter the existing lifecycle as immutable sources — offline from an agent-supplied
// payload by default, or through an explicit, read-only --fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { workspacePath } from '../src/core/workspace.js';
import * as github from '../src/intake/providers/github.js';
import * as jira from '../src/intake/providers/jira.js';
import * as azureDevops from '../src/intake/providers/azure-devops.js';
import { PROVIDER_IDS, resolveTicketRef } from '../src/intake/providers/index.js';
import { adfToMarkdown, extractAcceptanceSection, htmlToText, validateTicket } from '../src/intake/providers/ticket.js';
import { httpGet } from '../src/intake/providers/http.js';
import {
  cliPath, createdWork, driveChangeToDone, freshProject, noNetworkPreload, readWorkspaceText, routedBoundedChange,
  run, ticketFixture, workspaceHash, writeJsonFile
} from '../test-support/optional.js';

const fixtureJson = async (name) => JSON.parse(await readFile(ticketFixture(name), 'utf8'));
const sourceRecord = (root, id) => readYaml(path.join(workspacePath(root), 'sources', id, 'source.json'));
const sourceText = (root, id) => readFile(path.join(workspacePath(root), 'sources', id, 'extracted.txt'), 'utf8');

// spawnSync would block the local test server below; --fetch tests run the CLI async.
function runAsync(root, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: root, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function trackerServer(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null });
    const route = routes(req.url, `http://127.0.0.1:${server.address().port}`);
    if (!route) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'application/json', ...(route.headers ?? {}) });
    res.end(typeof route.body === 'string' || Buffer.isBuffer(route.body) ? route.body : JSON.stringify(route.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

// ---------------------------------------------------------------------------
// Adapters: pure normalization of what an agent typically already has

test('github adapter normalizes gh CLI JSON: criteria from the heading, bot comments flagged, uploaded files as attachments', async () => {
  const ticket = validateTicket(github.normalize(await fixtureJson('github-gh.json')), PROVIDER_IDS);
  assert.equal(ticket.key, 'acme/school#12');
  assert.equal(ticket.url, 'https://github.com/acme/school/issues/12');
  assert.equal(ticket.state, 'open');
  assert.deepEqual(ticket.labels, ['feature', 'calendar']);
  assert.deepEqual(ticket.acceptanceCriteria.map((entry) => [entry.id, entry.text]), [
    ['ac:1', 'The export downloads an ICS file'],
    ['ac:2', 'Only the selected term is exported']
  ]);
  assert.deepEqual(ticket.comments.map((comment) => [comment.author, comment.bot]), [['bob', false], ['dependabot[bot]', true]]);
  assert.deepEqual(ticket.attachments.map((entry) => entry.name), ['calendar-mock.png']);
});

test('github adapter normalizes the REST issue + comments wrapper', async () => {
  const ticket = github.normalize(await fixtureJson('github-rest.json'));
  assert.equal(ticket.key, 'acme/shop#7');
  assert.equal(ticket.revision, '2026-09-05T08:00:00Z');
  assert.deepEqual(ticket.acceptanceCriteria.map((entry) => entry.text), ['A refund above 100 waits for approval', 'A manager can approve it']);
  assert.deepEqual(ticket.comments.map((comment) => [comment.id, comment.bot]), [['9001', false], ['9002', true]]);
});

test('jira adapter reads ADF, finds the custom Acceptance Criteria field by name, and flags app comments', async () => {
  const ticket = jira.normalize(await fixtureJson('jira-v3.json'));
  assert.equal(ticket.key, 'SHOP-42');
  assert.equal(ticket.url, 'https://acme.atlassian.net/browse/SHOP-42');
  assert.match(ticket.description, /Totals must include VAT\.[\s\S]*- Applies to all invoices/);
  assert.deepEqual(ticket.acceptanceCriteria.map((entry) => entry.text), ['Invoice total equals net plus VAT', 'VAT rate comes from settings']);
  assert.match(ticket.acceptanceCriteria[0].origin, /customfield_10035/);
  assert.deepEqual(ticket.comments.map((comment) => [comment.body, comment.bot]), [['Rounding is half-up.', false], ['Transitioned.', true]]);
  assert.deepEqual(ticket.attachments.map((entry) => [entry.name, entry.sizeBytes]), [['invoice-sample.txt', 18]]);
});

test('azure devops adapter converts rich text, reads the acceptance-criteria field, and keeps only attached files', async () => {
  const ticket = azureDevops.normalize(await fixtureJson('azure-devops.json'));
  assert.equal(ticket.key, 'Portal#77');
  assert.equal(ticket.revision, 5);
  assert.equal(ticket.description, 'Users can reset a forgotten password.\nLinks expire.');
  assert.deepEqual(ticket.acceptanceCriteria.map((entry) => entry.text), ['The email contains a single-use link', 'The link expires after 30 minutes']);
  assert.deepEqual(ticket.labels, ['auth', 'email']);
  assert.deepEqual(ticket.attachments.map((entry) => entry.name), ['flow.txt']);
  assert.equal(ticket.comments[0].body, 'Use the existing mailer.');
});

test('references resolve to exactly one provider; unrelated input does not', () => {
  assert.equal(resolveTicketRef('github:acme/shop#7').adapter.id, 'github');
  assert.equal(resolveTicketRef('https://github.com/acme/shop/issues/7').ref.number, 7);
  assert.equal(resolveTicketRef('jira:shop-42').ref.key, 'SHOP-42');
  assert.equal(resolveTicketRef('https://acme.atlassian.net/browse/SHOP-42').ref.baseUrl, 'https://acme.atlassian.net');
  assert.deepEqual(resolveTicketRef('ado:acme/Portal#77').ref, { provider: 'azure-devops', base: 'https://dev.azure.com/acme', project: 'Portal', number: 77, shortForm: true });
  assert.equal(resolveTicketRef('https://acme.visualstudio.com/Portal/_workitems/edit/77').ref.base, 'https://acme.visualstudio.com');
  assert.equal(resolveTicketRef('notes.json'), null);
  assert.equal(resolveTicketRef('https://example.com/page'), null);
});

test('markup helpers are mechanical: headings, lists, entities, scripts dropped', () => {
  assert.deepEqual(extractAcceptanceSection('Intro\n### Acceptance criteria\n1. One\n- [x] Two\n### Next\n- Not this').map((entry) => entry.text), ['One', 'Two']);
  assert.deepEqual(extractAcceptanceSection('No criteria here.'), []);
  assert.equal(htmlToText('<p>a &amp; b</p><script>alert(1)</script><ul><li>x</li></ul>'), 'a & b\n\n- x');
  assert.equal(adfToMarkdown({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }] }), '## Title');
});

test('acceptance criteria are found in the formats real trackers use (found in live acceptance)', () => {
  const texts = (body) => extractAcceptanceSection(body).map((entry) => entry.text);
  // Plain label line with a colon, "*" bullets, tracker sync footer (as in mozilla/fxa issues).
  assert.deepEqual(texts('Display the amount.\n\nAcceptance Criteria:\n\n* Component shows the amount\n* FE tests check it\n\n┆Issue is synchronized with this [Jira Task](https://example.atlassian.net/browse/X-1)\n'), ['Component shows the amount', 'FE tests check it']);
  // "1-" numbering with Jira wiki image lines between items.
  assert.deepEqual(texts('Acceptance Criteria:\n\n1- The registration page has updated copy.\n\n!image-1.png|width=90%!\n\n2- The sign-in page has updated copy.'), ['The registration page has updated copy.', 'The sign-in page has updated copy.']);
  // Bold label followed by prose instead of a list; ends at the next label.
  const prose = extractAcceptanceSection('Intro\n\n**Acceptance Criteria**\n\nThere are two entry points.\n\n**(entrypoint=menu)** Users from the menu see version A.\n\n**Notes**\n- not this');
  assert.deepEqual(prose.map((entry) => entry.text), ['There are two entry points.', '**(entrypoint=menu)** Users from the menu see version A.']);
  assert.equal(prose[0].origin, 'description-heading (prose)');
  // Jira wiki heading; a section ends at a plain "Label:" line.
  assert.deepEqual(texts('h3. Acceptance criteria\n# ignored heading text\n* A\n* B\n\nOut of scope:\n* C'), []);
  assert.deepEqual(texts('h3. Acceptance criteria\n* A\n* B\n\nOut of scope:\n* C'), ['A', 'B']);
  // A sentence that merely mentions acceptance criteria is not a section label.
  assert.deepEqual(texts('We discussed acceptance criteria in the meeting.\n- not a criterion'), []);
});

test('a credentialed request never follows a redirect to another origin', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
  await assert.rejects(
    httpGet('https://api.github.com/repos/a/b/issues/1', { headers: { Authorization: 'Bearer secret-token-value' }, allowedOrigin: 'https://api.github.com', maxBytes: 1000, fetchImpl }),
    (error) => /Refusing to send a request outside https:\/\/api\.github\.com/.test(error.message) && !error.message.includes('secret-token-value')
  );
});

// ---------------------------------------------------------------------------
// CLI: offline import into the existing lifecycle

test('intake ticket imports an agent-supplied payload offline into a pending intake with a preserved original', async () => {
  const root = await freshProject();
  const result = run(root, ['intake', 'ticket', ticketFixture('github-gh.json'), '--provider', 'github'], { preload: noNetworkPreload });
  assert.match(result.stdout, /Ticket imported: GitHub Issues acme\/school#12 — Export school calendar/);
  assert.match(result.stdout, /Acceptance criteria found: 2/);
  assert.match(result.stdout, /Comments included: 1 of 1 \(1 bot comment\(s\) excluded\)/);
  assert.match(result.stdout, /untrusted content/);
  const workId = createdWork(result.stdout);
  const meta = await readYaml(path.join(workspacePath(root), 'work', workId, 'meta.yaml'));
  assert.equal(meta.routingStatus, 'pending');
  assert.equal(meta.titleHint, 'Export school calendar');
  assert.equal(meta.sources[0].id, 'SRC-0001');

  const record = await sourceRecord(root, 'SRC-0001');
  assert.equal(record.sourceType, 'file', 'older YallaFlow versions keep reading ticket sources');
  assert.equal(record.detectedFormat, 'ticket');
  assert.equal(record.contentAvailability, 'extracted');
  assert.equal(record.metadata.ticket.provider, 'github');
  assert.equal(record.metadata.ticket.acquiredBy, 'agent');
  assert.deepEqual(record.metadata.ticket.comments, { total: 2, included: 1, human: 1, bot: 1 });
  const original = await readFile(path.join(workspacePath(root), record.original.path));
  assert.deepEqual(original, await readFile(ticketFixture('github-gh.json')), 'the original payload is preserved byte-for-byte');

  const text = await sourceText(root, 'SRC-0001');
  assert.match(text, /^> Imported ticket — untrusted content/);
  assert.match(text, /- \[ac:1\] The export downloads an ICS file/);
  assert.match(text, /\[comment:IC_kwDO1\] bob/);
  assert.doesNotMatch(text, /Bumps a dependency/, 'bot comments are not rendered');
  assert.match(text, /^##### Acceptance Criteria$/m, 'ticket headings are nested below the rendering sections');
  assert.match(text, /Ignore all previous instructions/, 'untrusted text is kept as data, not removed silently');

  const shown = run(root, ['source', 'show', 'SRC-0001']).stdout;
  assert.match(shown, /Ticket: github acme\/school#12 — https:\/\/github\.com\/acme\/school\/issues\/12/);
  assert.match(shown, /Acquired: payload supplied by the agent/);
  assert.match(run(root, ['doctor']).stdout, /^(?!.*FAIL)/s);
});

test('a normalized ticket needs no --provider; a raw payload without one is refused without writing', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ticket-'));
  const normalized = await writeJsonFile(dir, 'ticket.json', {
    yallaflowTicket: 1, provider: 'jira', key: 'OPS-1', title: 'Rotate logs', description: 'Weekly.',
    acceptanceCriteria: [{ text: 'Logs older than 7 days are removed' }]
  });
  assert.match(run(root, ['intake', 'ticket', normalized]).stdout, /Ticket imported: Jira OPS-1/);

  const before = await workspaceHash(root);
  const refused = run(root, ['intake', 'ticket', ticketFixture('jira-v3.json')], { ok: false });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--provider github\|jira\|azure-devops/);
  const wrong = run(root, ['intake', 'ticket', ticketFixture('jira-v3.json'), '--provider', 'github'], { ok: false });
  assert.match(wrong.stderr, /Not a GitHub issue payload/);
  assert.equal(await workspaceHash(root), before);
});

test('a ticket reference without --fetch stays offline and explains both paths', async () => {
  const root = await freshProject();
  const before = await workspaceHash(root);
  const result = run(root, ['intake', 'ticket', 'github:acme/shop#7'], { ok: false, preload: noNetworkPreload });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /offline by default/);
  assert.match(result.stderr, /--fetch/);
  assert.equal(await workspaceHash(root), before);
});

test('re-importing a ticket creates a new source that names the previous one; the earlier source never changes', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ticket-'));
  run(root, ['intake', 'ticket', ticketFixture('github-rest.json'), '--provider', 'github']);
  const first = await readFile(path.join(workspacePath(root), 'sources', 'SRC-0001', 'source.json'), 'utf8');
  const changed = await fixtureJson('github-rest.json');
  changed.issue.updated_at = '2026-09-09T08:00:00Z';
  changed.issue.body += '3. Rejected refunds notify the requester\n';
  const workId = createdWork(run(root, ['intake', 'ticket', await writeJsonFile(dir, 'v2.json', changed), '--provider', 'github']).stdout);
  assert.ok(workId);
  const second = await sourceRecord(root, 'SRC-0002');
  assert.equal(second.metadata.ticket.previousSource, 'SRC-0001');
  assert.equal(second.metadata.ticket.revision, '2026-09-09T08:00:00Z');
  assert.equal(await readFile(path.join(workspacePath(root), 'sources', 'SRC-0001', 'source.json'), 'utf8'), first);
});

test('--work attaches like intake add: impact after intent is fixed, and DONE work needs --reason', async () => {
  const root = await freshProject();
  const id = createdWork(run(root, ['start', 'Add refund approval']).stdout);
  run(root, ['route', id, '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Feature.']);
  run(root, ['checkpoint', id, '--skill', 'context-discovery', '--complete', '--summary', 'ok']);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ticket-'));
  run(root, ['intake', 'ticket', ticketFixture('github-rest.json'), '--provider', 'github', '--work', id]);
  // Requirements trace to the ticket through ordinary source provenance and a locator.
  const intent = {
    requirements: [{ id: 'REQ-001', statement: 'Large refunds need approval.', provenance: [{ type: 'source', source: 'SRC-0001', locator: 'description' }] }],
    acceptanceCriteria: [{ id: 'AC-001', requirement: 'REQ-001', statement: 'A refund above 100 waits for approval.', provenance: [{ type: 'source', source: 'SRC-0001', locator: 'ac:1' }] }]
  };
  run(root, ['requirement', 'record', id, '--file', await writeJsonFile(dir, 'req.json', intent)]);
  assert.match(run(root, ['requirement', 'show', id, 'AC-001']).stdout, /SRC-0001/);
  run(root, ['checkpoint', id, '--skill', 'requirement-clarification', '--complete', '--summary', 'ok']);
  const attached = run(root, ['intake', 'ticket', ticketFixture('github-gh.json'), '--provider', 'github', '--work', id]);
  assert.match(attached.stdout, new RegExp(`Attached to: ${id}`));
  assert.match(attached.stdout, /Impact IM-\d+ pending/);

  const change = routedBoundedChange(root);
  driveChangeToDone(root, change);
  const refused = run(root, ['intake', 'ticket', ticketFixture('jira-v3.json'), '--provider', 'jira', '--work', change], { ok: false });
  assert.match(refused.stderr, /--reason/);
  const recovered = run(root, ['intake', 'ticket', ticketFixture('jira-v3.json'), '--provider', 'jira', '--work', change, '--reason', 'Ticket was the original requirement.']);
  assert.match(recovered.stdout, /remains DONE; recorded as recovered source/);
});

test('--attachment preserves agent-saved attachment files as their own linked sources', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ticket-'));
  const attachment = await writeJsonFile(dir, 'flow.txt', 'step 1 then 2');
  const result = run(root, ['intake', 'ticket', ticketFixture('azure-devops.json'), '--provider', 'azure-devops', '--attachment', attachment]);
  assert.match(result.stdout, /Source captured: SRC-0002 \(ticket\) · attachments: SRC-0001/);
  const ticket = await sourceRecord(root, 'SRC-0002');
  assert.deepEqual(ticket.metadata.ticket.attachments, [{ name: 'flow.txt', sizeBytes: 12, source: 'SRC-0001' }]);
  assert.equal((await sourceRecord(root, 'SRC-0001')).metadata.ticketAttachment.key, 'Portal#77');
  assert.match(await sourceText(root, 'SRC-0002'), /flow\.txt \(12 bytes\) — preserved as SRC-0001/);
});

test('the Brownfield understanding gate refuses a new ticket intake before any write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-ticket-bf-'));
  await writeFile(path.join(root, 'package.json'), '{"name":"legacy"}');
  run(root, ['init', '--type', 'brownfield']);
  const before = await workspaceHash(root);
  const result = run(root, ['intake', 'ticket', ticketFixture('github-gh.json'), '--provider', 'github'], { ok: false });
  assert.match(result.stdout + result.stderr, /PROJECT_UNDERSTANDING_REQUIRED/);
  assert.equal(await workspaceHash(root), before);
});

// ---------------------------------------------------------------------------
// Explicit, read-only --fetch

test('--fetch (GitHub) issues only GET requests with the env token, which never reaches state or output', async () => {
  const issue = (await fixtureJson('github-rest.json'));
  const server = await trackerServer((url) => {
    if (url === '/repos/acme/shop/issues/7') return { body: issue.issue };
    if (url.startsWith('/repos/acme/shop/issues/7/comments')) return { body: issue.comments };
    return null;
  });
  try {
    const root = await freshProject();
    const configFile = path.join(workspacePath(root), 'config.yaml');
    await writeYaml(configFile, { ...(await readYaml(configFile)), requirements: { providers: { github: { apiUrl: server.origin } } } });
    const token = 'ghp_testtoken0123456789abcdefghijklmnopqrstu';
    const result = await runAsync(root, ['intake', 'ticket', 'github:acme/shop#7', '--fetch'], { GITHUB_TOKEN: token, GH_TOKEN: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /over the network \(read-only\)/);
    assert.match(result.stdout, /using GITHUB_TOKEN \(never stored\)/);
    assert.deepEqual(server.requests.map((request) => request.method), ['GET', 'GET']);
    assert.ok(server.requests.every((request) => request.authorization === `Bearer ${token}`));
    assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token));
    assert.ok(!(await readWorkspaceText(root)).includes(token), 'the token is never persisted');
    const record = await sourceRecord(root, 'SRC-0001');
    assert.equal(record.metadata.ticket.acquiredBy, 'yallaflow-fetch');
    assert.equal(record.metadata.ticket.credentialSource, 'GITHUB_TOKEN');
    assert.equal(run(root, ['doctor']).status, 0);
  } finally {
    await server.close();
  }
});

test('--fetch --attachments (Jira) downloads attachments from the same site as their own sources', async () => {
  let origin;
  const server = await trackerServer((url, serverOrigin) => {
    origin = serverOrigin;
    if (url.startsWith('/rest/api/3/issue/SHOP-42')) {
      return { body: fixtureJira(serverOrigin) };
    }
    if (url === '/rest/api/3/attachment/content/500') return { body: 'net + vat example', type: 'text/plain' };
    return null;
  });
  try {
    const root = await freshProject();
    await configureProvider(root, 'jira', { baseUrl: server.origin });
    const env = { JIRA_EMAIL: 'qa@example.com', JIRA_API_TOKEN: 'jira-secret-value-123', JIRA_PAT: '' };
    const result = await runAsync(root, ['intake', 'ticket', `${server.origin}/browse/SHOP-42`, '--fetch', '--attachments'], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /attachments: SRC-0001/);
    assert.ok(server.requests.every((request) => request.method === 'GET' && request.authorization?.startsWith('Basic ')));
    assert.equal((await sourceRecord(root, 'SRC-0001')).sourceName, 'invoice-sample.txt');
    assert.equal((await sourceRecord(root, 'SRC-0002')).metadata.ticket.url, `${origin}/browse/SHOP-42`);
    assert.ok(!(await readWorkspaceText(root)).includes('jira-secret-value-123'));
  } finally {
    await server.close();
  }
});

test('--fetch without credentials names the variable and writes nothing', async () => {
  const server = await trackerServer(() => ({ body: {} }));
  try {
    const root = await freshProject();
    await configureProvider(root, 'azure-devops', { baseUrl: `${server.origin}/acme` });
    const before = await workspaceHash(root);
    const result = await runAsync(root, ['intake', 'ticket', `${server.origin}/acme/Portal/_workitems/edit/77`, '--fetch'], { AZURE_DEVOPS_EXT_PAT: '' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AZURE_DEVOPS_EXT_PAT/);
    assert.equal(server.requests.length, 0, 'no request is sent without credentials');
    assert.equal(await workspaceHash(root), before);
  } finally {
    await server.close();
  }
});

test('--fetch (Azure DevOps) reads the work item and its comments with the PAT', async () => {
  const payload = await fixtureJson('azure-devops.json');
  const server = await trackerServer((url) => {
    if (url.startsWith('/acme/Portal/_apis/wit/workitems/77')) return { body: payload.workItem };
    if (url.startsWith('/acme/Portal/_apis/wit/workItems/77/comments')) return { body: payload.comments };
    return null;
  });
  try {
    const root = await freshProject();
    await configureProvider(root, 'azure-devops', { baseUrl: `${server.origin}/acme` });
    const result = await runAsync(root, ['intake', 'ticket', `${server.origin}/acme/Portal/_workitems/edit/77`, '--fetch'], { AZURE_DEVOPS_EXT_PAT: 'ado-pat-value-xyz' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(server.requests.length, 2);
    assert.match(await sourceText(root, 'SRC-0001'), /\[ac:2\] The link expires after 30 minutes/);
    assert.ok(!(await readWorkspaceText(root)).includes('ado-pat-value-xyz'));
  } finally {
    await server.close();
  }
});

async function configureProvider(root, provider, settings) {
  const configFile = path.join(workspacePath(root), 'config.yaml');
  await writeYaml(configFile, { ...(await readYaml(configFile)), requirements: { providers: { [provider]: settings } } });
}

test('credentials only go to the hosted tracker or an explicitly configured host — never to a host named by a ticket URL', async () => {
  const server = await trackerServer(() => ({ body: {} }));
  try {
    const root = await freshProject();
    const before = await workspaceHash(root);
    const env = { GITHUB_TOKEN: 'ghp_never0123456789abcdefghijklmnopqrstuv', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 'jira-never', AZURE_DEVOPS_EXT_PAT: 'ado-never' };
    const host = server.origin.replace('http://', '');
    for (const [ref, pattern] of [
      [`${server.origin}/acme/shop/issues/7`, /is not github\.com\. For GitHub Enterprise, set requirements\.providers\.github\.apiUrl/],
      [`https://gitlab.example.com/acme/shop/issues/7`, /is not github\.com/],
      [`${server.origin}/browse/SHOP-42`, new RegExp(`refusing to send credentials to http://${host}, which is not a known Jira host \\(and is not https\\)`)],
      ['https://evil.example/browse/SHOP-42', /refusing to send credentials to https:\/\/evil\.example, which is not a known Jira host/],
      [`${server.origin}/acme/Portal/_workitems/edit/77`, /not a known Azure DevOps host/],
      ['https://evil.example/acme/Portal/_workitems/edit/77', /not a known Azure DevOps host/]
    ]) {
      const result = await runAsync(root, ['intake', 'ticket', ref, '--fetch'], env);
      assert.equal(result.status, 1, ref);
      assert.match(result.stderr, pattern, ref);
      for (const value of Object.values(env)) assert.ok(!result.stderr.includes(value), 'no credential value in the error');
    }
    assert.equal(server.requests.length, 0, 'no request reached an untrusted host');
    assert.equal(await workspaceHash(root), before);
  } finally {
    await server.close();
  }
});

test('GitHub attachments download only from GitHub attachment hosts, never from look-alikes', () => {
  const { allowAttachmentUrl } = github.attachmentRequest();
  assert.equal(allowAttachmentUrl('https://github.com/user-attachments/assets/1'), true);
  assert.equal(allowAttachmentUrl('https://private-user-images.githubusercontent.com/1/x.png'), true);
  assert.equal(allowAttachmentUrl('https://evilgithubusercontent.com/x.png'), false);
  assert.equal(allowAttachmentUrl('https://example.com/user-attachments/x.png'), false);
  const ticket = github.normalize({ number: 1, title: 't', body: '![a.png](https://evilgithubusercontent.com/a.png) ![b.png](https://github.com/user-attachments/assets/b)', html_url: 'https://github.com/a/b/issues/1' });
  assert.deepEqual(ticket.attachments.map((entry) => entry.name), ['b.png']);
});

function fixtureJira(origin) {
  const raw = JSON.parse(JSON.stringify(jiraFixture));
  raw.self = `${origin}/rest/api/3/issue/10042`;
  raw.fields.attachment[0].content = `${origin}/rest/api/3/attachment/content/500`;
  return raw;
}
const jiraFixture = JSON.parse(await readFile(ticketFixture('jira-v3.json'), 'utf8'));

// ---------------------------------------------------------------------------
// No implicit network access, anywhere else

test('no other command touches the network: init, start, route, intake, ticket import, verify, brief, status, doctor, finish', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-nonet-'));
  const marker = path.join(root, '..', `${path.basename(root)}-network-marker`);
  const opts = { preload: noNetworkPreload, env: { YALLAFLOW_TEST_NETWORK_MARKER: marker } };
  run(root, ['init', '--type', 'greenfield'], opts);
  const id = createdWork(run(root, ['start', 'Add an export'], opts).stdout);
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Small.'], opts);
  run(root, ['intake', 'ticket', ticketFixture('github-gh.json'), '--provider', 'github', '--work', id], opts);
  run(root, ['intake', 'add', id, ticketFixture('jira-v3.json')], opts);
  for (const args of [['brief'], ['status'], ['guide', id], ['doctor'], ['source', 'list'], ['skill', 'requirement-import', '--work', id], ['handoff', id]]) run(root, args, opts);
  driveChangeToDone(root, id);
  run(root, ['finish', id], { ...opts, ok: false });
  assert.equal(existsSync(marker), false, 'no command attempted network access');
});

test('config: requirements.providers is validated, and credentials are refused in config', async () => {
  const root = await freshProject();
  const configFile = path.join(workspacePath(root), 'config.yaml');
  const config = await readYaml(configFile);
  await writeYaml(configFile, { ...config, requirements: { providers: { jira: { baseUrl: 'https://acme.atlassian.net', token: 'x' } } } });
  const doctor = run(root, ['doctor'], { ok: false });
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /requirements\.providers\.jira has unknown field\(s\): token \(credentials never belong in config/);
  await writeYaml(configFile, { ...config, requirements: { providers: { jira: { baseUrl: 'https://acme.atlassian.net' } } } });
  assert.equal(run(root, ['doctor']).status, 0);
});
