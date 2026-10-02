import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { ActionButton } from '@/components/action-button';
import { SectionCard } from '@/components/section-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { deleteMemoryRecord, listMemoryRecords, setMemoryPinned } from '@/lib/db';
import { intlLocale } from '@/lib/format';
import { useTranslation } from '@/providers/language-provider';
import type { MemoryRecord } from '@nexus/shared';

export default function MemoryScreen() {
  const { t, lang } = useTranslation();
  const [records, setRecords] = useState<MemoryRecord[] | null>(null);

  const reload = useCallback(() => {
    void listMemoryRecords()
      .then(setRecords)
      .catch(() => setRecords([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const togglePin = (record: MemoryRecord) => {
    void setMemoryPinned(record.id, !record.pinned).then(reload);
  };

  const remove = (record: MemoryRecord) => {
    void deleteMemoryRecord(record.id).then(reload);
  };

  if (records === null) {
    return (
      <View style={styles.center}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('common.loading')}
        </ThemedText>
      </View>
    );
  }

  if (records.length === 0) {
    return (
      <View style={styles.center}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('memory.empty')}
        </ThemedText>
      </View>
    );
  }

  const locale = intlLocale(lang);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {records.map((record) => {
        const created = new Date(record.createdAt * 1000).toLocaleDateString(locale);
        const expiryLabel =
          record.tier === 'CORE'
            ? t('memory.noExpiry')
            : record.expiresAt === null
              ? t('memory.noExpiry')
              : new Date(record.expiresAt * 1000).toLocaleDateString(locale);
        return (
          <SectionCard
            key={record.id}
            title={record.tier === 'CORE' ? t('memory.core') : t('memory.rolling')}
          >
            <ThemedText type="default">{record.content}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {`${t('memory.created')}: ${created} · ${expiryLabel}`}
            </ThemedText>
            {record.pinned ? (
              <ThemedText type="smallBold">{t('memory.pinned')}</ThemedText>
            ) : null}
            <View style={styles.actions}>
              <ActionButton
                label={t(record.pinned ? 'memory.unpin' : 'memory.pin')}
                onPress={() => togglePin(record)}
                tone="muted"
              />
              <ActionButton
                label={t('memory.delete')}
                onPress={() => remove(record)}
                tone="muted"
              />
            </View>
          </SectionCard>
        );
      })}
      <ThemedText type="small" themeColor="textSecondary">
        {t('memory.rollingTtl')}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
