// v0.3.10 synthetic team pilot: one approved Brownfield baseline shared through Git,
// three developers on three branches (two backend areas, one frontend area) starting
// from the same memory base, a clean integration, a conflicting one that is refused
// without corrupting memory, and a fresh fourth developer who reads one current
// project truth with no repository-wide rescan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { contextLedgerPath, loadContextLedger } from '../src/context/ledger.js';
import { loadWorkMemory } from '../src/shared/memory.js';
import { ledgerFingerprint } from '../src/shared/fingerprint.js';
import { cli, commitAll, complete, developer, git, investigation, learn, mergeBranch, sharedTeam } from '../test-support/shared.js';

async function work(team, name, tag, branch, title, knowledge) {
  const root = await developer(team, name, tag, branch);
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /Project understanding: established/, `${name} starts from the shared understanding`);
  assert.doesNotMatch(brief, /Repository: .* by inventory/, `${name} triggers no repository inventory scan`);
  const workId = await investigation(root, title);
  await learn(root, workId, knowledge);
  await complete(root, workId);
  commitAll(root, `${name}: ${title}`);
  const finish = cli(root, ['finish', workId]).stdout;
  assert.match(finish, /Ready to push\.\n$/, `${name} is told only what matters`);
  assert.doesNotMatch(finish, /PF-|CTX-|K-\d/);
  git(root, ['push', '-q', 'origin', branch]);
  return { root, workId };
}

test('pilot scenario 1 (36–39, 41): three developers, one memory base, independent deltas integrate cleanly; developer D reads one truth', async () => {
  const team = await sharedTeam();
  const base = ledgerFingerprint((await loadContextLedger(team.maintainer)).ledger);

  const a = await work(team, 'Backend A', 'AAAAAAAAAA', 'feature/refunds', 'Partial refunds',
    { kind: 'business-rule', summary: 'Refunds may be partial; the refunded amount never exceeds the paid amount.', evidence: ['backend/refunds/refunds.js'] });
  const b = await work(team, 'Backend B', 'BBBBBBBBBB', 'fix/invoice-total', 'Invoice totals include tax',
    { kind: 'business-rule', summary: 'Invoice totals are the sum of line amounts plus 15% tax.', evidence: ['backend/invoices/totals.js', 'backend/invoices/tax.js'], supersedes: 'CTX-0005' });
  const c = await work(team, 'Frontend C', 'CCCCCCCCCC', 'feature/invoice-ui', 'Invoice UI review',
    { kind: 'convention', summary: 'UI components are function components in frontend/ui.', evidence: ['frontend/ui/InvoiceView.jsx'], reconfirms: 'CTX-0006' });

  // 36/37: all three started from the same memory base.
  for (const dev of [a, b, c]) assert.equal((await loadWorkMemory(dev.root, dev.workId)).record.contextBase.ledgerFingerprint, base);
  // 38: independent work items, no shared file touched on any branch.
  for (const dev of [a, b, c]) {
    const changed = git(dev.root, ['diff', '--name-only', 'origin/main', 'HEAD']).stdout.trim().split('\n');
    assert.ok(changed.every((file) => file.startsWith(`.yallaflow/work/${dev.workId}/`)), `${dev.workId} touched only its own work directory:\n${changed.join('\n')}`);
  }

  // 39: merge all three (any order) and integrate once on main.
  for (const branch of ['fix/invoice-total', 'feature/invoice-ui', 'feature/refunds']) assert.equal(mergeBranch(team.maintainer, branch).status, 0);
  assert.match(cli(team.maintainer, ['shared', 'check']).stdout, /Result: PASS/);
  assert.match(cli(team.maintainer, ['shared', 'integrate']).stdout, /Integrated 3 project-knowledge update\(s\)/);
  assert.match(cli(team.maintainer, ['doctor']).stdout, /Workspace healthy/);
  commitAll(team.maintainer, 'Integrate shared project memory');
  git(team.maintainer, ['push', '-q', 'origin', 'main']);
  const truth = await readFile(contextLedgerPath(team.maintainer), 'utf8');

  // 41: a fresh fourth developer — one brief, the same understanding, no rescan.
  const d = await developer(team, 'Developer D', 'DDDDDDDDDD');
  assert.equal(await readFile(contextLedgerPath(d), 'utf8'), truth);
  const brief = cli(d, ['brief']).stdout;
  assert.match(brief, /Project understanding: established — 7 current project fact\(s\), Brownfield baseline approved/);
  assert.match(brief, /Shared project: on — integration branch main; this checkout: main · memory [0-9a-f]{12} · pending knowledge integrations: 0/);
  assert.match(brief, /Business Rules \(3\): CTX-0004 Refunds are allowed within 30 days\./);
  assert.doesNotMatch(brief, /Repository: .* by inventory|baseline start|PROJECT_UNDERSTANDING_REQUIRED/);
  const taxFact = (await loadContextLedger(d)).ledger.facts.find((fact) => fact.summary.includes('plus 15% tax'));
  assert.deepEqual(taxFact.supersedes, ['CTX-0005']);
  assert.match(cli(d, ['context', 'show', taxFact.id]).stdout, new RegExp(`Introduced by: ${b.workId} \\(K-001\\)`));
  assert.match(cli(d, ['context', 'show', 'CTX-0005']).stdout, /superseded/);
  assert.doesNotMatch(cli(d, ['start', 'Add credit notes']).stdout, /PROJECT_UNDERSTANDING/);
  assert.equal((await readdir(path.join(workspacePath(d), 'work'))).filter((id) => id.startsWith('PF-DDDDDDDDDD')).length, 1);
});

test('pilot scenario 2 (40): A and B change the same fact differently — integration refuses silent overwrite, memory stays healthy', async () => {
  const team = await sharedTeam();
  await work(team, 'Backend A', 'AAAAAAAAAA', 'feature/refunds', 'Refund window',
    { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  await work(team, 'Backend B', 'BBBBBBBBBB', 'fix/refund-window', 'Refund window (finance)',
    { kind: 'business-rule', summary: 'Refunds are allowed within 45 days for enterprise customers.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  await work(team, 'Frontend C', 'CCCCCCCCCC', 'feature/invoice-ui', 'Invoice UI',
    { kind: 'architecture', summary: 'The invoice screen is rendered by frontend/ui/InvoiceView.jsx.', evidence: ['frontend/ui/InvoiceView.jsx'] });
  for (const branch of ['feature/refunds', 'fix/refund-window', 'feature/invoice-ui']) assert.equal(mergeBranch(team.maintainer, branch).status, 0);

  const before = (await loadContextLedger(team.maintainer)).ledger;
  const result = cli(team.maintainer, ['shared', 'integrate'], false);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Integrated 1 project-knowledge update/);
  assert.match(result.stdout, /PF-AAAAAAAAAA-0001 K-001: CTX-0004 is also changed by PF-BBBBBBBBBB-0001 K-001 \(supersedes\)/);
  assert.match(result.stdout, /PF-BBBBBBBBBB-0001 K-001: CTX-0004 is also changed by PF-AAAAAAAAAA-0001 K-001 \(supersedes\)/);
  const after = (await loadContextLedger(team.maintainer)).ledger;
  const fact = (ledger) => ledger.facts.find((item) => item.id === 'CTX-0004');
  assert.deepEqual(fact(after), fact(before), 'the contested fact is untouched');
  assert.equal(after.facts.length, before.facts.length + 1);
  assert.match(cli(team.maintainer, ['doctor']).stdout, /Workspace healthy/);
  assert.match(cli(team.maintainer, ['shared', 'check'], false).stdout, /Result: FAIL[\s\S]*never overwrites shared memory silently/);
  assert.match(cli(team.maintainer, ['shared', 'status', '--verbose']).stdout, /2 need reconciliation/);
});
