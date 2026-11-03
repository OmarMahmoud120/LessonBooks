import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertLesson } from '@lessonbooks/contracts';
const root = resolve(import.meta.dirname, '../..');
for (const file of await readdir(resolve(root, 'doc/fixtures/lessons'))) {
  if (!file.endsWith('.json')) continue;
  assertLesson(JSON.parse(await readFile(resolve(root, 'doc/fixtures/lessons', file), 'utf8')));
  console.log(`Validated ${file}`);
}
const catalog = JSON.parse(await readFile(resolve(root, 'doc/curricula/england.json'), 'utf8')) as {
  id: string;
  grades: { id: string; subjects: string[] }[];
};
if (
  new Set(catalog.grades.map((g) => g.id)).size !== catalog.grades.length ||
  catalog.grades.some((g) => !g.subjects.includes('mathematics'))
)
  throw new Error('Invalid curriculum catalog');
