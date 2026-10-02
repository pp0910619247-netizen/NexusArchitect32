import { describe, expect, it } from 'vitest';
import {
  answerCommitmentForQuestion,
  buildQuestion,
  combinedCountForSlot,
  difficultyBitsForHeight,
  difficultyForSlot,
  disciplineIdsForSlot,
  isChoiceCorrect,
  QuizChain,
  sha256Hex,
  TOTAL_QUESTIONS,
} from '../src/chain/index.js';
import { AdminConsole } from '../src/chain/admin.js';
import { QuizScheduler } from '../src/chain/scheduler.js';

describe('quiz-bank', () => {
  it('generates a deterministic question for each slot', () => {
    const a = buildQuestion(0);
    const b = buildQuestion(0);
    expect(a).toEqual(b);
    expect(a.options).toHaveLength(4);
    expect(a.answerIndex).toBeGreaterThanOrEqual(0);
    expect(a.answerIndex).toBeLessThanOrEqual(3);
    expect(a.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('covers exactly 100,000 slots with easy→hard ladder', () => {
    expect(TOTAL_QUESTIONS).toBe(100_000);
    expect(difficultyForSlot(0)).toBe(1);
    expect(difficultyForSlot(99_999)).toBe(10);
  });

  it('cycles through all 12 disciplines', () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < 120; slot += 1) seen.add(buildQuestion(slot).discipline);
    expect(seen.size).toBe(12);
  });

  it('combines 2 → 3 → 4 disciplines across epochs (cross-discipline v2)', () => {
    expect(combinedCountForSlot(0)).toBe(1);
    expect(combinedCountForSlot(522)).toBe(1); // frozen legacy zone (mined)
    expect(combinedCountForSlot(523)).toBe(2); // v2 starts here
    expect(combinedCountForSlot(999)).toBe(2);
    expect(combinedCountForSlot(1_000)).toBe(3);
    expect(combinedCountForSlot(1_999)).toBe(3);
    expect(combinedCountForSlot(2_000)).toBe(4);
    expect(combinedCountForSlot(50_000)).toBe(4);
  });

  it('cross-discipline questions carry distinct partner disciplines and are deterministic', () => {
    for (const slot of [523, 524, 600, 1_000, 1_500, 2_500, 50_000]) {
      const ids = disciplineIdsForSlot(slot);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(combinedCountForSlot(slot));
      const a = buildQuestion(slot);
      const b = buildQuestion(slot);
      expect(a).toEqual(b);
      expect(a.discipline).toBe(ids[0]);
      expect(a.prompt.th.startsWith('【')).toBe(true);
      expect(a.prompt.en.startsWith('[')).toBe(true);
      expect(a.options).toHaveLength(4);
      expect(a.answerIndex).toBeGreaterThanOrEqual(0);
      expect(a.answerIndex).toBeLessThanOrEqual(3);
    }
  });

  it('keeps mined legacy slots byte-identical (chain integrity guard)', () => {
    // Slots already mined on the live chain must reproduce EXACTLY the v1
    // questions — a single byte of drift would fail verifyChain for history.
    const seenDisciplines = new Set<string>();
    for (let slot = 0; slot < 523; slot += 1) {
      const q = buildQuestion(slot);
      seenDisciplines.add(q.discipline);
      expect(q.prompt.th.startsWith('【')).toBe(false);
      expect(q.answerCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(seenDisciplines.size).toBe(12);
    // The hard tier consumed by hard blocks up to height 520 is frozen too.
    for (const slot of [90_000, 90_010, 90_500, 90_520]) {
      expect(buildQuestion(slot).prompt.th.startsWith('【')).toBe(false);
    }
    expect(buildQuestion(90_521).prompt.th.startsWith('【')).toBe(true); // v2 hard tier
  });

  it('answer gate accepts the bank answer and rejects wrong choices', () => {
    const q = buildQuestion(3);
    for (let choice = 0; choice < 4; choice += 1) {
      const correct = isChoiceCorrect(q, [], choice);
      expect(correct).toBe(choice === q.answerIndex);
    }
  });

  it('answer gate honours admin alternatives', () => {
    const q = buildQuestion(3);
    const other = (q.answerIndex + 1) % 4;
    expect(isChoiceCorrect(q, [], other)).toBe(false);
    // Simulate an admin EDIT_ANSWER action granting an alternative.
    const action = {
      id: 'ACT-x', kind: 'EDIT_ANSWER' as const, questionId: q.id,
      oldAnswer: null,
      newAnswer: { answerIndex: q.answerIndex, alternatives: [other] },
      newQuestion: null, by: 'admin', at: 0, actionHash: sha256Hex('x'),
    };
    expect(isChoiceCorrect(q, [action], other)).toBe(true);
    expect(isChoiceCorrect(q, [action], q.answerIndex)).toBe(true);
  });
});

describe('quiz-chain', () => {
  const baseOptions = { baseDifficultyBits: 8 };

  it('mines the genesis block with valid hash + PoW', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    const block = chain.sealCurrentBlock();
    expect(block.height).toBe(1);
    expect(block.parentHash).toBe('0x' + '0'.repeat(64));
    expect(block.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chain.verifyChain()).toEqual({ valid: true, errors: [] });
  });

  it('refuses to open a second block while one is open (strict sequencing)', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    expect(() => chain.startNextBlock('m2')).toThrow('BLOCK_ALREADY_OPEN');
  });

  it('refuses sealing when nothing is open', () => {
    const chain = new QuizChain(baseOptions);
    expect(() => chain.sealCurrentBlock()).toThrow('NO_OPEN_BLOCK');
  });

  it('chains blocks: block N+1 parent = block N hash', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock(); const b1 = chain.sealCurrentBlock();
    chain.startNextBlock(); const b2 = chain.sealCurrentBlock();
    chain.startNextBlock(); const b3 = chain.sealCurrentBlock();
    expect(b2.parentHash).toBe(b1.hash);
    expect(b3.parentHash).toBe(b2.hash);
    expect(chain.verifyChain()).toEqual({ valid: true, errors: [] });
  });

  it('records answers and marks correctness for the open block', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    const q = chain.openQuestion!;
    const answer = chain.submitAnswer({ blockHeight: 1, miner: 'alice', choice: q.answerIndex });
    expect(answer.correct).toBe(true);
    expect(answer.commitmentHash).toMatch(/^0x[0-9a-f]{64}$/);
    const wrong = chain.submitAnswer({ blockHeight: 1, miner: 'bob', choice: (q.answerIndex + 1) % 4 });
    expect(wrong.correct).toBe(false);
    chain.sealCurrentBlock();
    expect(chain.stats.correctAnswerCount).toBe(1);
    expect(chain.stats.totalAnswerCount).toBe(2);
  });

  it('rejects answers for a non-open height and after sealing', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    chain.submitAnswer({ blockHeight: 1, miner: 'a', choice: 0 });
    chain.sealCurrentBlock();
    expect(() => chain.submitAnswer({ blockHeight: 1, miner: 'late', choice: 1 })).toThrow('NO_OPEN_BLOCK');
    chain.startNextBlock('m2');
    expect(() => chain.submitAnswer({ blockHeight: 1, miner: 'old', choice: 1 })).toThrow('BLOCK_HEIGHT_MISMATCH');
  });

  it('marks every 10th block as hard with elevated difficulty', () => {
    expect(difficultyBitsForHeight(9, 8)).toBe(8);
    expect(difficultyBitsForHeight(10, 8)).toBe(9);
    expect(difficultyBitsForHeight(20, 8)).toBe(9);
    expect(difficultyBitsForHeight(1000, 8)).toBe(12);
  });

  it('emits a milestone with chain-history hash at block 1000 (simulated)', () => {
    const chain = new QuizChain({ ...baseOptions, baseDifficultyBits: 4 });
    for (let height = 1; height <= 1000; height += 1) {
      chain.startNextBlock('m');
      chain.submitAnswer({ blockHeight: height, miner: 'm', choice: 0 });
      const block = chain.sealCurrentBlock();
      if (height === 1000) {
        expect(block.isMilestone).toBe(true);
        expect(block.milestone).not.toBeNull();
        expect(block.milestone!.milestoneHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(block.milestone!.spanBlocks).toBe(1000);
      } else {
        expect(block.isMilestone).toBe(false);
      }
    }
    expect(chain.height).toBe(1000);
    expect(chain.lastMilestoneHeight).toBe(1000);
    expect(chain.verifyChain()).toEqual({ valid: true, errors: [] });
  });

  it('queues admin EDIT_ANSWER and flips grading in the next block', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    const q = chain.openQuestion!;
    chain.sealCurrentBlock();
    const wrongChoice = (q.answerIndex + 1) % 4;
    chain.queueAdminAction({
      id: 'ACT-1', kind: 'EDIT_ANSWER', questionId: q.id, oldAnswer: null,
      newAnswer: { answerIndex: q.answerIndex, alternatives: [wrongChoice] },
      newQuestion: null, by: 'admin', at: 0, actionHash: sha256Hex('act1'),
    });
    // Height 2 has a different question, but height 3..: question q appears once.
    // To test the override directly, re-open the same question via a new chain.
    const chain2 = new QuizChain(baseOptions);
    chain2.queueAdminAction({
      id: 'ACT-2', kind: 'EDIT_ANSWER', questionId: q.id, oldAnswer: null,
      newAnswer: { answerIndex: q.answerIndex, alternatives: [wrongChoice] },
      newQuestion: null, by: 'admin', at: 0, actionHash: sha256Hex('act2'),
    });
    chain2.startNextBlock('m1');
    const q2 = chain2.openQuestion!;
    if (q2.id === q.id) {
      chain2.submitAnswer({ blockHeight: 1, miner: 'carol', choice: wrongChoice });
      chain2.sealCurrentBlock();
      expect(chain2.answers[0]!.correct).toBe(true);
    } else {
      chain2.submitAnswer({ blockHeight: 1, miner: 'carol', choice: q2.answerIndex });
      chain2.sealCurrentBlock();
      expect(chain2.answers[0]!.correct).toBe(true);
    }
  });

  it('snapshot reflects cumulative work and milestones', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock(); chain.sealCurrentBlock();
    const snap = chain.snapshot();
    expect(snap.blocks).toHaveLength(1);
    expect(BigInt(snap.totalCumulativeWork) > 0n).toBe(true);
    expect(snap.lastMilestoneHeight).toBe(0);
  });
});

describe('admin console', () => {
  it('logs in with correct credentials only', async () => {
    const dir = 'test/.tmp-admin-1';
    const admin = new AdminConsole({ password: 's3cret', dataDir: dir });
    await admin.initialize();
    await expect(admin.login('admin', 'wrong')).rejects.toThrow('INVALID_CREDENTIALS');
    const session = await admin.login('admin', 's3cret');
    expect(session.token).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => admin.requireSession('nope')).toThrow('UNAUTHORIZED');
    expect(admin.requireSession(session.token).username).toBe('admin');
  });

  it('edits answers produce chain actions (chain = single source of truth)', async () => {
    const dir = 'test/.tmp-admin-2';
    const admin1 = new AdminConsole({ password: 'pw', dataDir: dir });
    await admin1.initialize();
    const session = await admin1.login('admin', 'pw');
    const action = await admin1.editAnswer(session.token, 'q-000042', 2, [3]);
    expect(action.newAnswer).toEqual({ answerIndex: 2, alternatives: [3] });
    // The latest key is derived from committed chain actions, not a side file.
    expect(AdminConsole.latestKeyFor([action], 'q-000042')).toEqual({ answerIndex: 2, alternatives: [3] });
    expect(AdminConsole.latestKeyFor([action], 'q-999999')).toBeNull();
  });

  it('adds admin questions with action hash', async () => {
    const dir = 'test/.tmp-admin-3';
    const admin = new AdminConsole({ password: 'pw', dataDir: dir });
    await admin.initialize();
    const session = await admin.login('admin', 'pw');
    const action = await admin.addQuestion(session.token, {
      discipline: 'ict', difficulty: 5,
      prompt: { th: '1+1 เท่ากับเท่าใด', en: 'What is 1+1?' },
      options: ['1', '2', '3', '4'], answerIndex: 1,
    });
    expect(action.kind).toBe('ADD_QUESTION');
    expect(action.questionId).toMatch(/^admin-/);
    expect(action.actionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('scheduler', () => {
  it('fires with jitter around the interval and skips when busy (strict sequencing)', async () => {
    let fired = 0;
    let mining = false;
    const scheduler = new QuizScheduler({ intervalMs: 20, jitterMs: 5 }, {
      mineBlock: async () => {
        mining = true;
        await new Promise((resolve) => setTimeout(resolve, 30));
        fired += 1;
        mining = false;
        return null;
      },
    });
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    scheduler.stop();
    expect(fired).toBeGreaterThanOrEqual(1);
    // An in-flight mine may still be running at stop(); it must settle.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(mining).toBe(false);
  });

  it('never runs two mines concurrently even when the tick fires late', async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = new QuizScheduler({ intervalMs: 10, jitterMs: 0 }, {
      mineBlock: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 40));
        active -= 1;
        return null;
      },
    });
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    scheduler.stop();
    expect(maxActive).toBe(1);
  });
});

describe('blind answer commitments (anti-answer-leak)', () => {
  const baseOptions = { baseDifficultyBits: 8 };

  it('seals each block with the commitment of its final graded key', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    const q = chain.openQuestion!;
    const block = chain.sealCurrentBlock();
    expect(block.answerCommitment).toBe(answerCommitmentForQuestion(q.slot, q.answerIndex, q.alternatives));
    expect(chain.verifyChain()).toEqual({ valid: true, errors: [] });
  });

  it('covers admin alternative edits and stays verifiable', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    const q = chain.openQuestion!;
    const alt = (q.answerIndex + 1) % 4;
    chain.queueAdminAction({
      id: 'ACT-alt',
      kind: 'EDIT_ANSWER',
      questionId: q.id,
      oldAnswer: null,
      newAnswer: { answerIndex: q.answerIndex, alternatives: [alt] },
      newQuestion: null,
      by: 'admin',
      at: 0,
    });
    chain.submitAnswer({ blockHeight: 1, miner: 'a', choice: alt });
    const block = chain.sealCurrentBlock();
    expect(block.answers[0]!.correct).toBe(true);
    expect(block.answerCommitment).toBe(answerCommitmentForQuestion(q.slot, q.answerIndex, [alt]));
    expect(chain.verifyChain()).toEqual({ valid: true, errors: [] });
  });

  it('never publishes the answer key with the question payload', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    const sealed = chain.sealCurrentBlock();
    const publicQuestion = sealed.question;
    const publicJson = JSON.stringify(publicQuestion);
    expect(publicJson).not.toContain('answerIndex');
    expect(publicJson).not.toContain('alternatives');
    expect(publicJson).not.toContain('answerCommitment');
    expect(Object.keys(sealed.question)).toEqual(['id', 'discipline', 'difficulty', 'prompt', 'options', 'contentHash']);
  });

  it('brute-forcing the published contentHash with candidate answer indices fails', () => {
    // The legacy leak hashed the answer index into the published question
    // hash — 4 sha256 tries revealed the key. The published hash must never
    // match that formula again (canary across all 12 disciplines).
    for (let slot = 0; slot < 12; slot += 1) {
      const q = buildQuestion(slot);
      const guesses = [0, 1, 2, 3].map((i) =>
        sha256Hex(JSON.stringify([slot, q.discipline, q.difficulty, q.prompt.th, q.prompt.en, q.options.map((o) => [o, o]), i])),
      );
      expect(guesses).not.toContain(q.contentHash);
    }
  });

  it('verifyChain flags a block whose commitment does not bind the bank key', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    chain.sealCurrentBlock();
    const tampered = chain.blocks.map((b) => ({ ...b, answerCommitment: `0x${'ab'.repeat(32)}` }));
    const revived = new QuizChain(baseOptions);
    revived.restoreFromBlocks(tampered);
    const verdict = revived.verifyChain();
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.startsWith('ANSWER_COMMITMENT_MISMATCH@'))).toBe(true);
  });

  it('verifyChain flags blocks without an answer commitment (legacy payloads)', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    chain.sealCurrentBlock();
    const legacy = chain.blocks.map((b) => ({ ...b, answerCommitment: null }));
    const revived = new QuizChain(baseOptions);
    revived.restoreFromBlocks(legacy);
    const verdict = revived.verifyChain();
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.startsWith('ANSWER_COMMITMENT_MISSING@'))).toBe(true);
  });

  it('reveals the public answer at seal time and keeps commit-reveal verifiable', () => {
    const chain = new QuizChain(baseOptions);
    chain.startNextBlock('m1');
    const q = chain.openQuestion!;
    const block = chain.sealCurrentBlock();
    expect(block.revealedAnswerIndex).toBe(q.answerIndex);
    expect(chain.verifyChain()).toEqual({ valid: true, errors: [] });

    // A lying reveal (public answer ≠ sealed key) fails verification.
    const lying = chain.blocks.map((b) => ({ ...b, revealedAnswerIndex: (b.revealedAnswerIndex! + 1) % 4 }));
    const revivedLiar = new QuizChain(baseOptions);
    revivedLiar.restoreFromBlocks(lying);
    const liarVerdict = revivedLiar.verifyChain();
    expect(liarVerdict.valid).toBe(false);
    expect(liarVerdict.errors.some((e) => e.startsWith('REVEAL_MISMATCH@'))).toBe(true);

    // A block that never reveals (legacy) fails too.
    const unrevealed = chain.blocks.map((b) => ({ ...b, revealedAnswerIndex: null }));
    const revivedOld = new QuizChain(baseOptions);
    revivedOld.restoreFromBlocks(unrevealed);
    const oldVerdict = revivedOld.verifyChain();
    expect(oldVerdict.errors.some((e) => e.startsWith('REVEAL_MISSING@'))).toBe(true);
  });
});
