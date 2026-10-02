import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';

import { LanguageProvider } from '@/providers/language-provider';

/**
 * Root layout. The app ships one warm cream theme (gold accent), so the
 * navigation theme is pinned to `DefaultTheme` instead of following the OS
 * colour scheme.
 */
export default function RootLayout() {
  return (
    <LanguageProvider>
      <ThemeProvider value={DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </LanguageProvider>
  );
}
