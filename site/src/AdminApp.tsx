import { useEffect, useState } from 'react';
import { accessToken, loadSession, signIn, signOut, type ParentSession } from './auth';
import { strings } from './i18n';

const t = strings.en;

// The panel is a route of the parent site (ADR 0016). The realm role claim in the
// access token gates the UI; every admin capability is enforced server-side, so
// this check only decides what to render.
function decodeRoles(accessTokenValue: string): string[] {
  try {
    const part = accessTokenValue.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
      realm_access?: { roles?: unknown };
    };
    const roles = payload.realm_access?.roles;
    return Array.isArray(roles)
      ? roles.filter((role): role is string => typeof role === 'string')
      : [];
  } catch {
    return [];
  }
}

type AdminJob = {
  id: string;
  family_uid: string;
  stage: string;
  status: string;
  progress: number;
  error_code?: string;
  created_at: string;
};
type UsageTotals = {
  per_model: { model: string; purpose: string; calls: number; cost_usd: number }[];
  totals: { calls: number; cost_usd: number };
};
type AuditRow = { id: string; at: string; actor_uid: string; action: string; detail: string };
type FamilyView = {
  parent: { id: string; state: string };
  kids: { id: string; nickname: string; state: string }[];
  consents: { type?: string; granted_at?: string }[];
};
type DeletionCheck = {
  parent_state: string;
  counts: Record<string, number>;
  identity_exists: boolean | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error('signed_out');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`http://127.0.0.1:3001/v1${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('request_failed');
  return response.json() as Promise<T>;
}

export function AdminApp() {
  const [session, setSession] = useState<ParentSession | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<FamilyView | null>(null);
  const [deletion, setDeletion] = useState<DeletionCheck | null>(null);
  const [lessonId, setLessonId] = useState('');
  const [lessonJson, setLessonJson] = useState('');

  useEffect(() => {
    void loadSession().then((value) => {
      setSession(value);
      if (value) setRoles(decodeRoles(value.accessToken));
    });
  }, []);

  async function run(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch {
      setError(t.adminError);
    }
  }

  function refreshOps() {
    void run(async () => {
      const [jobsData, usageData, auditData] = await Promise.all([
        api<{ jobs: AdminJob[] }>('/admin/jobs?limit=50'),
        api<UsageTotals>('/admin/usage'),
        api<{ entries: AuditRow[] }>('/admin/audit?limit=20'),
      ]);
      setJobs(jobsData.jobs);
      setUsage(usageData);
      setAudit(auditData.entries);
    });
  }

  useEffect(() => {
    if (session && roles.includes('lessonbooks-admin')) refreshOps();
  }, [session, roles]);

  if (!session)
    return (
      <main className="parent-app">
        <header className="site-header">
          <span className="brand">✳ {t.brand}</span>
        </header>
        <section className="parent-card auth-card">
          <h2>{t.adminTitle}</h2>
          <p className="small">{t.adminNotice}</p>
          <button className="primary" onClick={() => void signIn()}>
            {t.signIn}
          </button>
        </section>
      </main>
    );

  if (!roles.includes('lessonbooks-admin'))
    return (
      <main className="parent-app">
        <header className="site-header">
          <span className="brand">✳ {t.brand}</span>
          <button onClick={() => void signOut()}>{t.signOut}</button>
        </header>
        <section className="parent-card">
          <h2>{t.adminTitle}</h2>
          <p className="small">{t.adminNotOperator}</p>
        </section>
      </main>
    );

  return (
    <main className="parent-app">
      <header className="site-header">
        <span className="brand">✳ {t.brand}</span>
        <span className="edition">{t.adminTitle}</span>
        <button onClick={() => void signOut()}>{t.signOut}</button>
      </header>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <section className="parent-card">
        <h2>{t.adminJobs}</h2>
        <button onClick={() => refreshOps()}>{t.adminRefresh}</button>
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <code>{job.id.slice(0, 8)}</code> — {job.status} · {job.stage} ·{' '}
              {Math.round(job.progress)}% · {job.family_uid.slice(0, 8)}
              {job.error_code ? ` · ${job.error_code}` : ''}
              {job.status === 'failed' && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(`/admin/jobs/${job.id}/retry`, { method: 'POST' });
                      refreshOps();
                    })
                  }
                >
                  {t.adminRetry}
                </button>
              )}
            </li>
          ))}
          {!jobs.length && <li>{t.adminEmpty}</li>}
        </ul>
      </section>
      <section className="parent-card">
        <h2>{t.adminUsage}</h2>
        {usage && (
          <p className="small">
            {t.adminUsageCalls}: {usage.totals.calls} · {t.adminUsageCost}:{' '}
            {usage.totals.cost_usd.toFixed(2)}
          </p>
        )}
        {usage && (
          <ul>
            {usage.per_model.map((entry) => (
              <li key={`${entry.model}:${entry.purpose}`}>
                {entry.model} · {entry.purpose} — {entry.calls} ({entry.cost_usd.toFixed(2)})
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="parent-card">
        <h2>{t.adminAudit}</h2>
        <ul>
          {audit.map((entry) => (
            <li key={entry.id}>
              {entry.at} — {entry.actor_uid.slice(0, 8)} · {entry.action} ·{' '}
              <code>{entry.detail}</code>
            </li>
          ))}
          {!audit.length && <li>{t.adminEmpty}</li>}
        </ul>
      </section>
      <section className="parent-card">
        <h2>{t.adminFamily}</h2>
        <label>
          {t.adminFamilyId}
          <input value={familyId} onChange={(event) => setFamilyId(event.target.value)} />
        </label>
        <button
          onClick={() =>
            void run(async () => {
              setDeletion(null);
              setLessonJson('');
              setFamily(await api<FamilyView>(`/admin/families/${encodeURIComponent(familyId)}`));
            })
          }
        >
          {t.adminView}
        </button>
        <button
          onClick={() =>
            void run(async () => {
              setDeletion(
                await api<DeletionCheck>(
                  `/admin/families/${encodeURIComponent(familyId)}/deletion-check`,
                ),
              );
            })
          }
        >
          {t.adminDeletionCheck}
        </button>
        <button
          onClick={() =>
            void run(async () => {
              const data = await api<unknown>(
                `/admin/families/${encodeURIComponent(familyId)}/export`,
              );
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `family-${familyId}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          {t.adminExport}
        </button>
        {family && (
          <div>
            <p className="small">
              {family.parent.id} · {family.parent.state} · {family.kids.length} {t.adminKids}
            </p>
            <ul>
              {family.kids.map((kid) => (
                <li key={kid.id}>
                  {kid.nickname} — {kid.state}
                </li>
              ))}
            </ul>
            <p className="small">{family.consents.map((consent) => consent.type).join(', ')}</p>
          </div>
        )}
        {deletion && (
          <p className="small">
            {t.adminDeletionState}: {deletion.parent_state} · {t.adminIdentityExists}:{' '}
            {String(deletion.identity_exists)}
          </p>
        )}
        <label>
          {t.adminLessonId}
          <input value={lessonId} onChange={(event) => setLessonId(event.target.value)} />
        </label>
        <button
          onClick={() =>
            void run(async () => {
              const view = await api<{ lesson: unknown }>(
                `/admin/families/${encodeURIComponent(familyId)}/lessons/${encodeURIComponent(lessonId)}`,
              );
              setLessonJson(JSON.stringify(view.lesson, null, 2));
            })
          }
        >
          {t.adminView}
        </button>
        {lessonJson && <pre className="small">{lessonJson}</pre>}
      </section>
    </main>
  );
}
