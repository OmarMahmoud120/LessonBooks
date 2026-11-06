import { createRoot } from 'react-dom/client';
import { assertLesson } from '@lessonbooks/contracts';
import { ParentApp } from './ParentApp';
import { AdminApp } from './AdminApp';
import { Player } from './player/Player';
import english from '../../doc/fixtures/lessons/english.json';
import arabic from '../../doc/fixtures/lessons/arabic.json';
import math from '../../doc/fixtures/lessons/math.json';
const sample = new URLSearchParams(location.search).get('example');
const fixture: unknown = sample === 'arabic' ? arabic : sample === 'math' ? math : english;
if (sample) assertLesson(fixture);
const root = document.getElementById('root');
if (!root) throw new Error('Missing app root');
createRoot(root).render(
  location.pathname === '/admin' ? (
    <AdminApp />
  ) : sample ? (
    <Player lesson={fixture as Parameters<typeof Player>[0]['lesson']} />
  ) : (
    <ParentApp />
  ),
);
