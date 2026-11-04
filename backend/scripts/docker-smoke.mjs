import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:3001/v1';
const authURL =
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-lessonbooks';
const signup = await fetch(authURL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: `docker-${Date.now()}@example.test`,
    password: 'SyntheticDocker2026',
    returnSecureToken: true,
  }),
});
assert.equal(signup.status, 200);
const { idToken } = await signup.json();
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
  const kid = await api('/kids', {
    method: 'POST',
    body: JSON.stringify({
      nickname: 'DockerFox',
      avatar: 'fox',
      grade_id: 'year-1',
      age_band: '5-7',
      country: 'GB-ENG',
      language: 'en-GB',
      curriculum_id: 'england-national-2014',
      reading_level: 'emerging',
    }),
  });
  const pdf = await readFile('doc/fixtures/books/counting.pdf');
  const form = new FormData();
  form.append('book', new Blob([pdf], { type: 'application/pdf' }), 'owned.pdf');
  await api(`/books?kid_id=${kid.id}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `docker-${Date.now()}` },
    body: form,
  });
  let lessons = [];
  for (let attempt = 0; attempt < 90; attempt++) {
    lessons = await api('/lessons');
    if (lessons.length === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(lessons.length, 3, 'worker must publish three drafts');
  const first = await api(`/lessons/${lessons[0].id}`);
  await api(`/lessons/${lessons[0].id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ revision: first.revision }),
  });
  await api(`/kids/${kid.id}`, { method: 'DELETE' });
  assert.equal((await api('/lessons')).length, 0);
  console.log(
    'Docker smoke passed: auth, consent, owned PDF, virus-scanned PDF ingestion, separate worker, approval, deletion.',
  );
} finally {
  await api('/account', { method: 'DELETE' });
}
