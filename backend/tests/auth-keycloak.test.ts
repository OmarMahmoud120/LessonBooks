import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
import { KeycloakAdmin, KeycloakTokens, realmFromIssuer } from '../src/auth-keycloak';
import { createAPI } from '../src/api';
import { FamilyService } from '../src/family';
import { MemoryAssets, MemoryRepository } from '../src/persistence';

const issuer = 'http://keycloak:8080/realms/lessonbooks';
const audience = 'lessonbooks-api';
const settings = {
  issuer,
  backchannelUrl: 'http://keycloak:8080',
  audience,
  clientId: 'lessonbooks-api',
  clientSecret: 'local-only-api-service-secret-0123456789',
};

let privateKey: SigningKey;
let otherKey: SigningKey;
let jwks: { keys: Record<string, unknown>[] };

async function accessToken(
  overrides: {
    key?: SigningKey;
    iss?: string;
    aud?: string;
    sub?: string;
    sid?: string | null;
    expiresIn?: string;
    realmRoles?: string[];
  } = {},
) {
  const builder = new SignJWT({
    sid: overrides.sid === undefined ? 'session-1' : overrides.sid,
    typ: 'Bearer',
    azp: 'lessonbooks-site',
    ...(overrides.realmRoles ? { realm_access: { roles: overrides.realmRoles } } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.iss ?? issuer)
    .setAudience(overrides.aud ?? audience)
    .setSubject(overrides.sub ?? 'parent-1')
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '5m');
  return builder.sign(overrides.key ?? privateKey);
}

beforeEach(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256' }] };
  const other = await generateKeyPair('RS256');
  otherKey = other.privateKey;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function verifier() {
  const admin = new KeycloakAdmin(settings);
  const jwksResolver = async () => jwks.keys[0] as never;
  return new KeycloakTokens(settings, admin, jwksResolver);
}

describe('realmFromIssuer', () => {
  it('extracts the realm from a Keycloak issuer', () => {
    expect(realmFromIssuer(issuer)).toBe('lessonbooks');
  });

  it.each([
    'https://auth.example.com/realms/',
    'https://auth.example.com/realms/a/b',
    'https://auth.example.com/',
    'not-a-url',
    'https://user:pass@auth.example.com/realms/lessonbooks',
  ])('rejects a malformed issuer %s', (value) => {
    expect(() => realmFromIssuer(value)).toThrow('invalid_keycloak_issuer');
  });
});

describe('KeycloakTokens', () => {
  it('accepts a valid access token and exposes a lazy auth time', async () => {
    const identity = await verifier().verify(await accessToken());
    expect(identity.uid).toBe('parent-1');
    expect(typeof identity.auth_time).toBe('function');
  });

  it('exposes realm roles and omits the field when the claim is absent', async () => {
    const operator = await verifier().verify(
      await accessToken({ realmRoles: ['lessonbooks-admin', 42 as never] }),
    );
    expect(operator.roles).toEqual(['lessonbooks-admin']);
    const parent = await verifier().verify(await accessToken());
    expect(parent.roles).toBeUndefined();
  });

  it.each([
    ['wrong issuer', { iss: 'http://keycloak:8080/realms/other' }],
    ['wrong audience', { aud: 'another-client' }],
    ['expired token', { expiresIn: '-10s' }],
    ['token without a session', { sid: null }],
  ])('rejects a %s', async (_label, overrides) => {
    await expect(verifier().verify(await accessToken(overrides))).rejects.toThrow();
  });

  it('rejects a token signed by a different key', async () => {
    await expect(verifier().verify(await accessToken({ key: otherKey }))).rejects.toThrow();
  });

  it('rejects unsigned and malformed tokens', async () => {
    const unsigned = [
      Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
      Buffer.from(`{"sub":"parent-1","iss":"${issuer}","aud":"${audience}"}`).toString('base64url'),
      '',
    ].join('.');
    await expect(verifier().verify(unsigned)).rejects.toThrow();
    await expect(verifier().verify('not-a-token')).rejects.toThrow();
  });
});

describe('KeycloakAdmin', () => {
  function stubFetch(
    handler: (url: string, init?: RequestInit) => { status: number; body?: unknown },
  ) {
    const calls: { url: string; method?: string }[] = [];
    vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      calls.push(init?.method ? { url, method: init.method } : { url });
      const result = handler(url, init);
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
      });
    });
    return calls;
  }

  it('caches the service-account token between admin calls', async () => {
    const calls = stubFetch((url, init) => {
      if (url.endsWith('/protocol/openid-connect/token')) {
        expect(String(init?.body)).toContain('client_credentials');
        return { status: 200, body: { access_token: 'admin-token', expires_in: 300 } };
      }
      return { status: 204 };
    });
    const admin = new KeycloakAdmin(settings);
    await admin.deleteUser('parent-1');
    await admin.deleteUser('parent-2');
    expect(calls.filter((call) => call.url.includes('/token'))).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
  });

  it('treats an already deleted identity as success', async () => {
    stubFetch((url) =>
      url.endsWith('/protocol/openid-connect/token')
        ? { status: 200, body: { access_token: 'admin-token', expires_in: 300 } }
        : { status: 404 },
    );
    await expect(new KeycloakAdmin(settings).deleteUser('missing')).resolves.toBeUndefined();
  });

  it('fails closed when user deletion is refused', async () => {
    stubFetch((url) =>
      url.endsWith('/protocol/openid-connect/token')
        ? { status: 200, body: { access_token: 'admin-token', expires_in: 300 } }
        : { status: 403 },
    );
    await expect(new KeycloakAdmin(settings).deleteUser('parent-1')).rejects.toThrow(
      'keycloak_user_delete_failed',
    );
  });

  it('returns the session start for the token session id', async () => {
    stubFetch((url) =>
      url.endsWith('/protocol/openid-connect/token')
        ? { status: 200, body: { access_token: 'admin-token', expires_in: 300 } }
        : {
            status: 200,
            body: [
              { id: 'other', start: 1 },
              { id: 'session-1', start: 1_700_000_000_000 },
            ],
          },
    );
    await expect(new KeycloakAdmin(settings).sessionStart('parent-1', 'session-1')).resolves.toBe(
      1_700_000_000,
    );
  });

  it('rejects a session that no longer exists', async () => {
    stubFetch((url) =>
      url.endsWith('/protocol/openid-connect/token')
        ? { status: 200, body: { access_token: 'admin-token', expires_in: 300 } }
        : { status: 200, body: [{ id: 'revoked', start: 1 }] },
    );
    await expect(new KeycloakAdmin(settings).sessionStart('parent-1', 'session-1')).rejects.toThrow(
      'unauthenticated',
    );
  });
});

describe('recent authentication with a lazy auth time', () => {
  async function familyApp(authTime: () => Promise<number>) {
    const family = new FamilyService(new MemoryRepository(), new MemoryAssets());
    await family.ensureParent('alice');
    return createAPI(family, async () => ({ uid: 'alice', auth_time: authTime }));
  }

  it('allows account deletion right after an interactive login', async () => {
    const app = await familyApp(async () => Math.floor(Date.now() / 1000) - 10);
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/account',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects account deletion when the session is older than five minutes', async () => {
    const app = await familyApp(async () => Math.floor(Date.now() / 1000) - 301);
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/account',
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'recent_auth_required' });
  });

  it('rejects PIN changes when the session lookup fails', async () => {
    const app = await familyApp(async () => {
      throw new Error('keycloak_session_lookup_failed');
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parent/pin',
      headers: { authorization: 'Bearer token' },
      payload: { pin: '1234' },
    });
    expect(response.statusCode).toBe(401);
  });
});
