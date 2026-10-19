// v1.1.0 pilot feedback (football booking application): clearer QC plan rejections,
// demo coverage across several videos, dialog-handling guidance, natural-language
// routing to the on-demand skills — and QC/demo never starting without the developer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { agentContractBody } from '../src/agent/contract.js';
import { loadSkillInstructions } from '../src/skills/instructions.js';
import { createdWork, freshProject, routedBoundedChange, run, workspaceHash, writeJsonFile } from '../test-support/optional.js';

const quality = (root, id) => path.join(workspacePath(root), 'work', id, 'quality');

test('a rejected QC plan or demo proposal says what was rejected, and explains work without criteria', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-'));
  const id = routedBoundedChange(root);
  const plan = run(root, ['qc', 'plan', id, '--file', await writeJsonFile(dir, 'p.json', { scenarios: [{ id: 'S-01', kind: 'functional', title: 'Cancel a booking', criteria: ['AC-001'] }] })], { ok: false });
  assert.match(plan.stderr, /^QC plan rejected:/m);
  assert.doesNotMatch(plan.stderr, /QC record rejected/);
  assert.match(plan.stderr, /"AC-001" cannot be cited — PF-0001 has no recorded acceptance criteria; omit criteria and give the scenario a rationale instead/);
  const scope = run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 's.json', { scenarios: [{ id: 'D-01' }] })], { ok: false });
  assert.match(scope.stderr, /^Demo proposal rejected:/m);
});

test('one video per feature: scenarios shown in other recordings are not reported as "not shown"', async () => {
  const root = await freshProject();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-pilot-'));
  const id = routedBoundedChange(root);
  for (const name of ['booking.webm', 'cancel.webm']) await writeFile(path.join(dir, name), `video-${name}`);
  run(root, ['demo', 'propose', id, '--file', await writeJsonFile(dir, 'scope.json', { scenarios: [
    { id: 'D-01', title: 'Book a pitch', audience: 'business', priority: 1, rationale: 'Main flow.', steps: ['Book'], record: true },
    { id: 'D-02', title: 'Cancel a booking', audience: 'business', priority: 2, rationale: 'Refund rule.', steps: ['Cancel'], record: true },
    { id: 'D-03', title: 'Admin overview', audience: 'developer', priority: 3, rationale: 'Ops.', steps: ['Open admin'] }
  ] })]);
  run(root, ['demo', 'approve', id, '--note', 'Approved by the developer: "yes, three demos"']);
  const first = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r1.json', { tool: 'playwright-cli', video: path.join(dir, 'booking.webm'), scenarios: [{ id: 'D-01', status: 'shown' }] })]);
  assert.match(first.stdout, /Approved scope not yet shown in any recording: D-02, D-03/);
  run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r2.json', { tool: 'playwright-cli', video: path.join(dir, 'cancel.webm'), scenarios: [{ id: 'D-02', status: 'shown' }] })]);
  const third = run(root, ['demo', 'record', id, '--file', await writeJsonFile(dir, 'r3.json', { tool: 'playwright-cli', scenarios: [{ id: 'D-03', status: 'shown' }] })]);
  assert.match(third.stdout, /Every approved scenario has now been shown across the recordings\./);
  const md = await readFile(path.join(quality(root, id), 'report.md'), 'utf8');
  assert.doesNotMatch(md, /Approved but not shown/);
  assert.match(md, /Every approved scenario has been shown \(D-01 in DM-001; D-02 in DM-002; D-03 in DM-003\)\./);
  const ledger = JSON.parse(await readFile(path.join(quality(root, id), 'demo.json'), 'utf8'));
  assert.ok(ledger.runs.every((entry) => !('notShown' in entry)), 'no per-video "not shown" list is stored');
});

test('QC and demo guidance explains browser dialogs from real playwright-cli behavior', async () => {
  for (const skillId of ['ai-qc', 'smart-demo']) {
    const { text } = await loadSkillInstructions(skillId, 1);
    assert.match(text, /## Browser dialogs \(confirm, alert, prompt\)/, skillId);
    assert.match(text, /`### Modal state`/, skillId);
    assert.match(text, /does not handle the modal state/, skillId);
    assert.match(text, /playwright-cli dialog-accept/, skillId);
    assert.match(text, /playwright-cli dialog-dismiss/, skillId);
  }
});

test('natural-language requests map to the on-demand skills, which never start without the developer', async () => {
  const body = agentContractBody();
  assert.match(body, /The developer asks in their own words and never needs a command/);
  assert.match(body, /"Test this", "run QC", or "check the booking flow in the browser" means QC/);
  assert.match(body, /"Prepare a demo", "record a video of the new flow", or "show the client how it works" means Smart Demo/);
  assert.match(body, /never because work was initialized, implemented, completed, or passed QC, and a request to fix or build something is not a request for QC or a demo/);
  assert.match((await loadSkillInstructions('ai-qc', 1)).text, /does not need to know any command/);
  assert.match((await loadSkillInstructions('smart-demo', 1)).text, /Never start one because work was finished or a QC run passed/);

  // Nothing in the lifecycle creates QC or demo records by itself.
  const root = await freshProject();
  const id = createdWork(run(root, ['start', 'Test the booking page and record a demo video']).stdout);
  run(root, ['route', id, '--type', 'change', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Request text only.']);
  const before = await workspaceHash(root);
  for (const args of [['guide', id], ['status'], ['brief'], ['doctor']]) run(root, args);
  assert.equal(await workspaceHash(root), before);
  assert.match(run(root, ['qc', 'status', id]).stdout, /no QC requested/);
  assert.match(run(root, ['demo', 'status', id]).stdout, /no demo requested/);
});

test('a project set up by an earlier build of the same contract version receives the final text on refresh', async () => {
  const { AGENT_CONTRACT_VERSION, inspectAgentContract, renderAgentContractBlock } = await import('../src/agent/contract.js');
  const root = await freshProject();
  const file = path.join(workspacePath(root), 'AGENT.md');
  const earlier = renderAgentContractBlock(AGENT_CONTRACT_VERSION, '# YallaFlow Agent Contract\n\nEarlier pre-release wording.\n');
  await writeFile(file, `${earlier}\n## Team notes\n\nKeep this.\n`);
  assert.deepEqual(await inspectAgentContract(root), { state: 'outdated', installed: AGENT_CONTRACT_VERSION, version: AGENT_CONTRACT_VERSION, sameVersion: true });
  assert.match(run(root, ['agent', 'status']).stdout, /generated by an earlier build of v\d+/);
  run(root, ['agent', 'refresh']);
  const refreshed = await readFile(file, 'utf8');
  assert.ok(refreshed.includes(renderAgentContractBlock()), 'the final contract text is installed');
  assert.match(refreshed, /## Team notes\n\nKeep this\./, 'content outside the block is preserved');
  assert.match(run(root, ['agent', 'refresh']).stdout, /nothing changed/);
  // A hand-edited block is still refused, never silently replaced.
  await writeFile(file, refreshed.replace('# YallaFlow Agent Contract', '# YallaFlow Agent Contract (edited)'));
  assert.equal((await inspectAgentContract(root)).state, 'modified');
  assert.notEqual(run(root, ['agent', 'refresh'], { ok: false }).status, 0);
});
