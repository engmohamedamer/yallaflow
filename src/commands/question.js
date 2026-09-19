import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import { addQuestion, answerQuestion, loadWorkQuestions, resolveQuestion, summarizeQuestions } from '../questions/store.js';
import { loadWorkMeta } from '../knowledge/store.js';

export async function questionCommand(action, requestedWorkId, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error(`No active work item. Provide a work ID: \`yallaflow question ${action} PF-0001 ...\`.`);

  if (action === 'add') {
    const result = await addQuestion(root, workId, options);
    console.log(`Added ${result.entry.id} [${result.entry.category}] ${result.entry.status}`);
    console.log(result.entry.question);
    if (result.entry.proposal) console.log(`Proposal: ${result.entry.proposal}`);
    console.log(`Material: ${result.entry.material ? 'yes' : 'no'}`);
    return;
  }
  if (action === 'answer') {
    const result = await answerQuestion(root, workId, options.questionId, options.answer);
    console.log(`${result.entry.id}: answered`);
    console.log(result.entry.answer);
    console.log('Next: resolve the question when the answer is accepted.');
    return;
  }
  if (action === 'resolve') {
    const result = await resolveQuestion(root, workId, options.questionId, options.resolution);
    console.log(`${result.entry.id}: resolved`);
    console.log(result.entry.resolution);
    return;
  }
  if (action === 'list') {
    const meta = await loadWorkMeta(root, workId);
    const loaded = await loadWorkQuestions(root, meta);
    const summary = summarizeQuestions(loaded.ledger);
    console.log(`${workId} open decisions: ${summary.open.length}`);
    for (const category of ['business', 'architecture']) {
      const entries = summary.byCategory[category];
      if (!entries.length) continue;
      console.log(`\n${capitalize(category)}:`);
      for (const entry of entries) {
        console.log(`- ${entry.id} [${entry.status}]${entry.material ? ' [material]' : ''} ${entry.question}`);
        if (entry.proposal) console.log(`  Proposal: ${entry.proposal}`);
        if (entry.answer) console.log(`  Answer: ${entry.answer}`);
      }
    }
    if (!summary.open.length) console.log('(no open decisions)');
    console.log(`Resolved: ${summary.resolved.length}`);
    return;
  }
  throw new Error(`Unknown question action: ${action}. Use add, list, answer, or resolve.`);
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
