import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BankItem } from './ai-eval.js';

/**
 * "Compare with AI" mode for the world-v1 quiz trainer.
 *
 * The AI answer sheet is a local, gitignored artifact: the frozen answers the
 * coding agent gave for the 100-item sample (files named `answers-*.json`,
 * optionally `ai-answers.json`). This module joins that sheet with the bank key
 * and the player's picks, so the page can say who missed which item.
 *
 * Everything here runs server-side. The bank key never leaves the process
 * except for items the player actually answered in this round.
 */

/** Reference files are matched with this prefix (e.g. answers-01.json). */
export const AI_REFERENCE_PREFIX = 'answers-';
/** Single-file alternative to the numbered parts. */
export const AI_REFERENCE_FILE = 'ai-answers.json';
/** One round cannot compare more than this many answers. */
export const MAX_COMPARE_ANSWERS = 200;
const ITEM_ID = /^wk-[0-9]{6}$/;

export interface AiReferencePick {
  readonly id: string;
  /** 0-based option index the AI chose. */
  readonly pick: number;
  /** Optional self-reported difficulty ("easy" | "medium" | "hard"). */
  readonly feel?: string;
}

export interface AiReference {
  readonly picks: ReadonlyMap<string, AiReferencePick>;
  /** File names the picks were read from, for display/debugging. */
  readonly sources: readonly string[];
  /** Entries dropped because the shape was wrong, reported instead of hidden. */
  readonly skipped: number;
}

export type CompareVerdict =
  | 'both-correct'
  | 'ai-correct-only'
  | 'player-correct-only'
  | 'both-wrong'
  | 'no-reference'
  | 'unknown-item';

export interface QuizCompareRow {
  readonly id: string;
  readonly difficulty: number | null;
  readonly playerPick: number;
  readonly aiPick: number | null;
  /** Bank truth; null when the item is not in the bank. */
  readonly keyIndex: number | null;
  readonly verdict: CompareVerdict;
  readonly explanation: { readonly en: string; readonly th: string } | null;
}

export interface QuizComparePercentRow {
  readonly label: string;
  readonly count: number;
  readonly percent: number;
}

export interface QuizCompareSummary {
  readonly total: number;
  /** Rows where reference + bank + verdict all resolved. */
  readonly compared: number;
  readonly bothCorrect: number;
  readonly aiAhead: number;
  readonly playerAhead: number;
  readonly bothWrong: number;
  readonly noReference: number;
  readonly unknown: number;
  /** Rows where the AI and the player chose the same option. */
  readonly agreement: number;
  readonly agreementPercent: number;
  readonly aiAccuracy: number;
  readonly playerAccuracy: number;
  /** Items the AI had right and the player missed (the "who missed what" list). */
  readonly missed: readonly string[];
  /** Items the player had right and the AI missed. */
  readonly aiMissed: readonly string[];
  readonly byDifficulty: readonly QuizComparePercentRow[];
}

export interface QuizCompareResult {
  readonly rows: readonly QuizCompareRow[];
  readonly summary: QuizCompareSummary;
  readonly reference: { readonly items: number; readonly sources: readonly string[]; readonly skipped: number };
}

/** Raised when no AI answer sheet could be read from the bank directory. */
export class AiReferenceMissingError extends Error {
  constructor(dir: string) {
    super('AI_REFERENCE_MISSING: no ' + AI_REFERENCE_PREFIX + '*.json in ' + dir);
  }
}

/** Raised for a malformed player payload. */
export class CompareInputError extends Error {
  constructor(code: 'INVALID_ANSWERS' | 'TOO_MANY_ANSWERS', detail: string) {
    super(code + ': ' + detail);
    this.name = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPick(entry: unknown): AiReferencePick | null {
  if (!isRecord(entry)) return null;
  const { id, pick, feel } = entry;
  if (typeof id !== 'string' || !ITEM_ID.test(id)) return null;
  if (typeof pick !== 'number' || !Number.isInteger(pick) || pick < 0 || pick > 3) return null;
  return feel === undefined ? { id, pick } : { id, pick, feel: String(feel) };
}

/**
 * Reads every AI answer sheet part from `dir`. Missing directories and
 * unreadable files are tolerated (the caller reports "no AI record"), but
 * individual bad entries are counted in `skipped` rather than silently dropped.
 */
export function readAiReference(dir: string): AiReference {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { picks: new Map(), sources: [], skipped: 0 };
  }
  const parts = names
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name === AI_REFERENCE_FILE || (name.startsWith(AI_REFERENCE_PREFIX) && !name.includes('key')))
    .sort();
  const picks = new Map<string, AiReferencePick>();
  const sources: string[] = [];
  let skipped = 0;
  for (const name of parts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      skipped += 1;
      continue;
    }
    if (!Array.isArray(parsed)) {
      skipped += 1;
      continue;
    }
    let used = false;
    for (const entry of parsed) {
      const pick = toPick(entry);
      if (pick === null) {
        skipped += 1;
        continue;
      }
      if (picks.has(pick.id)) continue;
      picks.set(pick.id, pick);
      used = true;
    }
    if (used) sources.push(name);
  }
  return { picks, sources, skipped };
}

/** Parses and validates the player's answers from a request body. */
export function parsePlayerAnswers(value: unknown): { id: string; pick: number }[] {
  if (!Array.isArray(value)) throw new CompareInputError('INVALID_ANSWERS', 'answers must be an array');
  if (value.length > MAX_COMPARE_ANSWERS) {
    throw new CompareInputError('TOO_MANY_ANSWERS', value.length + ' > ' + MAX_COMPARE_ANSWERS);
  }
  const seen = new Set<string>();
  const answers: { id: string; pick: number }[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw new CompareInputError('INVALID_ANSWERS', 'entry must be an object');
    const { id, pick } = entry;
    if (typeof id !== 'string' || !ITEM_ID.test(id)) throw new CompareInputError('INVALID_ANSWERS', 'bad id');
    if (typeof pick !== 'number' || !Number.isInteger(pick) || pick < 0 || pick > 3) {
      throw new CompareInputError('INVALID_ANSWERS', 'bad pick for ' + id);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    answers.push({ id, pick });
  }
  return answers;
}

function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function verdictFor(playerPick: number, aiPick: number, keyIndex: number): CompareVerdict {
  const playerRight = playerPick === keyIndex;
  const aiRight = aiPick === keyIndex;
  if (playerRight && aiRight) return 'both-correct';
  if (aiRight) return 'ai-correct-only';
  if (playerRight) return 'player-correct-only';
  return 'both-wrong';
}

/**
 * Scores one player round against the AI sheet and the bank key.
 *
 * `rows` follows the player's order so the page can show the same sequence the
 * player saw. Verdicts are computed from the bank key, not from the AI sheet,
 * so a wrong AI answer is reported as such instead of being treated as truth.
 */
export function compareWithReference(
  answers: readonly { readonly id: string; readonly pick: number }[],
  reference: AiReference,
  items: readonly BankItem[],
): QuizCompareResult {
  const byId = new Map(items.map((entry) => [entry.question.id, entry.question]));
  const rows: QuizCompareRow[] = [];
  for (const answer of answers) {
    const question = byId.get(answer.id);
    const aiPick = reference.picks.get(answer.id) ?? null;
    if (question === undefined) {
      rows.push({ id: answer.id, difficulty: null, playerPick: answer.pick, aiPick: aiPick?.pick ?? null, keyIndex: null, verdict: 'unknown-item', explanation: null });
      continue;
    }
    if (aiPick === null) {
      rows.push({
        id: answer.id,
        difficulty: question.difficulty,
        playerPick: answer.pick,
        aiPick: null,
        keyIndex: question.answerIndex,
        verdict: 'no-reference',
        explanation: { en: question.explanation.en, th: question.explanation.th },
      });
      continue;
    }
    rows.push({
      id: answer.id,
      difficulty: question.difficulty,
      playerPick: answer.pick,
      aiPick: aiPick.pick,
      keyIndex: question.answerIndex,
      verdict: verdictFor(answer.pick, aiPick.pick, question.answerIndex),
      explanation: { en: question.explanation.en, th: question.explanation.th },
    });
  }

  const scored = rows.filter((row) => row.verdict !== 'no-reference' && row.verdict !== 'unknown-item');
  const count = (verdict: CompareVerdict) => rows.filter((row) => row.verdict === verdict).length;
  const bothCorrect = count('both-correct');
  const aiAhead = count('ai-correct-only');
  const playerAhead = count('player-correct-only');
  const bothWrong = count('both-wrong');
  const agreement = scored.filter((row) => row.playerPick === row.aiPick).length;
  const buckets = new Map<number, { count: number; agreement: number }>();
  for (const row of scored) {
    if (row.difficulty === null) continue;
    const bucket = buckets.get(row.difficulty) ?? { count: 0, agreement: 0 };
    bucket.count += 1;
    if (row.playerPick === row.aiPick) bucket.agreement += 1;
    buckets.set(row.difficulty, bucket);
  }
  const byDifficulty: QuizComparePercentRow[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([difficulty, bucket]) => ({
      label: 'd' + difficulty,
      count: bucket.count,
      percent: percent(bucket.agreement, bucket.count),
    }));

  const summary: QuizCompareSummary = {
    total: rows.length,
    compared: scored.length,
    bothCorrect,
    aiAhead,
    playerAhead,
    bothWrong,
    noReference: count('no-reference'),
    unknown: count('unknown-item'),
    agreement,
    agreementPercent: percent(agreement, scored.length),
    aiAccuracy: percent(bothCorrect + aiAhead, scored.length),
    playerAccuracy: percent(bothCorrect + playerAhead, scored.length),
    missed: rows.filter((row) => row.verdict === 'ai-correct-only').map((row) => row.id),
    aiMissed: rows.filter((row) => row.verdict === 'player-correct-only').map((row) => row.id),
    byDifficulty,
  };
  return {
    rows,
    summary,
    reference: { items: reference.picks.size, sources: reference.sources, skipped: reference.skipped },
  };
}
