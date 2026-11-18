// Project health check (PF-0183, 1.5.5). Read-only: it reads the workspace and writes nothing,
// not even a lock. It reuses what YallaFlow already checks — doctor's integrity report, the
// workspace assessment (compatibility, project memory, legacy reconciliation), the agent
// contract and bootstrap inspectors, the refresh plan — and turns them into one answer a
// developer can act on:
//
//   healthy           nothing to do
//   update-available  YallaFlow can refresh its own files (`yallaflow refresh preview`)
//   repairable        something is missing or was interrupted, and a YallaFlow command fixes it
//   manual-review     a person has to decide (edited managed text, integrity failures, legacy
//                     context to reconcile); nothing is changed automatically
//   unsafe            do not update with this YallaFlow: a link leaves the project, the project
//                     needs a newer YallaFlow, or a file was written by one
//
// The overall class is the most serious finding.
import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { assessWorkspace } from './assessment.js';
import { listRefreshBackups, missingBootstrapText, planRefresh } from '../agent/refresh.js';
import { checkProjectCompatibility } from '../shared/config.js';
import { PACKAGE_VERSION } from '../version.js';

export const HEALTH_CLASSES = Object.freeze(['healthy', 'update-available', 'repairable', 'manual-review', 'unsafe']);
export const HEALTH_LABELS = Object.freeze({
  healthy: 'Healthy',
  'update-available': 'Update available',
  repairable: 'Repairable',
  'manual-review': 'Needs manual review',
  unsafe: 'Unsafe to update'
});
const rank = (value) => HEALTH_CLASSES.indexOf(value);
const SCAN_LIMIT = 50_000;

// Links inside .yallaflow: YallaFlow never creates one. A link that leaves the project (or
// dangles) could redirect a write; one inside it is unusual and worth a look. Bounded walk,
// links never followed.
async function scanWorkspaceLinks(root) {
  const realRoot = await realpath(root);
  const inside = (target) => target === realRoot || target.startsWith(`${realRoot}${path.sep}`);
  const found = { outside: [], inside: [], truncated: false };
  const top = path.join(root, '.yallaflow');
  const topInfo = await lstat(top).catch(() => null);
  if (!topInfo) return found;
  if (topInfo.isSymbolicLink()) {
    found.outside.push('.yallaflow');
    return found;
  }
  const queue = [top];
  let seen = 0;
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++seen > SCAN_LIMIT) { found.truncated = true; return found; }
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const relative = path.relative(root, full).split(path.sep).join('/');
        let target = null;
        try { target = await realpath(full); } catch { target = null; }
        if (!target || !inside(target)) found.outside.push(`${relative}${target ? '' : ' (dangling)'}`);
        else found.inside.push(`${relative} -> ${await readlink(full).catch(() => '?')}`);
      } else if (entry.isDirectory()) {
        queue.push(full);
      }
    }
  }
  return found;
}

const finding = (cls, area, message, next = null) => ({ class: cls, area, message, ...(next ? { next } : {}) });

const REFRESH_FINDINGS = {
  update: (item) => finding('update-available', 'agent-integration', `${item.file}: a newer YallaFlow ${item.kind === 'contract' ? 'agent contract' : 'bootstrap block'} is available (${item.reason}).`, 'yallaflow refresh preview'),
  replace: (item) => finding('update-available', 'agent-integration', `${item.file} is ${item.reason}; it can be replaced with the current contract.`, 'yallaflow refresh preview'),
  create: (item) => finding('repairable', 'agent-integration', `${item.file} is missing. Agents read it at the start of every session.`, 'yallaflow refresh apply'),
  conflict: (item) => finding('manual-review', 'agent-integration', `${item.file}: ${item.reason}. YallaFlow will not replace it without your decision.`, `yallaflow refresh preview --resolve ${item.file}=preserve   (or =keep)`),
  refuse: (item) => finding(item.severity === 'unsafe' ? 'unsafe' : 'manual-review', 'agent-integration', `${item.file}: ${item.reason}.`, item.state === 'newer' ? 'install the newer YallaFlow this project was updated with' : null)
};

export async function assessHealth(root) {
  const findings = [];
  const notes = [];

  // 1. Can this YallaFlow work on the project at all?
  const compat = await checkProjectCompatibility(root);
  if (!compat.compatible) findings.push(finding('unsafe', 'compatibility', `This project requires YallaFlow ${compat.required} or later; ${PACKAGE_VERSION} is installed.`, `npm install -g yallaflow@${compat.required}`));

  const links = await scanWorkspaceLinks(root);
  for (const entry of links.outside) findings.push(finding('unsafe', 'workspace-safety', `${entry} is a link that leaves the project or points nowhere. YallaFlow refuses to update through it.`, 'replace the link with the real folder or file'));
  for (const entry of links.inside) findings.push(finding('manual-review', 'workspace-safety', `${entry} is a link inside the workspace; YallaFlow never creates links there.`, 'check that it is intended'));
  if (links.truncated) notes.push(`The workspace link scan stopped after ${SCAN_LIMIT} entries.`);
  if (links.outside.includes('.yallaflow')) return summarize(findings, notes);

  // 2. YallaFlow's own files (agent contract and bootstrap blocks).
  let plan = null;
  try {
    plan = await planRefresh(root);
  } catch (error) {
    findings.push(finding('manual-review', 'agent-integration', `The agent integration files could not be checked: ${error.message}`));
  }
  if (plan) {
    for (const item of plan.items) {
      const make = REFRESH_FINDINGS[item.action];
      if (make) findings.push(make(item));
    }
    const missing = plan.items.filter((item) => item.action === 'add');
    if (missing.length) {
      const text = missingBootstrapText(missing);
      if (text.repairable && missing.length === plan.items.filter((item) => item.kind === 'bootstrap').length) findings.push(finding('repairable', 'agent-integration', text.repairable, 'yallaflow refresh apply --add-missing'));
      else notes.push(...(text.notes ?? [text.repairable]));
    }
  }

  // 3. An interrupted refresh.
  const [latest] = await listRefreshBackups(root);
  if (latest && ['started', 'failed-verification'].includes(latest.state)) {
    findings.push(finding('repairable', 'refresh', `The refresh started ${latest.createdAt} did not finish (${latest.files.map((file) => file.file).join(', ')}). The files from before it are backed up.`, `yallaflow refresh restore ${latest.id}   (or run yallaflow refresh apply again to finish it)`));
  }

  // 4. Workspace integrity, memory, history, compatibility of the stored data.
  let report = null;
  try {
    report = await assessWorkspace(root);
  } catch (error) {
    findings.push(finding('manual-review', 'integrity', `The workspace could not be read completely: ${error.message}`, 'yallaflow doctor'));
  }
  if (report) {
    if (!report.schema.supported && report.schema.exists) {
      findings.push(finding(report.schema.newer ? 'unsafe' : 'manual-review', 'compatibility', report.schema.newer ? `Project memory was written by a newer YallaFlow (context schema v${report.schema.version}).` : 'Project memory (.yallaflow/context/index.yaml) has an unknown or unreadable format.', report.schema.newer ? 'install the newer YallaFlow' : 'yallaflow doctor'));
    }
    for (const failure of report.doctor.failures) {
      if (failure === 'AGENT.md') continue; // reported by the integration check above
      if (/projection drift|missing its managed project-context block/.test(failure)) {
        findings.push(finding('repairable', 'project-memory', firstSentence(failure), 'yallaflow context render'));
      } else {
        findings.push(finding('manual-review', 'integrity', `Integrity check failed: ${firstSentence(failure)}`, 'yallaflow doctor'));
      }
    }
    if (report.reconciliation || report.pendingLegacy.length) {
      findings.push(finding('manual-review', 'project-memory', `${report.pendingLegacy.length} older project-context item(s) wait to be reconciled into current project memory; that needs your decisions.`, report.reconciliation?.nextAction ?? 'yallaflow context reconcile start'));
    }
    for (const warning of report.gitWarnings) notes.push(warning);
    notes.push(`${report.work.length} work item(s), ${report.sources.length} source(s)${report.memory.exists ? `, ${report.memory.totals.current} current project fact(s)` : ''}.`);
  }
  return summarize(findings, notes);
}

function firstSentence(text) {
  const value = String(text).replace(/\s+/g, ' ').trim();
  return value.length > 300 ? `${value.slice(0, 297)}…` : value;
}

function summarize(findings, notes) {
  const overall = findings.reduce((worst, item) => (rank(item.class) > rank(worst) ? item.class : worst), 'healthy');
  findings.sort((a, b) => rank(b.class) - rank(a.class));
  return { schema: 'yallaflow.health/1', version: PACKAGE_VERSION, overall, label: HEALTH_LABELS[overall], findings, notes };
}

export async function workspaceExists(root) {
  return Boolean(await stat(path.join(root, '.yallaflow')).catch(() => null));
}
