import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tone = 'primary' | 'muted';

export interface ActionButtonProps {
  /** Pre-translated label — callers pass `t(...)`, never raw copy. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: Tone;
}

/** Small pressable button used across settings and the mining screen. */
export function ActionButton({ label, onPress, disabled = false, tone = 'primary' }: ActionButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        // Primary = brand gold with an inverse label; muted = white surface
        // with a hairline border so it reads on the cream page.
        tone === 'primary'
          ? { backgroundColor: theme.accent }
          : { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 },
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <ThemedText
        type="small"
        themeColor={tone === 'primary' ? 'textInverse' : 'textSecondary'}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: {
    opacity: 0.6,
  },
});
