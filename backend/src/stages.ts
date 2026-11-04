import { assertLesson, semanticErrors } from '@lessonbooks/contracts';
import { DomainError, type Job, type Kid, type Book } from './domain';
import type { StageState, Topic, Outline } from './pipeline';
import type { FamilyService } from './family';
import type { ImageSink, Ingestor } from './ingest';
import { lessonSchema, type Accounting, type RoutedAI } from './ai';
export type StageInput = {
  state: StageState;
  job: Job;
  kid: Kid;
  book: Book;
  family: FamilyService;
  account: Accounting;
  ingestor: Ingestor;
  ai: RoutedAI;
};
export type StageOutput = StageState;
const objectSchema = (properties: object) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = { type: 'string', minLength: 1, maxLength: 250 };
const topicsSchema = objectSchema({
  topics: {
    type: 'array',
    minItems: 3,
    maxItems: 5,
    items: objectSchema({
      id: str,
      title: str,
      source_pages: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } },
    }),
  },
});
const planSchema = objectSchema({
  outlines: {
    type: 'array',
    minItems: 3,
    maxItems: 5,
    items: objectSchema({ id: str, title: str }),
  },
});
const safetySchema = objectSchema(
  Object.fromEntries(
    ['safe', 'age_appropriate', 'reading_level_appropriate', 'answer_key_consistent'].map((key) => [
      key,
      { type: 'boolean' },
    ]),
  ),
);

export async function ingest(input: StageInput): Promise<StageOutput> {
  const { state, book, family, ingestor, kid } = input;
  // Rasterized pages stay inside the isolated worker temp dir until the sink persists them
  // beside the book source, where family scoping and deletion already apply.
  const sink: ImageSink | undefined = async (page, bytes) => {
    const assetId = `${book.source_path.replace(/\/source\.pdf$/, '')}/pages/page-${page}.png`;
    await family.assets.put(assetId, bytes, 'image/png');
    return assetId;
  };
  state.extracted = await ingestor.extract(
    await family.assets.get(book.source_path),
    kid.language,
    sink,
  );
  return state;
}

export async function structure(input: StageInput): Promise<StageOutput> {
  const { state, kid, account, ai } = input;

  if (!state.extracted) throw new DomainError('missing_ingestion');
  const output = (await ai.run(
    'structure',
    kid.language,
    { pages: state.extracted.pages },
    topicsSchema,
    account,
  )) as { topics: Topic[] };
  if (
    output.topics.some((t) =>
      t.source_pages.some((p) => !state.extracted!.pages.some((page) => page.page === p)),
    )
  )
    throw new DomainError('invalid_source_reference');
  state.topics = output.topics;

  return state;
}

export async function plan(input: StageInput): Promise<StageOutput> {
  const { state, kid, account, ai } = input;
  const child = {
    grade_id: kid.grade_id,
    age_band: kid.age_band,
    curriculum_id: kid.curriculum_id,
    language: kid.language,
    reading_level: kid.reading_level,
  };

  if (!state.topics) throw new DomainError('missing_topics');
  state.outlines = (
    (await ai.run('plan', kid.language, { topics: state.topics, child }, planSchema, account)) as {
      outlines: Outline[];
    }
  ).outlines;
  if (new Set(state.outlines.map((o) => o.id)).size !== state.outlines.length)
    throw new DomainError('duplicate_outline');

  return state;
}

export async function generate(input: StageInput): Promise<StageOutput> {
  const { state, job, kid, account, ai } = input;
  const child = {
    grade_id: kid.grade_id,
    age_band: kid.age_band,
    curriculum_id: kid.curriculum_id,
    language: kid.language,
    reading_level: kid.reading_level,
  };

  if (!state.outlines || !state.extracted) throw new DomainError('missing_plan');
  state.lessons = [];
  for (const [index, outline] of state.outlines.entries()) {
    const lesson = await ai.run(
      'generate',
      kid.language,
      {
        outline,
        child,
        source: state.extracted.pages,
        allowed_activities: [
          'multiple_choice',
          'true_false',
          'fill_in_the_blank',
          'drag_to_match',
          'categorize',
        ],
      },
      lessonSchema,
      account,
    );
    assertLesson(lesson);
    lesson.id = `${job.id}-${index + 1}`;
    if (lesson.metadata.grade_id !== kid.grade_id) throw new DomainError('lesson_profile_mismatch');
    if (
      lesson.metadata.language !== kid.language ||
      lesson.metadata.curriculum_id !== kid.curriculum_id
    )
      throw new DomainError('lesson_profile_mismatch');
    state.lessons.push(lesson);
  }

  return state;
}

export async function validate(input: StageInput): Promise<StageOutput> {
  const { state, kid, account, ai } = input;
  const child = {
    grade_id: kid.grade_id,
    age_band: kid.age_band,
    curriculum_id: kid.curriculum_id,
    language: kid.language,
    reading_level: kid.reading_level,
  };

  if (!state.lessons?.length) throw new DomainError('missing_lessons');
  for (const lesson of state.lessons) {
    assertLesson(lesson);
    if (semanticErrors(lesson).length) throw new DomainError('answer_key_invalid');
    const result = (await ai.run(
      'validate',
      kid.language,
      { lesson, child },
      safetySchema,
      account,
    )) as Record<string, boolean>;
    if (Object.values(result).some((v) => v !== true))
      throw new DomainError('lesson_quality_failed');
  }

  return state;
}

export async function publish(input: StageInput): Promise<StageOutput> {
  if (!input.state.lessons || input.state.lessons.length < 3 || input.state.lessons.length > 5)
    throw new DomainError('invalid_lesson_count');
  input.state.lessons.forEach((lesson) => assertLesson(lesson));
  return input.state;
}
export const stageFunctions = { ingest, structure, plan, generate, validate, publish };
