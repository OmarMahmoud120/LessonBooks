import { beforeAll, afterAll, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { getBytes, uploadBytes, ref } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { testEmulatorEndpoints } from './emulator-config';
let env: RulesTestEnvironment;
beforeAll(async () => {
  const endpoints = testEmulatorEndpoints();
  const firestore = new URL(`http://${endpoints.FIRESTORE_EMULATOR_HOST}`);
  const storage = new URL(`http://${endpoints.FIREBASE_STORAGE_EMULATOR_HOST}`);
  env = await initializeTestEnvironment({
    projectId: 'demo-lessonbooks',
    firestore: {
      host: firestore.hostname,
      port: Number(firestore.port),
      rules: readFileSync('backend/infra/firestore.rules', 'utf8'),
    },
    storage: {
      host: storage.hostname,
      port: Number(storage.port),
      rules: readFileSync('backend/infra/storage.rules', 'utf8'),
    },
  });
});
afterAll(async () => {
  await env?.cleanup();
});
it('denies direct database reads and writes even to the signed-in parents own family', async () => {
  for (const context of [
    env.unauthenticatedContext(),
    env.authenticatedContext('alice'),
    env.authenticatedContext('bob'),
  ]) {
    const db = context.firestore();
    await assertFails(getDoc(doc(db, 'parents/alice')));
    await assertFails(setDoc(doc(db, 'parents/alice/kids/child'), { nickname: 'Fox' }));
  }
});
it('denies public and authenticated direct storage access', async () => {
  for (const context of [
    env.unauthenticatedContext(),
    env.authenticatedContext('alice'),
    env.authenticatedContext('bob'),
  ]) {
    const file = ref(context.storage(), 'families/alice/kids/child/books/book/source.pdf');
    await assertFails(uploadBytes(file, new Uint8Array([1, 2, 3])));
    await assertFails(getBytes(file));
  }
});
