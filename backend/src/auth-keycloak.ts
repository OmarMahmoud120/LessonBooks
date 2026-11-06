import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Identity } from './api';

// Keycloak issues access tokens whose `sub` is the parent identity and whose `sid`
// names the SSO session. The session start time is the authoritative authentication
// time, so recent-auth checks ask the admin API instead of trusting a client value.
export type KeycloakSettings = {
  // Public issuer appearing in tokens, e.g. https://auth.example.com/realms/lessonbooks
  issuer: string;
  // Internal endpoint used for JWKS and admin calls; never taken from a token.
  backchannelUrl: string;
  audience: string;
  clientId: string;
  clientSecret: string;
};

const SESSION_CACHE_MS = 10 * 60 * 1000;
const SESSION_CACHE_MAX = 1000;
const TOKEN_EXPIRY_SKEW_MS = 30_000;

export function realmFromIssuer(issuer: string): string {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new Error('invalid_keycloak_issuer');
  }
  const match = url.pathname.match(/^\/realms\/([A-Za-z0-9-]{1,63})$/);
  if (!match || url.search || url.hash || url.username || url.password)
    throw new Error('invalid_keycloak_issuer');
  return match[1]!;
}

export class KeycloakAdmin {
  private readonly base: URL;
  private readonly realm: string;
  private cached?: { token: string; expiresAt: number };

  constructor(private settings: KeycloakSettings) {
    this.realm = realmFromIssuer(settings.issuer);
    this.base = new URL(settings.backchannelUrl);
    if (!['http:', 'https:'].includes(this.base.protocol)) throw new Error('invalid_keycloak_url');
  }

  private async adminToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;
    const response = await fetch(
      new URL(`/realms/${this.realm}/protocol/openid-connect/token`, this.base),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error('keycloak_admin_token_failed');
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('keycloak_admin_token_failed');
    this.cached = {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 60) * 1000 - TOKEN_EXPIRY_SKEW_MS),
    };
    return body.access_token;
  }

  private async request(path: string, init: RequestInit = {}) {
    const token = await this.adminToken();
    return fetch(new URL(`/admin/realms/${this.realm}${path}`, this.base), {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
  }

  // Deletes the identity that owns the family. A missing user is already deleted.
  async deleteUser(uid: string) {
    const response = await this.request(`/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
    if (response.status === 404) return;
    if (!response.ok) throw new Error('keycloak_user_delete_failed');
  }

  // Deletion verification (ADR 0016 phase C): reports whether the identity survived.
  async userExists(uid: string): Promise<boolean> {
    const response = await this.request(`/users/${encodeURIComponent(uid)}`);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error('keycloak_user_lookup_failed');
    return true;
  }

  // Returns the SSO session start in epoch seconds, which survives token refresh.
  async sessionStart(uid: string, sid: string): Promise<number> {
    const response = await this.request(`/users/${encodeURIComponent(uid)}/sessions`);
    if (response.status === 404) throw new Error('unauthenticated');
    if (!response.ok) throw new Error('keycloak_session_lookup_failed');
    const sessions = (await response.json()) as { id?: string; start?: number }[];
    const session = sessions.find((candidate) => candidate.id === sid);
    if (!session?.start) throw new Error('unauthenticated');
    return Math.floor(session.start / 1000);
  }
}

export class KeycloakTokens {
  private readonly jwks: JWTVerifyGetKey;
  private readonly sessions = new Map<string, { start: number; expiresAt: number }>();

  constructor(
    private settings: KeycloakSettings,
    private admin: KeycloakAdmin,
    jwks?: JWTVerifyGetKey,
  ) {
    this.jwks =
      jwks ??
      createRemoteJWKSet(
        new URL(
          '/realms/' + realmFromIssuer(settings.issuer) + '/protocol/openid-connect/certs',
          settings.backchannelUrl,
        ),
        {
          cacheMaxAge: 10 * 60 * 1000,
          cooldownDuration: 30_000,
        },
      );
  }

  async verify(token: string): Promise<Identity> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.settings.issuer,
      audience: this.settings.audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'sid', 'exp', 'iat'],
      clockTolerance: 5,
    });
    const uid = payload.sub;
    const sid = payload.sid;
    if (typeof uid !== 'string' || !uid) throw new Error('unauthenticated');
    if (typeof sid !== 'string' || !sid) throw new Error('unauthenticated');
    // Defense-in-depth (security review): the subject reaches asset and document
    // paths, so hold it to the same alphabet the path builders assume.
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) throw new Error('unauthenticated');
    const claims = payload as { realm_access?: { roles?: unknown } };
    const claimed = claims.realm_access?.roles;
    const roles = Array.isArray(claimed)
      ? claimed.filter((role): role is string => typeof role === 'string')
      : [];
    return {
      uid,
      roles: roles.length ? roles : undefined,
      // Resolved only by endpoints that require a recent interactive login.
      auth_time: () => this.authTime(uid, sid),
    };
  }

  private async authTime(uid: string, sid: string) {
    const cacheKey = `${uid}:${sid}`;
    const cached = this.sessions.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.start;
    const start = await this.admin.sessionStart(uid, sid);
    if (this.sessions.size >= SESSION_CACHE_MAX) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }
    this.sessions.set(cacheKey, { start, expiresAt: Date.now() + SESSION_CACHE_MS });
    return start;
  }
}
