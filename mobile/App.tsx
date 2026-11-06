import { useEffect, useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  Button,
  View,
  StyleSheet,
  StatusBar,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { accessToken, signIn, signOut, subscribe, type ParentSession } from './src/auth';
import { uploadCopies } from './src/nativeUploadCopies';
import { assertLesson, type Lesson } from '@lessonbooks/contracts';
import { LessonPreview } from './src/LessonPreview';
import { strings } from '../site/src/i18n';
const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
// This synthetic preview intentionally signs out when the native process ends.
const t = strings.en;
type Summary = {
  id: string;
  kid_id: string;
  summary: string;
  revision: number;
  status: string;
};
type Assignment = { id: string; kid_id: string; lesson_id: string; revision: number };
type KidProgress = {
  kid_id: string;
  lessons: {
    lesson_id: string;
    started: number;
    completed: number;
    score: number;
    max_score: number;
    last_client_at: string;
  }[];
};
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <ParentPreview />
    </SafeAreaProvider>
  );
}

function ParentPreview() {
  const [user, setUser] = useState<ParentSession | null>(null);
  const [nickname, setNickname] = useState('');
  const [kid, setKid] = useState<{ id: string; nickname: string } | null>(null);
  const [kidsList, setKidsList] = useState<{ id: string; nickname: string }[]>([]);
  const [profileMode, setProfileMode] = useState(false);
  const [childMode, setChildMode] = useState(false);
  const [consent, setConsent] = useState(false);
  const [lessons, setLessons] = useState<Summary[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [progress, setProgress] = useState<KidProgress | null>(null);
  const [opened, setOpened] = useState<{
    lesson: Lesson;
    revision: number;
    status: string;
    owner_uid: string;
  } | null>(null);
  const [status, setStatus] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobView, setJobView] = useState<{
    status: string;
    progress: number;
    error: string | null;
  } | null>(null);
  const [uploadAsset, setUploadAsset] = useState<{ uri: string; name: string } | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [uploadKey, setUploadKey] = useState('');
  const [busy, setBusy] = useState(false);
  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await accessToken();
    if (!token) throw new Error('signed_out');
    const response = await fetch(`http://${host}:3001/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const failure = new Error('request_failed') as Error & { status?: number };
      failure.status = response.status;
      throw failure;
    }
    return response.json() as Promise<T>;
  }
  async function refresh() {
    const owner = user?.uid;
    const family = await api<{
      kids: { id: string; nickname: string }[];
      consents: { type: string }[];
      pin_set: boolean;
    }>('/family');
    if (!owner || owner !== user?.uid) return;
    setPinSet(family.pin_set);
    setKidsList(family.kids);
    setKid((current) => family.kids.find((k) => k.id === current?.id) ?? family.kids[0] ?? null);
    setConsent(
      ['privacy', 'content_rights'].every((type) => family.consents.some((c) => c.type === type)),
    );
    const summaries = await api<Summary[]>('/lessons');
    if (owner !== user?.uid) return;
    setLessons(summaries);
    const list = await api<Assignment[]>('/assignments');
    if (owner !== user?.uid) return;
    setAssignments(list);
    const selected = family.kids.find((k) => k.id === kid?.id) ?? family.kids[0];
    if (selected) setProgress(await api(`/kids/${selected.id}/progress`));
    else setProgress(null);
  }
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch {
      setStatus(t.error);
    } finally {
      setBusy(false);
    }
  }
  function clearTransient() {
    setStatus('');
    setOpened(null);
    setJobId(null);
    setJobView(null);
    setUploadAsset(null);
    setUploadKey('');
    setUnlocked(false);
    setPinInput('');
    setPinError('');
    setPinFormOpen(false);
  }
  useEffect(() => {
    void uploadCopies.cleanup().catch(() => setStatus(t.error));
  }, []);
  useEffect(
    () =>
      subscribe((current) => {
        setUser(current);
        clearTransient();
        setKid(null);
        setKidsList([]);
        setLessons([]);
        setAssignments([]);
        setProgress(null);
        setProfileMode(false);
        setChildMode(false);
        setNickname('');
        setStatus('');
      }),
    [],
  );
  useEffect(() => {
    if (!user) return;
    void refresh().catch(() => setStatus(t.error));
    // The periodic refresh re-renders the dashboard and breaks controlled text input
    // mid-typing; pause it while a form is open.
    if (pinFormOpen) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [user, pinFormOpen]);
  useEffect(() => {
    if (!jobId || !user || ['completed', 'failed', 'cancelled'].includes(jobView?.status ?? ''))
      return;
    const timer = setInterval(() => {
      void api<{ status: string; progress: number; error: string | null }>(`/jobs/${jobId}`)
        .then((next) => {
          setJobView(next);
          if (next.status === 'completed') {
            setStatus('');
            void refresh().catch(() => {});
          } else if (next.status === 'failed') {
            setStatus(t.jobErrors[next.error ?? ''] ?? t.jobErrorFallback);
          } else setStatus(`${t.generating} ${next.progress}%`);
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [jobId, jobView?.status, user]);
  async function submitPin() {
    setBusy(true);
    setPinError('');
    try {
      await api('/parent/pin/verify', {
        method: 'POST',
        body: JSON.stringify({ pin: pinInput }),
      });
      setPinInput('');
      setUnlocked(true);
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
      setUnlocked(true);
    } catch (error) {
      setPinError((error as { status?: number }).status === 429 ? t.pinLocked : t.pinWrong);
    } finally {
      setBusy(false);
    }
  }
  async function runUpload(asset: { uri: string; name: string }, key: string, kidId: string) {
    const data = new FormData();
    data.append('book', {
      uri: asset.uri,
      name: asset.name,
      type: 'application/pdf',
    } as unknown as Blob);
    const created = await api<{ job_id: string }>(`/books?kid_id=${kidId}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: data,
    });
    setJobId(created.job_id);
    setJobView({ status: 'queued', progress: 0, error: null });
    setStatus(t.generating);
  }
  function recordEvent(
    event: Parameters<NonNullable<Parameters<typeof LessonPreview>[0]['onEvent']>>[0],
  ) {
    void perform(async () => {
      await api('/events', {
        method: 'POST',
        body: JSON.stringify({ events: [event] }),
      });
    });
  }
  if (opened && user && opened.owner_uid === user.uid)
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.controls}>
          <Button
            title={t.back}
            onPress={() => {
              setOpened(null);
              setStatus('');
              void refresh().catch(() => {});
            }}
          />
          {!childMode && (
            <Button
              title={opened.status === 'approved' ? t.approved : t.approve}
              disabled={busy || opened.status === 'approved'}
              onPress={() =>
                void perform(async () => {
                  await api(`/lessons/${opened.lesson.id}/approve`, {
                    method: 'POST',
                    body: JSON.stringify({ revision: opened.revision }),
                  });
                  setOpened({ ...opened, status: 'approved' });
                })
              }
            />
          )}
        </View>
        <LessonPreview
          lesson={opened.lesson}
          revision={opened.revision}
          {...(childMode ? { onEvent: recordEvent, savesProgress: true } : {})}
        />
      </SafeAreaView>
    );
  const kidAssignments = assignments.filter((a) => a.kid_id === kid?.id);
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>{t.brand}</Text>
        <Text>{t.notice}</Text>
        <Text accessibilityLiveRegion="polite">{status}</Text>
        {jobView?.status === 'failed' && uploadAsset && kid && uploadKey && (
          <Button
            title={t.retryJob}
            disabled={busy}
            onPress={() =>
              void perform(async () => {
                await api(`/jobs/${jobId}/retry`, { method: 'POST' });
                setStatus(t.retryStarted);
                await runUpload(uploadAsset, uploadKey, kid.id);
              })
            }
          />
        )}
        {!user ? (
          <>
            <Text style={styles.heading}>{t.signIn}</Text>
            <Text>{t.signInNotice}</Text>
            <Button title={t.signIn} disabled={busy} onPress={() => void perform(signIn)} />
          </>
        ) : (
          <>
            <Button
              title={t.signOut}
              onPress={() => {
                clearTransient();
                signOut();
              }}
            />
            {!consent ? (
              <>
                <Text style={styles.heading}>{t.consentTitle}</Text>
                <Text>{t.privacy}</Text>
                <Text>{t.consent}</Text>
                <Text>{t.rights}</Text>
                <Button
                  title={t.saveConsent}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(t.consentTitle, `${t.consent}\n\n${t.rights}`, [
                      { text: t.back, style: 'cancel' },
                      {
                        text: t.saveConsent,
                        onPress: () =>
                          void perform(async () => {
                            for (const type of ['privacy', 'content_rights'])
                              await api('/consents', {
                                method: 'POST',
                                body: JSON.stringify({
                                  type,
                                  version: '2026-11-03',
                                  granted: true,
                                }),
                              });
                            await refresh();
                          }),
                      },
                    ])
                  }
                />
              </>
            ) : pinSet && !unlocked && !childMode ? (
              <>
                <Text style={styles.heading}>{t.pinGateTitle}</Text>
                <Text>{t.pinGatePrompt}</Text>
                <TextInput
                  style={styles.input}
                  accessibilityLabel={t.pinGatePrompt}
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={8}
                  value={pinInput}
                  onChangeText={setPinInput}
                />
                {pinError ? <Text accessibilityLiveRegion="assertive">{pinError}</Text> : null}
                <Button
                  title={t.pinEnter}
                  disabled={busy || pinInput.length < 4}
                  onPress={() => void submitPin()}
                />
                {kid && <Button title={t.kidPlay} onPress={() => setChildMode(true)} />}
              </>
            ) : !kid || profileMode ? (
              <>
                <Text style={styles.heading}>{t.childTitle}</Text>
                <Text>{t.nicknameHelp}</Text>
                <TextInput
                  style={styles.input}
                  accessibilityLabel={t.nickname}
                  maxLength={30}
                  value={nickname}
                  onChangeText={setNickname}
                />
                {(['year-1', 'year-2'] as const).map((grade) => (
                  <Button
                    key={grade}
                    title={`${t.addChild} · ${grade === 'year-1' ? t.year1 : t.year2}`}
                    disabled={busy || !nickname}
                    onPress={() =>
                      void perform(async () => {
                        const created = await api<{ id: string }>('/kids', {
                          method: 'POST',
                          body: JSON.stringify({
                            nickname,
                            avatar: 'fox',
                            grade_id: grade,
                            age_band: grade === 'year-1' ? '5-7' : '6-8',
                            country: 'GB-ENG',
                            language: 'en-GB',
                            curriculum_id: 'england-national-2014',
                            reading_level: 'emerging',
                          }),
                        });
                        setNickname('');
                        setProfileMode(false);
                        setKid({ id: created.id, nickname });
                        await refresh();
                      })
                    }
                  />
                ))}
                {profileMode && <Button title={t.back} onPress={() => setProfileMode(false)} />}
              </>
            ) : childMode ? (
              <>
                <Text style={styles.heading}>{kid.nickname}</Text>
                {kidsList.length > 1 && (
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                    accessibilityLabel={t.children}
                  >
                    {kidsList.map((candidate) => (
                      <Button
                        key={candidate.id}
                        title={
                          candidate.id === kid.id ? `• ${candidate.nickname}` : candidate.nickname
                        }
                        onPress={() => {
                          setKid(candidate);
                          setStatus('');
                        }}
                      />
                    ))}
                  </View>
                )}
                <Text>{t.kidPlayHelp}</Text>
                {(() => {
                  const approved = lessons.filter(
                    (lesson) => lesson.kid_id === kid.id && lesson.status === 'approved',
                  );
                  const assigned = approved.filter((lesson) =>
                    kidAssignments.some((a) => a.lesson_id === lesson.id),
                  );
                  const rest = approved.filter((lesson) => !assigned.includes(lesson));
                  return [...assigned, ...rest].map((lesson) => (
                    <View key={lesson.id} style={styles.card}>
                      <Text style={styles.heading}>{lesson.summary}</Text>
                      <Text>{assigned.includes(lesson) ? t.assignedLabel : t.approved}</Text>
                      <Button
                        title={t.open}
                        onPress={() =>
                          void perform(async () => {
                            const value = await api<{
                              lesson: unknown;
                              revision: number;
                              status: string;
                            }>(`/lessons/${lesson.id}`);
                            assertLesson(value.lesson);
                            if (user && user.uid)
                              setOpened({ ...value, lesson: value.lesson, owner_uid: user.uid });
                          })
                        }
                      />
                    </View>
                  ));
                })()}
                <Button
                  title={t.kidPlayExit}
                  onPress={() => {
                    setChildMode(false);
                    setStatus('');
                    if (pinSet) setUnlocked(false);
                  }}
                />
              </>
            ) : (
              <>
                <Text style={styles.heading}>{kid.nickname}</Text>
                {kidsList.length > 1 && (
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                    accessibilityLabel={t.children}
                  >
                    {kidsList.map((candidate) => (
                      <Button
                        key={candidate.id}
                        title={
                          candidate.id === kid.id ? `• ${candidate.nickname}` : candidate.nickname
                        }
                        onPress={() => {
                          setKid(candidate);
                          setStatus('');
                        }}
                      />
                    ))}
                  </View>
                )}
                <Button title={t.kidPlay} onPress={() => setChildMode(true)} />
                {pinFormOpen ? (
                  <>
                    <Text>{pinSet ? t.pinChange : t.pinChoose}</Text>
                    <TextInput
                      style={styles.input}
                      accessibilityLabel={t.pinSave}
                      secureTextEntry
                      onChangeText={setPinInput}
                    />
                    <Button
                      title={t.pinSave}
                      disabled={busy || pinInput.length < 4}
                      onPress={() => void savePin()}
                    />
                  </>
                ) : (
                  <Button
                    title={pinSet ? t.pinChangeAction : t.pinSetAction}
                    onPress={() => {
                      setPinInput('');
                      setPinError('');
                      setPinFormOpen(true);
                    }}
                  />
                )}
                <Text>{t.uploadHelp}</Text>
                <Button
                  title={t.choosePDF}
                  disabled={busy}
                  onPress={() =>
                    void perform(() =>
                      uploadCopies.run(async () => {
                        const owner = user?.uid;
                        const chosen = await DocumentPicker.getDocumentAsync({
                          type: 'application/pdf',
                          copyToCacheDirectory: true,
                        });
                        if (chosen.canceled) return;
                        if (!owner || user?.uid !== owner) throw new Error('signed_out');
                        const file = chosen.assets[0]!;
                        const key = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        setUploadAsset({ uri: file.uri, name: 'book.pdf' });
                        setUploadKey(key);
                        await runUpload({ uri: file.uri, name: 'book.pdf' }, key, kid.id);
                      }),
                    )
                  }
                />
                <Button title={`${t.addChild} +`} onPress={() => setProfileMode(true)} />
                {progress && progress.lessons.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.heading}>{t.progressTitle}</Text>
                    {progress.lessons.map((entry) => {
                      const lesson = lessons.find((item) => item.id === entry.lesson_id);
                      return (
                        <Text key={entry.lesson_id}>
                          {lesson?.summary ?? entry.lesson_id} —{' '}
                          {t.completedCount.replace('{count}', String(entry.completed))} ·{' '}
                          {Math.round((entry.score / Math.max(entry.max_score, 1)) * 100)}%
                        </Text>
                      );
                    })}
                  </View>
                )}
                {lessons
                  .filter((lesson) => lesson.kid_id === kid?.id)
                  .map((lesson) => {
                    const assignment = kidAssignments.find((a) => a.lesson_id === lesson.id);
                    return (
                      <View key={lesson.id} style={styles.card}>
                        <Text style={styles.heading}>{lesson.summary}</Text>
                        <Text>
                          {assignment
                            ? t.assignedLabel
                            : lesson.status === 'approved'
                              ? t.approved
                              : t.draft}
                        </Text>
                        <Button
                          title={t.open}
                          onPress={() =>
                            void perform(async () => {
                              const value = await api<{
                                lesson: unknown;
                                revision: number;
                                status: string;
                              }>(`/lessons/${lesson.id}`);
                              assertLesson(value.lesson);
                              if (user && user.uid)
                                setOpened({ ...value, lesson: value.lesson, owner_uid: user.uid });
                            })
                          }
                        />
                        {lesson.status === 'approved' &&
                          (assignment ? (
                            <Button
                              title={t.unassign}
                              disabled={busy}
                              onPress={() =>
                                void perform(async () => {
                                  await api(`/assignments/${assignment.id}`, { method: 'DELETE' });
                                  await refresh();
                                })
                              }
                            />
                          ) : (
                            <Button
                              title={t.assign}
                              disabled={busy}
                              onPress={() =>
                                void perform(async () => {
                                  await api('/assignments', {
                                    method: 'POST',
                                    body: JSON.stringify({ kid_id: kid.id, lesson_id: lesson.id }),
                                  });
                                  await refresh();
                                })
                              }
                            />
                          ))}
                      </View>
                    );
                  })}
                <Button
                  title={t.deleteChild.replace('{name}', kid.nickname)}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(t.deleteConfirm, '', [
                      { text: t.back, style: 'cancel' },
                      {
                        text: t.deleteChild,
                        style: 'destructive',
                        onPress: () =>
                          void perform(async () => {
                            await api(`/kids/${kid.id}`, { method: 'DELETE' });
                            setProgress(null);
                            await refresh();
                          }),
                      },
                    ])
                  }
                />
              </>
            )}
            <Button
              title={t.deleteAccount}
              disabled={busy}
              onPress={() =>
                Alert.alert(t.deleteAccountConfirm, '', [
                  { text: t.back, style: 'cancel' },
                  {
                    text: t.deleteAccount,
                    style: 'destructive',
                    onPress: () =>
                      void perform(async () => {
                        await api('/account', { method: 'DELETE' });
                        signOut();
                      }),
                  },
                ])
              }
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8f5ee' },
  content: { padding: 24, gap: 20 },
  brand: { fontSize: 30, color: '#244e47', fontWeight: '700' },
  heading: { fontSize: 22, color: '#233d43' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#8a9994',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  card: { padding: 20, borderWidth: 1, borderColor: '#d5dcce', borderRadius: 18, gap: 16 },
  controls: { padding: 16, gap: 8 },
});
