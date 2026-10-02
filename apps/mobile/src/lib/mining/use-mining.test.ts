import { describe, expect, it } from 'vitest';

import { resolveFeedbackKey } from './feedback';

describe('resolveFeedbackKey', () => {
  it('is empty while no answer was given', () => {
    expect(resolveFeedbackKey({ answerStatus: 'none', answerError: null })).toBeNull();
  });

  it('speaks Thai through the dictionary for each outcome', () => {
    expect(resolveFeedbackKey({ answerStatus: 'submitting', answerError: null })).toBe(
      'mining.status.submitting',
    );
    // Accepted answer → the result stays hidden until the block seals (the
    // node is deliberately not an oracle), so the screen reports "pending".
    expect(resolveFeedbackKey({ answerStatus: 'submitted', answerError: null })).toBe(
      'mining.answerPending',
    );
    expect(resolveFeedbackKey({ answerStatus: 'failed', answerError: 'rejected' })).toBe(
      'mining.answerRejected',
    );
    expect(resolveFeedbackKey({ answerStatus: 'failed', answerError: 'network' })).toBe(
      'mining.answerNetwork',
    );
  });

  it('never has a right/wrong key to reach — correctness arrives only with the sealed block (edge)', () => {
    // The input carries no correctness field at all, so every reachable branch
    // is status/error based; an idle status still says nothing.
    expect(resolveFeedbackKey({ answerStatus: 'none', answerError: null })).toBeNull();
    expect(resolveFeedbackKey({ answerStatus: 'failed', answerError: null })).toBe('error.generic');
  });
});
