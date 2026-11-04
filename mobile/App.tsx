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
import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  inMemoryPersistence,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import * as DocumentPicker from 'expo-document-picker';
import { uploadCopies } from './src/nativeUploadCopies';
import { assertLesson, type Lesson } from '@lessonbooks/contracts';
import { LessonPreview } from './src/LessonPreview';
import { strings } from '../site/src/i18n';
const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
// This synthetic preview intentionally signs out when the native process ends.
const auth = initializeAuth(
  initializeApp({ apiKey: 'demo-lessonbooks', projectId: 'demo-lessonbooks' }),
  { persistence: inMemoryPersistence },
);
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
const t = strings.en;
type Summary = {
  id: string;
  kid_id: string;
  summary: string;
  revision: number;
  status: string;
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
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [kid, setKid] = useState<{ id: string; nickname: string } | null>(null);
  const [kidsList, setKidsList] = useState<{ id: string; nickname: string }[]>([]);
  const [consent, setConsent] = useState(false);
  const [lessons, setLessons] = useState<Summary[]>([]);
  const [opened, setOpened] = useState<{
    lesson: Lesson;
    revision: number;
    status: string;
    owner_uid: string;
  } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await auth.currentUser?.getIdToken();
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
    if (!response.ok) throw new Error('request_failed');
    return response.json() as Promise<T>;
  }
  async function refresh() {
    const owner = auth.currentUser?.uid;
    const family = await api<{
      kids: { id: string; nickname: string }[];
      consents: { type: string }[];
    }>('/family');
    if (!owner || owner !== auth.currentUser?.uid) return;
    setKidsList(family.kids);
    setKid((current) => family.kids.find((k) => k.id === current?.id) ?? family.kids[0] ?? null);
    setConsent(
      ['privacy', 'content_rights'].every((type) => family.consents.some((c) => c.type === type)),
    );
    const summaries = await api<Summary[]>('/lessons');
    if (owner === auth.currentUser?.uid) setLessons(summaries);
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
  useEffect(() => {
    void uploadCopies.cleanup().catch(() => setStatus(t.error));
  }, []);
  useEffect(
    () =>
      onAuthStateChanged(auth, (current) => {
        setUser(current);
        setOpened(null);
        setKid(null);
        setLessons([]);
      }),
    [],
  );
  useEffect(() => {
    if (!user) return;
    void refresh().catch(() => setStatus(t.error));
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [user]);
  if (opened && user && opened.owner_uid === user.uid)
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.controls}>
          <Button title={t.back} onPress={() => setOpened(null)} />
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
        </View>
        <LessonPreview lesson={opened.lesson} revision={opened.revision} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>{t.brand}</Text>
        <Text>{t.notice}</Text>
        <Text accessibilityLiveRegion="polite">{status}</Text>
        {!user ? (
          <>
            <Text style={styles.heading}>{t.signIn}</Text>
            <Text>{t.email}</Text>
            <TextInput
              accessibilityLabel={t.email}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Text>{t.password}</Text>
            <TextInput
              accessibilityLabel={t.password}
              style={styles.input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Button
              title={t.signIn}
              disabled={busy}
              onPress={() => void perform(() => signInWithEmailAndPassword(auth, email, password))}
            />
            <Button
              title={t.signUp}
              disabled={busy}
              onPress={() =>
                void perform(() => createUserWithEmailAndPassword(auth, email, password))
              }
            />
          </>
        ) : (
          <>
            <Button title={t.signOut} onPress={() => void signOut(auth)} />
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
            ) : !kid ? (
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
                        await api('/kids', {
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
                        await refresh();
                      })
                    }
                  />
                ))}
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
                        onPress={() => setKid(candidate)}
                      />
                    ))}
                  </View>
                )}
                <Text>{t.uploadHelp}</Text>
                <Button
                  title={t.choosePDF}
                  disabled={busy}
                  onPress={() =>
                    void perform(() =>
                      uploadCopies.run(async () => {
                        const owner = auth.currentUser?.uid;
                        const chosen = await DocumentPicker.getDocumentAsync({
                          type: 'application/pdf',
                          copyToCacheDirectory: true,
                        });
                        if (chosen.canceled) return;
                        if (!owner || auth.currentUser?.uid !== owner)
                          throw new Error('signed_out');
                        const file = chosen.assets[0]!;
                        const data = new FormData();
                        data.append('book', {
                          uri: file.uri,
                          name: 'book.pdf',
                          type: 'application/pdf',
                        } as unknown as Blob);
                        await api(`/books?kid_id=${kid.id}`, {
                          method: 'POST',
                          headers: {
                            'Idempotency-Key': `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                          },
                          body: data,
                        });
                        setStatus(t.generating);
                      }),
                    )
                  }
                />
                {lessons
                  .filter((lesson) => lesson.kid_id === kid?.id)
                  .map((lesson) => (
                    <View key={lesson.id} style={styles.card}>
                      <Text style={styles.heading}>{lesson.summary}</Text>
                      <Text>{lesson.status === 'approved' ? t.approved : t.draft}</Text>
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
                            if (auth.currentUser?.uid === user?.uid && user)
                              setOpened({ ...value, lesson: value.lesson, owner_uid: user.uid });
                          })
                        }
                      />
                    </View>
                  ))}
                <Button
                  title={t.deleteChild}
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
                        await signOut(auth);
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
