// SPDX-License-Identifier: MIT
/**
 * World-v1 composer — turns a ladder plan into a finished two-language MCQ.
 *
 * Format: "match the following" — the prompt lists k real sub-questions
 * (entity × attribute) and the four options are sequences of k answers.
 * The correct option chains the true values; every distractor swaps one (or,
 * at high difficulty, two) values for a REAL value from the same attribute
 * family — plausible, verifiable, and never invented.
 *
 * Difficulty maps to reasoning load:
 *   d1–4 → 2 clauses (one swap)   d5–6 → 3 clauses (one swap)
 *   d7–8 → 4 clauses (one swap)   d9–10 → 4 clauses (two coordinated swaps)
 *
 * With ~500 base facts, C(N,k) clause combinations keep every prompt unique
 * (enforced by the dedupe hash retry below), so the spec's no-template rule
 * holds without ever fabricating data.
 */

import { DISCIPLINE_IDS } from '../chain/disciplines.js';
import { ENTITIES, type Fact, type Pair, type WorldEntity } from './facts.js';
import { mixSeeds, mulberry32, type LadderPlan } from './ladder.js';

/** One resolved sub-question inside a composed item. */
interface Clause {
  readonly entity: WorldEntity;
  readonly fact: Fact;
}

/** The deliverable question shape (world-v1 schema, on-disk). */
export interface WorldQuestion {
  readonly id: string;
  readonly disciplines: readonly string[];
  readonly primaryDiscipline: string;
  readonly subjectCount: number;
  readonly difficulty: number;
  readonly prompt: Pair;
  readonly options: readonly [string, string, string, string];
  readonly answerIndex: number;
  readonly explanation: Pair;
  readonly tags: readonly string[];
  readonly verifiedYear: 2026;
}

/** Flattened (entity, fact) catalog in deterministic order. */
export const FLAT: readonly Clause[] = Object.freeze(
  ENTITIES.flatMap((entity) => entity.facts.map((fact) => ({ entity, fact }))),
);

const SOURCE_NOTE_TH: Readonly<Record<string, string>> = Object.freeze({
  UN: 'ตามสถิติ UN/FAO',
  ISO: 'ตามมาตรฐาน ISO',
  ENCYCLOPEDIA: 'ตามสารานุกรมที่ยอมรับทั่วไป',
  SCIENCE: 'ตามตำราวิทยาศาสตร์มาตรฐาน',
  SPORT: 'ตามบันทึกสถิติการแข่งขัน',
  CONVENTION: 'ตามนิยาม SI',
  DOC: 'ตามเอกสารข้อกำหนดอ้างอิง',
});

function clauseTh(clause: Clause): string {
  const label = clause.fact.label.th;
  const joiner = label.endsWith(')') ? ' ' : '';
  return `${label}${joiner}ของ${clause.entity.name.th}`;
}

function clauseEn(clause: Clause): string {
  const label = clause.fact.label.en;
  const lowered = /^[A-Z]/.test(label) && !/^[A-Z]{2,}/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
  return `the ${lowered} of ${clause.entity.name.en}`;
}

/** Normalization for the mechanical dedupe rule (strip spaces/punct/digits). */
export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9\u0E50-\u0E59]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function dedupeKey(prompt: Pair, options: readonly string[]): string {
  const joined = [...options].map(normalizeForDedupe).sort().join('|');
  return `${normalizeForDedupe(prompt.en)}#${joined}`;
}

/** Lowercase-first helper kept local (no Array.prototype.sort on data). */
function firstLetterLower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Tag sanitizer for the spec's [a-z][a-z0-9-]* rule: camelCase attribute ids
 * (e.g. officialLanguages) become lowercase kebab-case (official-languages)
 * instead of leaking mixed case into the JSONL.
 */
function toTag(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const TAG_OK = /^[a-z][a-z0-9-]*$/;

interface BuildContext {
  readonly usage: number[]; // parallel to FLAT
  readonly seen: Set<string>; // dedupe keys of already-built questions
}

export type { BuildContext };

function candidateIndices(disciplines: readonly string[]): number[] {
  const wanted = new Set(disciplines);
  const primary: number[] = [];
  const secondary: number[] = [];
  for (let i = 0; i < FLAT.length; i += 1) {
    const entry = FLAT[i]!;
    if (wanted.has(entry.entity.discipline)) primary.push(i);
    else if (entry.entity.secondary.some((id) => wanted.has(id))) secondary.push(i);
  }
  return [...primary, ...secondary];
}

/** Picks a least-used clause among candidates (deterministic, no sort). */
function pickClause(ctx: BuildContext, candidates: readonly number[], rng: () => number, taken: ReadonlySet<number>): number {
  let minUsage = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    if (taken.has(index)) continue;
    const value = ctx.usage[index]!;
    if (value < minUsage) minUsage = value;
  }
  const pool = candidates.filter((index) => !taken.has(index) && ctx.usage[index]! <= minUsage + 2);
  const finalPool = pool.length > 0 ? pool : candidates.filter((index) => !taken.has(index));
  if (finalPool.length === 0) throw new Error('WORLDBANK_NO_CLAUSE_LEFT');
  const chosen = finalPool[Math.floor(rng() * finalPool.length)]!;
  ctx.usage[chosen] = ctx.usage[chosen]! + 1;
  return chosen;
}

/** Real replacement values for a fact: same fact id, different entity. */
function sameFactValues(fact: Fact, excludeValueTh: string): Pair[] {
  const pool: Pair[] = [];
  for (const entry of FLAT) {
    if (entry.fact.id !== fact.id) continue;
    if (entry.entity.name.en === clauseEntityFallback(fact)) continue;
    const value = entry.fact.value;
    if (value.th === excludeValueTh || value.en === fact.value.en) continue;
    if (pool.some((existing) => existing.th === value.th)) continue;
    pool.push(value);
  }
  return pool;
}

function clauseEntityFallback(_fact: Fact): string {
  return '\u0000never'; // placeholder: no entity excluded beyond value checks
}

/** Fallback distractor values: other facts of the same entity (real, wrong slot). */
function siblingEntityValues(entity: WorldEntity, excludeFactId: string): Pair[] {
  return entity.facts.filter((f) => f.id !== excludeFactId).map((f) => f.value);
}

function clauseCountForDifficulty(difficulty: number): number {
  if (difficulty <= 4) return 2;
  if (difficulty <= 6) return 3;
  return 4;
}

/** Number of value swaps per distractor (coordinated lies at the frontier). */
function swapCountForDifficulty(difficulty: number): number {
  return difficulty >= 9 ? 2 : 1;
}

function joined(values: readonly string[]): string {
  return values.join(' · ');
}

/**
 * Composes the question for a ladder plan (index 0 is the flagship — built
 * separately). Deterministic: same index → same question, forever.
 */
export function composeQuestion(plan: LadderPlan, ctx: BuildContext): WorldQuestion {
  const rng = mulberry32(mixSeeds(0x574f434d /* WORC */, plan.index));
  const k = clauseCountForDifficulty(plan.difficulty);
  const swapCount = swapCountForDifficulty(plan.difficulty);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    // 1) Pick k distinct clauses cycling through the plan's disciplines.
    const candidates = candidateIndices(plan.disciplines);
    const taken = new Set<number>();
    const clauses: Clause[] = [];
    const usedValueTh = new Set<string>();
    let ok = true;
    for (let j = 0; j < k; j += 1) {
      const subject = plan.disciplines[j % plan.disciplines.length]!;
      const scoped = candidateIndices([subject]);
      const pool = scoped.length > 0 ? scoped : candidates;
      let index: number;
      try {
        index = pickClause(ctx, pool, rng, taken);
      } catch {
        ok = false;
        break;
      }
      const clause = FLAT[index]!;
      if (usedValueTh.has(clause.fact.value.th)) {
        // Same visible value twice in one tuple — retry this slot once.
        try {
          index = pickClause(ctx, pool, rng, new Set([...taken, index]));
        } catch {
          ok = false;
          break;
        }
      }
      const resolved = FLAT[index]!;
      taken.add(index);
      usedValueTh.add(resolved.fact.value.th);
      clauses.push(resolved);
    }
    if (!ok || clauses.length !== k) continue;

    // 2) Correct tuple + adversarial distractors (real values, wrong slots).
    const correctValues = clauses.map((clause) => clause.fact.value.th);
    const correctEn = clauses.map((clause) => clause.fact.value.en);
    const optionSet = new Set<string>([joined(correctValues)]);
    const distractorTh: string[] = [];
    let distractorEn: string[] = [];
    let built = 0;
    for (let d = 0; d < 3 && ok; d += 1) {
      let candidate: string[] | null = null;
      let candidateEn: string[] | null = null;
      for (let retry = 0; retry < 16; retry += 1) {
        const positions = new Set<number>();
        let guard = 0;
        while (positions.size < Math.min(swapCount, k) && guard < 8) {
          positions.add(Math.floor(rng() * k));
          guard += 1;
        }
        const values = [...correctValues];
        const valuesEn = [...correctEn];
        let applied = true;
        for (const position of positions) {
          const clause = clauses[position]!;
          const pool = sameFactValues(clause.fact, clause.fact.value.th);
          const replacement = pool.length > 0 ? pool[Math.floor(rng() * pool.length)]! : null;
          if (replacement && !values.includes(replacement.th)) {
            values[position] = replacement.th;
            valuesEn[position] = replacement.en;
          } else {
            const siblings = siblingEntityValues(clause.entity, clause.fact.id);
            const sibling = siblings.length > 0 ? siblings[Math.floor(rng() * siblings.length)]! : null;
            if (!sibling || values.includes(sibling.th)) { applied = false; break; }
            values[position] = sibling.th;
            valuesEn[position] = sibling.en;
          }
        }
        const text = joined(values);
        if (applied && !optionSet.has(text)) {
          candidate = values;
          candidateEn = valuesEn;
          break;
        }
      }
      if (!candidate || !candidateEn) { ok = false; break; }
      optionSet.add(joined(candidate));
      distractorTh.push(joined(candidate));
      if (built === 0) distractorEn = candidateEn;
      else distractorEn = [...distractorEn, ...candidateEn];
      built += 1;
    }
    if (!ok || built < 3) continue;

    // 3) Place the correct option at the ladder's answer position.
    const options = [joined(correctValues), distractorTh[0]!, distractorTh[1]!, distractorTh[2]!] as [string, string, string, string];
    const optionsEn = [joined(correctEn), joined(distractorEn.slice(0, k)), joined(distractorEn.slice(k, 2 * k)), joined(distractorEn.slice(2 * k, 3 * k))];
    if (plan.answerIndex !== 0) {
      const j = plan.answerIndex;
      const tmp = options[0]!;
      options[0] = options[j]!;
      options[j] = tmp;
      const tmpEn = optionsEn[0]!;
      optionsEn[0] = optionsEn[j]!;
      optionsEn[j] = tmpEn;
    }

    const prompt: Pair = {
      th: `ลำดับคำตอบใดถูกต้องครบทุกรายการ: ${clauses.map(clauseTh).join(' / ')}`,
      en: `Which sequence answers every item correctly: ${clauses.map(clauseEn).join(' / ')}?`,
    };
    if (prompt.th.length > 300 || prompt.en.length > 300 || prompt.th.length < 10 || prompt.en.length < 10) continue;

    const key = dedupeKey(prompt, options);
    if (ctx.seen.has(key)) continue; // deterministic retry with the same stream
    ctx.seen.add(key);

    const sourceNote = SOURCE_NOTE_TH[clauses[0]!.fact.source] ?? 'ตามแหล่งอ้างอิงที่ยอมรับ';
    const sourceNoteEn = 'per the referenced standard sources';
    const explanation: Pair = {
      th: `ทุกรายการจับคู่ถูกต้องคือ ${joined(correctValues)} (${sourceNote})`,
      en: `Every item matches correctly: ${joined(correctEn)} (${sourceNoteEn})`,
    };

    const tagSet = new Set<string>();
    for (const clause of clauses) {
      tagSet.add(toTag(clause.fact.id));
      tagSet.add(toTag(firstLetterLower(clause.entity.tags[0] ?? 'world')));
      if (tagSet.size >= 3) break;
    }
    if (k >= 3) tagSet.add('multi-fact');
    const tags = [...tagSet].filter((tag) => tag.length > 0 && TAG_OK.test(tag) && !DISCIPLINE_IDS.includes(tag)).slice(0, 4);
    if (tags.length === 0) tags.push('world-knowledge');

    return {
      id: `wk-${String(plan.index + 1).padStart(6, '0')}`,
      disciplines: [...plan.disciplines],
      primaryDiscipline: plan.disciplines[0]!,
      subjectCount: plan.subjectCount,
      difficulty: plan.difficulty,
      prompt,
      options,
      answerIndex: plan.answerIndex,
      explanation,
      tags,
      verifiedYear: 2026,
    };
  }
  throw new Error(`WORLDBANK_COMPOSE_FAILED:${plan.index}`);
}

/** Fresh build context for one full deterministic pass. */
export function newBuildContext(): BuildContext {
  return { usage: Array.from({ length: FLAT.length }, () => 0), seen: new Set<string>() };
}

/** English helper kept for parity with the Thai prompt builder. */
export { firstLetterLower };
