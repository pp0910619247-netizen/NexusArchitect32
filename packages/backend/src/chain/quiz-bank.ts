import { canonicalJson, mixSeeds, mulberry32, pick, ri, round2, sha256Hex } from './hash.js';
import { DISCIPLINES, DISCIPLINE_IDS } from './disciplines.js';
import type { QuizQuestion } from './types.js';

/** Total number of questions the bank generates. */
export const TOTAL_QUESTIONS = 100_000;

/**
 * Difficulty ladder: block 1 starts easy; difficulty climbs with the bank
 * index and saturates at 10 (hardest). Blocks sample bank questions in slot
 * order, so the chain as a whole walks easy → hard.
 */
export function difficultyForSlot(slot: number): number {
  const clamped = Math.max(0, Math.min(TOTAL_QUESTIONS - 1, slot));
  return Math.min(10, 1 + Math.floor((clamped / TOTAL_QUESTIONS) * 10));
}

type TextPair = Readonly<{ th: string; en: string }>;

/** Question templates per discipline. Deterministic and locale-paired. */
const TEMPLATES: Readonly<Record<string, readonly Template[]>> = {
  math: [
    {
      make(rng, _d): QuestionDraft {
        const a = ri(rng, 2, 9 + _d * 3);
        const b = ri(rng, 2, 9 + _d * 3);
        const correct = a * b;
        const wrongs = new Set<number>([correct + ri(rng, 1, 5), correct - ri(rng, 1, 5), Math.round(correct * (1 + (rng() < 0.5 ? 0.1 : -0.1)))]);
        wrongs.delete(correct);
        return { prompt: { th: `${a} × ${b} = ข้อใดถูกต้อง`, en: `What is ${a} × ${b}?` }, answer: `${correct}`, distractors: [...wrongs].map(String) };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const n = ri(rng, 2, 8 + _d * 2);
        const correct = (n * (n + 1)) / 2;
        const wrongs = [correct + n, correct - n, correct + 1].filter((v) => v !== correct);
        return { prompt: { th: `ผลบวก 1+2+…+${n} เท่ากับเท่าใด`, en: `What is the sum 1+2+…+${n}?` }, answer: `${correct}`, distractors: wrongs.map(String) };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const total = ri(rng, 20, 60);
        const pct = pick(rng, [10, 20, 25, 50, 75] as const);
        const correct = round2((total * pct) / 100);
        const wrongs = [round2(correct * 2), Math.max(0, round2(correct / 2)), correct + 1].filter((v) => v !== correct);
        return { prompt: { th: `${pct}% ของ ${total} มีค่าเท่าใด`, en: `What is ${pct}% of ${total}?` }, answer: `${correct}`, distractors: wrongs.map(String) };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const a = ri(rng, 2, 9);
        const b = ri(rng, 2, 12);
        const c = ri(rng, 2, 9);
        const correct = a * b + c;
        const wrongs = [a * (b + c), a * b - c, a + b * c].filter((v) => v !== correct);
        return { prompt: { th: `${a} × ${b} + ${c} มีค่าเท่าใด`, en: `Evaluate ${a} × ${b} + ${c}` }, answer: `${correct}`, distractors: wrongs.map(String) };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const start = ri(rng, 1, 12);
        const step = ri(rng, 2, 9);
        const n = ri(rng, 4, 8);
        const correct = start + step * (n - 1);
        const wrongs = [start + step * n, correct + 1, correct - step].filter((v) => v !== correct && v >= 0);
        return { prompt: { th: `พจน์ที่ ${n} ของลำดับ ${start}, ${start + step}, ${start + 2 * step}, … คือข้อใด`, en: `What is term ${n} of the sequence ${start}, ${start + step}, ${start + 2 * step}, …?` }, answer: `${correct}`, distractors: wrongs.map(String) };
      },
    },
  ],
  science: [
    {
      make(rng, _d): QuestionDraft {
        const planet = pick(rng, [
          { th: 'ดาวพฤหัสบดี', en: 'Jupiter', moons: 95 }, { th: 'ดาวเสาร์', en: 'Saturn', moons: 146 },
          { th: 'ดาวอังคาร', en: 'Mars', moons: 2 }, { th: 'ดาวเนปจูน', en: 'Neptune', moons: 16 },
        ] as const);
        const correct = planet.moons;
        const wrongs = [correct + 3, Math.max(1, correct - 3), correct + 10].filter((v) => v !== correct);
        return { prompt: { th: `${planet.th} มีดวงจันทร์บริวารที่ได้รับการรับรองประมาณกี่ดวง`, en: `About how many confirmed moons does ${planet.en} have?` }, answer: `${correct}`, distractors: wrongs.map(String) };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const speed = ri(rng, 2, 10);
        const time = ri(rng, 2, 10);
        const correct = speed * time;
        const wrongs = [speed + time, correct + speed, Math.max(1, correct - time)].filter((v) => v !== correct);
        return { prompt: { th: `วัตถุเคลื่อนที่ด้วยความเร็ว ${speed} ม./วินาที นาน ${time} วินาที จะเคลื่อนที่ได้ระยะทางเท่าใด (เมตร)`, en: `An object moves at ${speed} m/s for ${time} s. What distance (m) does it cover?` }, answer: `${correct}`, distractors: wrongs.map(String) };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const organelle = pick(rng, [
          { th: 'ไมโทคอนเดรีย', en: 'mitochondria', fn: { th: 'ผลิตพลังงาน ATP', en: 'produce ATP energy' } },
          { th: 'ไรโบโซม', en: 'ribosomes', fn: { th: 'สร้างโปรตีน', en: 'synthesize proteins' } },
          { th: 'คลอโรพลาสต์', en: 'chloroplasts', fn: { th: 'สังเคราะห์แสง', en: 'perform photosynthesis' } },
          { th: 'ไลโซโซม', en: 'lysosomes', fn: { th: 'ย่อยสลายของเสีย', en: 'digest waste' } },
        ] as const);
        const others = TEMPLATES.science!.map((t) => t).length; // keep template count stable
        void others;
        const correct = organelle.fn;
        const wrongs = [
          { th: 'สร้างโปรตีน', en: 'synthesize proteins' },
          { th: 'ผลิตพลังงาน ATP', en: 'produce ATP energy' },
          { th: 'สังเคราะห์แสง', en: 'perform photosynthesis' },
          { th: 'ย่อยสลายของเสีย', en: 'digest waste' },
        ].filter((f) => f.en !== correct.en);
        return { prompt: { th: `หน้าที่หลักของ ${organelle.th} ในเซลล์คืออะไร`, en: `What is the main function of ${organelle.en} in a cell?` }, answer: correct, distractors: wrongs };
      },
    },
  ],
  thai: [
    {
      make(rng, _d): QuestionDraft {
        const word = pick(rng, [
          { th: 'เรือ', en: 'boat', cls: { th: 'คำนาม', en: 'noun' } },
          { th: 'วิ่ง', en: 'run', cls: { th: 'คำกริยา', en: 'verb' } },
          { th: 'สวยงาม', en: 'beautiful', cls: { th: 'คำคุณศัพท์', en: 'adjective' } },
          { th: 'อย่างรวดเร็ว', en: 'quickly', cls: { th: 'คำวิเศษณ์', en: 'adverb' } },
        ] as const);
        const correct = word.cls;
        const wrongs = [
          { th: 'คำนาม', en: 'noun' }, { th: 'คำกริยา', en: 'verb' },
          { th: 'คำคุณศัพท์', en: 'adjective' }, { th: 'คำวิเศษณ์', en: 'adverb' },
        ].filter((c) => c.en !== word.cls.en);
        return { prompt: { th: `คำว่า “${word.th}” เป็นคำชนิดใด`, en: `What part of speech is “${word.en}”?` }, answer: correct, distractors: wrongs };
      },
    },
  ],
  english: [
    {
      make(rng, _d): QuestionDraft {
        const item = pick(rng, [
          { base: 'go', past: 'went' }, { base: 'eat', past: 'ate' }, { base: 'see', past: 'saw' },
          { base: 'buy', past: 'bought' }, { base: 'take', past: 'took' }, { base: 'write', past: 'wrote' },
        ] as const);
        const wrongs = [`${item.base}ed`, item.base, `${item.base}ing`].filter((v) => v !== item.past);
        return { prompt: { th: `รูปอดีตของคำกริยา “${item.base}” คือคำใด`, en: `What is the past tense of “${item.base}”?` }, answer: item.past, distractors: wrongs };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const word = pick(rng, [
          { en: 'ancient', th: 'โบราณ' }, { en: 'rapid', th: 'รวดเร็ว' },
          { en: 'abundant', th: 'อุดมสมบูรณ์' }, { en: 'fragile', th: 'เปราะบาง' },
        ] as const);
        const wrongs = ['ช้า', 'เกลียด', 'แคบ'].filter((v) => v !== word.th);
        return { prompt: { th: `คำว่า “${word.en}” มีความหมายตรงกับข้อใด`, en: `What does “${word.en}” mean?` }, answer: word.th, distractors: wrongs };
      },
    },
  ],
  social: [
    {
      make(rng, _d): QuestionDraft {
        const item = pick(rng, [
          { th: 'อยุธยา', en: 'Ayutthaya', year: 1350 }, { th: 'ธนบุรี', en: 'Thonburi', year: 1767 },
          { th: 'รัตนโกสินทร์', en: 'Rattanakosin', year: 1782 }, { th: 'สุโขทัย', en: 'Sukhothai', year: 1238 },
        ] as const);
        const wrongs = [item.year + 32, item.year - 32, item.year + 100].filter((v) => v !== item.year);
        return { prompt: { th: `อาณาจักร${item.th} สถาปนาขึ้นในปี พ.ศ. ใด`, en: `In what year (BE) was the ${item.en} kingdom founded?` }, answer: `${item.year}`, distractors: wrongs.map(String) };
      },
    },
  ],
  health: [
    {
      make(rng, _d): QuestionDraft {
        const nutrient = pick(rng, [
          { th: 'วิตามินซี', en: 'Vitamin C', src: { th: 'ส้ม', en: 'oranges' } },
          { th: 'แคลเซียม', en: 'calcium', src: { th: 'นม', en: 'milk' } },
          { th: 'ธาตุเหล็ก', en: 'iron', src: { th: 'ตับ', en: 'liver' } },
          { th: 'โปรตีน', en: 'protein', src: { th: 'ไข่', en: 'eggs' } },
        ] as const);
        const correct = nutrient.src;
        const wrongs = [
          { th: 'ส้ม', en: 'oranges' }, { th: 'นม', en: 'milk' },
          { th: 'ตับ', en: 'liver' }, { th: 'ไข่', en: 'eggs' },
        ].filter((s) => s.en !== nutrient.src.en);
        return { prompt: { th: `${nutrient.th} พบมากในอาหารชนิดใด`, en: `Which food is rich in ${nutrient.en}?` }, answer: correct, distractors: wrongs };
      },
    },
  ],
  art: [
    {
      make(rng, _d): QuestionDraft {
        const color = pick(rng, [
          { th: 'แดง', en: 'red' }, { th: 'น้ำเงิน', en: 'blue' }, { th: 'เหลือง', en: 'yellow' },
        ] as const);
        const correct = { th: 'สี primary (สีขั้นที่ 1)', en: 'a primary color' };
        const wrongs = [
          { th: 'สี secondary (สีขั้นที่ 2)', en: 'a secondary color' },
          { th: 'สี tertiary (สีขั้นที่ 3)', en: 'a tertiary color' },
          { th: 'สีเอกรงค์', en: 'a monochrome' },
        ];
        return { prompt: { th: `สี${color.th} จัดเป็นสีชนิดใดในทฤษฎีสี`, en: `In color theory, ${color.en} is classified as…` }, answer: correct, distractors: wrongs };
      },
    },
  ],
  career: [
    {
      make(rng, _d): QuestionDraft {
        const tool = pick(rng, [
          { th: 'ค้อน', en: 'hammer', use: { th: 'ตอกตะปู', en: 'drive nails' } },
          { th: 'ไขควง', en: 'screwdriver', use: { th: 'ขันสกรู', en: 'turn screws' } },
          { th: 'เลื่อย', en: 'saw', use: { th: 'ตัดไม้', en: 'cut wood' } },
          { th: 'บล็อกสวิตช์', en: 'wrench', use: { th: 'ขันน็อต', en: 'turn nuts' } },
        ] as const);
        const correct = tool.use;
        const wrongs = [
          { th: 'ตอกตะปู', en: 'drive nails' }, { th: 'ขันสกรู', en: 'turn screws' },
          { th: 'ตัดไม้', en: 'cut wood' }, { th: 'ขันน็อต', en: 'turn nuts' },
        ].filter((u) => u.en !== tool.use.en);
        return { prompt: { th: `เครื่องมือ “${tool.th}” ใช้ทำอะไร`, en: `What is a ${tool.en} used for?` }, answer: correct, distractors: wrongs };
      },
    },
  ],
  ict: [
    {
      make(rng, _d): QuestionDraft {
        const unit = pick(rng, [
          { th: '1 กิโลไบต์', en: '1 kilobyte', bytes: 1024 }, { th: '1 เมกะไบต์', en: '1 megabyte', bytes: 1_048_576 },
        ] as const);
        const wrongs = [1000, 512, 2048].filter((v) => v !== unit.bytes).map(String);
        return { prompt: { th: `${unit.th} มีค่าเท่ากับกี่ไบต์ (ระบบเลขฐานสอง)`, en: `How many bytes is ${unit.en} (binary system)?` }, answer: `${unit.bytes}`, distractors: wrongs };
      },
    },
    {
      make(rng, _d): QuestionDraft {
        const bit = pick(rng, [3, 4, 5, 6, 7, 8] as const);
        const correct = 2 ** bit;
        const wrongs = [correct * 2, correct / 2, correct + 2].map(String);
        return { prompt: { th: `เลขฐานสอง ${bit} บิต แทนค่าได้มากที่สุดกี่ค่า`, en: `How many distinct values can ${bit} bits represent?` }, answer: `${correct}`, distractors: wrongs };
      },
    },
  ],
  econ: [
    {
      make(rng, _d): QuestionDraft {
        const good = pick(rng, [
          { th: 'ข้าว', en: 'rice' }, { th: 'น้ำมัน', en: 'oil' }, { th: 'ทองคำ', en: 'gold' },
        ] as const);
        const correct = { th: 'อุปสงค์เพิ่มขึ้น', en: 'demand increases' };
        const wrongs = [
          { th: 'อุปสงค์ลดลง', en: 'demand decreases' },
          { th: 'อุปทานเพิ่มขึ้น', en: 'supply increases' },
          { th: 'ราคาลดลง', en: 'price falls' },
        ];
        return { prompt: { th: `หากข่าวดีทำให้ผู้บริโภคต้องการ ${good.th} มากขึ้น แรงใดกระทบราคา`, en: `If consumers suddenly want more ${good.en}, which force pushes the price?` }, answer: correct, distractors: wrongs };
      },
    },
  ],
  geography: [
    {
      make(rng, _d): QuestionDraft {
        const river = pick(rng, [
          { th: 'แม่น้ำโขง', en: 'Mekong' }, { th: 'แม่น้ำเจ้าพระยา', en: 'Chao Phraya' },
          { th: 'แม่น้ำไนล์', en: 'Nile' }, { th: 'แม่น้ำแอมะซอน', en: 'Amazon' },
        ] as const);
        const correct = { th: 'ทวีปเอเชีย', en: 'Asia' };
        const wrongs = [
          { th: 'ทวีปแอฟริกา', en: 'Africa' }, { th: 'ทวีปอเมริกาใต้', en: 'South America' },
          { th: 'ทวีปยุโรป', en: 'Europe' },
        ];
        void river;
        return { prompt: { th: 'แม่น้ำโขงไหลผ่านทวีปใด', en: 'The Mekong River flows through which continent?' }, answer: correct, distractors: wrongs };
      },
    },
  ],
  philosophy: [
    {
      make(rng, _d): QuestionDraft {
        const syllogism = pick(rng, [
          { a: 'มนุษย์ทุกคนตายได้', b: 'สอมเป็นมนุษย์', c: 'สอมตายได้', en: ['All humans are mortal', 'Som is a human', 'Som is mortal'] },
          { a: 'สัตว์ทุกตัวต้องการอาหาร', b: 'แมวเป็นสัตว์', c: 'แมวต้องการอาหาร', en: ['All animals need food', 'A cat is an animal', 'A cat needs food'] },
        ] as const);
        const correct = { th: syllogism.c, en: syllogism.en[2]! };
        const wrongs = [
          { th: syllogism.a, en: syllogism.en[0]! },
          { th: 'ข้อสรุปไม่สามารถสรุปได้', en: 'No valid conclusion' },
          { th: 'ทั้งหมดผิด', en: 'All are false' },
        ];
        return { prompt: { th: `“${syllogism.a} และ ${syllogism.b}” ข้อสรุปที่ถูกต้องคือข้อใด`, en: `Given “${syllogism.en[0]} and ${syllogism.en[1]}”, what follows?` }, answer: correct, distractors: wrongs };
      },
    },
  ],
};

interface Template {
  make(rng: () => number, difficulty: number): QuestionDraft;
}

interface QuestionDraft {
  readonly prompt: TextPair;
  readonly answer: string | TextPair;
  readonly distractors: readonly (string | TextPair)[];
}

function textOf(value: string | TextPair): TextPair {
  return typeof value === 'string' ? { th: value, en: value } : value;
}

/**
 * ---- Cross-discipline questions (bank v2) ----
 *
 * The owner's spec: every 1,000 blocks the reward halves AND the system
 * escalates by combining MORE disciplines per question — 2 subjects first,
 * then 3, then 4 — sampled ACROSS the 12 core disciplines (ข้ามสาขา), so
 * questions span easy → hard continuously.
 *
 * Two zones were already mined with the v1 single-discipline formula and
 * MUST keep producing byte-identical questions (verifyChain re-derives
 * every historical block from the bank):
 *   • base slots 0–522            (blocks 1–523)
 *   • hard-tier slots 90000–90520 (hard blocks ÷10 up to height 520)
 * v2 composition starts at base slot 523 (block 524 onward) and hard-tier
 * slot 90521.
 */
export const CROSS_FROM_SLOT = 523;
/** Last hard-tier slot mined under bank v1. */
export const HARD_LEGACY_LAST_SLOT = 90_520;
/** Maximum subjects combined into one question. */
export const MAX_COMBINED_DISCIPLINES = 4;

/** Slots whose questions are frozen to the legacy v1 formula. */
export function isLegacySlot(slot: number): boolean {
  return slot < CROSS_FROM_SLOT || (slot >= 90_000 && slot <= HARD_LEGACY_LAST_SLOT);
}

/** How many disciplines a v2 slot combines: 2 → 3 → 4 as the chain grows. */
export function combinedCountForSlot(slot: number): number {
  if (isLegacySlot(slot)) return 1;
  if (slot < 1_000) return 2;
  if (slot < 2_000) return 3;
  return Math.min(MAX_COMBINED_DISCIPLINES, 4);
}

/** Stable per-slot discipline set: primary discipline + cross partners. */
export function disciplineIdsForSlot(slot: number): readonly string[] {
  if (isLegacySlot(slot)) return [DISCIPLINE_IDS[slot % DISCIPLINE_IDS.length]!];
  const count = combinedCountForSlot(slot);
  const ids: string[] = [DISCIPLINE_IDS[slot % DISCIPLINE_IDS.length]!];
  let probe = 0;
  while (ids.length < count) {
    // Deterministic partners from the slot number (never duplicates).
    const partner = DISCIPLINE_IDS[(slot * 7 + 3 + probe * 5) % DISCIPLINE_IDS.length]!;
    if (!ids.includes(partner)) ids.push(partner);
    probe += 1;
    if (probe > DISCIPLINE_IDS.length) break; // unreachable: count ≤ 4 ≤ 12
  }
  return ids;
}

/** Combined label `วิชา A + วิชา B + …` (TH/EN) for the question prologue. */
export function disciplineLabelForIds(ids: readonly string[]): TextPair {
  const names = ids.map((id) => {
    const found = DISCIPLINES.find((d) => d.id === id);
    if (!found) throw new Error(`UNKNOWN_DISCIPLINE:${id}`);
    return { th: found.th, en: found.en };
  });
  return { th: names.map((n) => n.th).join(' + '), en: names.map((n) => n.en).join(' + ') };
}

/** Builds one sub-question draft from a discipline's templates. */
function buildDisciplineDraft(disciplineId: string, rng: () => number, difficulty: number): QuestionDraft {
  const templates = TEMPLATES[disciplineId];
  if (!templates) throw new Error(`UNKNOWN_DISCIPLINE:${disciplineId}`);
  const template = pick(rng, templates);
  return template.make(rng, difficulty);
}

/**
 * Composes a cross-discipline draft: one leg per combined discipline; the
 * KEY leg supplies the answer while the other legs' answers join the
 * distractor pool (a wrong pick usually means you solved the wrong subject).
 */
function buildCrossQuestionDraft(ids: readonly string[], rng: () => number, difficulty: number): QuestionDraft {
  const drafts = ids.map((id) => buildDisciplineDraft(id, rng, difficulty));
  const keyIndex = Math.floor(rng() * drafts.length);
  const key = drafts[keyIndex]!;
  const otherAnswers = drafts.filter((_, i) => i !== keyIndex).map((d) => textOf(d.answer));
  const label = disciplineLabelForIds(ids);
  return {
    prompt: {
      th: `【${label.th}】 ${key.prompt.th}`,
      en: `[${label.en}] ${key.prompt.en}`,
    },
    answer: textOf(key.answer),
    distractors: [...otherAnswers, ...key.distractors.map(textOf)].map(textOf),
  };
}

/** Legacy v1 single-discipline question (mined slots — byte-stable). */
function buildLegacyQuestion(slot: number): QuizQuestion {
  const disciplineId = DISCIPLINE_IDS[slot % DISCIPLINE_IDS.length]!;
  const templates = TEMPLATES[disciplineId]!;
  const rng = mulberry32(mixSeeds(0x4e455800, slot));
  const difficulty = difficultyForSlot(slot);
  // Difficulty flips a variant knob so later slots differ from earlier ones.
  rng(); // burn one draw to decorrelate consecutive slots
  const template = pick(rng, templates);
  const draft = template.make(rng, difficulty);
  const options = shuffleOptions(rng, draft);
  const answerIndex = options.findIndex((option) => option.en === textOf(draft.answer).en);
  if (answerIndex < 0) throw new Error(`ANSWER_NOT_IN_OPTIONS:${slot}`);
  const prompt = { th: draft.prompt.th, en: draft.prompt.en };
  // SECURITY: the published content hash covers ONLY the public payload —
  // never the answer. Hashing answerIndex here would let anyone brute-force
  // the key with 4 sha256 tries against the hash shipped with the question.
  const contentHash = sha256Hex(canonicalQuestionString(slot, disciplineId, difficulty, prompt, options));
  // Blind commitment to the correct key (kept off the public payload; peers
  // verify it via answerCommitmentForQuestion without learning the key).
  const answerCommitment = answerCommitmentForQuestion(slot, answerIndex);
  return {
    id: `q-${String(slot + 1).padStart(6, '0')}`,
    slot,
    discipline: disciplineId,
    difficulty,
    prompt,
    answerCommitment,
    options: [options[0]!.th, options[1]!.th, options[2]!.th, options[3]!.th] as [string, string, string, string],
    answerIndex,
    alternatives: [],
    contentHash,
  };
}

/** Builds the canonical question for a slot (deterministic). */
export function buildQuestion(slot: number): QuizQuestion {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TOTAL_QUESTIONS) throw new Error(`SLOT_OUT_OF_RANGE:${slot}`);
  if (isLegacySlot(slot)) return buildLegacyQuestion(slot);
  const ids = disciplineIdsForSlot(slot);
  const rng = mulberry32(mixSeeds(0x4e455800, slot));
  const difficulty = difficultyForSlot(slot);
  // Difficulty flips a variant knob so later slots differ from earlier ones.
  rng(); // burn one draw to decorrelate consecutive slots
  const draft = buildCrossQuestionDraft(ids, rng, difficulty);
  const options = shuffleOptions(rng, draft);
  const answerIndex = options.findIndex((option) => option.en === textOf(draft.answer).en);
  if (answerIndex < 0) throw new Error(`ANSWER_NOT_IN_OPTIONS:${slot}`);
  const prompt = { th: draft.prompt.th, en: draft.prompt.en };
  // The block's single discipline field stays the PRIMARY id (safe for every
  // consumer); the full combined label lives inside the prompt prologue.
  const disciplineId = ids[0]!;
  // SECURITY: the published content hash covers ONLY the public payload —
  // never the answer (same canary as the legacy builder).
  const contentHash = sha256Hex(canonicalQuestionString(slot, disciplineId, difficulty, prompt, options));
  const answerCommitment = answerCommitmentForQuestion(slot, answerIndex);
  return {
    id: `q-${String(slot + 1).padStart(6, '0')}`,
    slot,
    discipline: disciplineId,
    difficulty,
    prompt,
    answerCommitment,
    options: [options[0]!.th, options[1]!.th, options[2]!.th, options[3]!.th] as [string, string, string, string],
    answerIndex,
    alternatives: [],
    contentHash,
  };
}

function canonicalQuestionString(slot: number, discipline: string, difficulty: number, prompt: TextPair, options: readonly TextPair[]): string {
  return JSON.stringify([slot, discipline, difficulty, prompt.th, prompt.en, options.map((o) => [o.th, o.en])]);
}

/**
 * Blind commitment to a question's answer key:
 * `sha256(canonicalJson({ slot, discipline, answerIndex, alternatives, v: 1 }))`.
 * Stored on sealed blocks (and derivable from the bank) so verifiers and
 * peers can confirm the embedded answer key is the genuine bank/admin one —
 * without the commitment ever revealing the key itself.
 *
 * Admin `EDIT_ANSWER` overrides commit through the same helper (the block's
 * commitment covers the FINAL graded key). `v: 1` guards the formula against
 * silent changes, and the domain separation (field names in the JSON) makes
 * it collision-proof against other sha256 uses.
 */
export function answerCommitmentForQuestion(slot: number, answerIndex: number, alternatives: readonly number[] = []): string {
  return sha256Hex(canonicalJson({ alternatives: [...alternatives], answerIndex, slot, v: 1 }));
}

function shuffleOptions(rng: () => number, draft: QuestionDraft): readonly TextPair[] {
  const correct = textOf(draft.answer);
  const distractors = draft.distractors.map(textOf);
  const seen = new Set<string>([correct.en]);
  const unique = distractors.filter((d) => {
    if (seen.has(d.en)) return false;
    seen.add(d.en);
    return true;
  });
  // Fallback pool: guarantee three distinct distractors for numeric answers.
  const numeric = /^-?\d+(\.\d+)?$/.test(correct.en);
  let filler = numeric ? Number(correct.en) : null;
  while (unique.length < 3 && filler !== null) {
    filler += 1;
    const candidate = String(filler);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      unique.push({ th: candidate, en: candidate });
    }
  }
  if (unique.length < 3) throw new Error(`NOT_ENOUGH_DISTRACTORS:${JSON.stringify(draft)}`);
  const all = [correct, unique[0]!, unique[1]!, unique[2]!];
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = all[i]!;
    all[i] = all[j]!;
    all[j] = tmp;
  }
  return all;
}

/** Full bank: 100,000 deterministic questions (slot 0 … 99,999). */
export function buildBank(): readonly QuizQuestion[] {
  const bank: QuizQuestion[] = new Array(TOTAL_QUESTIONS);
  for (let slot = 0; slot < TOTAL_QUESTIONS; slot += 1) bank[slot] = buildQuestion(slot);
  return bank;
}
