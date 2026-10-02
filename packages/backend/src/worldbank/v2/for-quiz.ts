// SPDX-License-Identifier: MIT
/**
 * world-v2 → quiz bridge.
 *
 * The quiz trainer and its stratified sampler speak one shape (BankItem with a
 * single-language `options` tuple). world-v2 stores both languages, so this
 * module renders the requested language on the way in and caches both the raw
 * items and the rendered variants. Nothing here changes the bank on disk.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Lang } from '@nexus/shared';
import type { BankItem } from '../ai-eval.js';
import type { WorldQuestion } from '../compose.js';
import { defaultOutDir2, fileNameFor2 } from './generate.js';
import { FILE_COUNT, type WorldQuestionV2 } from './schema.js';

let rawCache: { dir: string; items: WorldQuestionV2[] } | null = null;
const renderedCache = new Map<string, BankItem[]>();

export function bank2Dir(): string {
  return defaultOutDir2();
}

/** Reads every world-v2 JSONL file (raw, both languages). */
export function loadBank2Raw(dir: string = bank2Dir()): WorldQuestionV2[] {
  if (rawCache !== null && rawCache.dir === dir) return rawCache.items;
  const items: WorldQuestionV2[] = [];
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const body = readFileSync(path.join(dir, fileNameFor2(fileIndex)), 'utf8');
    for (const line of body.split('\n')) {
      if (line.trim().length === 0) continue;
      items.push(JSON.parse(line) as WorldQuestionV2);
    }
  }
  rawCache = { dir, items };
  return items;
}

/** Renders one world-v2 item as the single-language shape the trainer expects. */
export function toQuizQuestion(item: WorldQuestionV2, lang: Lang): WorldQuestion {
  const rendered = item.options[lang];
  return {
    id: item.id,
    disciplines: [...item.subjects],
    primaryDiscipline: item.primarySubject,
    subjectCount: item.subjectCount,
    difficulty: item.difficulty,
    prompt: { en: item.prompt.en, th: item.prompt.th },
    options: [rendered[0]!, rendered[1]!, rendered[2]!, rendered[3]!],
    answerIndex: item.answerIndex,
    explanation: { en: item.explanation.en, th: item.explanation.th },
    tags: [...item.tags],
    verifiedYear: 2026,
  };
}

/** The whole bank rendered for one language, cached per directory + language. */
export function loadBank2ForQuiz(lang: Lang, dir: string = bank2Dir()): BankItem[] {
  const key = `${dir}|${lang}`;
  const cached = renderedCache.get(key);
  if (cached !== undefined) return cached;
  const items = loadBank2Raw(dir).map((item, index) => ({ index, question: toQuizQuestion(item, lang) }));
  renderedCache.set(key, items);
  return items;
}

export function findBank2Item(id: string, dir: string = bank2Dir()): WorldQuestionV2 | undefined {
  return loadBank2Raw(dir).find((item) => item.id === id);
}
