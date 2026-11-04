import { createRoot } from 'react-dom/client';
import { assertLesson, type LessonEvent } from '@lessonbooks/contracts';
import { Player } from './Player';
const root = createRoot(document.getElementById('root')!);
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}
const emit = (event: LessonEvent) => window.ReactNativeWebView?.postMessage(JSON.stringify(event));
let loaded = false;
function load(event: MessageEvent) {
  // The native host injects data into this document; parent tokens never enter the player.
  if (event.source && event.source !== window) return;
  try {
    const data: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (
      !data ||
      typeof data !== 'object' ||
      !('type' in data) ||
      data.type !== 'load_lesson' ||
      !('lesson' in data) ||
      !('revision' in data) ||
      !Number.isInteger(data.revision) ||
      Number(data.revision) < 1 ||
      loaded
    )
      return;
    assertLesson(data.lesson);
    loaded = true;
    root.render(<Player lesson={data.lesson} revision={Number(data.revision)} onEvent={emit} />);
  } catch {
    root.render(<p role="alert">Unable to load this lesson.</p>);
  }
}
window.addEventListener('message', load);
document.addEventListener('message', load as EventListener);
window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'player_ready' }));
