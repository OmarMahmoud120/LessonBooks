import { assertEvent, type LessonEvent } from '@lessonbooks/contracts';
export function parsePlayerMessage(
  raw: string,
  lessonId: string,
  revision: number,
): LessonEvent | 'ready' {
  if (raw.length > 16000) throw new Error('Oversized player message');
  const value: unknown = JSON.parse(raw);
  if (
    value &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'player_ready' &&
    Object.keys(value).length === 1
  )
    return 'ready';
  assertEvent(value);
  if (value.lesson_id !== lessonId || value.lesson_revision !== revision)
    throw new Error('Player identity mismatch');
  return value;
}
export function loadLessonScript(lesson: unknown, revision: number, savesProgress = false): string {
  const data = JSON.stringify({ type: 'load_lesson', lesson, revision, savesProgress })
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  return `window.dispatchEvent(new MessageEvent('message', {data: ${data}})); true;`;
}
