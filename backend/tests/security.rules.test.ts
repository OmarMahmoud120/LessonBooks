import { beforeAll, afterAll, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { getBytes, uploadBytes, ref } from 'firebase/storage';
import { readFileSync } from 'node:fs';
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-lessonbooks',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('backend/infra/firestore.rules', 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
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
