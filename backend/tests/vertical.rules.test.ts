import { it, expect } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFile } from 'node:fs/promises';
import { FirestoreRepository, StorageAssets } from '../src/persistence';
import { FamilyService } from '../src/family';
import { createAPI } from '../src/api';
import { Pipeline } from '../src/pipeline';
import { PDFIngestor } from '../src/ingest';
import { MockModelClient, RoutedAI, mockPolicy } from '../src/ai';

it('uses actual Auth/Firestore/Storage emulators for PDF → three private drafts → approval → erasure', async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  const app = initializeApp(
    { projectId: 'demo-lessonbooks', storageBucket: 'demo-lessonbooks.appspot.com' },
    'vertical-test',
  );
  const auth = getAuth(app);
  const signup = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `synthetic-${Date.now()}@example.invalid`,
        password: 'synthetic-password-only',
        returnSecureToken: true,
      }),
    },
  );
  const identity = (await signup.json()) as { idToken: string; localId: string };
  expect(signup.ok).toBe(true);
  const family = new FamilyService(
    new FirestoreRepository(getFirestore(app)),
    new StorageAssets(getStorage(app).bucket()),
    (uid) => auth.deleteUser(uid),
  );
  const api = await createAPI(family, async (token) => {
    const claims = await auth.verifyIdToken(token, true);
    return { uid: claims.uid, auth_time: claims.auth_time };
  });
  const headers = { authorization: `Bearer ${identity.idToken}` };
  try {
    expect((await api.inject({ method: 'GET', url: '/v1/family', headers })).statusCode).toBe(200);
    for (const type of ['privacy', 'content_rights'])
      expect(
        (
          await api.inject({
            method: 'POST',
            url: '/v1/consents',
            headers,
            payload: { type, version: '2026-11-03', granted: true },
          })
        ).statusCode,
      ).toBe(200);
    const child = await api.inject({
      method: 'POST',
      url: '/v1/kids',
      headers,
      payload: {
        nickname: 'Sample',
        avatar: 'fox',
        age_band: '5-7',
        country: 'GB-ENG',
        language: 'en-GB',
        curriculum_id: 'england-national-2014',
        grade_id: 'year-1',
        reading_level: 'emerging',
      },
    });
    expect(child.statusCode).toBe(200);
    const pdf = await readFile('doc/fixtures/books/counting.pdf');
    const boundary = 'lessonbooks-owned-fixture';
    const uploaded = await api.inject({
      method: 'POST',
      url: `/v1/books?kid_id=${child.json().id}`,
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'idempotency-key': 'emulator-book-001',
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="book"; filename="sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        pdf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(uploaded.statusCode).toBe(202);
    const pipeline = new Pipeline(
      family,
      new PDFIngestor(),
      new RoutedAI(new MockModelClient(), mockPolicy),
    );
    for (let stage = 0; stage < 6; stage++)
      expect(await pipeline.run(identity.localId, uploaded.json().job_id)).toBe(true);
    const list = (await api.inject({ method: 'GET', url: '/v1/lessons', headers })).json();
    expect(list).toHaveLength(3);
    const lesson = await api.inject({ method: 'GET', url: `/v1/lessons/${list[0].id}`, headers });
    expect(lesson.statusCode).toBe(200);
    expect(lesson.headers['cache-control']).toBe('no-store');
    const approved = await api.inject({
      method: 'POST',
      url: `/v1/lessons/${list[0].id}/approve`,
      headers,
      payload: { revision: 1 },
    });
    expect(approved.json().status).toBe('approved');
    expect(
      (await api.inject({ method: 'DELETE', url: `/v1/kids/${child.json().id}`, headers }))
        .statusCode,
    ).toBe(200);
    expect((await api.inject({ method: 'GET', url: '/v1/lessons', headers })).json()).toHaveLength(
      0,
    );
    const [files] = await getStorage(app)
      .bucket()
      .getFiles({ prefix: `families/${identity.localId}/` });
    expect(files).toHaveLength(0);
  } finally {
    await api.close();
    await family.deleteAccount(identity.localId);
    await deleteApp(app);
  }
}, 30000);
