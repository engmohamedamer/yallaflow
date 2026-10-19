import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ensureDir } from '../utils/fs.js';
import { loadWorkMetaOrThrow } from '../core/workspace.js';
import { redactSecrets } from '../security/redact.js';
import { artifactState, qualityDirPath } from './artifacts.js';
import { evaluateQc, loadQcLedger, loadQualitySettings } from './qc.js';
import { approvedCoverage, currentApproval, loadDemoLedger } from './demo.js';
import { DEMO_DISCLAIMER } from './constants.js';

// Local quality report (v1.1.0): work/<id>/quality/report.md (always) and a
// standalone report.html (static, inline CSS, no scripts, no external requests).
// Regenerated after every QC/demo write; every link is relative to the quality/
// directory, so it resolves on this machine. A media file that is not present (a
// fresh clone: media is git-excluded by default) or no longer matches its recorded
// hash is flagged, never silently linked.
export async function writeQualityReport(root, workId, now = new Date().toISOString()) {
  const meta = await loadWorkMetaOrThrow(root, workId);
  const sections = [];
  for (const section of [qcSection, demoSection]) {
    const built = await section(root, meta);
    if (built) sections.push(built);
  }
  const dir = qualityDirPath(root, workId);
  await ensureDir(dir);
  const title = `Quality report — ${meta.id}: ${meta.title ?? 'untitled'}`;
  const intro = `Generated ${now} by YallaFlow from this work item's QC and demo records. Local files only; nothing was uploaded.`;
  const markdown = [`# ${title}`, '', intro, '', ...sections.map((section) => section.markdown)].join('\n');
  const html = renderHtml(title, intro, sections);
  await writeFile(path.join(dir, 'report.md'), redactSecrets(`${markdown.trim()}\n`), 'utf8');
  await writeFile(path.join(dir, 'report.html'), redactSecrets(html), 'utf8');
  return { markdown: path.join(dir, 'report.md'), html: path.join(dir, 'report.html') };
}

async function qcSection(root, meta) {
  const { exists, ledger } = await loadQcLedger(root, meta.id);
  if (!exists) return null;
  const view = evaluateQc(ledger, meta, { configPolicy: (await loadQualitySettings(root)).qcPolicy });
  const md = ['## AI QC', ''];
  const blocks = [];
  const policyLine = `Policy: **${view.policy}**${view.approval ? ` — quality approval **${view.approval.granted ? 'GRANTED' : 'NOT GRANTED'}**${view.approval.granted ? '' : ` (${view.approval.reasons.join('; ')})`}` : ' — failures are reported and never block completion'}. Quality approval is separate from task completion.`;
  md.push(policyLine, '', `Plan ${view.plan.id}${view.plan.target ? ` against ${view.plan.target.baseUrl}` : ''} · ${view.runs} run(s).`, '');
  if (view.plan.criteriaNotCovered.length) md.push(`Acceptance criteria with no QC scenario: ${view.plan.criteriaNotCovered.join(', ')}.`, '');
  md.push('| Scenario | Kind | Criteria | Required | Latest result |', '|---|---|---|---|---|');
  for (const scenario of view.scenarios) {
    md.push(`| ${scenario.id} ${escapeCell(scenario.title)} | ${scenario.kind} | ${scenario.criteria.join(', ') || '—'} | ${scenario.required ? 'yes' : 'no'} | ${scenario.latest ? `${scenario.latest.status.toUpperCase()} (${scenario.latest.runId}${scenario.stale ? ', before the latest reopen' : ''})` : 'not run'} |`);
  }
  blocks.push({ heading: 'AI QC', paragraphs: [policyLine.replace(/\*\*/g, '')], table: view.scenarios.map((scenario) => [
    `${scenario.id} ${scenario.title}`, scenario.kind, scenario.criteria.join(', ') || '—', scenario.required ? 'yes' : 'no',
    scenario.latest ? `${scenario.latest.status.toUpperCase()} (${scenario.latest.runId})` : 'not run'
  ]), tableHead: ['Scenario', 'Kind', 'Criteria', 'Required', 'Latest result'] });

  for (const run of ledger.runs) {
    md.push('', `### ${run.id} — ${run.recordedAt} · ${run.origin} via ${run.tool}${run.target ? ` · ${run.target.baseUrl}` : ''}`, '');
    if (run.summary) md.push(run.summary, '');
    const items = [];
    for (const result of run.scenarios) {
      md.push(`- **${result.id} ${result.status.toUpperCase()}**${result.reason ? ` — ${result.reason}` : ''}`);
      if (result.steps?.length) md.push(...result.steps.map((step, index) => `  ${index + 1}. ${step}`));
      if (result.expected) md.push(`  - Expected: ${result.expected}`);
      if (result.actual) md.push(`  - Actual: ${result.actual}`);
      if (result.notes) md.push(`  - Notes: ${result.notes}`);
      const links = await artifactLinks(root, meta.id, result.artifacts ?? []);
      for (const link of links) md.push(`  - ${link.markdown}`);
      items.push({ title: `${result.id} ${result.status.toUpperCase()}`, result, links });
    }
    if (run.notReported?.length) md.push(`- Not reported in this run: ${run.notReported.join(', ')}`);
    if (run.limitations.length) md.push('', 'Limitations:', ...run.limitations.map((entry) => `- ${entry}`));
    blocks.push({ heading: `${run.id} — ${run.origin} via ${run.tool}`, run, items });
  }
  return { markdown: `${md.join('\n')}\n`, blocks };
}

// Smart Demo section: the approved scope, what each run showed, and links to the
// recordings — always under the disclaimer that a demo is not test evidence.
async function demoSection(root, meta) {
  const { exists, ledger } = await loadDemoLedger(root, meta.id);
  if (!exists) return null;
  const proposal = ledger.proposals.at(-1);
  const approved = currentApproval(ledger);
  const md = ['## Smart Demo', '', `> ${DEMO_DISCLAIMER}`, ''];
  const scopeLine = `Scope ${proposal.id}: ${approved ? `approved ${approved.approval.approvedAt} (${approved.approval.scenarios.join(', ')}) — ${approved.approval.note}` : 'awaiting the developer\'s approval; nothing may be recorded yet'}.`;
  md.push(scopeLine, '', '| # | Scenario | Audience | Criteria | Why it matters |', '|---|---|---|---|---|');
  for (const scenario of proposal.scenarios) md.push(`| ${scenario.priority} | ${scenario.id} ${escapeCell(scenario.title)} | ${scenario.audience} | ${scenario.criteria.join(', ') || '—'} | ${escapeCell(scenario.rationale)} |`);
  if (proposal.excluded.length) md.push('', 'Deliberately not shown:', ...proposal.excluded.map((item) => `- ${item.title} — ${item.reason}`));
  const coverage = approvedCoverage(ledger);
  const coverageLine = !coverage ? null : coverage.remaining.length
    ? `Approved, not yet shown in any recording: ${coverage.remaining.join(', ')}.`
    : coverage.runs.length ? `Every approved scenario has been shown (${[...coverage.shownIn].map(([scenarioId, runIds]) => `${scenarioId} in ${runIds.join(', ')}`).join('; ')}).` : null;
  if (coverageLine) md.push('', coverageLine);
  const blocks = [{
    heading: 'Smart Demo',
    paragraphs: [DEMO_DISCLAIMER, scopeLine, ...(coverageLine ? [coverageLine] : [])],
    tableHead: ['#', 'Scenario', 'Audience', 'Criteria', 'Why it matters'],
    table: proposal.scenarios.map((scenario) => [String(scenario.priority), `${scenario.id} ${scenario.title}`, scenario.audience, scenario.criteria.join(', ') || '—', scenario.rationale])
  }];
  for (const run of ledger.runs) {
    md.push('', `### ${run.id} — ${run.recordedAt}${run.audience ? ` · ${run.audience} audience` : ''} · via ${run.tool}${run.target ? ` · ${run.target.baseUrl}` : ''}`, '');
    if (run.summary) md.push(run.summary, '');
    const items = [];
    if (run.video) {
      const links = await artifactLinks(root, meta.id, [run.video]);
      md.push(`- Recording: ${links[0].markdown}`);
      items.push({ title: 'Recording', result: {}, links });
    } else {
      md.push('- No video recorded (recording is optional).');
    }
    for (const result of run.scenarios) {
      const planned = proposal.id === run.proposalId ? proposal.scenarios.find((scenario) => scenario.id === result.id) : ledger.proposals.find((entry) => entry.id === run.proposalId)?.scenarios.find((scenario) => scenario.id === result.id);
      md.push(`- **${result.id} ${result.status.toUpperCase()}** ${planned?.title ?? ''}${result.notes ? ` — ${result.notes}` : ''}`);
      const links = await artifactLinks(root, meta.id, result.artifacts ?? []);
      for (const link of links) md.push(`  - ${link.markdown}`);
      items.push({ title: `${result.id} ${result.status.toUpperCase()} ${planned?.title ?? ''}`.trim(), result: { notes: result.notes, steps: planned?.steps }, links });
    }
    if (run.limitations.length) md.push('', 'Limitations:', ...run.limitations.map((entry) => `- ${entry}`));
    blocks.push({ heading: `${run.id} — demo${run.audience ? ` (${run.audience})` : ''}`, paragraphs: [DEMO_DISCLAIMER], items });
  }
  return { markdown: `${md.join('\n')}\n`, blocks };
}

export async function artifactLinks(root, workId, artifacts) {
  const links = [];
  for (const artifact of artifacts) {
    const state = await artifactState(root, workId, artifact);
    const note = state === 'present' ? '' : state === 'missing' ? ' — **not on this machine** (media is local-only by default)' : state === 'unreadable' ? ' — **could not be read**' : state === 'unsafe' ? ' — **links outside the media folder; not shown**' : ' — **changed since recorded (hash mismatch)**';
    const traceHint = artifact.kind === 'trace' ? ` (open with \`npx playwright show-trace ${artifact.path}\`)` : '';
    links.push({ artifact, state, markdown: `${artifact.kind}: [${artifact.name}](${encodeURI(artifact.path)}) · ${artifact.sizeBytes} bytes · sha256 ${artifact.sha256.slice(0, 12)}…${traceHint}${note}` });
  }
  return links;
}

function renderHtml(title, intro, sections) {
  const body = [];
  for (const section of sections) {
    for (const block of section.blocks ?? []) {
      body.push(`<section><h2>${esc(block.heading)}</h2>`);
      for (const paragraph of block.paragraphs ?? []) body.push(`<p>${esc(paragraph)}</p>`);
      if (block.table) {
        body.push(`<table><thead><tr>${block.tableHead.map((cell) => `<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>`);
        for (const row of block.table) body.push(`<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`);
        body.push('</tbody></table>');
      }
      for (const item of block.items ?? []) {
        body.push(`<article><h3>${esc(item.title)}</h3>`);
        const result = item.result;
        if (result.reason) body.push(`<p>${esc(result.reason)}</p>`);
        if (result.description) body.push(`<p>${esc(result.description)}</p>`);
        if (result.steps?.length) body.push(`<ol>${result.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>`);
        if (result.expected) body.push(`<p><strong>Expected:</strong> ${esc(result.expected)}</p>`);
        if (result.actual) body.push(`<p><strong>Actual:</strong> ${esc(result.actual)}</p>`);
        if (result.notes) body.push(`<p><strong>Notes:</strong> ${esc(result.notes)}</p>`);
        for (const link of item.links) body.push(mediaHtml(link));
        body.push('</article>');
      }
      body.push('</section>');
    }
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#5f6368;--line:#dadce0;--ok:#137333;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#e8eaed;--muted:#9aa0a6;--line:#3c4043;--ok:#81c995;--bad:#f28b82}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:0 auto;padding:16px}
h1{font-size:1.4rem}h2{font-size:1.15rem;margin-top:2rem;border-bottom:1px solid var(--line)}h3{font-size:1rem}
p.meta,small{color:var(--muted)}table{border-collapse:collapse;width:100%;overflow-x:auto;display:block}
th,td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
article{border-left:3px solid var(--line);padding-left:12px;margin:12px 0}
video,img{max-width:100%;height:auto;border:1px solid var(--line)}.warn{color:var(--bad)}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="meta">${esc(intro)}</p>
${body.join('\n')}
</body>
</html>
`;
}

function mediaHtml(link) {
  const { artifact, state } = link;
  const href = esc(encodeURI(artifact.path));
  const caption = `${esc(artifact.kind)}: <a href="${href}">${esc(artifact.name)}</a> <small>${artifact.sizeBytes} bytes · sha256 ${esc(artifact.sha256.slice(0, 12))}…</small>`;
  if (state !== 'present') return `<p class="warn">${caption} — ${state === 'missing' ? 'not on this machine (media is local-only by default)' : state === 'unreadable' ? 'could not be read' : state === 'unsafe' ? 'links outside the media folder; not shown' : 'changed since recorded (hash mismatch)'}</p>`;
  if (artifact.kind === 'video') return `<figure><video controls preload="metadata" src="${href}"></video><figcaption>${caption}</figcaption></figure>`;
  if (artifact.kind === 'screenshot') return `<figure><img alt="${esc(artifact.name)}" src="${href}"><figcaption>${caption}</figcaption></figure>`;
  if (artifact.kind === 'trace') return `<p>${caption} <small>(open with <code>npx playwright show-trace ${esc(artifact.path)}</code>)</small></p>`;
  return `<p>${caption}</p>`;
}

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
