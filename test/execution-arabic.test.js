// PF-0112 Phase 2 (owner Checkpoint D, SRC-0060): every execution message the console can show
// has an Arabic copy. The messages are read from the source itself (template parts become a
// sample value), so a new English message without a translation fails this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { toArabic, withArabic } from '../src/execution/arabic.js';

const SRC = (file) => fileURLToPath(new URL(`../src/${file}`, import.meta.url));
// Messages the console shows. git-ops argument checks (invalid(...)) and the CLI-only integration
// record errors are developer-tool output and stay English by design.
const FILES = ['execution/review.js', 'execution/merge.js', 'execution/lanes.js', 'execution/manager.js', 'execution/git-ops.js', 'execution/messages.js'];
const SHAPES = [
  /(?:block|pass|warn)\('[a-z]+', ([`'])((?:(?!\1)[^\\]|\\.)*)\1/g,
  /new Stop\('[a-z-]+', ([`'])((?:(?!\1)[^\\]|\\.)*)\1/g,
  /blockers\.push\(([`'])((?:(?!\1)[^\\]|\\.)*)\1/g,
  /blockers\.push\(\{ code: '[A-Z_]+', message: ([`'])((?:(?!\1)[^\\]|\\.)*)\1/g,
  /fail\(\d+, '[A-Z_]+', ([`'])((?:(?!\1)[^\\]|\\.)*)\1/g,
  /GitOpsError\('(?:GIT_SUBMODULES|GIT_PATH_ENCODING|GIT_UNVERIFIED_PLATFORM|GIT_EXTERNAL_DRIVERS|LANE_NOT_WORKTREE|SCOPE_CHANGED|SIGNING_UNSUPPORTED|INDEX_MISMATCH|GIT_BUSY|BRANCH_EXISTS)', ([`'])((?:(?!\1)[^\\]|\\.)*)\1/g,
  /reason: ([`'])((?:(?!\1)[^\\]|\\.)*)\1 \}/g
];
// Fill ${...} with a sample word; drop nested template parts the regex cannot see whole.
const sample = (template) => template.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, 'X1').replace(/\\'/g, "'");
// Skipped: templates whose real values the sampler cannot form (each real form has a rule:
// 'main checkout' / 'lane', closed / on hold, nested lists) and task reason codes, which the
// console labels itself (REASON_LABEL).
const SKIP = [/^preview$/, /^The \$\{label\}/, /^Unknown step/, /^$/, /^Git is busy in the \$\{where\}/, /^Knowledge from this lane conflicts/, /^The checks run in the lane together/, /^\$\{workId\} is \$\{item\.lifecycle/, /^crashed$/, /^cancelled (?:after the current task|by you)$/];

test('every console-facing execution message has an Arabic copy', async () => {
  const missing = [];
  let seen = 0;
  for (const file of FILES) {
    const text = await readFile(SRC(file), 'utf8');
    for (const shape of SHAPES) for (const match of text.matchAll(shape)) {
      const template = match[2];
      if (SKIP.some((pattern) => pattern.test(template)) || template.includes('`')) continue;
      seen++;
      const english = sample(template);
      const arabic = toArabic(english);
      if (!arabic || /[A-Za-z]{4,} [a-z]{3,} [a-z]{3,}/.test(arabic.replace(/X1|yallaflow [a-z ]+|\.yallaflow\/\S+|Git \w+|Shared Project Mode|merge drivers|skip-worktree|assume-unchanged/g, ''))) missing.push(`${file}: ${english}${arabic ? `\n    → ${arabic}` : ''}`);
    }
  }
  assert.ok(seen > 80, `found ${seen} messages`);
  assert.deepEqual(missing, []);
});

test('composed messages are translated piece by piece; names and paths stay as they are; unknown text stays English', () => {
  const composed = 'Your main checkout has staged changes. Commit or unstage them first; YallaFlow never commits them. backend/x.js exists in your main checkout (ignored or untracked) and the merge adds it; it would be overwritten. Nothing was changed.';
  const arabic = toArabic(composed);
  assert.match(arabic, /backend\/x\.js موجود في المشروع الأساسي/);
  assert.match(arabic, /مفيش حاجة اتغيرت\.$/);
  assert.equal(toArabic('Something new and untranslated.'), null);
  // The real forms of the templates the coverage test skips.
  assert.equal(toArabic('Git is busy in the main checkout (index.lock).'), 'Git مشغول في المشروع الأساسي (index.lock).');
  assert.equal(toArabic('Git is busy in the lane (MERGE_HEAD).'), 'Git مشغول في المسار (MERGE_HEAD).');
  assert.equal(toArabic('PF-0003 is on hold.'), 'PF-0003 متوقفة مؤقتاً.');
  assert.match(toArabic('The checks run in the lane together with files Git ignores, which this review does not show: node_modules/, build/. Programs in them (for example node_modules/.bin) run with your permissions.'), /^الفحوص بتشتغل في المسار/);
  assert.match(toArabic('Knowledge from this lane conflicts with project memory changed in parallel: PF-1 K-001.'), /^المعرفة اللي في المسار ده بتتعارض/);
  const body = withArabic({ error: { code: 'X', message: 'Unknown lane.' }, readiness: [{ id: 'task', text: 'Not DONE yet: PF-1.' }], merges: [{ reason: 'The lane moved since you approved it.' }] });
  assert.equal(body.error.messageAr, 'مسار مش معروف.');
  assert.equal(body.readiness[0].textAr, 'لسه ما خلصتش (DONE): PF-1.');
  assert.equal(body.merges[0].reasonAr, 'المسار اتحرك من ساعة ما وافقت.');
});
