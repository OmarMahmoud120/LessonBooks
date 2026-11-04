import { it, expect } from 'vitest';
import { parsePlayerMessage, loadLessonScript } from '../src/bridge';
it('rejects oversized, malformed and cross-lesson messages', () => {
  expect(() => parsePlayerMessage('x'.repeat(16001), 'lesson', 1)).toThrow();
  expect(() => parsePlayerMessage('{', 'lesson', 1)).toThrow();
  const event = {
    schema_version: '1.0.0',
    event_id: 'event',
    lesson_id: 'other',
    lesson_revision: 1,
    type: 'started',
    timestamp: new Date().toISOString(),
  };
  expect(() => parsePlayerMessage(JSON.stringify(event), 'lesson', 1)).toThrow(/identity/);
  expect(parsePlayerMessage('{"type":"player_ready"}', 'lesson', 1)).toBe('ready');
});
it('encodes lesson data so text cannot terminate an injected script', () => {
  const script = loadLessonScript({ text: '</script><script>attack()</script>' }, 1);
  expect(script).not.toContain('</script>');
  expect(script).toContain('\\u003c');
});
