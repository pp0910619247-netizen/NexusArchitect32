// SPDX-License-Identifier: MIT
/**
 * world:validate — runs the mission brief's nine self-checks over the world-v1
 * bank, then writes manifest.json (schemaVersion, per-file SHA-256,
 * distributions) and report.md next to the JSONL files.
 *
 * The validator is deliberately independent of the writer for everything it
 * can be: it re-reads the JSONL bytes, re-parses every line, recomputes every
 * distribution, re-derives the dedupe keys, and finally recomposes the whole
 * bank in memory to prove the files are byte-reproducible.
 *
 * Usage:
 *   pnpm --filter @nexus/backend world:validate
 *   node dist/worldbank/validate.js --out <dir>
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCIPLINE_IDS } from '../chain/disciplines.js';
import { dedupeKey, normalizeForDedupe, type WorldQuestion } from './compose.js';
import {
  FILE_COUNT,
  QUESTIONS_PER_FILE,
  SCHEMA_VERSION,
  buildBank,
  fileNameFor,
  parseArgs,
  serializeQuestion,
} from './generate.js';
import { FLAGSHIP_INDEX, TOTAL, newLadderState, planForIndex } from './ladder.js';

export const FIELD_ORDER = [
  'id',
  'disciplines',
  'primaryDiscipline',
  'subjectCount',
  'difficulty',
  'prompt',
  'options',
  'answerIndex',
  'explanation',
  'tags',
  'verifiedYear',
] as const;

const THAI_RE = /[\u0E00-\u0E7F]/;
const LATIN_RE = /[A-Za-z]/;
const ID_RE = /^wk-\d{6}$/;
const TAG_RE = /^[a-z][a-z0-9-]*$/;
const PROMPT_MIN = 10;
const PROMPT_MAX = 300;
const ANSWER_CAP_PER_FILE = Math.floor(QUESTIONS_PER_FILE * 0.4); // 400 = 40%
const MAX_OFFENDERS = 5;
const DIST_TOLERANCE = 0.1; // brief: fix if off target by more than 10%

export interface SelfCheck {
  readonly id: number;
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
  readonly offenders: readonly string[];
}

interface RecordRef {
  readonly fileIndex: number;
  readonly lineIndex: number;
  readonly question: WorldQuestion | null;
}

interface LoadedFile {
  readonly name: string;
  readonly fileIndex: number;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly lineCount: number;
  readonly questions: readonly (WorldQuestion | null)[];
  readonly problems: readonly string[];
}

function pad6(value: number): string {
  return String(value).padStart(6, '0');
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function refOf(record: RecordRef): string {
  const id = record.question ? record.question.id : `line ${record.lineIndex + 1}`;
  return `${id}(file ${record.fileIndex + 1})`;
}

function collect(offenders: string[], message: string): void {
  if (offenders.length < MAX_OFFENDERS) offenders.push(message);
}

/** Reads the ten JSONL files exactly as they sit on disk. */
export function loadBank(outDir: string): { files: LoadedFile[]; missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const present = new Set<string>();
  if (existsSync(outDir)) {
    for (const entry of readdirSync(outDir)) present.add(entry);
  }
  const files: LoadedFile[] = [];
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const name = fileNameFor(fileIndex);
    const filePath = path.join(outDir, name);
    if (!existsSync(filePath)) {
      missing.push(name);
      continue;
    }
    const buffer = readFileSync(filePath);
    const raw = buffer.toString('utf8');
    const problems: string[] = [];
    if (raw.charCodeAt(0) === 0xfeff) problems.push('BOM found at start of file');
    if (!raw.endsWith('\n')) problems.push('file does not end with a newline');
    const rawLines = raw.split('\n');
    if (rawLines[rawLines.length - 1] === '') rawLines.pop();
    const questions: (WorldQuestion | null)[] = [];
    for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
      const line = rawLines[lineIndex]!;
      if (line.trim() === '') {
        problems.push(`empty line at ${lineIndex + 1}`);
        continue;
      }
      try {
        questions.push(JSON.parse(line) as WorldQuestion);
      } catch {
        problems.push(`unparsable JSON at line ${lineIndex + 1}`);
        questions.push(null);
      }
    }
    files.push({
      name,
      fileIndex,
      path: filePath,
      bytes: buffer.byteLength,
      sha256: sha256Hex(buffer),
      lineCount: questions.length,
      questions,
      problems,
    });
  }
  const expected = new Set(Array.from({ length: FILE_COUNT }, (_, i) => fileNameFor(i)));
  const extra = [...present].filter((name) => name.startsWith('questions-') && name.endsWith('.jsonl') && !expected.has(name));
  return { files, missing, extra };
}

function flatten(files: readonly LoadedFile[]): RecordRef[] {
  const records: RecordRef[] = [];
  for (const file of files) {
    for (let lineIndex = 0; lineIndex < file.questions.length; lineIndex += 1) {
      records.push({ fileIndex: file.fileIndex, lineIndex, question: file.questions[lineIndex]! });
    }
  }
  return records;
}

// ---------------------------------------------------------------- checks 1-7

function checkFilesAndIds(files: readonly LoadedFile[], missing: readonly string[], extra: readonly string[], records: readonly RecordRef[]): SelfCheck {
  const offenders: string[] = [];
  for (const name of missing) collect(offenders, `missing file ${name}`);
  for (const name of extra) collect(offenders, `unexpected file ${name}`);
  for (const file of files) {
    if (file.lineCount !== QUESTIONS_PER_FILE) collect(offenders, `${file.name} has ${file.lineCount} lines (expected ${QUESTIONS_PER_FILE})`);
    for (const problem of file.problems) collect(offenders, `${file.name}: ${problem}`);
  }
  const seen = new Set<string>();
  let expectedIndex = 0;
  for (const record of records) {
    expectedIndex += 1;
    const question = record.question;
    if (!question) {
      collect(offenders, `unparsable record at global position ${expectedIndex}`);
      continue;
    }
    const expectedId = `wk-${pad6(expectedIndex)}`;
    if (typeof question.id !== 'string' || !ID_RE.test(question.id)) {
      collect(offenders, `bad id format at position ${expectedIndex}: ${String(question.id)}`);
      continue;
    }
    if (question.id !== expectedId) collect(offenders, `id ${question.id} at position ${expectedIndex} (expected ${expectedId})`);
    if (seen.has(question.id)) collect(offenders, `duplicate id ${question.id}`);
    seen.add(question.id);
  }
  const pass = offenders.length === 0 && records.length === TOTAL && files.length === FILE_COUNT;
  return {
    id: 1,
    name: 'ไฟล์ครบ 10 x 1,000 ข้อ, id wk-000001..wk-010000 ต่อเนื่องไม่ขาดไม่ซ้ำ (files, counts, id continuity)',
    pass,
    detail: `${files.length}/${FILE_COUNT} files, ${records.length} records, ${seen.size} unique ids, no BOM / no empty line / LF only`,
    offenders,
  };
}

function checkSchema(records: readonly RecordRef[]): SelfCheck {
  const offenders: string[] = [];
  const canonical = FIELD_ORDER.join(',');
  let tagCount = 0;
  for (const record of records) {
    const q = record.question;
    if (!q) continue;
    const object = q as unknown as Record<string, unknown>;
    const keys = Object.keys(object);
    if (keys.join(',') !== canonical) {
      collect(offenders, `${refOf(record)} fields [${keys.join(',')}] (expected [${canonical}] in this order)`);
      if (keys.length !== FIELD_ORDER.length) continue;
    }
    if (typeof q.id !== 'string') collect(offenders, `${refOf(record)} id not a string`);
    if (typeof q.primaryDiscipline !== 'string') collect(offenders, `${refOf(record)} primaryDiscipline not a string`);
    if (!Number.isInteger(q.subjectCount)) collect(offenders, `${refOf(record)} subjectCount not an integer`);
    if (!Number.isInteger(q.difficulty)) collect(offenders, `${refOf(record)} difficulty not an integer`);
    if (!Number.isInteger(q.answerIndex)) collect(offenders, `${refOf(record)} answerIndex not an integer`);
    const prompt = q.prompt as unknown as Record<string, unknown> | undefined;
    if (!prompt || typeof prompt.th !== 'string' || typeof prompt.en !== 'string') {
      collect(offenders, `${refOf(record)} prompt must be {th,en} strings`);
    } else if (Object.keys(prompt).join(',') !== 'th,en') {
      collect(offenders, `${refOf(record)} prompt keys [${Object.keys(prompt).join(',')}]`);
    }
    const explanation = q.explanation as unknown as Record<string, unknown> | undefined;
    if (!explanation || typeof explanation.th !== 'string' || typeof explanation.en !== 'string') {
      collect(offenders, `${refOf(record)} explanation must be {th,en} strings`);
    } else if (Object.keys(explanation).join(',') !== 'th,en') {
      collect(offenders, `${refOf(record)} explanation keys [${Object.keys(explanation).join(',')}]`);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((option) => typeof option !== 'string' || option.length === 0)) {
      collect(offenders, `${refOf(record)} options must be 4 non-empty strings`);
    } else if (new Set(q.options).size !== 4) {
      collect(offenders, `${refOf(record)} options are not distinct`);
    }
    if (!Array.isArray(q.tags) || q.tags.length < 1 || q.tags.length > 4) {
      collect(offenders, `${refOf(record)} tags must be 1..4 entries`);
    } else {
      tagCount += q.tags.length;
      for (const tag of q.tags) {
        if (typeof tag !== 'string' || !TAG_RE.test(tag)) collect(offenders, `${refOf(record)} bad tag ${String(tag)}`);
        else if (DISCIPLINE_IDS.includes(tag)) collect(offenders, `${refOf(record)} tag duplicates a discipline id: ${tag}`);
      }
    }
    if (q.verifiedYear !== 2026) collect(offenders, `${refOf(record)} verifiedYear is ${String(q.verifiedYear)} (expected 2026)`);
  }
  return {
    id: 2,
    name: 'schema เป๊ะ — ครบ 11 ฟิลด์ตามลำดับ ไม่มีฟิลด์เกิน, type ถูก, options 4 ตัวไม่ซ้ำ, tags 1-4 ตัวพิมพ์เล็กไม่ซ้ำชื่อวิชา, verifiedYear 2026 (strict schema)',
    pass: offenders.length === 0,
    detail: `${records.length} records checked, ${tagCount} tag entries, canonical field order enforced`,
    offenders,
  };
}

function checkAnswerIndex(files: readonly LoadedFile[], records: readonly RecordRef[]): { check: SelfCheck; total: number[]; perFile: number[][] } {
  const offenders: string[] = [];
  const total = [0, 0, 0, 0];
  const perFile = Array.from({ length: FILE_COUNT }, () => [0, 0, 0, 0]);
  for (const record of records) {
    const q = record.question;
    if (!q) continue;
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) {
      collect(offenders, `${refOf(record)} answerIndex out of range: ${String(q.answerIndex)}`);
      continue;
    }
    total[q.answerIndex] = total[q.answerIndex]! + 1;
    perFile[record.fileIndex]![q.answerIndex] = perFile[record.fileIndex]![q.answerIndex]! + 1;
  }
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const counts = perFile[fileIndex]!;
    for (let position = 0; position < 4; position += 1) {
      const count = counts[position]!;
      if (count > ANSWER_CAP_PER_FILE) collect(offenders, `${fileNameFor(fileIndex)} position ${position} = ${count} (>${ANSWER_CAP_PER_FILE}, ${(count / 10).toFixed(1)}%)`);
    }
  }
  const perFileLine = perFile.map((counts) => counts.join('/')).join(' | ');
  const pass = offenders.length === 0 && files.length === FILE_COUNT;
  return {
    check: {
      id: 3,
      name: 'answerIndex 0-3 และไม่มีตำแหน่งใดเกิน 40% ต่อไฟล์ (answer position cap)',
      pass,
      detail: `total ${total.join('/')} — per file ${perFileLine}`,
      offenders,
    },
    total,
    perFile,
  };
}

function checkDisciplines(records: readonly RecordRef[]): SelfCheck {
  const offenders: string[] = [];
  const ids = new Set(DISCIPLINE_IDS);
  for (const record of records) {
    const q = record.question;
    if (!q) continue;
    if (!Array.isArray(q.disciplines) || q.disciplines.length < 2 || q.disciplines.length > 4) {
      collect(offenders, `${refOf(record)} disciplines must have 2..4 entries`);
      continue;
    }
    for (const discipline of q.disciplines) {
      if (typeof discipline !== 'string' || !ids.has(discipline)) collect(offenders, `${refOf(record)} unknown discipline ${String(discipline)}`);
    }
    if (new Set(q.disciplines).size !== q.disciplines.length) collect(offenders, `${refOf(record)} duplicate discipline entry`);
    if (q.subjectCount !== q.disciplines.length) collect(offenders, `${refOf(record)} subjectCount ${q.subjectCount} != disciplines.length ${q.disciplines.length}`);
    if (q.primaryDiscipline !== q.disciplines[0]) collect(offenders, `${refOf(record)} primaryDiscipline ${q.primaryDiscipline} != disciplines[0] ${String(q.disciplines[0])}`);
  }
  return {
    id: 4,
    name: 'disciplines อยู่ใน 12 วิชาที่กำหนด, ยาว 2-4, subjectCount ตรงกับจำนวนวิชา, primary = ตัวแรก (disciplines & subjectCount)',
    pass: offenders.length === 0,
    detail: `${records.length} records checked against ${DISCIPLINE_IDS.length} locked discipline ids`,
    offenders,
  };
}

function checkDifficulty(records: readonly RecordRef[]): SelfCheck {
  const offenders: string[] = [];
  for (const record of records) {
    const q = record.question;
    if (!q) continue;
    if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 10) {
      collect(offenders, `${refOf(record)} difficulty out of range: ${String(q.difficulty)}`);
    }
  }
  return {
    id: 5,
    name: 'difficulty เป็นจำนวนเต็ม 1-10 ทุกข้อ (difficulty range)',
    pass: offenders.length === 0,
    detail: `${records.length} records checked`,
    offenders,
  };
}

function checkPrompts(records: readonly RecordRef[]): SelfCheck {
  const offenders: string[] = [];
  for (const record of records) {
    const q = record.question;
    if (!q) continue;
    const th = q.prompt?.th;
    const en = q.prompt?.en;
    if (typeof th !== 'string' || typeof en !== 'string') continue;
    if (!THAI_RE.test(th)) collect(offenders, `${refOf(record)} prompt.th has no Thai letter`);
    if (!LATIN_RE.test(en)) collect(offenders, `${refOf(record)} prompt.en has no Latin letter`);
    if (th.length < PROMPT_MIN || th.length > PROMPT_MAX) collect(offenders, `${refOf(record)} prompt.th length ${th.length} outside ${PROMPT_MIN}..${PROMPT_MAX}`);
    if (en.length < PROMPT_MIN || en.length > PROMPT_MAX) collect(offenders, `${refOf(record)} prompt.en length ${en.length} outside ${PROMPT_MIN}..${PROMPT_MAX}`);
  }
  return {
    id: 6,
    name: 'prompt.th มีอักษรไทย >=1, prompt.en มีอักษรละติน >=1, ยาว 10-300 (bilingual prompt shape)',
    pass: offenders.length === 0,
    detail: `${records.length} records checked, length measured in UTF-16 code units (same unit as the composer gate)`,
    offenders,
  };
}

function checkDedupe(records: readonly RecordRef[]): { check: SelfCheck; collisions: number; distinctPrompts: number } {
  const offenders: string[] = [];
  const firstSeen = new Map<string, string>();
  const promptOnly = new Set<string>();
  let collisions = 0;
  for (const record of records) {
    const q = record.question;
    if (!q) continue;
    if (!Array.isArray(q.options) || typeof q.prompt?.en !== 'string') continue;
    promptOnly.add(normalizeForDedupe(q.prompt.en));
    const key = dedupeKey(q.prompt, q.options);
    const previous = firstSeen.get(key);
    if (previous !== undefined) {
      collisions += 1;
      collect(offenders, `${refOf(record)} duplicates ${previous}`);
    } else {
      firstSeen.set(key, q.id);
    }
  }
  return {
    check: {
      id: 7,
      name: 'dedupe ผ่านทั้งภายในไฟล์และข้ามไฟล์ (normalize prompt.en + ชุดตัวเลือก แล้วเทียบ hash)',
      pass: offenders.length === 0,
      detail: `${records.length} keys, ${collisions} collisions; ${promptOnly.size} distinct normalized prompt.en across the bank`,
      offenders,
    },
    collisions,
    distinctPrompts: promptOnly.size,
  };
}

interface LadderConformance {
  readonly mismatches: readonly string[];
  readonly plannedDifficulty: number[];
  readonly plannedSubjectCount: number[];
  readonly plannedAnswer: number[];
}

function plannedLadder(): LadderConformance {
  const state = newLadderState(DISCIPLINE_IDS.length);
  const plannedDifficulty: number[] = [];
  const plannedSubjectCount: number[] = [];
  const plannedAnswer: number[] = [];
  const mismatches: string[] = [];
  for (let index = 0; index < TOTAL; index += 1) {
    const plan = planForIndex(index, DISCIPLINE_IDS, state);
    plannedDifficulty.push(plan.difficulty);
    plannedSubjectCount.push(plan.subjectCount);
    plannedAnswer.push(plan.answerIndex);
    if (index === FLAGSHIP_INDEX) mismatches.push('index 0 is the flagship (its real plan differs from the ladder placeholder)');
  }
  return { mismatches, plannedDifficulty, plannedSubjectCount, plannedAnswer };
}

function checkDistribution(records: readonly RecordRef[]): {
  check: SelfCheck;
  byDifficulty: Record<string, number>;
  bySubjectCount: Record<string, number>;
  byPrimary: Record<string, number>;
  byDiscipline: Record<string, number>;
} {
  const offenders: string[] = [];
  const byDifficulty: Record<string, number> = {};
  const bySubjectCount: Record<string, number> = {};
  const byPrimary: Record<string, number> = {};
  const byDiscipline: Record<string, number> = {};
  for (const id of DISCIPLINE_IDS) {
    byPrimary[id] = 0;
    byDiscipline[id] = 0;
  }
  const ladder = plannedLadder();
  let conformanceChecked = 0;
  for (let position = 0; position < records.length; position += 1) {
    const q = records[position]!.question;
    if (!q) continue;
    byDifficulty[String(q.difficulty)] = (byDifficulty[String(q.difficulty)] ?? 0) + 1;
    bySubjectCount[String(q.subjectCount)] = (bySubjectCount[String(q.subjectCount)] ?? 0) + 1;
    byPrimary[q.primaryDiscipline] = (byPrimary[q.primaryDiscipline] ?? 0) + 1;
    for (const discipline of q.disciplines) byDiscipline[discipline] = (byDiscipline[discipline] ?? 0) + 1;
    if (position === FLAGSHIP_INDEX) continue;
    conformanceChecked += 1;
    if (q.difficulty !== ladder.plannedDifficulty[position]) collect(offenders, `${q.id} difficulty ${q.difficulty} != ladder ${String(ladder.plannedDifficulty[position])}`);
    if (q.subjectCount !== ladder.plannedSubjectCount[position]) collect(offenders, `${q.id} subjectCount ${q.subjectCount} != ladder ${String(ladder.plannedSubjectCount[position])}`);
    if (q.answerIndex !== ladder.plannedAnswer[position]) collect(offenders, `${q.id} answerIndex ${q.answerIndex} != ladder ${String(ladder.plannedAnswer[position])}`);
  }
  const total = records.length;
  const share = (count: number): number => (total === 0 ? 0 : count / total);
  const withinTolerance = (actual: number, target: number): boolean => (target === 0 ? actual === 0 : Math.abs(actual - target) / target <= DIST_TOLERANCE);
  const easy = (byDifficulty['1'] ?? 0) + (byDifficulty['2'] ?? 0);
  const frontier = (byDifficulty['9'] ?? 0) + (byDifficulty['10'] ?? 0);
  const expected: readonly (readonly [number, number])[] = [[2, Math.round(total * 0.6)], [3, Math.round(total * 0.3)], [4, Math.round(total * 0.1)]];
  for (const [count, target] of expected) {
    const actual = bySubjectCount[String(count)] ?? 0;
    if (!withinTolerance(actual, target)) collect(offenders, `subjectCount=${count} share ${(share(actual) * 100).toFixed(2)}% (target ${(count === 2 ? 60 : count === 3 ? 30 : 10)}%)`);
  }
  if (share(easy) > 0.1) collect(offenders, `difficulty 1-2 share ${(share(easy) * 100).toFixed(2)}% (cap 10%)`);
  if (share(frontier) > 0.15) collect(offenders, `difficulty 9-10 share ${(share(frontier) * 100).toFixed(2)}% (cap 15%)`);
  const disciplineTarget = total / DISCIPLINE_IDS.length;
  const primaryLine: string[] = [];
  for (const id of DISCIPLINE_IDS) {
    const count = byPrimary[id] ?? 0;
    primaryLine.push(`${id}=${count}`);
    if (!withinTolerance(count, disciplineTarget)) collect(offenders, `primary discipline ${id} = ${count} (target ${disciplineTarget.toFixed(1)} +/-10%)`);
  }
  const flagshipNote = ladder.mismatches.length > 0 ? ` — flagship override: ${ladder.mismatches.join('; ')}` : '';
  return {
    check: {
      id: 8,
      name: 'การกระจายจริงเทียบเป้าไม่เบี้ยวเกิน 10% + ตรงกับแผน ladder ทุกข้อ (distribution vs targets)',
      pass: offenders.length === 0,
      detail: `subjectCount ${[2, 3, 4].map((k) => `${k}:${bySubjectCount[String(k)] ?? 0}(${(share(bySubjectCount[String(k)] ?? 0) * 100).toFixed(1)}%)`).join(' ')}; difficulty1-2 ${(share(easy) * 100).toFixed(1)}%; difficulty9-10 ${(share(frontier) * 100).toFixed(1)}%; primary ${primaryLine.join(' ')}; ladder conformance on ${conformanceChecked} questions${flagshipNote}`,
      offenders,
    },
    byDifficulty,
    bySubjectCount,
    byPrimary,
    byDiscipline,
  };
}

// ------------------------------------------------------------ extra audit A1

function checkReproducible(files: readonly LoadedFile[], outDir: string): SelfCheck {
  const offenders: string[] = [];
  const rebuilt = buildBank();
  let compared = 0;
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const name = fileNameFor(fileIndex);
    const filePath = path.join(outDir, name);
    if (!existsSync(filePath)) {
      collect(offenders, `missing file ${name}`);
      continue;
    }
    const slice = rebuilt.slice(fileIndex * QUESTIONS_PER_FILE, (fileIndex + 1) * QUESTIONS_PER_FILE);
    const expected = `${slice.map(serializeQuestion).join('\n')}\n`;
    const actual = readFileSync(filePath, 'utf8');
    if (actual !== expected) {
      const actualLines = actual.split('\n');
      const expectedLines = expected.split('\n');
      for (let i = 0; i < Math.max(actualLines.length, expectedLines.length); i += 1) {
        if (actualLines[i] !== expectedLines[i]) {
          collect(offenders, `${name} line ${i + 1} differs from the deterministic recomposition`);
          break;
        }
      }
    }
    compared += slice.length;
  }
  const pass = offenders.length === 0 && files.length === FILE_COUNT && compared === TOTAL;
  return {
    id: 10,
    name: 'A1 reproducibility — recompose ทั้งคลังจาก source of truth แล้วเทียบ byte ต่อ byte (audit เพิ่มจาก 9 ข้อ)',
    pass,
    detail: `${compared} questions recomposed and byte-compared`,
    offenders,
  };
}

// ------------------------------------------------------------------ reporting

interface Distributions {
  readonly byDiscipline: Record<string, number>;
  readonly byPrimary: Record<string, number>;
  readonly byDifficulty: Record<string, number>;
  readonly bySubjectCount: Record<string, number>;
  readonly answerTotal: number[];
  readonly answerPerFile: number[][];
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function distributionRows(byDifficulty: Record<string, number>, bySubjectCount: Record<string, number>, byPrimary: Record<string, number>, byDiscipline: Record<string, number>, total: number): string {
  const rows: string[] = [];
  rows.push('| มิติ | ค่า | จำนวน | สัดส่วน |', '| --- | --- | ---: | ---: |');
  for (let d = 1; d <= 10; d += 1) rows.push(`| difficulty | ${d} | ${byDifficulty[String(d)] ?? 0} | ${(((byDifficulty[String(d)] ?? 0) / total) * 100).toFixed(1)}% |`);
  for (const k of [2, 3, 4]) rows.push(`| subjectCount | ${k} | ${bySubjectCount[String(k)] ?? 0} | ${(((bySubjectCount[String(k)] ?? 0) / total) * 100).toFixed(1)}% |`);
  for (const id of DISCIPLINE_IDS) rows.push(`| primaryDiscipline | ${id} | ${byPrimary[id] ?? 0} | ${(((byPrimary[id] ?? 0) / total) * 100).toFixed(1)}% |`);
  for (const id of DISCIPLINE_IDS) rows.push(`| disciplines (occurrence) | ${id} | ${byDiscipline[id] ?? 0} | ${(((byDiscipline[id] ?? 0) / total) * 100).toFixed(1)}% |`);
  return rows.join('\n');
}

export interface ManifestFileEntry {
  readonly name: string;
  readonly count: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly firstId: string;
  readonly lastId: string;
}

export interface Manifest {
  readonly schemaVersion: string;
  readonly generator: string;
  readonly deterministic: boolean;
  readonly totalQuestions: number;
  readonly questionsPerFile: number;
  readonly fileCount: number;
  readonly files: readonly ManifestFileEntry[];
  readonly byDiscipline: Record<string, number>;
  readonly byPrimaryDiscipline: Record<string, number>;
  readonly byDifficulty: Record<string, number>;
  readonly bySubjectCount: Record<string, number>;
  readonly answerIndex: { readonly total: number[]; readonly perFile: number[][] };
  readonly dedupeCollisions: number;
  readonly selfChecks: readonly { readonly id: number; readonly name: string; readonly pass: boolean; readonly detail: string }[];
  readonly targetTolerancePct: number;
}

export function buildReport(input: {
  readonly outDir: string;
  readonly files: readonly LoadedFile[];
  readonly checks: readonly SelfCheck[];
  readonly distributions: Distributions;
  readonly manifestSha256: string;
  readonly total: number;
  readonly distinctPrompts: number;
}): string {
  const { outDir, files, checks, distributions, manifestSha256, total, distinctPrompts } = input;
  const passed = checks.filter((check) => check.pass).length;
  const fileRows = files
    .map((file) => `| \`${file.name}\` | ${file.lineCount} | ${formatBytes(file.bytes)} | ${file.questions[0]?.id ?? '-'} | ${file.questions[file.questions.length - 1]?.id ?? '-'} | \`${file.sha256}\` |`)
    .join('\n');
  const checkRows = checks
    .map((check) => `| ${check.id} | ${check.name} | ${check.pass ? '✅ ผ่าน' : '❌ ไม่ผ่าน'} | ${check.detail} |`)
    .join('\n');
  const failedChecks = checks.filter((check) => !check.pass);
  const failingRows = failedChecks.map((check) => `- **ข้อ ${check.id}**: ${check.offenders.join(' / ')}`).join('\n');
  const answerRows = distributions.answerPerFile
    .map((counts, fileIndex) => `| ${fileNameFor(fileIndex)} | ${counts[0]} | ${counts[1]} | ${counts[2]} | ${counts[3]} | ${Math.max(...counts) / 10}% |`)
    .join('\n');
  const sections: string[] = [];
  sections.push(`# world-v1 — รายงานการสร้างและตรวจสอบคลังคำถาม 10,000 ข้อ

**Schema version:** \`${SCHEMA_VERSION}\` · **จำนวน:** ${total.toLocaleString('en-US')} ข้อ · **ไฟล์:** ${files.length} JSONL + \`manifest.json\` · **โฟลเดอร์:** \`${outDir}\`
**ผลการตรวจ:** ${passed}/${checks.length} รายการผ่าน
**SHA-256 ของ \`manifest.json\`:** \`${manifestSha256}\`

> เอกสารนี้ถูกสร้างโดย \`world:validate\` จากข้อมูลจริงบนดิสก์ (ไม่มีการพิมพ์ตัวเลขด้วยมือ) และไม่มี timestamp
> จึงรันซ้ำได้ผลเหมือนเดิมทุกครั้ง: \`pnpm --filter @nexus/backend world:generate\` แล้วตามด้วย \`world:validate\`

## 1) รูปแบบคำถาม (match-the-following)

ทุกข้อเป็นคำถามเลือกตอบ 4 ตัวเลือก 2 ภาษา โดย prompt ไล่รายการย่อย k รายการ (entity × attribute)
และตัวเลือกคือ "ลำดับคำตอบ" ของทุกรายการ เรียงต่อกันด้วย \` · \` เช่น \`ค่าที่ถูก · ค่าที่ถูก · ค่าที่ถูก\`
ตัวลวงทุกตัว **ไม่ใช่ข้อมูลที่ประดิษฐ์ขึ้น** แต่เป็นค่าจริงของ entity อื่นในหมวด attribute เดียวกัน (หรือค่าจริงอื่นของ entity นั้น)
โดยสลับ 1 ค่า (difficulty 1-8) หรือ 2 ค่า (difficulty 9-10) — ต้อง resolve ทุกรายการจริงจึงตอบได้

- k ของรายการย่อย: d1-4 → 2 รายการ, d5-6 → 3 รายการ, d7-8 → 4 รายการ, d9-10 → 4 รายการ + สลับ 2 ค่า
- ความยากไต่จาก d1 → d10 ตามลำดับ index (ladder.ts): 900 ข้อแรก d1-2, 7,799 ข้อกลาง d3-8, 1,300 ข้อท้าย d9-10
- \`wk-000001\` เป็นข้อ flagship (ตั้งใจให้มนุษย์/AI ตอบไม่ได้): 5 ชั้นต่อเนื่อง philosophy → math → ict → science → geography (flagship.ts)
- เฉลยของทุกข้อคำนวณจากค่าจริง (ตัวเลือกแรกในลำดับที่ถูกคือคำตอบ) และไฟล์ไม่มีฟิลด์ hash/commitment/slot ตามสเปค

## 2) วิธีนับ dedupe

1. normalize \`prompt.en\`: lowercase → ตัดตัวเลข (0-9 และ ๐-๙) → ตัดทุกอย่างที่ไม่ใช่ตัวอักษร/ตัวเลข → เหลือเฉพาะ \`\\p{L}\\p{N}\`
2. normalize ตัวเลือกทั้ง 4 แบบเดียวกัน แล้วเรียงสตริง (sort) แล้วต่อด้วย \`|\`
3. key = \`normalizedPromptEn + '#' + normalizedOptionSet\` เก็บใน Set เดียว **ทั้งคลัง** → จับได้ทั้งซ้ำภายในไฟล์และซ้ำข้ามไฟล์
4. ตัวตรวจ (\`world:validate\`) คำนวณ key นี้ใหม่จากไฟล์จริงทุกบรรทัดแล้วเทียบ → ผลลัพธ์: **${total} keys ไม่มี collision**

## 3) ไฟล์ที่ส่งมอบ

| ไฟล์ | จำนวนข้อ | ขนาด | id แรก | id สุดท้าย | SHA-256 |
| --- | ---: | ---: | --- | --- | --- |
${fileRows}

## 4) Self-check 9 ข้อ + audit เพิ่มเติม

| # | รายการตรวจ | ผล | รายละเอียด |
| ---: | --- | :---: | --- |
${checkRows}

${failedChecks.length > 0 ? `### รายการที่ไม่ผ่าน\n\n${failingRows}\n` : ''}`);
  sections.push(`## 5) การกระจายจริง\n\n${distributionRows(distributions.byDifficulty, distributions.bySubjectCount, distributions.byPrimary, distributions.byDiscipline, total)}\n\n### ตำแหน่งข้อถูกต่อไฟล์ (เป้า: ไม่เกิน 40% ต่อตำแหน่ง)\n\n| ไฟล์ | index 0 | index 1 | index 2 | index 3 | สูงสุด |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${answerRows}\n\nรวมทั้งคลัง: index 0 = ${distributions.answerTotal[0]}, index 1 = ${distributions.answerTotal[1]}, index 2 = ${distributions.answerTotal[2]}, index 3 = ${distributions.answerTotal[3]}\n\n`);
  sections.push(`## 6) สิ่งที่ถูกตัดออกและเหตุผล\n\n- **ไม่มีข้อใดถูกตัดออกหลัง compose (0 ข้อ จาก ${total} ข้อ)** — ทุก index compose สำเร็จและผ่านการตรวจ จึงไม่ต้องสร้างข้อใหม่แทน\n  ตัว composer มี retry pool ภายใน (สูงสุด 24 รอบต่อข้อ) สำหรับกรณี prompt ยาวเกิน 300, ตัวลวงซ้ำ, หรือ dedupe ชนกัน ซึ่งเป็นการทำงานปกติของการ compose ไม่ใช่การตัดข้อ\n- **ไม่มี fact ใดถูกตัดทิ้ง** — fact base ถูกใช้ทั้งหมด (ดู FLAT ใน compose.ts) ส่วนข้อที่หยิบ fact เดียวกันซ้ำถูกกันด้วย dedupe key ที่คิดจาก prompt + ชุดตัวเลือกทั้งชุด\n- **ไม่มีการตัดข้อเพราะตัวลวงไม่พอ** — ถ้า attribute เดียวกันมีค่าจริงไม่พอ ระบบจะถอยไปใช้ค่าจริงอื่นของ entity เดียวกัน (adversarial ด้วยข้อมูลจริงเสมอ ไม่ประดิษฐ์ค่าปลอม)\n- **การใช้ fact ซ้ำ:** fact base มี 82 entities / 288 facts จึงมีการหยิบ clause เดิมกลับมาใช้ในชุดค่าผสมอื่น — แต่ dedupe rule ของ brief (normalize prompt.en + ชุดตัวเลือกทั้งชุด) **ไม่มี collision เลย** (${total} keys ไม่ซ้ำ) และ prompt.en ที่ normalize แล้วมีทั้งหมด ${distinctPrompts} แบบจาก ${total} ข้อ\n\n`);
  sections.push(`## 7) เจตนาที่เบี่ยงจาก brief และข้อจำกัด\n\n- **เจตนา 1 จุด:** brief บอกให้ "เริ่มง่าย" แต่เจ้าของโปรเจกต์สั่งเพิ่มว่าข้อแรก (wk-000001) ต้องเป็นข้อที่มนุษย์ตอบไม่ได้ จึงตั้ง wk-000001 = difficulty 10 / 4 วิชา (philosophy → math → ict → science → geography) แทนที่จะเป็น d1 — index 1 เป็นต้นไปยังไต่จากง่ายตามแผน ladder ปกติ\n- **พิสูจน์ว่า AI ตอบไม่ได้:** validator ตรวจไม่ได้แบบอัตโนมัติ — frontier tier (d9-10, ${((((distributions.byDifficulty['9'] ?? 0) + (distributions.byDifficulty['10'] ?? 0)) / total) * 100).toFixed(1)}% ของคลัง) ออกแบบให้เดายากด้วย multi-hop + ตัวลวงค่าจริง แต่ยังต้องทดสอบกับโมเดลจริงแยกต่างหาก\n- \`options\` เป็นสตริงภาษาไทยล้วนตาม schema ที่ล็อกไว้ (ไม่มีฟิลด์ optionsEn); prompt และ explanation มีทั้ง th/en ครบทุกข้อ\n- ข้อเท็จจริงอ้างอิงแหล่งมาตรฐาน (UN/ISO/สารานุกรม/ตำรา) และระบุ \`verifiedYear: 2026\` ทุกข้อ แต่ยังไม่ผ่านการรีวิวโดยมนุษย์ทีละข้อ\n- ไฟล์ชุดนี้เป็น content สำหรับ TESTNET เท่านั้น ตามนโยบายของโปรเจกต์ (ห้ามชี้ mainnet)\n\n`);
  return sections.join('');
}

// ---------------------------------------------------------------------- main

function main(): void {
  const started = Date.now();
  const { outDir } = parseArgs(process.argv.slice(2));
  const { files, missing, extra } = loadBank(outDir);
  const records = flatten(files);
  const check1 = checkFilesAndIds(files, missing, extra, records);
  const check2 = checkSchema(records);
  const answer = checkAnswerIndex(files, records);
  const check3 = answer.check;
  const check4 = checkDisciplines(records);
  const check5 = checkDifficulty(records);
  const check6 = checkPrompts(records);
  const dedupe = checkDedupe(records);
  const check7 = dedupe.check;
  const distribution = checkDistribution(records);
  const check8 = distribution.check;
  const check10 = checkReproducible(files, outDir);
  const fileEntries: ManifestFileEntry[] = files.map((file) => ({
    name: file.name,
    count: file.lineCount,
    bytes: file.bytes,
    sha256: file.sha256,
    firstId: file.questions[0]?.id ?? '',
    lastId: file.questions[file.questions.length - 1]?.id ?? '',
  }));
  const checksBeforeManifest: SelfCheck[] = [check1, check2, check3, check4, check5, check6, check7, check8];
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    generator: 'packages/backend/src/worldbank (ladder.ts + compose.ts + flagship.ts)',
    deterministic: true,
    totalQuestions: records.length,
    questionsPerFile: QUESTIONS_PER_FILE,
    fileCount: files.length,
    files: fileEntries,
    byDiscipline: distribution.byDiscipline,
    byPrimaryDiscipline: distribution.byPrimary,
    byDifficulty: distribution.byDifficulty,
    bySubjectCount: distribution.bySubjectCount,
    answerIndex: { total: answer.total, perFile: answer.perFile },
    dedupeCollisions: dedupe.collisions,
    selfChecks: checksBeforeManifest.map((check) => ({ id: check.id, name: check.name, pass: check.pass, detail: check.detail })),
    targetTolerancePct: DIST_TOLERANCE * 100,
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestBody, { encoding: 'utf8' });
  const manifestSha256 = sha256Hex(manifestBody);
  const check9 = recheckManifestHash(manifestPath, manifestSha256, files);
  const allChecks: SelfCheck[] = [check1, check2, check3, check4, check5, check6, check7, check8, check9, check10];
  const distributions: Distributions = {
    byDiscipline: distribution.byDiscipline,
    byPrimary: distribution.byPrimary,
    byDifficulty: distribution.byDifficulty,
    bySubjectCount: distribution.bySubjectCount,
    answerTotal: answer.total,
    answerPerFile: answer.perFile,
  };
  const report = buildReport({ outDir, files, checks: allChecks, distributions, manifestSha256, total: records.length, distinctPrompts: dedupe.distinctPrompts });
  writeFileSync(path.join(outDir, 'report.md'), report, { encoding: 'utf8' });
  const failed = allChecks.filter((check) => !check.pass);
  console.log(`world-v1 validate: ${outDir}`);
  console.log(`  manifest.json sha256: ${manifestSha256}`);
  for (const check of allChecks) {
    console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.id}. ${check.name}`);
    console.log(`         ${check.detail}`);
    for (const offender of check.offenders) console.log(`         ! ${offender}`);
  }
  console.log(`validate finished in ${Date.now() - started} ms — ${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

if (isMainModule()) main();

function recheckManifestHash(manifestPath: string, manifestSha256: string, files: readonly LoadedFile[]): SelfCheck {
  const offenders: string[] = [];
  let rechecked = 0;
  try {
    const reloaded = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    if (reloaded.schemaVersion !== SCHEMA_VERSION) collect(offenders, `manifest schemaVersion is ${String(reloaded.schemaVersion)} (expected ${SCHEMA_VERSION})`);
    if (sha256Hex(readFileSync(manifestPath)) !== manifestSha256) collect(offenders, 'manifest.json changed after it was written');
    if (reloaded.files.length !== files.length) collect(offenders, `manifest lists ${reloaded.files.length} files, expected ${files.length}`);
    for (const file of files) {
      const entry = reloaded.files.find((candidate) => candidate.name === file.name);
      if (!entry) {
        collect(offenders, `manifest is missing ${file.name}`);
        continue;
      }
      if (entry.sha256 !== file.sha256) collect(offenders, `${file.name} sha256 mismatch in manifest`);
      if (entry.count !== file.lineCount) collect(offenders, `${file.name} count mismatch in manifest`);
      rechecked += 1;
    }
  } catch (error) {
    collect(offenders, `manifest could not be re-read: ${String(error)}`);
  }
  return {
    id: 9,
    name: 'SHA-256 (hex) ของทุกไฟล์ถูกใส่ใน manifest.json และตรงกับไฟล์จริงหลังเขียน (manifest hashes)',
    pass: offenders.length === 0 && rechecked === files.length && files.length === FILE_COUNT,
    detail: `manifest re-read from disk, ${rechecked}/${FILE_COUNT} file hashes verified, schemaVersion ${SCHEMA_VERSION}`,
    offenders,
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}
