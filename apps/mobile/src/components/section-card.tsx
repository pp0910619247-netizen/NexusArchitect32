import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A titled card used to group Settings/Mining sections. Text comes from callers (i18n). */
export function SectionCard({
  title,
  children,
  footer,
}: PropsWithChildren<{ title: string; footer?: ReactNode }>) {
  const theme = useTheme();
  return (
    // White card on the cream page, separated by a warm hairline border
    // (see constants/theme.ts for the palette).
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <View style={styles.body}>{children}</View>
      {footer !== undefined ? <View style={styles.body}>{footer}</View> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  body: {
    gap: Spacing.two,
  },
});
