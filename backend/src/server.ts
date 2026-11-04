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

// Emulator-only entrypoint. A cloud deployment needs explicit configuration/review.
const projectId = 'demo-lessonbooks';
if (process.env.NODE_ENV === 'production' || process.env.LIVE_AI_APPROVED === 'true')
  throw new Error('Use reviewed cloud configuration before production/live AI.');
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
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
  new PDFIngestor(false),
  new RoutedAI(new MockModelClient(), mockPolicy),
);
const app = await createAPI(families, async (token) => {
  const identity = await auth.verifyIdToken(token, true);
  return { uid: identity.uid, auth_time: identity.auth_time };
});
let running = false;
const worker = setInterval(async () => {
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
        if (job.status === 'queued' || (job.status === 'running' && job.lease_until < Date.now()))
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
  clearInterval(worker);
});
await app.listen({ port: 3001, host: '127.0.0.1' });
console.log(
  'LessonBooks API: http://127.0.0.1:3001 (emulators + mocked AI; synthetic content only)',
);
