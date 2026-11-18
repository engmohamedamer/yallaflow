// PF-0174: an answer reaches the agent working on the item. Answering a question records it in
// YallaFlow (the console's answer action, through Core); when the item's own Codex session is up
// and idle, the same action also sends the answer to it, so the developer acts once. Delivery is
// reported as it really happened: 'sent' only when the session took the message and its turn
// started. Nothing else is started: no new session, no other item's session, no busy session.
// → { state: 'sent' | 'no-session' | 'other-item' | 'busy' | 'manual' | 'failed', workId?, message? }
export function answerText(workId, body) {
  const given = typeof body?.deliverText === 'string' ? body.deliverText.trim() : '';
  // PF-0181: the page's own wording (its language) is used only when it carries the exact answer
  // being recorded and the item; otherwise the text is built here from what is recorded.
  const answer = String(body?.answer ?? '').trim();
  if (given && answer && given.length <= 20_000 && !given.includes('\0') && given.includes(answer) && given.includes(workId)) return given;
  return `I answered ${String(body?.question ?? '')} for ${workId}: ${String(body?.answer ?? '').trim()}\nIt is recorded in YallaFlow. Continue ${workId} to the end; stop only if you need a decision from me.`;
}

export async function deliverAnswer(bridge, projectId, workId, body) {
  if (!bridge) return { state: 'no-session' };
  const glance = bridge.glance(projectId);
  const session = glance?.session ?? null;
  if (!session) return { state: 'no-session' };
  if (session.provider !== 'codex') return { state: 'manual' };
  if (session.workId !== workId) return { state: 'other-item', workId: session.workId ?? null };
  if (session.status !== 'idle' || (glance.pending ?? []).length) return { state: 'busy' };
  try {
    await bridge.message(projectId, answerText(workId, body));
  } catch (error) {
    return { state: error.code === 'SESSION_BUSY' ? 'busy' : 'failed', message: String(error.message ?? error).slice(0, 300) };
  }
  const after = bridge.glance(projectId)?.session;
  return after?.status === 'working' ? { state: 'sent' } : { state: 'failed', message: 'The agent did not start working on the answer.' };
}
