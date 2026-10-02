/**
 * App palette — a warm, easy-on-the-eyes cream theme (owner's spec): soft
 * yellow-white page, white cards, warm ink type and one deep-gold accent taken
 * from the brand mark (`assets/images/logo.png` — gold pyramid). `light` is the
 * palette actually in force (see `useTheme`); `dark` is the inverted twin, kept
 * so a future dark-mode only has to flip the switch back on.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1C1714',
    /** Cream page base (`#FAF6EC`) — softer on the eyes than a glaring white. */
    background: '#FAF6EC',
    /** Cards/surfaces: pure white, separated by `border`. */
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#F1E7D0',
    textSecondary: '#6B6152',
    /** Type that sits on a solid `accent` surface (primary buttons). */
    textInverse: '#FFFFFF',
    border: '#EADFC9',
    /** Brand gold — matches the solid gold badges on the web explorer. */
    accent: '#B45309',
  },
  dark: {
    text: '#FAF6EC',
    background: '#141210',
    backgroundElement: '#1C1917',
    backgroundSelected: '#3A342C',
    textSecondary: '#A9A196',
    textInverse: '#141210',
    border: '#3A342C',
    accent: '#F59E0B',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
