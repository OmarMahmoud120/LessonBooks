import Fastify from 'fastify';
import { createPublicKey, verify as cryptoVerify, X509Certificate } from 'node:crypto';
import type { Pipeline } from './pipeline';

export interface TokenVerifier {
  verify(token: string): Promise<void>;
}
// Local-mode stand-in keeps the endpoint testable without Google infrastructure.
export class EmulatorVerifier implements TokenVerifier {
  constructor(private accepted: string) {}
  async verify(token: string): Promise<void> {
    if (token !== this.accepted) throw new Error('token_rejected');
  }
}
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/cloudtasks@system.gserviceaccount.com';
// Cloud Tasks signs the OIDC bearer with its service identity; only the configured
// audience and service account are accepted, and the signature must be RS256.
export class CloudTasksOidcVerifier implements TokenVerifier {
  constructor(
    private audience: string,
    private serviceAccount: string,
    private fetchCerts: () => Promise<Record<string, string>> = () =>
      fetch(GOOGLE_CERTS_URL).then((r) => r.json() as Promise<Record<string, string>>),
  ) {}
  async verify(token: string): Promise<void> {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !signatureB64) throw new Error('malformed_token');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) throw new Error('unsupported_token');
    const certs = await this.fetchCerts();
    const certPem = certs[header.kid];
    if (!certPem) throw new Error('unknown_key');
    const signed = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(signatureB64, 'base64url');
    // Google serves X.509 certificates; raw SPKI PEMs are accepted so tests need no CA.
    const publicKey = (() => {
      try {
        return new X509Certificate(certPem).publicKey;
      } catch {
        return createPublicKey(certPem);
      }
    })();
    const valid = cryptoVerify('RSA-SHA256', Buffer.from(signed), publicKey, signature);
    if (!valid) throw new Error('bad_signature');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      aud?: string;
      email?: string;
      exp?: number;
    };
    if (payload.aud !== this.audience) throw new Error('audience_mismatch');
    if (payload.email !== this.serviceAccount) throw new Error('caller_unauthorized');
    if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error('token_expired');
  }
}
// The private generation endpoint accepts only Cloud Tasks OIDC callers; it never
// accepts parent tokens and stays unexposed in emulator mode.
export function createWorkerApp(pipeline: Pipeline, verifier: TokenVerifier) {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ status: 'ok', mode: 'mock-worker' }));
  const idPattern = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' };
  app.post<{ Params: { uid: string; jobId: string } }>(
    '/v1/internal/jobs/:uid/:jobId',
    {
      schema: {
        params: {
          type: 'object',
          properties: { uid: idPattern, jobId: idPattern },
          required: ['uid', 'jobId'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer '))
        return reply.code(401).send({ error: 'unauthorized' });
      try {
        await verifier.verify(authorization.slice('Bearer '.length));
      } catch {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const ran = await pipeline.run(request.params.uid, request.params.jobId);
      return { ran };
    },
  );
  return app;
}
