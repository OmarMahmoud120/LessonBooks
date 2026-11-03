import { compileFromFile } from 'json-schema-to-typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
for (const kind of ['lesson', 'events']) {
  const schema = resolve(root, `doc/specs/${kind}/v1.schema.json`);
  const output = resolve(root, `doc/contracts/generated/${kind}.ts`);
  const content = await compileFromFile(schema, {
    bannerComment: '/* Generated from doc/specs. Run npm run contracts:generate. */',
    style: { singleQuote: true },
    additionalProperties: false,
    ignoreMinAndMaxItems: true,
  });
  if (check) {
    const existing = await readFile(output, 'utf8').catch(() => '');
    if (existing !== content) throw new Error(`Generated contract drift: ${kind}`);
  } else {
    await mkdir(resolve(root, 'doc/contracts/generated'), { recursive: true });
    await writeFile(output, content);
  }
}
console.log(check ? 'Contracts match canonical schemas.' : 'Contracts generated.');
