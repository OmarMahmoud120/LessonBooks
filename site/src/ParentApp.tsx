import { useEffect, useState } from 'react';
import { assertLesson, type Lesson } from '@lessonbooks/contracts';
import { accessToken, loadSession, signIn, signOut, userManager, type ParentSession } from './auth';
import { Player } from './player/Player';
import { strings } from './i18n';
import {
  cacheKidLessons,
  cacheLesson,
  enqueueEvent,
  flushQueue,
  loadCachedKidLessons,
  loadCachedLesson,
  type CachedSummary,
} from './progress';
import './parent.css';

const t = strings.en;
type Kid = { id: string; nickname: string; grade_id: string };
type Summary = {
  id: string;
  kid_id: string;
  summary: string;
  status: 'draft' | 'approved';
  revision: number;
};
type Job = {
  id: string;
  stage: string;
  status: string;
  progress: number;
  error: string | null;
};
export function ParentApp() {
  const [user, setUser] = useState<ParentSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kids, setKids] = useState<Kid[]>([]);
  const [selectedKidId, setSelectedKidId] = useState<string | null>(null);
  const [addingKid, setAddingKid] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem('lessonbooks-parent-unlocked') === '1',
  );
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [kidView, setKidView] = useState(false);
  const [consented, setConsented] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [rights, setRights] = useState(false);
  const [nickname, setNickname] = useState('');
  const [grade, setGrade] = useState('year-1');
  const [kidLanguage, setKidLanguage] = useState<'en-GB' | 'ar'>('en-GB');
  const [file, setFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [lessons, setLessons] = useState<Summary[]>([]);
  const [progress, setProgress] = useState<{
    kid_id: string;
    lessons: {
      lesson_id: string;
      started: number;
      completed: number;
      score: number;
      max_score: number;
      last_client_at: string;
    }[];
  } | null>(null);
  const [assignments, setAssignments] = useState<
    { id: string; kid_id: string; lesson_id: string; revision: number }[]
  >([]);
  const [opened, setOpened] = useState<{
    lesson: Lesson;
    revision: number;
    status: string;
    owner_uid: string;
  } | null>(null);
  const selectedKid = kids.find((kid) => kid.id === selectedKidId) ?? kids[0] ?? null;
  const kidLessons = selectedKid
    ? lessons.filter((lesson) => lesson.kid_id === selectedKid.id)
    : [];
  const cachedKidLessons = selectedKid
    ? loadCachedKidLessons().filter((lesson) => lesson.kid_id === selectedKid.id)
    : [];
  function clearFamilyState() {
    setKids([]);
    setLessons([]);
    setOpened(null);
    setJob(null);
    setConsented(false);
    setUnlocked(false);
    sessionStorage.removeItem('lessonbooks-parent-unlocked');
    setKidView(false);
    setPinFormOpen(false);
    setPinInput('');
    setAssignments([]);
    setProgress(null);
    setSelectedKidId(null);
    setAddingKid(false);
    setFile(null);
    setUploadKey('');
    setError('');
    setNickname('');
  }
  useEffect(() => {
    let active = true;
    void loadSession()
      .then((session) => {
        if (!active) return;
        setUser(session);
        if (session) void refresh().catch(() => setError(t.error));
      })
      .catch(() => setError(t.error));
    const onLoaded = () => void loadSession().then((session) => active && setUser(session));
    const onUnloaded = () => {
      if (!active) return;
      setUser(null);
      clearFamilyState();
    };
    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onUnloaded);
    return () => {
      active = false;
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onUnloaded);
    };
  }, []);
  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await accessToken();
    if (!token) throw new Error('signed_out');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
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
  async function refresh(forKidId?: string) {
    const owner = user?.uid;
    const family = await api<{
      kids: Kid[];
      consents: { type: string }[];
      pin_set: boolean;
    }>('/family');
    if (!owner || owner !== user?.uid) return;
    setKids(family.kids);
    setPinSet(family.pin_set);
    // The closure's selectedKidId can be stale (first load after sign-in or a
    // switcher click that sets state); resolve the kid from the fetched family.
    const kidId =
      forKidId ??
      (family.kids.some((kid) => kid.id === selectedKidId) ? selectedKidId : undefined) ??
      family.kids[0]?.id;
    if (kidId !== selectedKidId) setSelectedKidId(kidId ?? null);
    setConsented(
      ['privacy', 'content_rights'].every((type) => family.consents.some((c) => c.type === type)),
    );
    const summaries = await api<Summary[]>('/lessons');
    if (owner === user?.uid && user) {
      setLessons(summaries);
      cacheKidLessons(summaries as CachedSummary[]);
    }
    const list =
      await api<{ id: string; kid_id: string; lesson_id: string; revision: number }[]>(
        '/assignments',
      );
    if (owner === user?.uid) setAssignments(list);
    if (owner === user?.uid && kidId) {
      setProgress(await api(`/kids/${kidId}/progress`));
    } else setProgress(null);
  }
  useEffect(() => {
    if (user) void refresh().catch(() => setError(t.error));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    flush();
    const timer = setInterval(flush, 10000);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
    };
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
    let value: { lesson: unknown; revision: number; status: string };
    try {
      value = await api<{ lesson: unknown; revision: number; status: string }>(
        `/lessons/${record.id}`,
      );
      if (record.status === 'approved') cacheLesson(record.id, record.revision, value.lesson);
    } catch {
      const cached = loadCachedLesson(record.id, record.revision);
      if (!cached) throw new Error('lesson_unavailable_offline');
      value = { lesson: cached, revision: record.revision, status: record.status };
    }
    assertLesson(value.lesson);
    if (user && user.uid) setOpened({ ...value, lesson: value.lesson, owner_uid: user.uid });
  }
  const assignedForKid = (lessonId: string) =>
    assignments.some((a) => a.kid_id === selectedKid?.id && a.lesson_id === lessonId);
  function flush() {
    void flushQueue(async (batch) =>
      api('/events', { method: 'POST', body: JSON.stringify({ events: batch }) }),
    ).catch(() => {
      // Delivery is best-effort while offline; the next load, interval or online event retries.
    });
  }
  function recordEvent(event: Parameters<typeof enqueueEvent>[0]) {
    enqueueEvent(event);
    flush();
  }
  function retryJob() {
    if (!job) return;
    void perform(async () => {
      await api(`/jobs/${job.id}/retry`, { method: 'POST' });
      setJob({ id: job.id, stage: 'ingest', status: 'queued', progress: 0, error: null });
      await refresh();
    });
  }
  function unlockParentArea() {
    setUnlocked(true);
    sessionStorage.setItem('lessonbooks-parent-unlocked', '1');
  }
  async function submitPin() {
    setBusy(true);
    setPinError('');
    try {
      await api('/parent/pin/verify', {
        method: 'POST',
        body: JSON.stringify({ pin: pinInput }),
      });
      setPinInput('');
      unlockParentArea();
    } catch (error) {
      setPinError((error as { status?: number }).status === 429 ? t.pinLocked : t.pinWrong);
    } finally {
      setBusy(false);
    }
  }
  async function savePin() {
    setBusy(true);
    setPinError('');
    try {
      await api('/parent/pin', { method: 'POST', body: JSON.stringify({ pin: pinInput }) });
      setPinInput('');
      setPinFormOpen(false);
      setPinSet(true);
      unlockParentArea();
    } catch (error) {
      setPinError((error as { status?: number }).status === 429 ? t.pinLocked : t.pinWrong);
    } finally {
      setBusy(false);
    }
  }
  if (opened && user && opened.owner_uid === user.uid)
    return (
      <div>
        <nav className="preview-nav">
          <button onClick={() => setOpened(null)}>← {t.back}</button>
          {!kidView && (
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
          )}
        </nav>
        {error && <p role="alert">{error}</p>}
        <Player
          key={`${opened.lesson.id}-${opened.revision}`}
          lesson={opened.lesson}
          revision={opened.revision}
          {...(kidView ? { onEvent: recordEvent, savesProgress: true } : {})}
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
        {user && <button onClick={() => void signOut()}>{t.signOut}</button>}
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
          <section className="parent-card auth-card" aria-labelledby="signin-heading">
            <h2 id="signin-heading">{t.signIn}</h2>
            <p className="small">{t.signInNotice}</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void perform(() => signIn())}
            >
              {t.signIn}
            </button>
            <p className="small">{t.localNotice}</p>
          </section>
        </main>
      ) : (
        <main className="dashboard">
          <div className="dashboard-title">
            <span className="eyebrow">{t.parentSpace}</span>
            <h1>{selectedKid ? `${selectedKid.nickname} · ${t.library}` : t.library}</h1>
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
          ) : kidView && selectedKid ? (
            <section className="parent-card kid-play">
              <h2>{selectedKid.nickname}</h2>
              {kids.length > 1 && (
                <div className="kid-switcher" role="group" aria-label={t.children}>
                  {kids.map((kid) => (
                    <button
                      key={kid.id}
                      aria-pressed={kid.id === selectedKid.id}
                      onClick={() => {
                        setSelectedKidId(kid.id);
                        void refresh(kid.id).catch(() => setError(t.error));
                      }}
                    >
                      {kid.nickname}
                    </button>
                  ))}
                </div>
              )}
              <p>{t.kidPlayHelp}</p>
              {(() => {
                const approved = [
                  ...kidLessons.filter((lesson) => lesson.status === 'approved'),
                  ...cachedKidLessons.filter(
                    (cached) => !kidLessons.some((lesson) => lesson.id === cached.id),
                  ),
                ];
                const assigned = approved.filter((lesson) =>
                  assignments.some((a) => a.kid_id === selectedKid.id && a.lesson_id === lesson.id),
                );
                const rest = approved.filter((lesson) => !assigned.includes(lesson));
                return (
                  <>
                    {assigned.length > 0 && <h3>{t.assignedLabel}</h3>}
                    <div className="lesson-grid">
                      {[...assigned, ...rest].map((lesson) => (
                        <article className="lesson-tile" key={lesson.id}>
                          <span className="status">
                            {assigned.includes(lesson) ? t.assignedLabel : t.approved}
                          </span>
                          <h3>{lesson.summary}</h3>
                          <button onClick={() => void perform(() => open(lesson))}>
                            {t.open} →
                          </button>
                        </article>
                      ))}
                    </div>
                    {!approved.length && (
                      <div className="empty-state">
                        <span aria-hidden="true">✧</span>
                        <p>{t.empty}</p>
                      </div>
                    )}
                  </>
                );
              })()}
              <button
                disabled={busy}
                onClick={() => {
                  setKidView(false);
                  setOpened(null);
                  if (pinSet) {
                    setUnlocked(false);
                    sessionStorage.removeItem('lessonbooks-parent-unlocked');
                  }
                }}
              >
                {t.kidPlayExit}
              </button>
            </section>
          ) : pinSet && !unlocked ? (
            <section className="parent-card pin-gate">
              <h2>{t.pinGateTitle}</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitPin();
                }}
              >
                <label>
                  {t.pinGatePrompt}
                  <input
                    type="password"
                    inputMode="numeric"
                    required
                    pattern="[0-9]{4,8}"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                {pinError && (
                  <p role="alert" className="small">
                    {pinError}
                  </p>
                )}
                <button className="primary" disabled={busy}>
                  {t.pinEnter}
                </button>
              </form>
              {selectedKid && (
                <button
                  onClick={() => {
                    setKidView(true);
                    setPinInput('');
                  }}
                >
                  {t.kidPlay}
                </button>
              )}
            </section>
          ) : !kids.length || addingKid ? (
            <form
              className="parent-card profile-card"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  const created = await api<{ id: string }>('/kids', {
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
                  setSelectedKidId(created.id);
                  setAddingKid(false);
                  await refresh(created.id);
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
              {kids.length > 1 && (
                <div className="kid-switcher" role="group" aria-label={t.children}>
                  {kids.map((kid) => (
                    <button
                      key={kid.id}
                      aria-pressed={kid.id === selectedKid?.id}
                      onClick={() => {
                        setSelectedKidId(kid.id);
                        setJob(null);
                        setError('');
                        void refresh(kid.id).catch(() => setError(t.error));
                      }}
                    >
                      {kid.nickname}
                    </button>
                  ))}
                  <button className="add" onClick={() => setAddingKid(true)}>
                    {t.addChild} +
                  </button>
                </div>
              )}
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
                        `/books?kid_id=${selectedKid!.id}`,
                        {
                          method: 'POST',
                          headers: { 'Idempotency-Key': uploadKey || crypto.randomUUID() },
                          body: data,
                        },
                      );
                      setJob({
                        id: created.job_id,
                        stage: 'ingest',
                        status: 'queued',
                        progress: 0,
                        error: null,
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
                      onChange={(e) => {
                        const chosen = e.target.files?.[0] ?? null;
                        setFile(chosen);
                        if (!chosen) {
                          setUploadKey('');
                          return;
                        }
                        void chosen
                          .arrayBuffer()
                          .then((buffer) =>
                            crypto.subtle
                              .digest('SHA-256', buffer)
                              .then((digest) =>
                                setUploadKey(
                                  [...new Uint8Array(digest)]
                                    .map((b) => b.toString(16).padStart(2, '0'))
                                    .join(''),
                                ),
                              ),
                          );
                      }}
                    />
                  </label>
                  <button className="primary" disabled={busy || !file}>
                    {t.upload}
                  </button>
                </form>
              </section>
              {job && (
                <section className="parent-card job-card" role="status">
                  {job.status === 'failed' ? (
                    <>
                      <h2>{t.failed}</h2>
                      <p>{t.jobErrors[job.error ?? ''] ?? t.jobErrorFallback}</p>
                      <button className="primary" disabled={busy} onClick={retryJob}>
                        {t.retryJob}
                      </button>
                    </>
                  ) : (
                    <>
                      <h2>{stageLabels[job.stage] ?? t.generating}</h2>
                      <progress value={job.progress} max={100} aria-label={t.generating} />
                      <span>{job.progress}%</span>
                    </>
                  )}
                </section>
              )}
              {progress && progress.lessons.length > 0 && (
                <section className="parent-card progress-card">
                  <h2>{t.progressTitle}</h2>
                  <ul>
                    {progress.lessons.map((entry) => {
                      const lesson = lessons.find((item) => item.id === entry.lesson_id);
                      return (
                        <li key={entry.lesson_id}>
                          {lesson?.summary ?? entry.lesson_id} —{' '}
                          {t.completedCount.replace('{count}', String(entry.completed))} ·{' '}
                          {Math.round((entry.score / Math.max(entry.max_score, 1)) * 100)}%
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              <section className="library">
                <h2>{t.library}</h2>
                {!kidLessons.length ? (
                  <div className="empty-state">
                    <span aria-hidden="true">✧</span>
                    <p>{t.empty}</p>
                  </div>
                ) : (
                  <div className="lesson-grid">
                    {kidLessons.map((lesson, index) => (
                      <article className="lesson-tile" key={lesson.id}>
                        <span className="tile-number">{String(index + 1).padStart(2, '0')}</span>
                        <span className="status">
                          {lesson.status === 'approved' ? t.approved : t.draft}
                        </span>
                        <h3>{lesson.summary}</h3>
                        <button onClick={() => void perform(() => open(lesson))}>{t.open} →</button>
                        {lesson.status === 'approved' &&
                          (assignedForKid(lesson.id) ? (
                            <button
                              disabled={busy}
                              onClick={() => {
                                const record = assignments.find(
                                  (a) => a.kid_id === selectedKid?.id && a.lesson_id === lesson.id,
                                );
                                if (!record) return;
                                void perform(async () => {
                                  await api(`/assignments/${record.id}`, { method: 'DELETE' });
                                  await refresh();
                                });
                              }}
                            >
                              {t.unassign}
                            </button>
                          ) : (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void perform(async () => {
                                  await api('/assignments', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      kid_id: selectedKid!.id,
                                      lesson_id: lesson.id,
                                    }),
                                  });
                                  await refresh();
                                })
                              }
                            >
                              {t.assign}
                            </button>
                          ))}
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <footer className="data-controls">
                <p>{t.privacy}</p>
                {pinSet && <button onClick={() => setKidView(true)}>{t.kidPlay}</button>}
                {pinFormOpen ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void savePin();
                    }}
                  >
                    <label>
                      {pinSet ? t.pinChange : t.pinChoose}
                      <input
                        type="password"
                        inputMode="numeric"
                        required
                        pattern="[0-9]{4,8}"
                        value={pinInput}
                        onChange={(e) => setPinInput(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      {t.pinSave}
                    </button>
                  </form>
                ) : (
                  <button onClick={() => setPinFormOpen(true)}>
                    {pinSet ? t.pinChangeAction : t.pinSetAction}
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm(t.deleteConfirm))
                      void perform(async () => {
                        await api(`/kids/${selectedKid!.id}`, { method: 'DELETE' });
                        setSelectedKidId(null);
                        setJob(null);
                        await refresh();
                      });
                  }}
                >
                  {t.deleteChild.replace('{name}', selectedKid?.nickname ?? '')}
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
                  await signOut();
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
