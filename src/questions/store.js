import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { QUESTION_CATEGORIES, QUESTION_SCHEMA_VERSION, QUESTION_STATUSES } from './constants.js';

const LEDGER_FIELDS = new Set(['version', 'questions', 'updatedAt']);
const QUESTION_FIELDS = new Set([
  'id', 'category', 'question', 'status', 'material', 'proposal', 'answer', 'resolution',
  'createdAt', 'updatedAt', 'resolvedAt'
]);

export function questionsFilePath(root, workId) {
  return path.join(workspacePath(root), 'work', workId, 'questions.yaml');
}

export async function loadWorkQuestions(root, meta) {
  const file = questionsFilePath(root, meta.id);
  if (!await exists(file)) return { exists: false, ledger: emptyLedger() };
  const ledger = await readYaml(file);
  validateQuestionsLedger(ledger, meta.id);
  return { exists: true, ledger: cloneLedger(ledger) };
}

export async function addQuestion(root, workId, input, now = new Date().toISOString()) {
  const meta = await loadMeta(root, workId);
  if (meta.routingStatus === 'pending') throw new Error(`${workId} is awaiting routing. Route the work before adding questions.`);
  if (!QUESTION_CATEGORIES.includes(input.category)) {
    throw new Error(`category must be one of: ${QUESTION_CATEGORIES.join(', ')}; received ${JSON.stringify(input.category)}.`);
  }
  const question = normalizeText(input.question, '--text must be a non-empty question.');
  const proposal = input.proposal === undefined ? undefined : normalizeText(input.proposal, '--proposal must be non-empty when supplied.');
  if (proposal && input.category !== 'architecture') {
    throw new Error('--proposal is only valid for architecture questions.');
  }
  const loaded = await loadWorkQuestions(root, meta);
  const entry = {
    id: nextQuestionId(loaded.ledger.questions),
    category: input.category,
    question,
    status: proposal ? 'proposed' : 'open',
    material: input.material !== false,
    ...(proposal ? { proposal } : {}),
    createdAt: now,
    updatedAt: now
  };
  loaded.ledger.questions.push(entry);
  loaded.ledger.updatedAt = now;
  await writeQuestionsLedger(root, workId, loaded.ledger);
  return { meta, entry, ledger: loaded.ledger };
}

export async function answerQuestion(root, workId, questionId, answer, now = new Date().toISOString()) {
  const meta = await loadMeta(root, workId);
  const loaded = await loadWorkQuestions(root, meta);
  const entry = requireQuestion(loaded.ledger, questionId);
  if (entry.status === 'resolved') throw new Error(`Question ${questionId} is already resolved.`);
  entry.answer = normalizeText(answer, 'Answering a question requires a non-empty --answer.');
  entry.status = 'answered';
  entry.updatedAt = now;
  loaded.ledger.updatedAt = now;
  await writeQuestionsLedger(root, workId, loaded.ledger);
  return { meta, entry, ledger: loaded.ledger };
}

export async function resolveQuestion(root, workId, questionId, resolution, now = new Date().toISOString()) {
  const meta = await loadMeta(root, workId);
  const loaded = await loadWorkQuestions(root, meta);
  const entry = requireQuestion(loaded.ledger, questionId);
  if (entry.status === 'resolved') throw new Error(`Question ${questionId} is already resolved.`);
  const finalResolution = resolution ?? entry.answer ?? entry.proposal;
  entry.resolution = normalizeText(finalResolution, 'Resolving a question requires --resolution, a recorded answer, or a recorded proposal.');
  entry.status = 'resolved';
  entry.resolvedAt = now;
  entry.updatedAt = now;
  loaded.ledger.updatedAt = now;
  await writeQuestionsLedger(root, workId, loaded.ledger);
  return { meta, entry, ledger: loaded.ledger };
}

export function summarizeQuestions(ledger) {
  const open = ledger.questions.filter((entry) => entry.status !== 'resolved');
  const materialOpen = open.filter((entry) => entry.material);
  return {
    totalCount: ledger.questions.length,
    open,
    materialOpen,
    resolved: ledger.questions.filter((entry) => entry.status === 'resolved'),
    byCategory: {
      business: open.filter((entry) => entry.category === 'business'),
      architecture: open.filter((entry) => entry.category === 'architecture')
    }
  };
}

export function validateQuestionsLedger(ledger, workId = '<unknown>') {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) throw new Error(`Questions ledger for ${workId} must be an object.`);
  rejectUnknownFields(ledger, LEDGER_FIELDS, `questions ledger for ${workId}`);
  if (ledger.version !== QUESTION_SCHEMA_VERSION) throw new Error(`Questions ledger for ${workId} must use version ${QUESTION_SCHEMA_VERSION}.`);
  if (!Array.isArray(ledger.questions)) throw new Error(`Questions ledger for ${workId} must contain a questions array.`);
  const ids = new Set();
  for (const entry of ledger.questions) {
    validateQuestion(entry);
    if (ids.has(entry.id)) throw new Error(`Questions ledger for ${workId} contains duplicate question ID ${entry.id}.`);
    ids.add(entry.id);
  }
  if (ledger.updatedAt !== null && !isNonEmptyString(ledger.updatedAt)) throw new Error(`Questions ledger for ${workId} has an invalid updatedAt.`);
  return true;
}

async function writeQuestionsLedger(root, workId, ledger) {
  validateQuestionsLedger(ledger, workId);
  await writeYaml(questionsFilePath(root, workId), ledger);
}

async function loadMeta(root, workId) {
  const file = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(file)) throw new Error(`Work item ${workId} was not found.`);
  return readYaml(file);
}

function emptyLedger() {
  return { version: QUESTION_SCHEMA_VERSION, questions: [], updatedAt: null };
}

function cloneLedger(ledger) {
  return { ...ledger, questions: ledger.questions.map((entry) => ({ ...entry })) };
}

function nextQuestionId(questions) {
  const highest = questions.reduce((max, entry) => Math.max(max, Number(entry.id.slice(2)) || 0), 0);
  return `Q-${String(highest + 1).padStart(3, '0')}`;
}

function requireQuestion(ledger, questionId) {
  if (!isNonEmptyString(questionId)) throw new Error('--id must be a non-empty question ID.');
  const entry = ledger.questions.find((question) => question.id === questionId);
  if (!entry) throw new Error(`Question ${questionId} was not found.`);
  return entry;
}

function validateQuestion(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Question entry must be an object.');
  rejectUnknownFields(entry, QUESTION_FIELDS, `question ${entry.id ?? '<unknown>'}`);
  if (!/^Q-\d{3,}$/.test(entry.id)) throw new Error(`Invalid question ID ${JSON.stringify(entry.id)}.`);
  if (!QUESTION_CATEGORIES.includes(entry.category)) throw new Error(`Question ${entry.id} has unsupported category ${JSON.stringify(entry.category)}.`);
  if (!QUESTION_STATUSES.includes(entry.status)) throw new Error(`Question ${entry.id} has unsupported status ${JSON.stringify(entry.status)}.`);
  if (!isNonEmptyString(entry.question)) throw new Error(`Question ${entry.id} requires non-empty question text.`);
  if (typeof entry.material !== 'boolean') throw new Error(`Question ${entry.id} requires a boolean material flag.`);
  for (const field of ['proposal', 'answer', 'resolution', 'createdAt', 'updatedAt', 'resolvedAt']) {
    if (entry[field] !== undefined && !isNonEmptyString(entry[field])) throw new Error(`Question ${entry.id} has invalid ${field}.`);
  }
  if (entry.status === 'proposed' && !isNonEmptyString(entry.proposal)) throw new Error(`Proposed question ${entry.id} requires a proposal.`);
  if (entry.status === 'answered' && !isNonEmptyString(entry.answer)) throw new Error(`Answered question ${entry.id} requires an answer.`);
  if (entry.status === 'resolved' && (!isNonEmptyString(entry.resolution) || !isNonEmptyString(entry.resolvedAt))) {
    throw new Error(`Resolved question ${entry.id} requires resolution and resolvedAt.`);
  }
}

function normalizeText(value, message) {
  if (!isNonEmptyString(value)) throw new Error(message);
  return value.trim().replace(/\s+/g, ' ');
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`Unknown field(s) in ${label}: ${unknown.join(', ')}.`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
