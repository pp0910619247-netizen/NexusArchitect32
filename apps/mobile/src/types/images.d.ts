/**
 * Metro bundles image assets and hands back an `ImageSourcePropType`; TypeScript
 * only needs a declaration to accept the ES import form
 * (`import logo from '@/assets/images/logo.png'`), which is what ESLint's
 * `no-require-imports` rule expects instead of `require()`.
 */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
