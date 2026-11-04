import Fastify from 'fastify';
import { runtimeConfig } from './runtime-config';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FirestoreRepository, StorageAssets } from './persistence';
import { FamilyService } from './family';
import { createAPI } from './api';
import { Pipeline } from './pipeline';
import { PDFIngestor } from './ingest';
import { MockModelClient, RoutedAI, mockPolicy } from './ai';
import { familyPath, type Parent, type Job } from './domain';

// This remains emulator-only even when distributed as a production-shaped image.
const config = runtimeConfig(process.env);
const projectId = 'demo-lessonbooks';
Object.assign(process.env, config.endpoints);
const firebase = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const auth = getAuth(firebase);
const repo = new FirestoreRepository(getFirestore(firebase));
const assets = new StorageAssets(getStorage(firebase).bucket());
const families = new FamilyService(repo, assets, async (uid) => {
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
});
const pipeline = new Pipeline(
  families,
  new PDFIngestor(config.requireScan),
  new RoutedAI(new MockModelClient(), mockPolicy),
);
const app =
  config.role === 'worker'
    ? Fastify({ logger: false })
    : await createAPI(families, async (token) => {
        const identity = await auth.verifyIdToken(token, true);
        return { uid: identity.uid, auth_time: identity.auth_time };
      });
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
        } catch {
          app.log.error('local_worker_failed');
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
  `LessonBooks ${config.role}: port ${config.port} (emulators + mocked AI; synthetic content only)`,
);
