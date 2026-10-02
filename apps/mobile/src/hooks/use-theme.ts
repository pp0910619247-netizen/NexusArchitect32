/**
 * The app ships one theme: a warm cream palette with a gold accent (owner's
 * spec — "สีขาวนวลอมเหลือง ดูแล้วลื่นตา"). The OS colour scheme is
 * intentionally ignored, so every screen renders on the same warm base in
 * light and dark system settings alike.
 *
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';

export function useTheme() {
  return Colors.light;
}
