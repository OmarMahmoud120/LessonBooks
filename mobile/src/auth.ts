import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

// Native builds reach the local Keycloak through the emulator loopback alias.
const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
export const oidcAuthority =
  process.env.EXPO_PUBLIC_OIDC_AUTHORITY ?? `http://${host}:8081/realms/lessonbooks`;

const clientId = 'lessonbooks-mobile';
const scopes = ['openid', 'profile', 'email'];
const redirectUri = AuthSession.makeRedirectUri({ scheme: 'lessonbooks', path: 'auth' });

export type ParentSession = {
  uid: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

// The session lives in memory only: closing the native process signs the parent
// out and no token is written to disk.
let session: ParentSession | null = null;
const listeners = new Set<(next: ParentSession | null) => void>();

function publish(next: ParentSession | null) {
  session = next;
  for (const listener of listeners) listener(next);
}

export function subscribe(listener: (next: ParentSession | null) => void) {
  listeners.add(listener);
  listener(session);
  return () => {
    listeners.delete(listener);
  };
}

export function currentSession() {
  return session;
}

function decodeSub(accessToken: string): string {
  const payload = accessToken.split('.')[1];
  if (!payload) throw new Error('invalid_token');
  const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const subject: unknown = JSON.parse(globalThis.atob(padded)).sub;
  if (typeof subject !== 'string' || !subject) throw new Error('invalid_token');
  return subject;
}

async function request() {
  const discovery = await AuthSession.fetchDiscoveryAsync(oidcAuthority);
  const authRequest = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });
  const result = await authRequest.promptAsync(discovery);
  if (result.type !== 'success') throw new Error('sign_in_cancelled');
  const code = result.params.code;
  if (!code) throw new Error('sign_in_failed');
  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code,
      redirectUri,
      extraParams: { code_verifier: authRequest.codeVerifier ?? '' },
    },
    discovery,
  );
  publish({
    uid: decodeSub(tokens.accessToken),
    accessToken: tokens.accessToken,
    expiresAt: (tokens.issuedAt + (tokens.expiresIn ?? 300)) * 1000,
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
  });
}

export async function signIn() {
  await request();
}

export function signOut() {
  publish(null);
}

// Renews the access token shortly before it expires; null means signed out.
export async function accessToken(): Promise<string | null> {
  if (!session) return null;
  if (session.expiresAt - 30_000 > Date.now()) return session.accessToken;
  if (!session.refreshToken) {
    publish(null);
    return null;
  }
  const discovery = await AuthSession.fetchDiscoveryAsync(oidcAuthority);
  const renewed = await AuthSession.refreshAsync(
    { clientId, refreshToken: session.refreshToken },
    discovery,
  );
  publish({
    uid: session.uid,
    accessToken: renewed.accessToken,
    expiresAt: (renewed.issuedAt + (renewed.expiresIn ?? 300)) * 1000,
    ...(renewed.refreshToken ? { refreshToken: renewed.refreshToken } : {}),
  });
  return renewed.accessToken;
}
