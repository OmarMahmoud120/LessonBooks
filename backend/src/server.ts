import Fastify from 'fastify';
import { Pool } from 'pg';
import { runtimeConfig } from './runtime-config';
import { PostgresRepository } from './persistence-postgres';
import { S3Assets, createS3Transport } from './persistence-s3';
import { KeycloakAdmin, KeycloakTokens } from './auth-keycloak';
import { FamilyService } from './family';
import { AdminOps, AuditLog } from './admin';
import { createAPI } from './api';
import { Pipeline } from './pipeline';
import { createRuntimeIngestor } from './runtime-ingestor';
import { MockModelClient, RoutedAI, mockPolicy } from './ai';
import { familyPath, type Parent, type Job } from './domain';

// Self-hosted runtime (ADR 0013): Postgres documents, Keycloak identity, Garage
// assets and a local polling worker. AI stays mocked until live use is approved.
const config = runtimeConfig(process.env);
const ingestor = createRuntimeIngestor(config, process.env);
const keycloak = {
  admin: new KeycloakAdmin(config.auth),
  tokens: new KeycloakTokens(config.auth, new KeycloakAdmin(config.auth)),
};
const verifyToken = (token: string) => keycloak.tokens.verify(token);
const pool = new Pool({ connectionString: config.postgres.url, max: 10 });
const repo = new PostgresRepository(pool);
await repo.init();
const assets = new S3Assets(createS3Transport(config.assets), config.assets.bucket);
await assets.init();
const families = new FamilyService(repo, assets, (uid) => keycloak.admin.deleteUser(uid));
const pipeline = new Pipeline(families, ingestor, new RoutedAI(new MockModelClient(), mockPolicy));
const audit = new AuditLog(repo);
// Deletion verification asks the identity provider directly; the result is never cached here.
const identityExists = (uid: string) => keycloak.admin.userExists(uid);
const ops = new AdminOps(repo, families, identityExists);
const app =
  config.role === 'worker'
    ? Fastify({ logger: false })
    : await createAPI(families, verifyToken, audit, ops, config.limits);
if (config.role === 'worker')
  app.get('/health', async () => ({ status: 'ok', mode: 'mock-worker' }));
let running = false;
const worker =
  config.role === 'api'
    ? undefined
    : setInterval(async () => {
        if (running) return;
        running = true;
        try {
          for (const parent of await repo.list<Parent>('parents')) {
            if (parent.state === 'deleting') {
              await families.deleteAccount(parent.id);
              continue;
            }
            if (parent.state !== 'active') continue;
            for (const job of await repo.list<Job>(familyPath(parent.id, 'generation_jobs'))) {
              if (
                job.status === 'queued' ||
                (job.status === 'running' && job.lease_until < Date.now())
              )
                await pipeline.run(parent.id, job.id);
            }
          }
        } catch (error) {
          console.error('local_worker_failed', error);
        } finally {
          running = false;
        }
      }, 1500);
app.addHook('onClose', async () => {
  if (worker) clearInterval(worker);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ port: config.port, host: config.host });
console.log(
  `LessonBooks ${config.mode} ${config.role}: port ${config.port}; OCR=${config.role === 'api' ? 'unused' : config.ocrProvider} (Postgres + Keycloak + Garage; mocked AI; synthetic content only)`,
);
