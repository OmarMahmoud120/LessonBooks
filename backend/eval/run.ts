import { readFile } from 'node:fs/promises';
import { MemoryRepository, MemoryAssets } from '../src/persistence';
import { FamilyService } from '../src/family';
import { Pipeline } from '../src/pipeline';
import { PDFIngestor } from '../src/ingest';
import { MockModelClient, RoutedAI, mockPolicy } from '../src/ai';
import { familyPath, type Job, type LessonRecord } from '../src/domain';
import { assertLesson } from '@lessonbooks/contracts';

const results = [];
for (const [book, grade] of [
  ['counting', 'year-1'],
  ['addition', 'year-2'],
] as const) {
  const family = new FamilyService(new MemoryRepository(), new MemoryAssets());
  const uid = `evaluation-${book}`;
  await family.ensureParent(uid);
  await family.consent(uid, 'privacy');
  await family.consent(uid, 'content_rights');
  const kid = await family.addKid(uid, {
    nickname: 'Sample',
    avatar: 'owl',
    age_band: grade === 'year-1' ? '5-7' : '6-8',
    country: 'GB-ENG',
    language: 'en-GB',
    curriculum_id: 'england-national-2014',
    grade_id: grade,
    reading_level: 'emerging',
  });
  const { job_id } = await family.upload(
    uid,
    kid.id,
    await readFile(`doc/fixtures/books/${book}.pdf`),
    `evaluation-${book}`,
  );
  const pipeline = new Pipeline(
    family,
    new PDFIngestor(),
    new RoutedAI(new MockModelClient(), mockPolicy),
  );
  for (let i = 0; i < 6; i++) await pipeline.run(uid, job_id);
  const job = await family.repo.get<Job>(familyPath(uid, 'generation_jobs', job_id));
  const lessons = await family.repo.list<LessonRecord>(familyPath(uid, 'lessons'));
  if (job?.status !== 'completed' || lessons.length !== 3)
    throw new Error(
      `Mocked pipeline evaluation failed: ${book}, ${job?.stage}, ${job?.error_code ?? job?.status}`,
    );
  for (const record of lessons) {
    const lesson = (await family.lesson(uid, record.id)).lesson;
    assertLesson(lesson);
    if (lesson.metadata.grade_id !== grade) throw new Error('Grade mismatch');
  }
  results.push({
    book,
    grade,
    checks: {
      lesson_count: true,
      schema: true,
      answer_consistency: true,
      grade: true,
      private_drafts: lessons.every((l) => l.status === 'draft'),
    },
  });
}
console.log(
  JSON.stringify(
    {
      mode: 'mock',
      prompt_version: '1',
      policy_version: '1',
      results,
      cost_usd: 0,
      unassessed: [
        'real_model_source_grounding',
        'real_model_safety',
        'real_model_reading_level',
        'learning_outcomes',
      ],
    },
    null,
    2,
  ),
);
