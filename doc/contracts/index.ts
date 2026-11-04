import type { ValidateFunction } from 'ajv';
import { validateLesson as rawLesson, validateEvent as rawEvent } from './generated/validators.cjs';
import lessonSchema from '../specs/lesson/v1.schema.json';
import eventSchema from '../specs/events/v1.schema.json';
import type { Lesson } from './generated/lesson';
import type { LessonEvent } from './generated/events';
export type { Lesson, LessonEvent };
export type Activity = Lesson['sections'][number]['activities'][number];
export type ContentBlock = Lesson['sections'][number]['blocks'][number];
export type LocalizedText = Lesson['metadata']['title'];
export { lessonSchema, eventSchema };

export const validateLesson = rawLesson as ValidateFunction<Lesson>;
export const validateEvent = rawEvent as ValidateFunction<LessonEvent>;
export const PHASE_ONE_TYPES = [
  'multiple_choice',
  'true_false',
  'fill_in_the_blank',
  'drag_to_match',
  'categorize',
] as const;
export function textFor(text: LocalizedText, locale: string): string {
  return text[locale] ?? text[locale.split('-')[0] ?? locale] ?? Object.values(text)[0] ?? '';
}
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[٠-٩]/g, (n) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(n)))
    .replaceAll(/\s+/g, ' ');
}
export function assertLesson(value: unknown, phaseOne = true): asserts value is Lesson {
  if (!validateLesson(value))
    throw new Error(`Invalid lesson schema: ${JSON.stringify(validateLesson.errors)}`);
  const errors = semanticErrors(value, phaseOne);
  if (errors.length) throw new Error(`Invalid lesson semantics: ${errors.join('; ')}`);
}
export function semanticErrors(lesson: Lesson, phaseOne = true): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) errors.push(`Duplicate id ${id}`);
    ids.add(id);
  };
  if (lesson.metadata.age_range.min > lesson.metadata.age_range.max)
    errors.push('Invalid age range');
  const rtl = /^(ar|he|fa|ur)(-|$)/.test(lesson.metadata.language);
  if (rtl !== (lesson.metadata.direction === 'rtl')) errors.push('Language/direction mismatch');
  const visitText = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visitText);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const entries = Object.entries(value);
    if (
      entries.length &&
      entries.every(
        ([key, item]) => /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(key) && typeof item === 'string',
      ) &&
      !('id' in value)
    ) {
      if (!(lesson.metadata.language in value))
        errors.push('Missing lesson locale in localized text');
    }
    entries.forEach(([, item]) => visitText(item));
  };
  // Check localized text at known fields; answer maps are not localization maps.
  [lesson.metadata.title, ...lesson.metadata.learning_objectives].forEach((t) => {
    if (!t[lesson.metadata.language]) errors.push('Missing metadata locale');
  });
  for (const section of lesson.sections) {
    unique(section.id);
    if (!section.title[lesson.metadata.language]) errors.push('Missing section locale');
    section.blocks.forEach(visitText);
    for (const activity of section.activities) {
      unique(activity.id);
      if (phaseOne && !(PHASE_ONE_TYPES as readonly string[]).includes(activity.type))
        errors.push(`Unsupported activity ${activity.type}`);
      [activity.prompt, ...Object.values(activity.feedback)].forEach((t) => {
        if (!t[lesson.metadata.language]) errors.push(`Missing activity locale ${activity.id}`);
      });
      const checkOptions = (options: { id: string; text: LocalizedText }[]) => {
        const optionIds = options.map((o) => o.id);
        if (new Set(optionIds).size !== optionIds.length)
          errors.push(`Duplicate option in ${activity.id}`);
        if (options.some((o) => !o.text[lesson.metadata.language]))
          errors.push(`Missing option locale ${activity.id}`);
        return optionIds;
      };
      if (activity.type === 'multiple_choice') {
        const options = checkOptions(activity.content.options);
        if (
          activity.correct_answers.some((id) => !options.includes(id)) ||
          new Set(activity.correct_answers).size !== activity.correct_answers.length
        )
          errors.push(`Invalid choice key ${activity.id}`);
        if (!activity.content.multiple && activity.correct_answers.length !== 1)
          errors.push(`Single choice has multiple answers ${activity.id}`);
      } else if (activity.type === 'fill_in_the_blank') {
        const blanks = activity.content.blanks.map((b) => b.id);
        if (
          new Set(blanks).size !== blanks.length ||
          !sameKeys(blanks, Object.keys(activity.correct_answers))
        )
          errors.push(`Invalid blanks ${activity.id}`);
        if (
          Object.values(activity.correct_answers).some((values) =>
            values.some((v) => !normalizeAnswer(v)),
          )
        )
          errors.push(`Empty accepted answer ${activity.id}`);
      } else if (activity.type === 'drag_to_match' || activity.type === 'categorize') {
        const sources = checkOptions(
          activity.type === 'drag_to_match' ? activity.content.left : activity.content.items,
        );
        const destinations = checkOptions(
          activity.type === 'drag_to_match' ? activity.content.right : activity.content.categories,
        );
        if (
          !sameKeys(sources, Object.keys(activity.correct_answers)) ||
          Object.values(activity.correct_answers).some((id) => !destinations.includes(id))
        )
          errors.push(`Invalid map key ${activity.id}`);
        if (
          activity.type === 'drag_to_match' &&
          new Set(Object.values(activity.correct_answers)).size !== sources.length
        )
          errors.push(`Nonunique pairs ${activity.id}`);
      }
    }
  }
  return errors;
}
function sameKeys(a: string[], b: string[]) {
  return a.length === b.length && a.every((key) => b.includes(key));
}

export type Answer = boolean | string[] | Record<string, string>;
export function scoreActivity(
  activity: Activity,
  answer: unknown,
): { score: number; maxScore: number; correct: boolean } {
  let fraction = 0;
  if (activity.type === 'true_false') fraction = answer === activity.correct_answers ? 1 : 0;
  else if (
    activity.type === 'multiple_choice' &&
    Array.isArray(answer) &&
    answer.every((v) => typeof v === 'string')
  ) {
    const selected = new Set(answer as string[]);
    const key = new Set(activity.correct_answers);
    const valid = new Set(activity.content.options.map((o) => o.id));
    if (
      selected.size === answer.length &&
      [...selected].every((id) => valid.has(id)) &&
      (activity.content.multiple || selected.size <= 1)
    ) {
      const hits = [...selected].filter((id) => key.has(id)).length;
      fraction = Math.max(0, (hits - (selected.size - hits)) / key.size);
    }
  } else if (
    (activity.type === 'fill_in_the_blank' ||
      activity.type === 'drag_to_match' ||
      activity.type === 'categorize') &&
    answer &&
    typeof answer === 'object' &&
    !Array.isArray(answer)
  ) {
    const submitted = answer as Record<string, unknown>;
    const keys = Object.keys(activity.correct_answers);
    if (Object.keys(submitted).every((id) => keys.includes(id))) {
      const correct = keys.filter((id) => {
        const value = submitted[id];
        if (typeof value !== 'string') return false;
        if (activity.type === 'fill_in_the_blank')
          return activity.correct_answers[id]?.some(
            (v) => normalizeAnswer(v) === normalizeAnswer(value),
          );
        return activity.correct_answers[id] === value;
      }).length;
      fraction = correct / keys.length;
    }
  }
  const correct = fraction === 1;
  const score =
    Math.round(activity.points * (activity.scoring === 'exact' && !correct ? 0 : fraction) * 100) /
    100;
  return { score, maxScore: activity.points, correct };
}

export function assertEvent(value: unknown): asserts value is LessonEvent {
  if (!validateEvent(value)) throw new Error('Invalid event schema');
  if (['answered', 'hint_used'].includes(value.type) && !value.activity_id)
    throw new Error('Activity required');
  if (
    ['score', 'completed', 'answered'].includes(value.type) &&
    (value.score === undefined || value.max_score === undefined || value.score > value.max_score)
  )
    throw new Error('Valid score bounds required');
}
