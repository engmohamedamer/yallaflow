import { evaluateConvergence } from './convergence.js';
import { describeTrigger } from './impact.js';
import { convergenceRequired } from './policy.js';

// One compact, read-only delivery block shared by guide, resume, handoff, and brief
// (v0.3.8): intent size, convergence counts, blocking criteria, open unrequested
// behavior, and any pending impact. It never lists the full ledgers.
const LIMIT = 5;

export async function loadDeliverySummary(root, meta) {
  if (!convergenceRequired(meta) || meta.routingStatus === 'pending') return { applies: false, pendingImpact: null, lines: [] };
  const convergence = await evaluateConvergence(root, meta);
  return { applies: true, pendingImpact: convergence.pendingImpact, convergence, lines: deliveryLines(meta, convergence) };
}

function deliveryLines(meta, convergence) {
  const lines = [];
  const activeRequirements = convergence.requirements.filter((entry) => entry.status === 'active').length;
  const intent = convergence.source === 'none'
    ? 'no requirements recorded yet'
    : `${activeRequirements} requirement(s) · ${convergence.criteria.length} acceptance ${convergence.criteria.length === 1 ? 'criterion' : 'criteria'}${convergence.source === 'inherited' ? ` (assigned from ${convergence.owner})` : ''}`;
  lines.push(`Delivery intent: ${intent} · convergence required`);
  if (convergence.criteria.length && !convergence.assessments) {
    lines.push(`Convergence: not assessed yet (${convergence.criteria.length} criteria to assess once implementation is reached)`);
  } else if (convergence.criteria.length) {
    const { counts } = convergence;
    lines.push(`Convergence: satisfied ${counts.satisfied} · partial ${counts.partial} · missing ${counts.missing} · contradicts ${counts.contradicts} · not assessed ${counts['not-assessed']}${counts.stale ? ` · stale ${counts.stale}` : ''}` +
      (convergence.latestAssessment ? ` (latest ${convergence.latestAssessment.id})` : ''));
  }
  const gaps = convergence.assessments ? convergence.criteria.filter((entry) => entry.status !== 'satisfied' || entry.stale) : [];
  if (gaps.length) {
    const shown = gaps.slice(0, LIMIT).map((entry) => `${entry.ref} (${entry.stale ? 'stale' : entry.status})`);
    lines.push(`${meta.status === 'DONE' ? 'No longer current since DONE' : 'Blocking criteria'}: ${shown.join(', ')}${gaps.length > LIMIT ? `, … ${gaps.length - LIMIT} more` : ''}`);
  }
  const open = convergence.unrequested.filter((item) => item.disposition === 'open');
  if (open.length) lines.push(`Unrequested behavior open: ${open.map((item) => item.id).join(', ')}`);
  if (convergence.pendingImpact) {
    const impact = convergence.pendingImpact;
    lines.push(`IMPACT ${impact.id} PENDING: ${impact.triggers.map(describeTrigger).join('; ')} — assess before continuing (yallaflow impact status ${meta.id})`);
  }
  if (meta.status === 'DONE' && gaps.length) {
    lines.push('DONE is history and is not rewritten; revalidate through a reopen if the delivered intent must hold now.');
  } else if (meta.status !== 'DONE' && !convergence.pendingImpact && (gaps.length || open.length)) {
    lines.push(`Next convergence action: resolve the gaps, then yallaflow convergence record ${meta.id} --file convergence.json`);
  }
  return lines;
}
