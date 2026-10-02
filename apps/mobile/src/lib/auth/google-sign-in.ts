import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

/**
 * Google Sign-In via expo-auth-session (authorization-code + PKCE).
 *
 * The OAuth flow is fully wired but stays in the "not configured" state
 * until a real web client ID is provided through
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (see `.env.example`) — no secret or
 * client ID is ever hard-coded or committed.
 */

WebBrowser.maybeCompleteAuthSession();

export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export type GoogleSignInOutcome =
  | { readonly status: 'success'; readonly user: GoogleUserInfo }
  /** User closed the browser or the popup was dismissed. */
  | { readonly status: 'dismissed' }
  /** No client ID configured yet (interface-first mode). */
  | { readonly status: 'not_configured' }
  /** Network failure, token exchange failure, or malformed payload. */
  | { readonly status: 'error' };

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Reads the public OAuth client ID inlined by Expo at build time. */
export function getGoogleClientId(): string | undefined {
  const value = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

interface UserinfoPayload {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  picture?: unknown;
}

/** Runs the Google OAuth browser flow and returns a typed outcome. */
export async function signInWithGoogle(): Promise<GoogleSignInOutcome> {
  const clientId = getGoogleClientId();
  if (clientId === undefined) {
    return { status: 'not_configured' };
  }
  try {
    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'nex32' });
    const request = new AuthSession.AuthRequest({
      clientId,
      scopes: ['openid', 'profile', 'email'],
      redirectUri,
      usePKCE: true,
    });
    const result = await request.promptAsync(DISCOVERY);
    if (result.type !== 'success' || typeof result.params.code !== 'string') {
      return { status: 'dismissed' };
    }
    const token = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        code: result.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier ?? '' },
      },
      DISCOVERY,
    );
    if (token.accessToken === undefined || token.accessToken === null) {
      return { status: 'error' };
    }
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!response.ok) {
      return { status: 'error' };
    }
    const payload = (await response.json()) as UserinfoPayload;
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      return { status: 'error' };
    }
    const user: GoogleUserInfo = {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
      ...(typeof payload.picture === 'string' ? { picture: payload.picture } : {}),
    };
    return { status: 'success', user };
  } catch {
    return { status: 'error' };
  }
}
