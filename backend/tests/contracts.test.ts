import { describe, it, expect } from 'vitest';
import { assertLesson, scoreActivity, assertEvent } from '@lessonbooks/contracts';
import english from '../../doc/fixtures/lessons/english.json';
import arabic from '../../doc/fixtures/lessons/arabic.json';
import math from '../../doc/fixtures/lessons/math.json';

describe('shared contracts', () => {
  it.each([english, arabic, math])('validates the $id fixture', (value) =>
    expect(() => assertLesson(value)).not.toThrow(),
  );
  it('rejects unknown schema versions and executable content', () => {
    expect(() => assertLesson({ ...english, schema_version: '2.0.0' })).toThrow();
    expect(() => assertLesson({ ...english, html: '<script>alert(1)</script>' })).toThrow();
  });
  it('rejects inconsistent answer keys and duplicate activity identities', () => {
    const value: unknown = structuredClone(english);
    assertLesson(value);
    const first = value.sections[0]!.activities[0]!;
    if (first.type === 'multiple_choice') first.correct_answers = ['missing'];
    expect(() => assertLesson(value)).toThrow(/choice key/);
    value.sections[0]!.activities[1]!.id = first.id;
    expect(() => assertLesson(value)).toThrow(/Duplicate id/);
  });
  it('normalizes accepted Arabic digits and gives partial credit without rewarding invalid input', () => {
    const lesson: unknown = english;
    assertLesson(lesson);
    const activities = lesson.sections[0]!.activities;
    expect(scoreActivity(activities[2]!, { sum: ' ٢ ' }).correct).toBe(true);
    expect(scoreActivity(activities[3]!, { two: 'n2', three: 'n2' }).score).toBe(2);
    expect(scoreActivity(activities[0]!, ['three', 'three']).score).toBe(0);
    expect(scoreActivity(activities[2]!, { sum: '2', injected: 'x' }).score).toBe(0);
  });
  it('rejects malformed or impossible progress events', () => {
    const event = {
      event_id: 'event-1',
      schema_version: '1.0.0',
      lesson_id: 'english-counting',
      lesson_revision: 1,
      type: 'answered',
      timestamp: new Date().toISOString(),
    };
    expect(() => assertEvent(event)).toThrow();
    expect(() =>
      assertEvent({ ...event, activity_id: 'choose', score: 5, max_score: 4 }),
    ).toThrow();
    expect(() =>
      assertEvent({ ...event, activity_id: 'choose', score: 4, max_score: 4 }),
    ).not.toThrow();
  });
});
