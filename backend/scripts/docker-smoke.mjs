import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
const base = 'http://127.0.0.1:3001/v1';
// Synthetic local Keycloak credentials from compose.yaml and the realm import.
// None of these values are valid on a VPS.
const keycloak = process.env.KEYCLOAK_PUBLIC_URL ?? 'http://127.0.0.1:8081';
const realm = 'lessonbooks';
const adminUser = process.env.KEYCLOAK_ADMIN_USERNAME ?? 'local-admin';
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'local-only-keycloak-admin';
const syntheticPassword = 'SyntheticDocker2026';
const email = `docker-${Date.now()}@example.test`;
const username = `docker${Date.now()}`;

async function form(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const adminLogin = await form(`${keycloak}/realms/master/protocol/openid-connect/token`, {
  grant_type: 'password',
  client_id: 'admin-cli',
  username: adminUser,
  password: adminPassword,
});
assert.equal(adminLogin.status, 200, 'bootstrap admin must be able to sign in');
const adminToken = adminLogin.body.access_token;

async function admin(path, init = {}) {
  const response = await fetch(`${keycloak}/admin/realms/${realm}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  return response;
}

const siteClient = (await (await admin('/clients?clientId=lessonbooks-site')).json())[0];
assert.ok(siteClient?.id, 'the website client must exist');
async function setDirectGrants(enabled) {
  const response = await admin(`/clients/${siteClient.id}`, {
    method: 'PUT',
    body: JSON.stringify({ directAccessGrantsEnabled: enabled }),
  });
  assert.ok(response.ok, 'the test must be able to toggle the local password grant');
}
// The website uses authorization-code + PKCE. The password grant is enabled only
// for this scripted journey and turned off again in the finally block.
await setDirectGrants(true);
const created = await admin('/users', {
  method: 'POST',
  body: JSON.stringify({
    username,
    email,
    emailVerified: true,
    enabled: true,
    firstName: 'Docker',
    lastName: 'Parent',
    credentials: [{ type: 'password', value: syntheticPassword, temporary: false }],
  }),
});
assert.equal(created.status, 201, 'a synthetic parent identity is created');
const grant = await form(`${keycloak}/realms/${realm}/protocol/openid-connect/token`, {
  grant_type: 'password',
  client_id: 'lessonbooks-site',
  username,
  password: syntheticPassword,
  scope: 'openid',
});
assert.equal(grant.status, 200, 'the synthetic parent receives a token');
let idToken = grant.body.access_token;
const uid = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).sub;
assert.ok(uid);
// The Compose stack stores assets in Garage. These are the local synthetic
// credentials from compose.yaml, not a supported production configuration.
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:3900',
  region: process.env.S3_REGION ?? 'garage',
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'GK0123456789abcdef0123456789abcdef',
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY ??
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
});
const bucket = process.env.S3_BUCKET ?? 'lessonbooks';
async function listStored(prefix) {
  const response = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  return (response.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []));
}
async function waitForStoredPdf(prefix) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const key = (await listStored(prefix)).find((candidate) => candidate.endsWith('.pdf'));
    if (key) {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      assert.ok(object.Body);
      const bytes = await object.Body.transformToByteArray();
      assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), '%PDF');
      const anonymous = await fetch(
        `${process.env.S3_ENDPOINT ?? 'http://127.0.0.1:3900'}/${bucket}/${key
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
      );
      assert.equal(anonymous.status, 403, 'anonymous object access must be denied');
      console.log(`Garage stored ${key} (${bytes.length} bytes; anonymous access 403)`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(`no PDF object stored under ${prefix}`);
}
async function waitForEmptyPrefix(prefix) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await listStored(prefix)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(`objects remain under ${prefix}`);
}
// Recent-auth endpoints need a session younger than five minutes. Re-authenticating
// here exercises the real re-login path after a long OCR journey.
async function signInAgain() {
  const refreshed = await form(`${keycloak}/realms/${realm}/protocol/openid-connect/token`, {
    grant_type: 'password',
    client_id: 'lessonbooks-site',
    username,
    password: syntheticPassword,
    scope: 'openid',
  });
  assert.equal(refreshed.status, 200, 'the parent can sign in again');
  idToken = refreshed.body.access_token;
}
async function api(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
try {
  assert.equal((await fetch(base + '/family')).status, 401);
  await api('/family');
  for (const type of ['privacy', 'content_rights'])
    await api('/consents', {
      method: 'POST',
      body: JSON.stringify({ type, version: '2026-11-03', granted: true }),
    });
  async function createKid(nickname, language) {
    return api('/kids', {
      method: 'POST',
      body: JSON.stringify({
        nickname,
        avatar: 'fox',
        grade_id: 'year-1',
        age_band: '5-7',
        country: 'GB-ENG',
        language,
        curriculum_id: 'england-national-2014',
        reading_level: 'emerging',
      }),
    });
  }
  async function upload(kidId, filename) {
    const pdf = await readFile(`doc/fixtures/books/${filename}`);
    const form = new FormData();
    form.append('book', new Blob([pdf], { type: 'application/pdf' }), 'owned.pdf');
    await api(`/books?kid_id=${kidId}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `docker-${Date.now()}-${kidId}` },
      body: form,
    });
  }
  async function waitLessons(count) {
    let lessons = [];
    for (let attempt = 0; attempt < 240; attempt++) {
      lessons = await api('/lessons');
      if (lessons.length === count) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(lessons.length, count, `worker must publish ${count} drafts`);
    return lessons;
  }
  const kid = await createKid('DockerFox', 'en-GB');
  await upload(kid.id, 'counting.pdf');
  await waitForStoredPdf(`families/${uid}/kids/${kid.id}/`);
  let lessons = await waitLessons(3);
  const first = await api(`/lessons/${lessons[0].id}`);
  await api(`/lessons/${lessons[0].id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ revision: first.revision }),
  });
  await api(`/kids/${kid.id}`, { method: 'DELETE' });
  await waitForEmptyPrefix(`families/${uid}/kids/${kid.id}/`);
  assert.equal((await api('/lessons')).length, 0);
  // Phase 1 allows one kid per family, so the Arabic journey reuses the freed slot.
  const arabicKid = await createKid('DockerArousa', 'ar');
  await upload(arabicKid.id, 'arabic-counting-scanned.pdf');
  await waitForStoredPdf(`families/${uid}/kids/${arabicKid.id}/`);
  lessons = await waitLessons(3);
  const arabicFirst = await api(`/lessons/${lessons[0].id}`);
  assert.equal(arabicFirst.lesson.metadata.language, 'ar');
  assert.equal(arabicFirst.lesson.metadata.direction, 'rtl');
  await api(`/kids/${arabicKid.id}`, { method: 'DELETE' });
  await waitForEmptyPrefix(`families/${uid}/kids/${arabicKid.id}/`);
  assert.equal((await api('/lessons')).length, 0);
  console.log(
    'Docker smoke passed: Keycloak token, consent, owned PDFs, virus-scanned ingestion, Arabic OCR by a separate worker, mocked Arabic lessons, approval, deletion, and private Garage objects.',
  );
} finally {
  await signInAgain();
  await api('/account', { method: 'DELETE' });
  await waitForEmptyPrefix(`families/${uid}/`);
  // Account deletion cascades to the identity that owns the family.
  const lookup = await admin(`/users?username=${encodeURIComponent(username)}`);
  const remaining = await lookup.json();
  assert.ok(
    Array.isArray(remaining) && remaining.length === 0,
    'the Keycloak identity must be deleted with the family',
  );
  console.log('Keycloak identity removed with the family');
  await setDirectGrants(false);
}
