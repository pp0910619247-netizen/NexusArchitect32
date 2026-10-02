import type { FastifyInstance, FastifyRequest } from 'fastify';
import { t, type Lang, type TranslationKey } from '@nexus/shared';
import { DEFAULT_SEED, loadQuestions, sampleBank, type BankItem, type SampledItem } from './ai-eval.js';
import { defaultOutDir } from './generate.js';
import {
  AiReferenceMissingError,
  CompareInputError,
  compareWithReference,
  parsePlayerAnswers,
  readAiReference,
  type AiReference,
} from './quiz-compare.js';
import { bank2Dir, findBank2Item, loadBank2ForQuiz } from './v2/for-quiz.js';

/** Banks the trainer can serve. v1 = the 10,000 school-subject items. */
export type QuizBankId = 'v1' | 'v2';

/**
 * Local quiz trainer for the world-v1 bank, mounted on the existing quiz-chain
 * node so a Windows 11 user can open `http://localhost:4100/quiz`.
 *
 * Design notes:
 * - The sample endpoint never exposes `answerIndex`; the correct answer is only
 *   returned one item at a time by POST /api/quiz/reveal, so the whole key
 *   cannot be scraped from the page.
 * - Every quiz route is loopback-only by default (the chain node binds 0.0.0.0).
 * - No new dependencies: the page is plain HTML + vanilla JS.
 */

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const DEFAULT_COUNT = 100;
const DEFAULT_PER_DIFFICULTY = 10;
const DEFAULT_FRONTIER_PER_DIFFICULTY = 10;
const MAX_COUNT = 200;
/** UI keys this page needs, in the order the page renders them. */
const UI_KEYS = [
  'quiz.title',
  'quiz.tagline',
  'quiz.sampleSize',
  'quiz.start',
  'quiz.loading',
  'quiz.error',
  'quiz.bankMissing',
  'quiz.progress',
  'quiz.score',
  'quiz.difficulty',
  'quiz.subject',
  'quiz.correct',
  'quiz.incorrect',
  'quiz.correctAnswer',
  'quiz.yourPick',
  'quiz.explanation',
  'quiz.nextQuestion',
  'quiz.finish',
  'quiz.restart',
  'quiz.results',
  'quiz.accuracy',
  'quiz.items',
  'quiz.byDifficulty',
  'quiz.bankPercentages',
  'quiz.answerPosition',
  'quiz.language',
  'quiz.compare',
  'quiz.compareHint',
  'quiz.compareRunning',
  'quiz.compareNone',
  'quiz.compareMissing',
  'quiz.compareHeadline',
  'quiz.compareCompared',
  'quiz.compareAgreement',
  'quiz.compareAiAccuracy',
  'quiz.comparePlayerAccuracy',
  'quiz.compareAiAhead',
  'quiz.comparePlayerAhead',
  'quiz.compareBothCorrect',
  'quiz.compareBothWrong',
  'quiz.compareAiPick',
  'quiz.compareVerdict',
  'quiz.compareMissedHeading',
  'quiz.compareBeatHeading',
  'quiz.compareNoReferenceRow',
  'quiz.compareSheet',
  'quiz.bank',
  'quiz.bankV1',
  'quiz.bankV2',
  'quiz.bankV2Note',
] as const satisfies readonly TranslationKey[];

export interface QuizPublicItem {
  readonly id: string;
  readonly difficulty: number;
  readonly subject: string;
  readonly subjectCount: number;
  readonly flagship: boolean;
  readonly prompt: { readonly en: string; readonly th: string };
  readonly options: readonly string[];
}

export interface QuizPercentRow {
  readonly label: string;
  readonly count: number;
  readonly percent: number;
}

export interface QuizStats {
  readonly total: number;
  readonly byDifficulty: readonly QuizPercentRow[];
  readonly byAnswerPosition: readonly QuizPercentRow[];
}

export interface QuizSample {
  readonly seed: string;
  readonly requested: number;
  readonly count: number;
  readonly perDifficulty: number;
  readonly frontierPerDifficulty: number;
  readonly shortfalls: readonly { readonly difficulty: number; readonly requested: number; readonly available: number }[];
  readonly items: readonly QuizPublicItem[];
}

export interface QuizAppOptions {
  /** Bank directory; defaults to packages/backend/questions/world-v1. */
  readonly bankDir?: string;
  /** world-v2 bank directory (default: packages/backend/questions/world-v2). */
  readonly v2BankDir?: string;
  /** Directory holding the AI answer sheet (default: the bank directory). */
  readonly referenceDir?: string;
  /** Allow non-loopback callers (default false: the node binds 0.0.0.0). */
  readonly allowRemote?: boolean;
  /** Sample seed (default: the published world-v1-ai-eval seed). */
  readonly seed?: string;
}

export class QuizBankMissingError extends Error {
  constructor(cause: unknown) {
    super('QUIZ_BANK_MISSING');
    this.cause = cause;
  }
}

export function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/** Percentages over the whole bank: per difficulty and per answer position. */
export function buildStats(items: readonly BankItem[]): QuizStats {
  const byDifficulty: QuizPercentRow[] = [];
  for (let difficulty = 1; difficulty <= 10; difficulty += 1) {
    const count = items.filter((entry) => entry.question.difficulty === difficulty).length;
    byDifficulty.push({ label: 'd' + difficulty, count, percent: percent(count, items.length) });
  }
  const byAnswerPosition = [0, 1, 2, 3].map((index) => {
    const count = items.filter((entry) => entry.question.answerIndex === index).length;
    return { label: LETTERS[index] as string, count, percent: percent(count, items.length) };
  });
  return { total: items.length, byDifficulty, byAnswerPosition };
}

/** Strips the answer (and explanation) from one sampled item. */
export function toPublicItem(entry: SampledItem): QuizPublicItem {
  return {
    id: entry.question.id,
    difficulty: entry.question.difficulty,
    subject: entry.question.primaryDiscipline,
    subjectCount: entry.question.subjectCount,
    flagship: entry.flagship,
    prompt: { en: entry.question.prompt.en, th: entry.question.prompt.th },
    options: entry.question.options,
  };
}

/** Stratified, deterministic draw using the same sampler as `world:ai-eval`. */
export function drawQuizSample(items: readonly BankItem[], options: QuizAppOptions & { count?: number } = {}): QuizSample {
  const count = Math.min(Math.max(options.count ?? DEFAULT_COUNT, 1), MAX_COUNT);
  const spec = {
    perDifficulty: DEFAULT_PER_DIFFICULTY,
    frontierPerDifficulty: DEFAULT_FRONTIER_PER_DIFFICULTY,
    seed: options.seed ?? DEFAULT_SEED,
    includeFlagship: true,
  };
  const { sample, shortfalls } = sampleBank(items, spec);
  const items100 = sample.filter((entry) => entry.question.difficulty >= 1).slice(0, count);
  return {
    seed: spec.seed,
    requested: count,
    count: items100.length,
    perDifficulty: spec.perDifficulty,
    frontierPerDifficulty: spec.frontierPerDifficulty,
    shortfalls,
    items: items100.map(toPublicItem),
  };
}

/** Translates every UI key once, for injection into the page. */
export function uiDictionary(lang: Lang): Record<string, string> {
  const dictionary: Record<string, string> = {};
  for (const key of UI_KEYS) dictionary[key] = t(key, lang);
  return dictionary;
}

function parseLang(value: unknown): Lang {
  return value === 'en' ? 'en' : 'th';
}

/** The whole page: server-rendered labels, vanilla-JS quiz loop. */
export function buildQuizPage(lang: Lang, bank: QuizBankId = 'v1'): string {
  const dict = JSON.stringify(uiDictionary(lang));
  const other: Lang = lang === 'th' ? 'en' : 'th';
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t('quiz.title', lang)}</title>
<style>
:root{color-scheme:dark}body{margin:0;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0c1117;color:#e6edf3;padding:24px}
main{max-width:820px;margin:0 auto}h1{font-size:20px;margin:0 0 6px}.tagline{color:#9aa7b4;margin:0 0 18px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
select,button{font:inherit;color:#e6edf3;background:#161d26;border:1px solid #2c3742;border-radius:8px;padding:8px 12px}
button{cursor:pointer}button:hover{border-color:#3d4b59}button.primary{background:#1f6feb;border-color:#1f6feb}
button.opt{display:block;width:100%;text-align:left;margin:6px 0}
button.opt.correct{border-color:#2ea043;background:#10281a}button.opt.wrong{border-color:#b62324;background:#2a1416}
.badge{display:inline-block;background:#161d26;border:1px solid #2c3742;border-radius:999px;padding:2px 10px;margin-right:6px;font-size:12px;color:#9aa7b4}
.card{background:#111820;border:1px solid #222c36;border-radius:12px;padding:16px;margin:14px 0}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #222c36;font-size:13px}
th{color:#9aa7b4;font-weight:600}.muted{color:#9aa7b4}a{color:#79c0ff}
</style></head><body><main>
<h1 id="title"></h1>
<p class="tagline" id="tagline"></p>
<p><a href="/quiz?lang=${other}&bank=${bank}">${t('quiz.language', lang)}: ${other.toUpperCase()}</a> · <a href="/">Dashboard</a></p>
<div class="row">
  <label for="size" id="sizeLabel"></label>
  <select id="size"><option value="20">20</option><option value="50">50</option><option value="100" selected>100</option><option value="200">200</option></select>
  <label for="bank" id="bankLabel"></label>
  <select id="bank">
    <option value="v1"${bank === 'v1' ? ' selected' : ''}>${t('quiz.bankV1', lang)}</option>
    <option value="v2"${bank === 'v2' ? ' selected' : ''}>${t('quiz.bankV2', lang)}</option>
  </select>
  <button class="primary" id="start"></button>
</div>
<p class="muted" id="bankNote"></p>
<div id="status" class="muted"></div>
<div class="row" id="meters" hidden>
  <span class="badge" id="progress"></span><span class="badge" id="score"></span>
</div>
<div class="card" id="card" hidden>
  <div><span class="badge" id="diff"></span><span class="badge" id="subject"></span><span class="badge" id="qid"></span></div>
  <p id="prompt"></p>
  <div id="options"></div>
  <div id="feedback" class="card" hidden></div>
  <button class="primary" id="next" hidden></button>
</div>
<div class="card" id="results" hidden></div>
<div class="card" id="compare" hidden>
  <h2 id="compareTitle"></h2>
  <p class="muted" id="compareHint"></p>
  <div class="row"><button class="primary" id="compareBtn"></button></div>
  <div id="compareStatus" class="muted"></div>
  <div id="compareOut"></div>
</div>
<script id="dict" type="application/json">${dict}</script>
<script>
var D = JSON.parse(document.getElementById('dict').textContent);
var LANG = '${lang}';
var state = { items: [], index: 0, picked: [], correct: 0, done: false, stats: null, seed: '', referenceMatches: 0, bank: 'v1' };
function el(id) { return document.getElementById(id); }
function put(id, text) { el(id).textContent = text; }
function letters(i) { return ['A','B','C','D'][i]; }
function esc(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
put('title', D['quiz.title']); put('tagline', D['quiz.tagline']); put('sizeLabel', D['quiz.sampleSize']);
put('start', D['quiz.start']); put('progress', D['quiz.progress']); put('score', D['quiz.score']);
put('compareTitle', D['quiz.compare']); put('compareHint', D['quiz.compareHint']); put('compareBtn', D['quiz.compare']);
put('bankLabel', D['quiz.bank']); put('bankNote', document.getElementById('bank').value === 'v2' ? D['quiz.bankV2Note'] : '');
document.getElementById('bank').addEventListener('change', function () { put('bankNote', document.getElementById('bank').value === 'v2' ? D['quiz.bankV2Note'] : ''); });
function optionText(item, index) { return letters(index) + '. ' + item.options[index]; }
function showMeters() {
  el('meters').hidden = false;
  put('progress', D['quiz.progress'] + ': ' + Math.min(state.index + 1, state.items.length) + ' / ' + state.items.length);
  put('score', D['quiz.score'] + ': ' + state.correct);
}
function render() {
  var item = state.items[state.index];
  el('card').hidden = false; el('feedback').hidden = true; el('next').hidden = true;
  put('diff', D['quiz.difficulty'] + ' d' + item.difficulty);
  put('subject', D['quiz.subject'] + ': ' + item.subject);
  put('qid', item.id + (item.flagship ? ' ★' : ''));
  put('prompt', item.prompt[LANG]);
  var box = el('options'); box.textContent = '';
  item.options.forEach(function (option, index) {
    var button = document.createElement('button');
    button.className = 'opt'; button.textContent = optionText(item, index);
    button.addEventListener('click', function () { pick(index); });
    box.appendChild(button);
  });
  showMeters();
}
function pick(index) {
  var item = state.items[state.index];
  fetch('/api/quiz/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id, bank: state.bank, lang: LANG }) })
    .then(function (response) { if (!response.ok) throw new Error('reveal ' + response.status); return response.json(); })
    .then(function (answer) {
      var buttons = el('options').querySelectorAll('button');
      buttons.forEach(function (button, slot) {
        button.disabled = true;
        if (slot === answer.answerIndex) button.className = 'opt correct';
        else if (slot === index) button.className = 'opt wrong';
      });
      var ok = index === answer.answerIndex;
      if (ok) state.correct += 1;
      state.picked.push({ id: item.id, difficulty: item.difficulty, ok: ok, pick: index });
      var lines = [
        (ok ? D['quiz.correct'] : D['quiz.incorrect']),
        D['quiz.yourPick'] + ': ' + letters(index),
        D['quiz.correctAnswer'] + ': ' + letters(answer.answerIndex),
        D['quiz.explanation'] + ': ' + (answer.explanation[LANG] || answer.explanation.en),
      ];
      el('feedback').textContent = '';
      lines.forEach(function (line) { var p = document.createElement('p'); p.textContent = line; el('feedback').appendChild(p); });
      el('feedback').hidden = false;
      el('next').hidden = false;
      put('next', state.index + 1 >= state.items.length ? D['quiz.finish'] : D['quiz.nextQuestion']);
      showMeters();
    })
    .catch(function (error) { put('status', D['quiz.error'] + ' (' + error.message + ')'); });
}
function rowTable(rows, caption) {
  var html = '<h3>' + caption + '</h3><table><tr><th></th><th>' + D['quiz.items'] + '</th><th>' + D['quiz.accuracy'] + '</th></tr>';
  rows.forEach(function (row) { html += '<tr><td>' + row.label + '</td><td>' + row.count + '</td><td>' + row.percent + '%</td></tr>'; });
  return html + '</table>';
}
function finish() {
  state.done = true;
  el('card').hidden = true;
  var byDifficulty = {};
  state.picked.forEach(function (row) {
    var bucket = byDifficulty[row.difficulty] || (byDifficulty[row.difficulty] = { label: 'd' + row.difficulty, count: 0, hits: 0 });
    bucket.count += 1; if (row.ok) bucket.hits += 1;
  });
  var rows = Object.keys(byDifficulty).map(function (key) {
    var bucket = byDifficulty[key];
    return { label: bucket.label, count: bucket.count, percent: Math.round((bucket.hits / bucket.count) * 1000) / 10 };
  }).sort(function (a, b) { return a.label < b.label ? -1 : 1; });
  var total = state.picked.length;
  var hits = state.picked.filter(function (row) { return row.ok; }).length;
  var html = '<h2>' + D['quiz.results'] + '</h2><p>' + D['quiz.score'] + ': ' + hits + ' / ' + total + ' (' + (total ? Math.round((hits / total) * 1000) / 10 : 0) + '%)</p>';
  html += rowTable(rows, D['quiz.byDifficulty']);
  html += rowTable(state.stats.byAnswerPosition, D['quiz.answerPosition']);
  html += rowTable(state.stats.byDifficulty, D['quiz.bankPercentages']);
  html += '<p class="muted">seed: ' + state.seed + ' · bank ' + state.stats.total + '</p>';
  var box = el('results'); box.innerHTML = html; box.hidden = false;
  el('start').hidden = false; el('meters').hidden = true; el('status').textContent = '';
  el('compareOut').textContent = ''; el('compareOut').hidden = true; el('compareBtn').hidden = false;
  el('compare').hidden = state.referenceMatches <= 0;
  put('compareStatus', state.referenceMatches > 0 ? '' : D['quiz.compareNone']);
}
function verdictLabel(verdict) {
  var labels = {
    'both-correct': D['quiz.compareBothCorrect'],
    'ai-correct-only': D['quiz.compareAiAhead'],
    'player-correct-only': D['quiz.comparePlayerAhead'],
    'both-wrong': D['quiz.compareBothWrong'],
    'no-reference': D['quiz.compareNoReferenceRow'],
    'unknown-item': D['quiz.compareNoReferenceRow'],
  };
  return labels[verdict] || verdict;
}
function isDisputed(row) { return row.verdict !== 'both-correct' && row.verdict !== 'no-reference' && row.verdict !== 'unknown-item'; }
function itemOf(id) {
  for (var i = 0; i < state.items.length; i += 1) { if (state.items[i].id === id) return state.items[i]; }
  return null;
}
function disputedTable(rows) {
  var html = '<h3>' + D['quiz.compareHeadline'] + '</h3><table><tr><th>#</th><th>' + D['quiz.compareAiPick'] + '</th><th>' + D['quiz.yourPick'] + '</th><th>' + D['quiz.correctAnswer'] + '</th><th>' + D['quiz.compareVerdict'] + '</th></tr>';
  var shown = 0;
  rows.forEach(function (row) {
    if (!isDisputed(row)) return;
    shown += 1;
    html += '<tr><td>' + row.id + ' <span class="muted">d' + row.difficulty + '</span></td><td>' + letters(row.aiPick) + '</td><td>' + letters(row.playerPick) + '</td><td>' + letters(row.keyIndex) + '</td><td>' + verdictLabel(row.verdict) + '</td></tr>';
  });
  if (shown === 0) html += '<tr><td colspan="5">' + D['quiz.compareBothCorrect'] + '</td></tr>';
  return html + '</table>';
}
function idList(ids, heading) {
  if (!ids || ids.length === 0) return '';
  var html = '<h3>' + heading + ' (' + ids.length + ')</h3><ol>';
  ids.forEach(function (id) {
    var item = itemOf(id);
    html += '<li>' + id + ' <span class="muted">d' + (item ? item.difficulty : '?') + '</span> — ' + esc(item ? item.prompt[LANG] : id) + '</li>';
  });
  return html + '</ol>';
}
function disputedDetails(rows) {
  var html = '';
  rows.forEach(function (row) {
    if (!isDisputed(row)) return;
    var item = itemOf(row.id);
    html += '<div class="card"><div><span class="badge">' + row.id + '</span><span class="badge">' + D['quiz.difficulty'] + ' d' + row.difficulty + '</span><span class="badge">' + verdictLabel(row.verdict) + '</span></div>';
    if (item) html += '<p>' + esc(item.prompt[LANG]) + '</p>';
    html += '<p>' + D['quiz.compareAiPick'] + ': ' + letters(row.aiPick) + ' · ' + D['quiz.yourPick'] + ': ' + letters(row.playerPick) + ' · ' + D['quiz.correctAnswer'] + ': ' + letters(row.keyIndex) + '</p>';
    html += '<p class="muted">' + D['quiz.explanation'] + ': ' + esc(row.explanation ? (row.explanation[LANG] || row.explanation.en) : '') + '</p></div>';
  });
  return html;
}
function renderCompare(payload) {
  var summary = payload.summary;
  var html = '<h2>' + D['quiz.compareHeadline'] + '</h2>';
  html += '<p>' + D['quiz.compareCompared'] + ': ' + summary.compared + ' / ' + summary.total + ' · ' + D['quiz.compareAgreement'] + ': ' + summary.agreement + ' (' + summary.agreementPercent + '%)</p>';
  html += '<p>' + D['quiz.compareAiAccuracy'] + ': ' + summary.aiAccuracy + '% · ' + D['quiz.comparePlayerAccuracy'] + ': ' + summary.playerAccuracy + '%</p>';
  var counts = [
    ['both-correct', summary.bothCorrect], ['ai-correct-only', summary.aiAhead],
    ['player-correct-only', summary.playerAhead], ['both-wrong', summary.bothWrong],
    ['no-reference', summary.noReference + summary.unknown],
  ];
  html += '<table><tr><th>' + D['quiz.compareVerdict'] + '</th><th>' + D['quiz.items'] + '</th></tr>';
  counts.forEach(function (row) { html += '<tr><td>' + verdictLabel(row[0]) + '</td><td>' + row[1] + '</td></tr>'; });
  html += '</table>';
  html += rowTable(summary.byDifficulty, D['quiz.compareAgreement'] + ' — ' + D['quiz.byDifficulty']);
  html += idList(summary.missed, D['quiz.compareMissedHeading']);
  html += idList(summary.aiMissed, D['quiz.compareBeatHeading']);
  html += disputedTable(payload.rows);
  html += disputedDetails(payload.rows);
  html += '<p class="muted">' + D['quiz.compareSheet'] + ': ' + payload.reference.items + (payload.reference.sources.length ? ' (' + payload.reference.sources.join(', ') + ')' : '') + '</p>';
  var box = el('compareOut'); box.innerHTML = html; box.hidden = false;
}
el('compareBtn').addEventListener('click', function () {
  put('compareStatus', D['quiz.compareRunning']);
  el('compareBtn').hidden = true;
  var answers = state.picked.map(function (row) { return { id: row.id, pick: row.pick }; });
  fetch('/api/quiz/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: answers, bank: state.bank, lang: LANG }) })
    .then(function (response) {
      if (response.status === 503) throw new Error('sheet');
      if (!response.ok) throw new Error('compare ' + response.status);
      return response.json();
    })
    .then(function (payload) {
      if (payload.summary.compared === 0) { put('compareStatus', D['quiz.compareNone']); el('compareBtn').hidden = false; return; }
      put('compareStatus', ''); renderCompare(payload);
    })
    .catch(function (error) {
      put('compareStatus', error.message === 'sheet' ? D['quiz.compareMissing'] : D['quiz.error'] + ' (' + error.message + ')');
      el('compareBtn').hidden = false;
    });
});
el('next').addEventListener('click', function () {
  if (state.index + 1 >= state.items.length) { finish(); return; }
  state.index += 1; render();
});
el('start').addEventListener('click', function () {
  var count = Number(el('size').value);
  var bank = el('bank').value;
  el('results').hidden = true; el('card').hidden = true; el('meters').hidden = true;
  put('status', D['quiz.loading']); el('start').hidden = true;
  fetch('/api/quiz/sample?count=' + count + '&lang=' + LANG + '&bank=' + bank)
    .then(function (response) {
      if (response.status === 503) throw new Error('bank');
      if (!response.ok) throw new Error('sample ' + response.status);
      return response.json();
    })
    .then(function (payload) {
      state = { items: payload.items, index: 0, picked: [], correct: 0, done: false, stats: payload.stats, seed: payload.seed, referenceMatches: payload.referenceMatches || 0, bank: payload.bank || bank };
      put('status', ''); el('compare').hidden = true; render();
    })
    .catch(function (error) {
      put('status', error.message === 'bank' ? D['quiz.bankMissing'] : D['quiz.error'] + ' (' + error.message + ')');
      el('start').hidden = false;
    });
});
</script></main></body></html>`;
}

let cached: { key: string; items: BankItem[] } | null = null;
let cachedReference: { dir: string; reference: AiReference } | null = null;

/** v1 reads the school-subject bank from disk; v2 renders its bilingual items. */
function loadBank(bank: QuizBankId, lang: Lang, v1Dir: string, v2Dir: string): BankItem[] {
  const key = bank === 'v2' ? `v2|${v2Dir}|${lang}` : `v1|${v1Dir}`;
  if (cached !== null && cached.key === key) return cached.items;
  const items = bank === 'v2' ? loadBank2ForQuiz(lang, v2Dir) : loadQuestions(v1Dir);
  cached = { key, items };
  return items;
}

function bankOf(value: unknown): QuizBankId {
  return value === 'v2' ? 'v2' : 'v1';
}

function loadReference(dir: string): AiReference {
  if (cachedReference !== null && cachedReference.dir === dir) return cachedReference.reference;
  const reference = readAiReference(dir);
  cachedReference = { dir, reference };
  return reference;
}

/** Registers /quiz + /api/quiz/* on the given Fastify instance. */
export function registerQuizApp(app: FastifyInstance, options: QuizAppOptions = {}): void {
  const bankDir = options.bankDir ?? defaultOutDir();
  const v2Dir = options.v2BankDir ?? bank2Dir();
  const referenceDir = options.referenceDir ?? bankDir;
  const allowRemote = options.allowRemote === true;
  const guard = (request: FastifyRequest): boolean => allowRemote || isLoopback(request.socket.remoteAddress);

  app.get('/quiz', async (request, reply) => {
    if (!guard(request)) return reply.code(403).send({ error: 'QUIZ_LOOPBACK_ONLY' });
    const query = request.query as { lang?: string; bank?: string } | undefined;
    reply.type('text/html; charset=utf-8');
    return buildQuizPage(parseLang(query?.lang), bankOf(query?.bank));
  });

  app.get('/api/quiz/stats', async (request, reply) => {
    if (!guard(request)) return reply.code(403).send({ error: 'QUIZ_LOOPBACK_ONLY' });
    const query = request.query as { lang?: string; bank?: string } | undefined;
    try {
      return reply.send(buildStats(loadBank(bankOf(query?.bank), parseLang(query?.lang), bankDir, v2Dir)));
    } catch (error) {
      return reply.code(503).send({ error: 'QUIZ_BANK_MISSING', detail: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/quiz/sample', async (request, reply) => {
    if (!guard(request)) return reply.code(403).send({ error: 'QUIZ_LOOPBACK_ONLY' });
    const query = request.query as { count?: string; seed?: string; lang?: string; bank?: string } | undefined;
    const requested = Number(query?.count ?? DEFAULT_COUNT);
    const count = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_COUNT) : DEFAULT_COUNT;
    const bank = bankOf(query?.bank);
    try {
      const items = loadBank(bank, parseLang(query?.lang), bankDir, v2Dir);
      const sample = drawQuizSample(items, { count, seed: query?.seed ?? options.seed });
      const reference = loadReference(referenceDir);
      const referenceMatches = sample.items.filter((entry) => reference.picks.has(entry.id)).length;
      return reply.send({ ...sample, bank, stats: buildStats(items), referenceMatches, referenceItems: reference.picks.size });
    } catch (error) {
      return reply.code(503).send({ error: 'QUIZ_BANK_MISSING', detail: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/quiz/reveal', async (request, reply) => {
    if (!guard(request)) return reply.code(403).send({ error: 'QUIZ_LOOPBACK_ONLY' });
    const body = request.body as { id?: unknown; lang?: string; bank?: string } | undefined;
    if (typeof body?.id !== 'string' || !/^(wk|w2)-[0-9]{6}$/.test(body.id)) {
      return reply.code(400).send({ error: 'INVALID_ITEM_ID' });
    }
    try {
      if (bankOf(body.bank) === 'v2') {
        const found = findBank2Item(body.id, v2Dir);
        if (found === undefined) return reply.code(404).send({ error: 'ITEM_NOT_FOUND' });
        return reply.send({ id: found.id, answerIndex: found.answerIndex, explanation: { en: found.explanation.en, th: found.explanation.th } });
      }
      const items = loadBank('v1', parseLang(body.lang), bankDir, v2Dir);
      const found = items.find((entry) => entry.question.id === body.id);
      if (found === undefined) return reply.code(404).send({ error: 'ITEM_NOT_FOUND' });
      return reply.send({
        id: found.question.id,
        answerIndex: found.question.answerIndex,
        explanation: { en: found.question.explanation.en, th: found.question.explanation.th },
      });
    } catch (error) {
      return reply.code(503).send({ error: 'QUIZ_BANK_MISSING', detail: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * Scores a finished round against the AI answer sheet, item by item.
   * Only the items the player submits are scored; items without an AI record
   * are reported as such instead of being guessed.
   */
  app.post('/api/quiz/compare', async (request, reply) => {
    if (!guard(request)) return reply.code(403).send({ error: 'QUIZ_LOOPBACK_ONLY' });
    const body = request.body as { answers?: unknown; lang?: string; bank?: string } | undefined;
    let answers: { id: string; pick: number }[];
    try {
      answers = parsePlayerAnswers(body?.answers);
    } catch (error) {
      const code = error instanceof CompareInputError ? error.name : 'INVALID_ANSWERS';
      return reply.code(400).send({ error: code, detail: error instanceof Error ? error.message : String(error) });
    }
    let reference: AiReference;
    try {
      reference = loadReference(referenceDir);
    } catch (error) {
      return reply.code(503).send({ error: 'AI_REFERENCE_MISSING', detail: error instanceof Error ? error.message : String(error) });
    }
    if (reference.picks.size === 0) {
      return reply.code(503).send({ error: 'AI_REFERENCE_MISSING', detail: new AiReferenceMissingError(referenceDir).message });
    }
    try {
      const items = loadBank(bankOf(body?.bank), parseLang(body?.lang), bankDir, v2Dir);
      return reply.send(compareWithReference(answers, reference, items));
    } catch (error) {
      return reply.code(503).send({ error: 'QUIZ_BANK_MISSING', detail: error instanceof Error ? error.message : String(error) });
    }
  });
}
