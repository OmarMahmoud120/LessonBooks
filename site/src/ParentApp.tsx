import { useEffect, useState } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { assertLesson, type Lesson } from '@lessonbooks/contracts';
import { Player } from './player/Player';
import { strings } from './i18n';
import './parent.css';

const t = strings.en;
const firebase = initializeApp({
  apiKey: 'demo-lessonbooks',
  projectId: 'demo-lessonbooks',
  authDomain: 'demo-lessonbooks.firebaseapp.com',
});
const auth = getAuth(firebase);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
type Kid = { id: string; nickname: string; grade_id: string };
type Summary = { id: string; summary: string; status: 'draft' | 'approved'; revision: number };
type Job = { id: string; stage: string; status: string; progress: number };
export function ParentApp() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kids, setKids] = useState<Kid[]>([]);
  const [consented, setConsented] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [rights, setRights] = useState(false);
  const [nickname, setNickname] = useState('');
  const [grade, setGrade] = useState('year-1');
  const [kidLanguage, setKidLanguage] = useState<'en-GB' | 'ar'>('en-GB');
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [lessons, setLessons] = useState<Summary[]>([]);
  const [opened, setOpened] = useState<{
    lesson: Lesson;
    revision: number;
    status: string;
    owner_uid: string;
  } | null>(null);
  useEffect(
    () =>
      onAuthStateChanged(auth, (current) => {
        setUser(current);
        setKids([]);
        setLessons([]);
        setOpened(null);
        setJob(null);
        setConsented(false);
      }),
    [],
  );
  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!auth.currentUser) throw new Error('signed_out');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await auth.currentUser.getIdToken()}`);
    if (init.body && !(init.body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    const response = await fetch(`http://127.0.0.1:3001/v1${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('request_failed');
    return response.json() as Promise<T>;
  }
  async function refresh() {
    const owner = auth.currentUser?.uid;
    const family = await api<{ kids: Kid[]; consents: { type: string }[] }>('/family');
    if (!owner || owner !== auth.currentUser?.uid) return;
    setKids(family.kids);
    setConsented(
      ['privacy', 'content_rights'].every((type) => family.consents.some((c) => c.type === type)),
    );
    const summaries = await api<Summary[]>('/lessons');
    if (owner === auth.currentUser?.uid) setLessons(summaries);
  }
  useEffect(() => {
    if (user) void refresh().catch(() => setError(t.error));
  }, [user]);
  useEffect(() => {
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) return;
    const timer = setInterval(() => {
      void api<Job>(`/jobs/${job.id}`)
        .then((next) => {
          setJob(next);
          if (next.status === 'completed') return refresh();
        })
        .catch(() => setError(t.error));
    }, 2000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  }
  async function open(record: Summary) {
    const value = await api<{ lesson: unknown; revision: number; status: string }>(
      `/lessons/${record.id}`,
    );
    assertLesson(value.lesson);
    if (auth.currentUser?.uid === user?.uid && user)
      setOpened({ ...value, lesson: value.lesson, owner_uid: user.uid });
  }
  if (opened && user && opened.owner_uid === user.uid)
    return (
      <div>
        <nav className="preview-nav">
          <button onClick={() => setOpened(null)}>← {t.back}</button>
          <button
            className="primary"
            disabled={busy || opened.status === 'approved'}
            onClick={() =>
              void perform(async () => {
                await api(`/lessons/${opened.lesson.id}/approve`, {
                  method: 'POST',
                  body: JSON.stringify({ revision: opened.revision }),
                });
                setOpened({ ...opened, status: 'approved' });
                await refresh();
              })
            }
          >
            {opened.status === 'approved' ? t.approved : t.approve}
          </button>
        </nav>
        {error && <p role="alert">{error}</p>}
        <Player
          key={`${opened.lesson.id}-${opened.revision}`}
          lesson={opened.lesson}
          revision={opened.revision}
        />
      </div>
    );
  const stageLabels: Record<string, string> = {
    ingest: t.stageIngest,
    structure: t.stageStructure,
    plan: t.stagePlan,
    generate: t.stageGenerate,
    validate: t.stageValidate,
    publish: t.stagePublish,
  };
  return (
    <div className="parent-app">
      <header className="site-header">
        <a className="brand" href="/" aria-label={t.brand}>
          <span aria-hidden="true">✳</span> {t.brand}
        </a>
        <span className="edition">{t.parentSpace}</span>
        {user && <button onClick={() => void signOut(auth)}>{t.signOut}</button>}
      </header>
      <div className="development-notice">{t.notice}</div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {!user ? (
        <main className="welcome">
          <section>
            <span className="eyebrow">{t.parentSpace}</span>
            <h1>{t.tagline}</h1>
            <p className="intro">{t.localNotice}</p>
            <div className="book-art" aria-hidden="true">
              <div className="book-left">
                1<br />2<br />3
              </div>
              <div className="book-right">
                ✦<br />✧
              </div>
              <span className="leaf">✽</span>
            </div>
            <div className="sample-links">
              <a href="/?example=english">{t.sample} ↗</a>
              <a href="/?example=arabic" lang="ar">
                {t.sampleArabic} ↗
              </a>
            </div>
          </section>
          <form
            className="parent-card auth-card"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(() => signInWithEmailAndPassword(auth, email, password));
            }}
          >
            <h2>{t.signIn}</h2>
            <label>
              {t.email}
              <input
                autoComplete="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              {t.password}
              <input
                autoComplete="current-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {t.signIn}
            </button>
            <button
              type="button"
              disabled={busy || !email || password.length < 8}
              onClick={() =>
                void perform(() => createUserWithEmailAndPassword(auth, email, password))
              }
            >
              {t.signUp}
            </button>
            <p className="small">{t.localNotice}</p>
          </form>
        </main>
      ) : (
        <main className="dashboard">
          <div className="dashboard-title">
            <span className="eyebrow">{t.parentSpace}</span>
            <h1>{kids[0]?.nickname ? `${kids[0].nickname} · ${t.library}` : t.library}</h1>
            <p>{t.pages}</p>
          </div>
          {!consented ? (
            <section className="parent-card">
              <h2>{t.consentTitle}</h2>
              <p>{t.privacy}</p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={privacy}
                  onChange={(e) => setPrivacy(e.target.checked)}
                />
                {t.consent}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                />
                {t.rights}
              </label>
              <button
                className="primary"
                disabled={busy || !privacy || !rights}
                onClick={() =>
                  void perform(async () => {
                    for (const type of ['privacy', 'content_rights'])
                      await api('/consents', {
                        method: 'POST',
                        body: JSON.stringify({ type, version: '2026-11-03', granted: true }),
                      });
                    await refresh();
                  })
                }
              >
                {t.saveConsent}
              </button>
            </section>
          ) : !kids.length ? (
            <form
              className="parent-card profile-card"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await api('/kids', {
                    method: 'POST',
                    body: JSON.stringify({
                      nickname,
                      avatar: 'fox',
                      grade_id: grade,
                      age_band: grade === 'year-1' ? '5-7' : '6-8',
                      country: 'GB-ENG',
                      language: kidLanguage,
                      curriculum_id: 'england-national-2014',
                      reading_level: 'emerging',
                    }),
                  });
                  await refresh();
                });
              }}
            >
              <h2>{t.childTitle}</h2>
              <label>
                {t.nickname}
                <input
                  required
                  maxLength={30}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  aria-describedby="nickname-help"
                />
              </label>
              <p id="nickname-help" className="small">
                {t.nicknameHelp}
              </p>
              <label>
                {t.grade}
                <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="year-1">{t.year1}</option>
                  <option value="year-2">{t.year2}</option>
                </select>
              </label>
              <label>
                {t.childLanguage}
                <select
                  value={kidLanguage}
                  onChange={(e) => setKidLanguage(e.target.value as 'en-GB' | 'ar')}
                >
                  <option value="en-GB">{t.languageEn}</option>
                  <option value="ar">{t.languageAr}</option>
                </select>
              </label>
              <button className="primary" disabled={busy}>
                {t.addChild}
              </button>
            </form>
          ) : (
            <>
              <section className="upload-card">
                <div>
                  <span className="eyebrow">{t.pages}</span>
                  <h2>{t.uploadTitle}</h2>
                  <p>{t.uploadHelp}</p>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      if (!file) return;
                      const data = new FormData();
                      data.append('book', file);
                      const created = await api<{ job_id: string }>(
                        `/books?kid_id=${kids[0]!.id}`,
                        {
                          method: 'POST',
                          headers: { 'Idempotency-Key': crypto.randomUUID() },
                          body: data,
                        },
                      );
                      setJob({
                        id: created.job_id,
                        stage: 'ingest',
                        status: 'queued',
                        progress: 0,
                      });
                    });
                  }}
                >
                  <label>
                    {t.choosePDF}
                    <input
                      type="file"
                      accept="application/pdf"
                      required
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button className="primary" disabled={busy || !file}>
                    {t.upload}
                  </button>
                </form>
              </section>
              {job && (
                <section className="parent-card job-card" role="status">
                  <h2>
                    {job.status === 'failed' ? t.failed : (stageLabels[job.stage] ?? t.generating)}
                  </h2>
                  <progress value={job.progress} max={100} aria-label={t.generating} />
                  <span>{job.progress}%</span>
                </section>
              )}
              <section className="library">
                <h2>{t.library}</h2>
                {!lessons.length ? (
                  <div className="empty-state">
                    <span aria-hidden="true">✧</span>
                    <p>{t.empty}</p>
                  </div>
                ) : (
                  <div className="lesson-grid">
                    {lessons.map((lesson, index) => (
                      <article className="lesson-tile" key={lesson.id}>
                        <span className="tile-number">{String(index + 1).padStart(2, '0')}</span>
                        <span className="status">
                          {lesson.status === 'approved' ? t.approved : t.draft}
                        </span>
                        <h3>{lesson.summary}</h3>
                        <button onClick={() => void perform(() => open(lesson))}>{t.open} →</button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <footer className="data-controls">
                <p>{t.privacy}</p>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm(t.deleteConfirm))
                      void perform(async () => {
                        await api(`/kids/${kids[0]!.id}`, { method: 'DELETE' });
                        setJob(null);
                        await refresh();
                      });
                  }}
                >
                  {t.deleteChild}
                </button>
              </footer>
            </>
          )}
          <button
            className="delete-account"
            disabled={busy}
            onClick={() => {
              if (confirm(t.deleteAccountConfirm))
                void perform(async () => {
                  await api('/account', { method: 'DELETE' });
                  await signOut(auth);
                });
            }}
          >
            {t.deleteAccount}
          </button>
        </main>
      )}
    </div>
  );
}
