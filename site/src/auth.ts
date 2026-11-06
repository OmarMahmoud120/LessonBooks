import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

// The website is a public OIDC client using authorization code + PKCE. No client
// secret is bundled; the API is the only resource server.
export const oidcAuthority =
  import.meta.env.VITE_OIDC_AUTHORITY ?? 'http://127.0.0.1:8081/realms/lessonbooks';

const origin = window.location.origin;

export const userManager = new UserManager({
  authority: oidcAuthority,
  client_id: 'lessonbooks-site',
  redirect_uri: `${origin}/`,
  post_logout_redirect_uri: `${origin}/`,
  response_type: 'code',
  scope: 'openid profile email',
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.localStorage }),
});

export type ParentSession = { uid: string; accessToken: string };

function toSession(user: { profile: { sub: string }; access_token: string }): ParentSession {
  return { uid: user.profile.sub, accessToken: user.access_token };
}

// Completes a redirect back from Keycloak, or restores an existing session.
// The state nonce is single-use, so concurrent callers (React strict mode runs the
// effect twice) must share one exchange instead of racing for it.
let hydration: Promise<ParentSession | null> | null = null;
export function loadSession(): Promise<ParentSession | null> {
  hydration ??= hydrate().finally(() => {
    hydration = null;
  });
  return hydration;
}

async function hydrate(): Promise<ParentSession | null> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') && params.has('state')) {
    try {
      const user = await userManager.signinRedirectCallback();
      // Keep the lesson/example query string out of history after the exchange.
      window.history.replaceState({}, document.title, window.location.pathname);
      return toSession(user);
    } catch {
      // A consumed or rejected callback must not leave a stale code in the URL.
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
  const user = await userManager.getUser();
  return user ? toSession(user) : null;
}

export async function signIn() {
  // The admin panel lives on the /admin path of the same app; return there when
  // sign-in started from it. The site client's redirect whitelist covers both.
  const returnPath = window.location.pathname.startsWith('/admin') ? '/admin' : '/';
  await userManager.signinRedirect({ redirect_uri: `${origin}${returnPath}` });
}

export async function signOut() {
  await userManager.signoutRedirect();
}

// Returns a usable access token, renewing through the refresh token when needed.
export async function accessToken(): Promise<string | null> {
  const user = await userManager.getUser();
  if (!user) return null;
  if (!user.expired) return user.access_token;
  const renewed = await userManager.signinSilent().catch(() => null);
  return renewed?.access_token ?? null;
}
