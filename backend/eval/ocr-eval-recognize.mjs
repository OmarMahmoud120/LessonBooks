// Runs inside the worker container: rasterizes each eval page and recognizes it with the
// pinned tessdata_best models (system default) and the fast models (TESSDATA_PREFIX),
// then reports letter-level character error rate per variant.
import { execFile as callbackExec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const exec = promisify(callbackExec);
const dir = process.argv[2] ?? '/eval';
const pagesDir = `${dir}/pages`;
const { pages, references } = JSON.parse(await readFile(`${pagesDir}/manifest.json`, 'utf8'));

const HARAKAT = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
function letters(text) {
  return text
    .normalize('NFKC')
    .replace(HARAKAT, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
function withDiacritics(text) {
  return text
    .normalize('NFKC')
    .replace(/\u0640/g, '')
    .replace(/[^\p{L}\p{N}\u064B-\u065F\u0670]/gu, '');
}
function cer(reference, hypothesis) {
  if (!reference.length) return hypothesis.length ? 1 : 0;
  const dist = Array.from({ length: reference.length + 1 }, (_, i) => [
    i,
    ...Array(hypothesis.length).fill(0),
  ]);
  for (let j = 0; j <= hypothesis.length; j++) dist[0][j] = j;
  for (let i = 1; i <= reference.length; i++)
    for (let j = 1; j <= hypothesis.length; j++)
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1),
      );
  return dist[reference.length][hypothesis.length] / reference.length;
}
const models = [
  { name: 'best', env: {}, lang: 'ara+eng' },
  // The fast baseline ships Arabic data only; mixed-language pages are excluded from it.
  { name: 'fast', env: { TESSDATA_PREFIX: `${dir}/tessdata-fast` }, lang: 'ara' },
];
const results = [];
for (const page of pages) {
  for (const scale of [1800, 2400]) {
    await exec(
      'pdftoppm',
      [
        '-singlefile',
        '-scale-to',
        String(scale),
        '-png',
        `${pagesDir}/${page.id}.pdf`,
        `${pagesDir}/out-${page.id}-${scale}`,
      ],
      { timeout: 60000 },
    );
    for (const model of models.filter((m) => m.name === 'best' || !page.mixed)) {
      const { stdout } = await exec(
        'tesseract',
        [
          `${pagesDir}/out-${page.id}-${scale}.png`,
          'stdout',
          '-l',
          model.lang,
          '--oem',
          '1',
          '--psm',
          '3',
        ],
        { timeout: 120000, env: { ...process.env, ...model.env } },
      );
      const reference = references[page.id];
      results.push({
        id: page.id,
        font: page.font,
        size: page.size,
        vocalized: page.vocalized,
        mixed: page.mixed,
        model: model.name,
        scale,
        cer_letters: cer(letters(reference), letters(stdout)),
        cer_diacritic: page.vocalized
          ? cer(withDiacritics(reference), withDiacritics(stdout))
          : null,
      });
    }
  }
}
console.log(JSON.stringify(results));
