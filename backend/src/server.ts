import Fastify from 'fastify';
import { runtimeConfig } from './runtime-config';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FirestoreRepository, StorageAssets, type Assets } from './persistence';
import { S3Assets, createS3Transport } from './persistence-s3';
import { KeycloakAdmin, KeycloakTokens } from './auth-keycloak';
import { FamilyService } from './family';
import { createAPI } from './api';
import { Pipeline } from './pipeline';
import { createRuntimeIngestor } from './runtime-ingestor';
import { MockModelClient, RoutedAI, mockPolicy } from './ai';
import { familyPath, type Parent, type Job } from './domain';
import { CloudTasksOidcVerifier, createWorkerApp } from './worker';
import { CloudTasksPublisher, OutboxSweeper } from './transport';

// Emulator mode keeps the local polling worker; cloud mode dispatches via Cloud Tasks.
const config = runtimeConfig(process.env);
const ingestor = createRuntimeIngestor(config, process.env);
const projectId = config.mode === 'cloud' ? config.projectId! : 'demo-lessonbooks';
const firebase = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
Object.assign(process.env, config.endpoints);
// Firestore still stores family documents in both modes; identity moves to Keycloak
// when AUTH_PROVIDER=keycloak. The Firebase user-deletion hook is only used by Firebase.
const firebaseAuth = config.auth.kind === 'firebase' ? getAuth(firebase) : undefined;
const keycloak =
  config.auth.kind === 'keycloak'
    ? {
        admin: new KeycloakAdmin(config.auth),
        tokens: new KeycloakTokens(config.auth, new KeycloakAdmin(config.auth)),
      }
    : undefined;
const verifyToken = keycloak
  ? (token: string) => keycloak.tokens.verify(token)
  : async (token: string) => {
      const identity = await firebaseAuth!.verifyIdToken(token, true);
      return { uid: identity.uid, auth_time: identity.auth_time };
    };
const repo = new FirestoreRepository(getFirestore(firebase));
let assets: Assets;
if (config.assets.kind === 's3') {
  const s3 = new S3Assets(createS3Transport(config.assets), config.assets.bucket);
  await s3.init();
  assets = s3;
} else {
  assets = new StorageAssets(getStorage(firebase).bucket());
}
const families = new FamilyService(repo, assets, async (uid) => {
  if (keycloak) {
    await keycloak.admin.deleteUser(uid);
    return;
  }
  try {
    await firebaseAuth!.deleteUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
});
const pipeline = new Pipeline(families, ingestor, new RoutedAI(new MockModelClient(), mockPolicy));
const app =
  config.mode === 'cloud' && config.role === 'worker'
    ? createWorkerApp(
        pipeline,
        new CloudTasksOidcVerifier(config.workerUrl!, config.workerServiceAccount!),
      )
    : config.mode === 'cloud' && config.role === 'api'
      ? await createAPI(families, verifyToken)
      : config.role === 'worker'
        ? Fastify({ logger: false })
        : await createAPI(families, verifyToken);
if (config.role === 'worker' && config.mode === 'emulator')
  app.get('/health', async () => ({ status: 'ok', mode: 'mock-worker' }));
let running = false;
const worker =
  config.mode === 'cloud' || config.role === 'api'
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
// Cloud API instances recover lost dispatch; Cloud Tasks carries every fresh enqueue.
let sweeping = false;
const sweeper =
  config.mode === 'cloud' && config.role === 'api'
    ? setInterval(async () => {
        if (sweeping) return;
        sweeping = true;
        try {
          const { CloudTasksClient } = await import('@google-cloud/tasks');
          await new OutboxSweeper(
            repo,
            new CloudTasksPublisher(
              new CloudTasksClient(),
              config.queuePath!,
              config.workerUrl!,
              config.workerServiceAccount!,
            ),
          ).sweep();
        } catch (error) {
          console.error('outbox_sweep_failed', error);
        } finally {
          sweeping = false;
        }
      }, 60000)
    : undefined;
app.addHook('onClose', async () => {
  if (worker) clearInterval(worker);
  if (sweeper) clearInterval(sweeper);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ port: config.port, host: config.host });
console.log(
  `LessonBooks ${config.mode} ${config.role}: port ${config.port}; OCR=${config.role === 'api' ? 'unused' : config.ocrProvider} (${
    config.mode === 'cloud'
      ? 'mocked AI; live provider remains gated'
      : 'emulators + mocked AI; synthetic content only'
  })`,
);
