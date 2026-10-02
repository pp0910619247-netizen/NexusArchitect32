import {
  GENESIS_END_BLOCK,
  GENESIS_START_BLOCK,
  getBlockRewardWei,
} from '@nexus/shared';
import type { TranslationKey } from '@nexus/shared';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { SectionCard } from '@/components/section-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatNex } from '@/lib/format';
import { chainUrlFromEnv, createQuizChainClient } from '@/lib/mining/chain-client';
import { resolveFeedbackKey } from '@/lib/mining/feedback';
import { useMining } from '@/lib/mining/use-mining';
import { useTranslation } from '@/providers/language-provider';

const SESSION_KEYS = {
  idle: 'mining.status.idle',
  starting: 'mining.status.starting',
  mining: 'mining.status.mining',
} as const satisfies Record<string, TranslationKey>;

const ANSWER_KEYS = {
  none: 'mining.status.none',
  submitting: 'mining.status.submitting',
  submitted: 'mining.status.submitted',
  failed: 'mining.status.failed',
} as const satisfies Record<string, TranslationKey>;

/** Reward for a Genesis-Era height; `null` when outside 1–10,000. */
function rewardForHeight(height: number | null): bigint | null {
  if (height === null) {
    return null;
  }
  const heightBig = BigInt(height);
  if (heightBig < GENESIS_START_BLOCK || heightBig > GENESIS_END_BLOCK) {
    return null;
  }
  return getBlockRewardWei(heightBig);
}

export default function MiningScreen() {
  const { t, lang } = useTranslation();

  // The node URL is configured once per app launch (env → .env; see
  // .env.example). `null` keeps every state honest: offline hints only.
  const [source] = useState(() => {
    const url = chainUrlFromEnv();
    return url === null ? null : createQuizChainClient(url);
  });
  const mining = useMining(source);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);

  // Reset the local highlight when a new block opens (different height).
  const openHeight = mining.question?.blockHeight ?? null;
  const lastSeenHeight = useRef<number | null>(null);
  useEffect(() => {
    if (openHeight !== null && lastSeenHeight.current !== null && openHeight !== lastSeenHeight.current) {
      setChosenIndex(null);
    }
    if (openHeight !== null) {
      lastSeenHeight.current = openHeight;
    }
  }, [openHeight]);

  const isMiningActive = mining.sessionStatus !== 'idle';
  const rewardWei = rewardForHeight(mining.summary?.openHeight ?? null);
  const canAnswer = mining.question !== null && isMiningActive && mining.answerStatus !== 'submitting';

  const choose = (choice: number) => {
    if (!canAnswer) {
      return;
    }
    setChosenIndex(choice);
    void mining.choose(choice);
  };

  const nodeStatusKey: TranslationKey =
    source === null
      ? 'mining.sourceOffline'
      : mining.nodeReachable === null
        ? 'mining.nodeChecking'
        : mining.nodeReachable
          ? 'mining.nodeOnline'
          : 'mining.nodeOffline';

  const feedbackKey = resolveFeedbackKey({
    answerStatus: mining.answerStatus,
    answerError: mining.answerError,
  });

  const question = mining.question;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SectionCard title={t('nav.mining')}>
        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('mining.statusLabel')}
          </ThemedText>
          <ThemedText type="small">{t(SESSION_KEYS[mining.sessionStatus])}</ThemedText>
        </View>
        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('mining.nodeStatus')}
          </ThemedText>
          <ThemedText type="small" themeColor={mining.nodeReachable === true ? undefined : 'textSecondary'}>
            {t(nodeStatusKey)}
          </ThemedText>
        </View>
        {source === null ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('mining.connectHint')}
          </ThemedText>
        ) : mining.summary === null ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('common.loading')}
          </ThemedText>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mining.cadence')}
            </ThemedText>
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('mining.chainHeight')}
              </ThemedText>
              <ThemedText type="code">{mining.summary.height}</ThemedText>
            </View>
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('mining.openBlock')}
              </ThemedText>
              <ThemedText type="code">{mining.summary.openHeight ?? '—'}</ThemedText>
            </View>
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('mining.lastMilestone')}
              </ThemedText>
              <ThemedText type="code">#{mining.summary.lastMilestoneHeight}</ThemedText>
            </View>
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('mining.totalAttempts')}
              </ThemedText>
              <ThemedText type="code">{mining.summary.totalAttempts.toLocaleString(lang === 'th' ? 'th-TH' : 'en-US')}</ThemedText>
            </View>
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('mining.rewardThisRound')}
              </ThemedText>
              <ThemedText type="code">
                {rewardWei === null ? '—' : `${formatNex(rewardWei)} ${t('common.nexTicker')}`}
              </ThemedText>
            </View>
          </>
        )}
        <View style={styles.buttonRow}>
          <ActionButton
            label={t(isMiningActive ? 'mining.stop' : 'mining.start')}
            onPress={isMiningActive ? mining.stop : mining.start}
          />
          <ActionButton label={t('mining.refresh')} onPress={mining.refresh} tone="muted" />
        </View>
      </SectionCard>

      <SectionCard title={question === null ? t('problem.title') : `${t('explorer.block')} #${question.blockHeight}`}>
        {question === null ? (
          <ThemedText type="small" themeColor="textSecondary">
            {source === null
              ? t('mining.sourceOffline')
              : mining.nodeReachable === false
                ? t('mining.nodeOffline')
                : t('mining.waitingNextBlock')}
          </ThemedText>
        ) : (
          <View style={styles.problem}>
            <ThemedText type="small" themeColor="textSecondary">
              {`${t('mining.discipline')}: ${lang === 'th' ? question.disciplineTh : question.disciplineEn || question.disciplineTh}`}
              {' · '}
              {`${t('problem.difficulty')}: ${question.difficulty}/10`}
            </ThemedText>
            <View style={styles.statementBlock}>
              <ThemedText type="smallBold">{t('settings.language.th')}</ThemedText>
              <ThemedText type="default">{question.promptTh}</ThemedText>
            </View>
            <View style={styles.statementBlock}>
              <ThemedText type="smallBold">{t('settings.language.en')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {question.promptEn}
              </ThemedText>
            </View>
            <ThemedText type="smallBold">{t('mining.chooseAnswer')}</ThemedText>
            {question.options.map((option, index) => {
              const isSelected = chosenIndex === index;
              return (
                <PressableOption
                  key={`${index}-${option}`}
                  label={option}
                  onPress={() => choose(index)}
                  disabled={!canAnswer}
                  selected={isSelected}
                />
              );
            })}
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('mining.answerStatus')}
              </ThemedText>
              <ThemedText type="small">{t(ANSWER_KEYS[mining.answerStatus])}</ThemedText>
            </View>
            {feedbackKey === null ? null : (
              <ThemedText type="small" themeColor="textSecondary">
                {t(feedbackKey)}
              </ThemedText>
            )}
          </View>
        )}
      </SectionCard>
    </ScrollView>
  );
}

/** One multiple-choice option rendered as a pressable row. */
function PressableOption({
  label,
  onPress,
  disabled,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  selected: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.option,
        { borderColor: selected ? theme.text : theme.backgroundSelected },
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  buttonRow: {
    gap: Spacing.two,
  },
  problem: {
    gap: Spacing.two,
  },
  statementBlock: {
    gap: Spacing.half,
  },
  option: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  dimmed: {
    opacity: 0.55,
  },
});
