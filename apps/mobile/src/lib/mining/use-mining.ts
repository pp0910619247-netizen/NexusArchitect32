import { useCallback, useEffect, useRef, useState } from 'react';

import type { AnswerErrorKind } from './feedback';
import type {
  AnswerStatus,
  ChainSummary,
  MiningSessionStatus,
  QuizChainDataSource,
  QuizQuestionView,
} from './types';

export interface UseMiningResult {
  sessionStatus: MiningSessionStatus;
  answerStatus: AnswerStatus;
  /** Why the last submission failed, or `null`. */
  answerError: AnswerErrorKind | null;
  /** Node reachable? `null` until the first poll resolves. */
  nodeReachable: boolean | null;
  summary: ChainSummary | null;
  question: QuizQuestionView | null;
  /** Opens the session and polls immediately + on an interval. */
  start(): void;
  /** Closes the session and clears node data. */
  stop(): void;
  /** Re-poll now (pull-to-refresh). */
  refresh(): void;
  /**
   * Submits the chosen option; returns `true` when the node accepted it.
   * The node never reports right/wrong for an open block, so `true` means
   * "recorded, result pending until the block seals".
   */
  choose(choice: number): Promise<boolean>;
}

/**
 * Mining session state machine for the Mining tab, wired to a real
 * quiz-chain data source. Polls node status + the open block's question on
 * an interval while active, and posts answers for real.
 *
 * `dataSource === null` keeps the UI honest: offline empty states only —
 * no fake problems, heights or answers are ever invented.
 */
export function useMining(dataSource: QuizChainDataSource | null): UseMiningResult {
  const [sessionStatus, setSessionStatus] = useState<MiningSessionStatus>('idle');
  const [answerStatus, setAnswerStatus] = useState<AnswerStatus>('none');
  const [answerError, setAnswerError] = useState<AnswerErrorKind | null>(null);
  const [nodeReachable, setNodeReachable] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<ChainSummary | null>(null);
  const [question, setQuestion] = useState<QuizQuestionView | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const sourceRef = useRef(dataSource);
  sourceRef.current = dataSource;
  const mountedRef = useRef(true);
  const seenOpenHeightRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const poll = useCallback(async (): Promise<void> => {
    const source = sourceRef.current;
    if (source === null) {
      setNodeReachable(false);
      setSummary(null);
      setQuestion(null);
      return;
    }
    try {
      const [nextSummary, nextQuestion] = await Promise.all([
        source.fetchSummary(),
        source.fetchCurrentQuestion(),
      ]);
      if (!mountedRef.current) return;
      setNodeReachable(true);
      setSummary(nextSummary);
      setQuestion(nextQuestion);
      // A new open block = a fresh answer window (reset once per change).
      const openHeight = nextQuestion?.blockHeight ?? null;
      if (openHeight !== null && seenOpenHeightRef.current !== null && openHeight !== seenOpenHeightRef.current) {
        setAnswerStatus('none');
        setAnswerError(null);
      }
      if (openHeight !== null) seenOpenHeightRef.current = openHeight;
    } catch {
      if (!mountedRef.current) return;
      // Node unreachable → surface the offline state, keep previous data
      // greyed out rather than inventing anything.
      setNodeReachable(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  // Poll while the mining session is active; refreshTick forces one extra
  // pass (pull-to-refresh) even when idle.
  useEffect(() => {
    if (sessionStatus !== 'mining' && refreshTick === 0) return;
    void poll();
    if (sessionStatus !== 'mining') return;
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionStatus, refreshTick, poll]);

  const start = useCallback(() => {
    setSessionStatus('mining');
    setRefreshTick((tick) => tick + 1);
  }, []);

  const stop = useCallback(() => {
    setSessionStatus('idle');
    setQuestion(null);
    setSummary(null);
    setNodeReachable(null);
  }, []);

  const choose = useCallback(
    async (choice: number): Promise<boolean> => {
      const source = sourceRef.current;
      const current = question;
      if (source === null || current === null || answerStatus === 'submitting') {
        return false;
      }
      setAnswerStatus('submitting');
      setAnswerError(null);
      try {
        const outcome = await source.submitAnswer(current.blockHeight, choice);
        if (!mountedRef.current) return false;
        if (outcome.ok) {
          // Accepted, not graded: the node hides correctness until the block
          // seals, so the UI can only show "pending" from here.
          setAnswerStatus('submitted');
          return true;
        }
        setAnswerStatus('failed');
        setAnswerError(outcome.kind);
        return false;
      } catch {
        if (!mountedRef.current) return false;
        setAnswerStatus('failed');
        setAnswerError('network');
        return false;
      }
    },
    [answerStatus, question],
  );

  return {
    sessionStatus,
    answerStatus,
    answerError,
    nodeReachable,
    summary,
    question,
    start,
    stop,
    refresh,
    choose,
  };
}

/** How often the active session re-polls the node. */
const POLL_INTERVAL_MS = 5_000;
